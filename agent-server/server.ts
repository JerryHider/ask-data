import { randomUUID } from 'node:crypto';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import express, { type Response } from 'express';
import Type from 'typebox';
import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
  createModels,
} from '@earendil-works/pi-ai';
import { Agent, type AgentTool } from '@earendil-works/pi-agent-core';
import { renderMarkdownTable } from '../extensions/table-render/index.js';
import { routingPrompt } from '../extensions/dual-router/prompts.js';
import { parseDateRange } from './date-range.js';

const app = express();
const port = Number(process.env.AGENT_SERVER_PORT ?? 3000);
const host = process.env.AGENT_SERVER_HOST ?? '127.0.0.1';
const sessionsDir = path.resolve(process.cwd(), '..', 'data', 'sessions');
const registryUrl = process.env.REGISTRY_URL ?? 'http://127.0.0.1:8004';
const artifactParserUrl = process.env.ARTIFACT_PARSER_URL ?? 'http://127.0.0.1:8001';
const metricFlowUrl = process.env.METRICFLOW_BRIDGE_URL ?? 'http://127.0.0.1:8002';
const sandboxUrl = process.env.SQL_SANDBOX_URL ?? 'http://127.0.0.1:8003';

app.use(express.json({ limit: '1mb' }));

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

interface CompileOptions {
  metrics: string[];
  group_by?: string[];
  where?: string;
  limit: number;
  start_time?: string;
  end_time?: string;
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
    const message =
      typeof data === 'object' && data !== null && 'message' in data
        ? String((data as { message?: unknown }).message)
        : `Request failed: ${response.status}`;
    throw new Error(message);
  }
  return data as TResult;
}

function sendEvent(response: Response, event: string, data: unknown): void {
  response.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function extractMetric(message: string): string | null {
  const normalized = message.toLowerCase();
  if (normalized.includes('gmv')) return 'gmv';
  if (normalized.includes('refund')) return 'refund_rate';
  if (normalized.includes('order')) return 'order_count';
  return null;
}

async function searchSchema(message: string): Promise<string> {
  try {
    const result = await postJson<
      { query: string; top_k?: number },
      { results?: { text?: string }[] }
    >(`${artifactParserUrl}/search`, { query: message, top_k: 3 });
    return result.results?.map((item) => item.text).filter(Boolean).join('\n') || '';
  } catch {
    return '';
  }
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

async function runAgentFlow(
  response: Response,
  message: string,
  user: string
): Promise<SessionMessage> {
  const metric = extractMetric(message);
  if (!metric) {
    return runAskFlow(response, message, user);
  }

  const dateRange = parseDateRange(message);
  const models = createModels();
  const faux = fauxProvider();
  models.setProvider(faux.provider);
  const model = faux.getModel();

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

  let finalText = '';
  faux.setResponses([
    () =>
      fauxAssistantMessage(
        [
          fauxToolCall('query_metric', {
            metric,
            ...dateRange,
          }),
        ],
        { stopReason: 'toolUse' }
      ),
    () => {
      finalText = `${renderMarkdownTable(toolResult)}\n\n[来源：dbt 标准指标]`;
      return fauxAssistantMessage(finalText);
    },
  ]);

  let toolResult: QueryResult = {
    columns: [],
    rows: [],
    rowCount: 0,
    durationMs: 0,
    sql: '',
  };

  const agent = new Agent({
    initialState: {
      systemPrompt: routingPrompt,
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
      if (text) sendEvent(response, 'message', { text });
    } else if (event.type === 'agent_end') {
      sendEvent(response, 'done', {});
    }
  });

  await agent.prompt(message);

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
  user: string
): Promise<SessionMessage> {
  const metric = extractMetric(message);
  const dateRange = parseDateRange(message);
  let result: QueryResult | null = null;

  if (!metric) {
    const schema = await searchSchema(message);
    sendEvent(response, 'tool_call', { name: 'search_schema', input: { query: message } });
    sendEvent(response, 'tool_result', { name: 'search_schema', output: { schema } });
  }

  if (metric) {
    result = await queryMetric(response, metric, user, dateRange);
  }

  let text: string;
  if (result) {
    text = `${renderMarkdownTable(result)}\n\n[来源：dbt 标准指标]`;
    sendEvent(response, 'table_result', { title: metric ?? '查询结果', queryResult: result });
  } else {
    text =
      '当前未能完成查询。请确认 artifact-parser、metricflow-bridge 和 sandbox 服务已启动；若问题包含时间、口径或维度，请补充这些信息。';
    sendEvent(response, 'clarify', {
      question: '请补充查询口径',
      options: ['指定时间范围', '指定维度', '查看可用指标'],
    });
  }

  return {
    id: randomUUID(),
    role: 'assistant',
    text,
    createdAt: now(),
  };
}

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
    const assistantMessage = await runAgentFlow(response, body.message, body.user ?? 'admin');
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
    const result = await postJson<Record<string, never>, unknown>(`${artifactParserUrl}/sync`, {});
    response.json({ status: 'ok', result });
  } catch (error) {
    response.status(503).json({ message: (error as Error).message });
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
