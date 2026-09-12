import { randomUUID } from 'node:crypto';
import { mkdir, readdir, readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import express, { type Request, type Response } from 'express';
import Type from 'typebox';
import {
  createProvider,
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
  createModels,
  type Model,
  type Provider,
} from '@earendil-works/pi-ai';
import { anthropicMessagesApi } from '@earendil-works/pi-ai/api/anthropic-messages.lazy';
import { openAICompletionsApi } from '@earendil-works/pi-ai/api/openai-completions.lazy';
import { Agent, type AgentTool } from '@earendil-works/pi-agent-core';
import { renderMarkdownTable } from '../extensions/table-render/index.js';
import { connectorRegistry } from '../extensions/datasource/registry.js';
import { routingPrompt } from '../extensions/dual-router/prompts.js';
import { parseDateRange } from './date-range.js';

const app = express();
const port = Number(process.env.AGENT_SERVER_PORT ?? 3000);
const host = process.env.AGENT_SERVER_HOST ?? '127.0.0.1';
const sessionsDir = path.resolve(process.cwd(), '..', 'data', 'sessions');
const registryUrl = process.env.REGISTRY_URL ?? 'http://127.0.0.1:8004';
const dataIngestUrl = process.env.DATA_INGEST_URL ?? 'http://127.0.0.1:8005';
const artifactParserUrl = process.env.ARTIFACT_PARSER_URL ?? 'http://127.0.0.1:8001';
const metricFlowUrl = process.env.METRICFLOW_BRIDGE_URL ?? 'http://127.0.0.1:8002';
const sandboxUrl = process.env.SQL_SANDBOX_URL ?? 'http://127.0.0.1:8003';

app.use(express.json({ limit: '1mb' }));
app.use(express.raw({ type: 'multipart/form-data', limit: '51mb' }));

interface SessionMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  createdAt: string;
}

interface SessionRecord {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  skillTestId?: string;
  messages: SessionMessage[];
}

interface QueryResult {
  columns: string[];
  rows: Record<string, unknown>[];
  rowCount: number;
  durationMs: number;
  sql: string;
}

interface LlmRuntimeConfig {
  id: number;
  name: string;
  provider: string;
  model: string;
  api_key?: string | null;
  base_url?: string | null;
  temperature: number;
  max_tokens: number;
}

interface CompileOptions {
  metrics: string[];
  group_by?: string[];
  where?: string;
  limit: number;
  start_time?: string;
  end_time?: string;
}

interface SemanticMetric {
  name: string;
  description: string;
  type: string;
  available_dimensions: string[];
}

interface SemanticMetricQueryRequest {
  metrics: string[];
  groupBy?: string[];
  startTime?: string;
  endTime?: string;
  limit?: number;
  user?: string;
}

interface QueryMetricParameters {
  metric: string;
  startTime?: string;
  endTime?: string;
}

function now(): string {
  return new Date().toISOString();
}

function sessionPath(sessionId: string): string {
  if (!/^[a-f0-9-]{36}$/i.test(sessionId)) {
    throw new Error('Invalid session id');
  }
  return path.join(sessionsDir, `${sessionId}.json`);
}

async function ensureSessionsDir(): Promise<void> {
  await mkdir(sessionsDir, { recursive: true });
}

async function readSession(sessionId: string): Promise<SessionRecord | null> {
  try {
    return JSON.parse(await readFile(sessionPath(sessionId), 'utf8')) as SessionRecord;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

async function writeSession(session: SessionRecord): Promise<void> {
  await ensureSessionsDir();
  await writeFile(sessionPath(session.id), `${JSON.stringify(session, null, 2)}\n`, 'utf8');
}

async function deleteSession(sessionId: string): Promise<boolean> {
  const session = await readSession(sessionId);
  if (!session) return false;
  await unlink(sessionPath(sessionId));
  return true;
}

async function listSessions(): Promise<SessionRecord[]> {
  await ensureSessionsDir();
  const files = await readdir(sessionsDir);
  const sessions: SessionRecord[] = [];
  for (const file of files) {
    if (!file.endsWith('.json')) continue;
    try {
      sessions.push(JSON.parse(await readFile(path.join(sessionsDir, file), 'utf8')) as SessionRecord);
    } catch {
      continue;
    }
  }
  return sessions.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

async function postJson<TRequest, TResult>(url: string, payload: TRequest): Promise<TResult> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data: unknown = await response.json();
  if (!response.ok) {
    const detailMessage =
      typeof data === 'object' && data !== null && 'detail' in data
        ? String((data as { detail?: unknown }).detail)
        : typeof data === 'object' && data !== null && 'error' in data && 'message' in data
          ? String((data as { message?: unknown }).message)
          : null;
    const message =
      typeof data === 'object' && data !== null && 'message' in data
        ? String((data as { message?: unknown }).message)
        : detailMessage ?? `Request failed: ${response.status}`;
    throw new Error(message);
  }
  return data as TResult;
}

interface SkillRecord {
  id: number;
  name: string;
  description: string;
  trigger_keywords: string[];
  prompt_addition: string;
  allowed_tools: string[];
  enabled: boolean;
}

async function getRegistryJson<T>(path: string): Promise<T | null> {
  try {
    const response = await fetch(`${registryUrl}${path}`);
    if (!response.ok) return null;
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

async function activeLlmConfig(): Promise<LlmRuntimeConfig | null> {
  try {
    return await postJson<Record<string, never>, LlmRuntimeConfig | null>(
      `${registryUrl}/llm-configs/runtime`,
      {}
    );
  } catch {
    return null;
  }
}

function llmBaseUrl(config: LlmRuntimeConfig): string {
  if (config.base_url) return config.base_url.replace(/\/+$/, '');
  switch (config.provider) {
    case 'openai':
      return 'https://api.openai.com/v1';
    case 'deepseek':
      return 'https://api.deepseek.com/v1';
    case 'ollama':
      return 'http://host.docker.internal:11434/v1';
    case 'anthropic':
      return 'https://api.anthropic.com';
    default:
      return '';
  }
}

function registryProvider(config: LlmRuntimeConfig): Provider {
  const baseUrl = llmBaseUrl(config);
  const providerId = `registry-${config.id}`;
  const auth = {
    apiKey: {
      name: `${config.provider} registry credential`,
      resolve: async () => ({
        auth: { apiKey: config.api_key || 'local-model', baseUrl },
        source: 'AskData registry',
      }),
    },
  };

  if (config.provider === 'anthropic') {
    const model: Model<'anthropic-messages'> = {
      id: config.model,
      name: config.name,
      api: 'anthropic-messages',
      provider: providerId,
      baseUrl,
      reasoning: false,
      input: ['text'],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 128000,
      maxTokens: config.max_tokens,
      samplingParams: { temperature: config.temperature },
    };
    return createProvider<'anthropic-messages'>({
      id: providerId,
      name: config.name,
      baseUrl,
      auth,
      models: [model],
      api: anthropicMessagesApi(),
    });
  }

  const model: Model<'openai-completions'> = {
    id: config.model,
    name: config.name,
    api: 'openai-completions',
    provider: providerId,
    baseUrl,
    reasoning: false,
    input: ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128000,
    maxTokens: config.max_tokens,
    samplingParams: { temperature: config.temperature },
    compat: { supportsDeveloperRole: false, maxTokensField: 'max_tokens' },
  };
  return createProvider<'openai-completions'>({
    id: providerId,
    name: config.name,
    baseUrl,
    auth,
    models: [model],
    api: openAICompletionsApi(),
  });
}

async function createLlmRuntime() {
  const config = await activeLlmConfig();
  const models = createModels();
  if (!config || !config.model || !llmBaseUrl(config) || (config.provider === 'anthropic' && !config.api_key)) {
    const faux = fauxProvider();
    models.setProvider(faux.provider);
    return {
      models,
      model: faux.getModel(),
      faux,
      providerName: 'faux',
      modelName: 'faux',
    };
  }
  const provider = registryProvider(config);
  models.setProvider(provider);
  const model = provider.getModels()[0];
  if (!model) throw new Error('Active LLM model is unavailable');
  return {
    models,
    model,
    providerName: config.provider,
    modelName: config.model,
  };
}

async function activeSkills(skillTestId?: string): Promise<SkillRecord[]> {
  const skills = await getRegistryJson<SkillRecord[]>(
    skillTestId ? `/skills` : `/skills?enabled=true`
  );
  if (!skills) return [];
  return skillTestId ? skills.filter((skill) => String(skill.id) === skillTestId) : skills;
}

function matchingSkills(message: string, skills: SkillRecord[]): SkillRecord[] {
  const normalized = message.toLowerCase();
  return skills.filter((skill) =>
    skill.trigger_keywords.some((keyword) => normalized.includes(keyword.toLowerCase()))
  );
}

function skillAllowsTool(skill: SkillRecord, toolName: string): boolean {
  if (skill.allowed_tools.length === 0) return true;
  return (
    skill.allowed_tools.includes(toolName) ||
    toolName === 'search_schema' ||
    toolName === 'render_table'
  );
}

function sendEvent(response: Response, event: string, data: unknown): void {
  response.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function extractMetric(message: string): string | null {
  const normalized = message.toLowerCase();
  if (normalized.includes('明细') || normalized.includes('sql')) return null;
  if (/删除|清空|drop|truncate|delete/i.test(message)) return null;
  if (normalized.includes('refund_rate_local_ratio')) return 'refund_rate_local_ratio';
  if (normalized.includes('gmv')) return 'gmv';
  if (normalized.includes('refund') || normalized.includes('退款')) return 'refund_rate';
  if (normalized.includes('订单数')) return 'order_count';
  if (normalized.includes('order')) return 'order_count';
  return null;
}

function isMetricExplanation(message: string): boolean {
  return /是怎么算的|怎么计算|计算方式|口径|定义/.test(message);
}

interface SearchContext {
  schema: string;
  examples: { question: string; sql: string; metric_name?: string | null }[];
  knowledge: { space: string; content: string; source: string }[];
}

async function searchContext(message: string): Promise<SearchContext> {
  try {
    const result = await postJson<
      { query: string; top_k?: number },
      {
        models?: { name?: string; description?: string }[];
        metrics?: { name?: string; description?: string }[];
      }
    >(`${artifactParserUrl}/search`, { query: message, top_k: 3 });
    const schema = [
      ...(result.models ?? []).map((item) => `${item.name ?? ''}: ${item.description ?? ''}`),
      ...(result.metrics ?? []).map((item) => `${item.name ?? ''}: ${item.description ?? ''}`),
    ].filter(Boolean).join('\n');
    const examples = await postJson<{ query: string }, SearchContext['examples']>(
      `${registryUrl}/sql-examples/search`,
      { query: message }
    ).catch(() => []);
    const spaces = await getRegistryJson<
      { name: string; docs: { file_name: string; content: string }[] }[]
    >('/rag/active-spaces');
    const normalized = message.toLowerCase();
    const knowledge = (spaces ?? []).flatMap((space) =>
      space.docs
        .filter((doc) =>
          normalized.split(/\s+/).some((token) => doc.content.toLowerCase().includes(token))
        )
        .slice(0, 3)
        .map((doc) => ({
          space: space.name,
          content: doc.content.slice(0, 1200),
          source: doc.file_name,
        }))
    );
    return { schema, examples, knowledge };
  } catch {
    return { schema: '', examples: [], knowledge: [] };
  }
}

async function importedTableFor(table: string): Promise<string> {
  const models = await getRegistryJson<
    { config: { source_table?: string; source_schema?: string | null } }[]
  >('/semantic-models?status=published');
  const imported = (models ?? []).find(
    (model) => model.config.source_table === table && model.config.source_schema
  );
  return imported ? `${imported.config.source_schema}.${table}` : table;
}

async function queryMetric(
  response: Response,
  metric: string,
  user: string,
  dateRange: { startTime?: string; endTime?: string }
): Promise<QueryResult | null> {
  sendEvent(response, 'tool_call', {
    name: 'query_metric',
    input: { metric, ...dateRange },
  });
  try {
    const compiled = await postJson<CompileOptions, { sql: string }>(
      `${metricFlowUrl}/compile_sql`,
      {
        metrics: [metric],
        limit: 100,
        start_time: dateRange.startTime,
        end_time: dateRange.endTime,
      }
    );
    const result = await postJson<
      { sql: string; datasource: string; user: string },
      QueryResult
    >(`${sandboxUrl}/execute`, {
      sql: compiled.sql,
      datasource: 'mysql',
      user,
    });
    sendEvent(response, 'tool_result', { name: 'query_metric', output: result });
    return result;
  } catch (error) {
    sendEvent(response, 'tool_result', {
      name: 'query_metric',
      output: { error: (error as Error).message },
    });
    return null;
  }
}

async function executeSql(
  response: Response,
  sql: string,
  user: string
): Promise<QueryResult | null> {
  sendEvent(response, 'tool_call', { name: 'execute_sql', input: { sql } });
  try {
    const result = await postJson<
      { sql: string; datasource: string; user: string },
      QueryResult
    >(`${sandboxUrl}/execute`, {
      sql,
      datasource: 'mysql',
      user,
    });
    sendEvent(response, 'tool_result', { name: 'execute_sql', output: result });
    return result;
  } catch (error) {
    sendEvent(response, 'tool_result', {
      name: 'execute_sql',
      output: { error: (error as Error).message },
    });
    return null;
  }
}

async function explainMetricFlow(response: Response, metric: string): Promise<SessionMessage> {
  sendEvent(response, 'tool_call', { name: 'explain_metric', input: { metric } });
  try {
    const result = await postJson<
      { metric: string },
      { name: string; description: string; numerator: string; denominator: string; expression: string }
    >(`${metricFlowUrl}/explain_metric`, { metric });
    sendEvent(response, 'tool_result', { name: 'explain_metric', output: result });
    const text = [
      `${result.name}：${result.description || '暂无口径描述'}`,
      result.expression ? `计算公式：${result.expression}` : '',
    ]
      .filter(Boolean)
      .join('\n');
    sendEvent(response, 'message', { text });
    sendEvent(response, 'done', {});
    return { id: randomUUID(), role: 'assistant', text, createdAt: now() };
  } catch (error) {
    const text = `指标解释失败：${(error as Error).message}`;
    sendEvent(response, 'tool_result', { name: 'explain_metric', output: { error: text } });
    sendEvent(response, 'message', { text });
    sendEvent(response, 'done', {});
    return { id: randomUUID(), role: 'assistant', text, createdAt: now() };
  }
}

async function runAgentFlow(
  response: Response,
  message: string,
  user: string,
  session?: SessionRecord
): Promise<SessionMessage> {
  const metric = extractMetric(message);
  if (!metric) {
    return runAskFlow(response, message, user, session);
  }
  if (isMetricExplanation(message)) {
    return explainMetricFlow(response, metric);
  }
  const dateRangeForClarification = parseDateRange(message);
  if (/上季度/.test(message) && !dateRangeForClarification.startTime) {
    const text = '请补充时间范围和统计口径。';
    sendEvent(response, 'clarify', {
      question: text,
      options: ['按订单日期统计 2026 年第二季度', '查看可用指标'],
    });
    sendEvent(response, 'message', { text });
    sendEvent(response, 'done', {});
    return { id: randomUUID(), role: 'assistant', text, createdAt: now() };
  }
  const skills = await activeSkills(session?.skillTestId);
  const matchedSkills = matchingSkills(message, skills);
  const blockedSkill = matchedSkills.find((skill) => !skillAllowsTool(skill, 'query_metric'));
  if (blockedSkill) {
    const text = '当前 Skill 限制工具：' + blockedSkill.name;
    sendEvent(response, 'message', { text });
    sendEvent(response, 'done', {});
    return { id: randomUUID(), role: 'assistant', text, createdAt: now() };
  }
  const skillPrompt = matchedSkills
    .map(
      (skill) =>
        '=== 可用 Skills ===\n### Skill: ' +
        skill.name +
        '\n触发场景: ' +
        skill.trigger_keywords.join(',') +
        '\n' +
        skill.prompt_addition +
        '\n允许工具: ' +
        (skill.allowed_tools.length ? skill.allowed_tools.join(',') : '全部')
    )
    .join('\n');
  const skillPrefix = matchedSkills.map((skill) => skill.prompt_addition + '\n').join('');

  const dateRange = parseDateRange(message);
  const context = await searchContext(message);
  sendEvent(response, 'tool_call', { name: 'search_schema', input: { query: message } });
  sendEvent(response, 'tool_result', { name: 'search_schema', output: context });
  const llm = await createLlmRuntime();
  sendEvent(response, 'llm', {
    provider: llm.providerName,
    model: llm.modelName,
  });
  const models = llm.models;
  const model = llm.model;

  const queryMetricSchema = Type.Object({
    metric: Type.String(),
    startTime: Type.Optional(Type.String()),
    endTime: Type.Optional(Type.String()),
  });

  const tool: AgentTool<typeof queryMetricSchema, QueryResult> = {
    name: 'query_metric',
    label: 'Query metric',
    description: 'Query a standard dbt metric.',
    parameters: queryMetricSchema,
    execute: async (_toolCallId, params) => {
      const compiled = await postJson<CompileOptions, { sql: string }>(
        `${metricFlowUrl}/compile_sql`,
        {
          metrics: [params.metric],
          limit: 100,
          start_time: params.startTime,
          end_time: params.endTime,
        }
      );
      const result = await postJson<
        { sql: string; datasource: string; user: string },
        QueryResult
      >(`${sandboxUrl}/execute`, {
        sql: compiled.sql,
        datasource: 'mysql',
        user,
      });
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result) }],
        details: result,
      };
    },
  };

  let assistantText = '';
  let finalText = '';
  const faux = 'faux' in llm ? llm.faux : undefined;
  if (faux) {
    faux.setResponses([
      () =>
        fauxAssistantMessage(
          [fauxToolCall('query_metric', { metric, ...dateRange })],
          { stopReason: 'toolUse' }
        ),
      () => fauxAssistantMessage(''),
    ]);
  }

  let toolResult: QueryResult = {
    columns: [],
    rows: [],
    rowCount: 0,
    durationMs: 0,
    sql: '',
  };

  const agent = new Agent({
    initialState: {
      systemPrompt: [routingPrompt, skillPrompt].filter(Boolean).join('\n'),
      model,
      tools: [tool],
    },
    streamFn: models.streamSimple.bind(models),
  });

  agent.subscribe((event) => {
    if (event.type === 'tool_execution_start') {
      sendEvent(response, 'tool_call', {
        name: event.toolName,
        input: event.args,
      });
    } else if (event.type === 'tool_execution_end') {
      toolResult = event.result.details;
      sendEvent(response, 'tool_result', {
        name: event.toolName,
        output: event.result.details,
      });
      sendEvent(response, 'table_result', {
        title: metric,
        queryResult: event.result.details,
      });
    } else if (event.type === 'message_end' && event.message.role === 'assistant') {
      const text = event.message.content
        .filter((block) => block.type === 'text')
        .map((block) => block.text)
        .join('');
      if (text) assistantText += `${text}\n`;
    } else if (event.type === 'agent_end') {
      if (toolResult.sql) {
        const source = context.knowledge.length
          ? `知识库：${context.knowledge[0].space}`
          : 'dbt 标准指标';
        const summary = assistantText.trim() ? `\n\n${assistantText.trim()}` : '';
        finalText = `${skillPrefix}${renderMarkdownTable(toolResult)}${summary}\n\n[来源：${source}]`;
        if (context.knowledge.length) {
          finalText += `\n\n${context.knowledge[0].content}`;
        }
        sendEvent(response, 'message', { text: finalText });
      }
      sendEvent(response, 'done', {});
    }
  });

  const promptMessage = [
    `请调用 query_metric 工具查询指标 ${metric}。`,
    dateRange.startTime ? `开始时间：${dateRange.startTime}` : '',
    dateRange.endTime ? `结束时间：${dateRange.endTime}` : '',
  ]
    .filter(Boolean)
    .join('\n');
  await agent.prompt(promptMessage);

  return {
    id: randomUUID(),
    role: 'assistant',
    text: finalText,
    createdAt: now(),
  };
}

async function runAskFlow(
  response: Response,
  message: string,
  user: string,
  session?: SessionRecord
): Promise<SessionMessage> {
  const metric = extractMetric(message);
  const dateRange = parseDateRange(message);
  let result: QueryResult | null = null;
  const skills = await activeSkills(session?.skillTestId);
  const matchedSkills = matchingSkills(message, skills);
  const context = await searchContext(message);
  sendEvent(response, 'tool_call', { name: 'search_schema', input: { query: message } });
  sendEvent(response, 'tool_result', { name: 'search_schema', output: context });
  const skillPrefix = matchedSkills.map((skill) => skill.prompt_addition + '\n').join('');
  const wantsSql = /明细|sql|前\s*\d+|(?:from|查|查询)\s+[A-Za-z_][A-Za-z0-9_.]*/i.test(message);
  const wantsWrite = /删除|清空|drop|truncate|delete/i.test(message);
  const blockedSkill = matchedSkills.find((skill) => !skillAllowsTool(skill, wantsSql ? 'execute_sql' : 'query_metric'));

  if (blockedSkill) {
    const text = '当前 Skill 限制工具：' + blockedSkill.name;
    sendEvent(response, 'message', { text });
    sendEvent(response, 'done', {});
    return { id: randomUUID(), role: 'assistant', text, createdAt: now() };
  }

  if (wantsWrite) {
    const result = await executeSql(response, 'DELETE FROM fct_orders', user);
    const text = result
      ? '写操作未被拦截，请立即检查沙箱配置。'
      : '写操作已被 SQL 沙箱拦截；系统未提供 bash 工具，无法绕过沙箱执行数据库命令。';
    sendEvent(response, 'message', { text });
    sendEvent(response, 'done', {});
    return { id: randomUUID(), role: 'assistant', text, createdAt: now() };
  }

  if (wantsSql) {
    const tableMatch = message.match(/(?:from|查|查询|sql)\s+([A-Za-z_][A-Za-z0-9_.]*)/i);
    const limitMatch = message.match(/前\s*(\d+)/i);
    const amountMatch = message.match(/金额大于\s*(\d+(?:\.\d+)?)/i);
    const table = tableMatch?.[1] ?? 'fct_orders';
    const physicalTable = await importedTableFor(table);
    const limit = Math.min(Number(limitMatch?.[1] ?? 10), 1000);
    const where = amountMatch ? ` WHERE amount > ${amountMatch[1]}` : '';
    const sql = `SELECT * FROM ${physicalTable}${where} ORDER BY id DESC LIMIT ${limit}`;
    result = await executeSql(response, sql, user);
  } else if (metric) {
    result = await queryMetric(response, metric, user, dateRange);
  }

  let text: string;
  if (result) {
    const source = wantsSql
      ? '临时 SQL 查询'
      : context.knowledge.length
        ? `知识库 ${context.knowledge[0].space}`
        : 'dbt 标准指标';
    text = `${skillPrefix}${renderMarkdownTable(result)}\n\n[来源：${source}]`;
    if (context.knowledge.length) {
      text += `\n\n${context.knowledge[0].content}`;
    }
    if (context.examples.length) {
      text += `\n\n参考样例：${context.examples[0].question}`;
    }
    sendEvent(response, 'table_result', {
      title: metric ?? (wantsSql ? '明细查询' : '查询结果'),
      queryResult: result,
    });
  } else {
    text =
      '当前未能完成查询。请确认 artifact-parser、metricflow-bridge 和 sandbox 服务已启动；若问题包含时间、口径或维度，请补充这些信息。';
    sendEvent(response, 'clarify', {
      question: '请补充查询口径',
      options: ['指定时间范围', '指定维度', '查看可用指标'],
    });
  }

  sendEvent(response, 'message', { text });
  sendEvent(response, 'done', {});
  return {
    id: randomUUID(),
    role: 'assistant',
    text,
    createdAt: now(),
  };
}

async function proxyRequest(
  request: Request,
  response: Response,
  baseUrl: string,
  prefix: string
): Promise<void> {
  const target = baseUrl + request.originalUrl.slice(prefix.length);
  const rawContentType = request.headers['content-type'];
  const contentType = Array.isArray(rawContentType) ? rawContentType[0] : rawContentType;
  const init: RequestInit = {
    method: request.method,
    headers: contentType ? { 'content-type': contentType } : {},
  };
  if (!['GET', 'HEAD'].includes(request.method) && request.body) {
    init.body = Buffer.isBuffer(request.body)
      ? new Uint8Array(request.body)
      : JSON.stringify(request.body);
  }
  try {
    const upstream = await fetch(target, init);
    const text = await upstream.text();
    response.status(upstream.status).type('json').send(text);
  } catch (error) {
    response.status(503).json({ message: (error as Error).message });
  }
}

app.all('/api/registry/*', (request, response) => {
  void proxyRequest(request, response, registryUrl, '/api/registry');
});

app.all('/api/ingest/*', (request, response) => {
  void proxyRequest(request, response, dataIngestUrl, '/api/ingest');
});

app.get('/health', (_request, response) => {
  response.json({ status: 'ok' });
});

app.post('/api/session', async (request, response) => {
  const body = (request.body ?? {}) as { skill_test?: string };
  const session: SessionRecord = {
    id: randomUUID(),
    title: '新任务',
    createdAt: now(),
    updatedAt: now(),
    skillTestId: body.skill_test,
    messages: [],
  };
  await writeSession(session);
  response.status(201).json({ sessionId: session.id });
});

app.get('/api/sessions', async (_request, response) => {
  const sessions = await listSessions();
  response.json(
    sessions.map(({ id, title, createdAt, updatedAt, skillTestId }) => ({
      id,
      title,
      createdAt,
      updatedAt,
      skillTestId,
    }))
  );
});

app.get('/api/sessions/:id/messages', async (request, response) => {
  const session = await readSession(request.params.id);
  if (!session) {
    response.status(404).json({ message: 'Session not found' });
    return;
  }
  response.json(session.messages);
});

app.delete('/api/sessions/:id', async (request, response) => {
  const sessionId = request.params.id;
  if (!/^[a-f0-9-]{36}$/i.test(sessionId)) {
    response.status(400).json({ message: 'Invalid session id' });
    return;
  }
  try {
    const deleted = await deleteSession(sessionId);
    if (!deleted) {
      response.status(404).json({ message: 'Session not found' });
      return;
    }
    response.status(204).send();
  } catch (error) {
    response.status(500).json({ message: (error as Error).message });
  }
});

app.post('/api/message', async (request, response) => {
  const body = request.body as { sessionId?: string; message?: string; user?: string };
  if (!body.sessionId || !body.message?.trim()) {
    response.status(400).json({ message: 'sessionId and message are required' });
    return;
  }
  const session = await readSession(body.sessionId);
  if (!session) {
    response.status(404).json({ message: 'Session not found' });
    return;
  }

  response.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
  });
  response.flushHeaders?.();

  const userMessage: SessionMessage = {
    id: randomUUID(),
    role: 'user',
    text: body.message.trim(),
    createdAt: now(),
  };
  try {
    const assistantMessage = await runAgentFlow(
      response,
      body.message,
      body.user ?? 'admin',
      session
    );
    session.messages.push(userMessage, assistantMessage);
    if (session.title === '新任务') session.title = userMessage.text.slice(0, 20);
    session.updatedAt = now();
    await writeSession(session);
  } catch (error) {
    sendEvent(response, 'message', { text: `执行失败：${(error as Error).message}` });
    sendEvent(response, 'done', {});
  } finally {
    response.end();
  }
});

app.post('/api/datasources/refresh', async (_request, response) => {
  try {
    await connectorRegistry.refreshFromRegistry();
    const result = await postJson<Record<string, never>, unknown>(`${artifactParserUrl}/sync`, {});
    response.json({ status: 'ok', datasources: connectorRegistry.listNames(), result });
  } catch (error) {
    response.status(503).json({ message: (error as Error).message });
  }
});

app.get('/api/semantic-metrics', async (_request, response) => {
  try {
    const metrics = await postJson<Record<string, never>, SemanticMetric[]>(
      `${metricFlowUrl}/list_metrics`,
      {}
    );
    response.json(metrics);
  } catch (error) {
    response.status(503).json({ message: (error as Error).message });
  }
});

app.post('/api/semantic-metrics/query', async (request, response) => {
  const body = (request.body ?? {}) as SemanticMetricQueryRequest;
  const metrics = (body.metrics ?? []).map((metric) => metric.trim()).filter(Boolean);
  const limit = Number(body.limit ?? 100);
  if (metrics.length === 0) {
    response.status(400).json({ message: 'metrics is required' });
    return;
  }
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000) {
    response.status(400).json({ message: 'limit must be 1-1000' });
    return;
  }

  try {
    const compiled = await postJson<
      CompileOptions,
      { sql: string; dialect: string }
    >(`${metricFlowUrl}/compile_sql`, {
      metrics,
      group_by: body.groupBy ?? [],
      limit,
      start_time: body.startTime,
      end_time: body.endTime,
    });
    const result = await postJson<
      { sql: string; datasource: string; user: string },
      QueryResult
    >(`${sandboxUrl}/execute`, {
      sql: compiled.sql,
      datasource: 'mysql',
      user: body.user ?? 'admin',
    });
    response.json(result);
  } catch (error) {
    response.status(422).json({ message: (error as Error).message });
  }
});

app.get('/api/registry/llm-configs', async (_request, response) => {
  try {
    const result = await fetch(`${registryUrl}/llm-configs?is_active=true`);
    response.status(result.status).json(await result.json());
  } catch {
    response.json([]);
  }
});

app.listen(port, host, () => {
  console.log(`agent-server listening on http://${host}:${port}`);
});
