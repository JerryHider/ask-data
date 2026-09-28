import { randomUUID } from 'node:crypto';
import type { Response } from 'express';
import {
  Agent,
  type AgentEvent,
  type AgentMessage,
  type AgentOptions,
  type AgentState,
} from '@earendil-works/pi-agent-core';
import { fauxAssistantMessage, fauxToolCall } from '@earendil-works/pi-ai';
import { createAgentTools } from './agent-tools.js';
import { renderMarkdownTable } from '../extensions/table-render/index.js';
import { appendRolloutEvent } from './rollout.js';
import type {
  QueryMetricOptions,
  QueryResult,
  SemanticModelRecord,
  SessionMessage,
  SessionRecord,
} from './types.js';

const maxTurns = 8;

export interface FullAgentLlmRuntime {
  model: AgentState['model'];
  streamFn: AgentOptions['streamFn'];
  faux?: {
    setResponses: (responses: (() => ReturnType<typeof fauxAssistantMessage>)[]) => void;
  };
}

export interface FullAgentRequest {
  response: Response;
  message: string;
  user: string;
  session: SessionRecord;
  semanticModels: Parameters<typeof createAgentTools>[0]['semanticModels'];
  dependencies: Omit<Parameters<typeof createAgentTools>[0], 'user' | 'sessionId' | 'requestId' | 'semanticModels'>;
  llm: FullAgentLlmRuntime;
  preprocessed: QueryMetricOptions;
  fallbackContext: () => Promise<{ examples: { question: string }[] }>;
  skillPrompt?: string;
  clarification?: {
    question: string;
    selectedOption: string;
  };
}

export function toAgentMessages(history: SessionMessage[]): AgentMessage[] {
  return history.map((message) => {
    const timestamp = Date.parse(message.createdAt);
    const safeTimestamp = Number.isFinite(timestamp) ? timestamp : Date.now();
    if (message.role === 'assistant') {
      return fauxAssistantMessage(message.text, { timestamp: safeTimestamp });
    }
    return {
      role: 'user',
      content: message.text,
      timestamp: safeTimestamp,
    };
  });
}

export function renderSemanticDescriptions(models: SemanticModelRecord[]): string {
  const sections = models
    .map((model) => {
      const elements = [
        ...(model.config.entities ?? []).map((item) => ({
          kind: 'entity',
          name: item.name,
          description: item.description,
        })),
        ...(model.config.dimensions ?? []).map((item) => ({
          kind: 'dimension',
          name: item.name,
          description: item.description,
        })),
        ...(model.config.measures ?? []).map((item) => ({
          kind: 'measure',
          name: item.name,
          description: item.description,
        })),
      ]
        .filter((item) => item.name && item.description)
        .map((item) => `- ${item.kind} ${item.name}: ${item.description}`);

      if (model.config.description) {
        elements.unshift(`- model ${model.config.name}: ${model.config.description}`);
      }
      if (!elements.length) return '';
      return `### ${model.config.name ?? model.name}\n${elements.join('\n')}`;
    })
    .filter(Boolean);

  if (!sections.length) return '';
  return `=== 语义模型描述 ===\n${sections.join('\n\n')}`;
}

export function fullAgentSystemPrompt(skillPrompt = '', semanticDescriptions = ''): string {
  return [
    '生成工具参数和最终答案前，必须先参考语义模型描述；描述中的业务口径、维度含义和计算说明优先于名称直觉。',
    '遇到以下情况时，立即停止推理并调用 clarify：',
    '- 范围歧义：用户问“分区域/分城市”时，上一轮实体的区域内细分（如湖北各市州）与实体外扩展（如全国各区域）均合理；',
    '- 粒度歧义：“按月/按年”与上一轮时间语境冲突；',
    '- 维度继承 vs 重置：省略指代（“那安徽呢”）与代词指代（“该省”）的解析。',
    'clarify 选项必须是你权衡中的候选项（如：湖北省内各市州 / 全国各区域），不要在 thinking 中反复权衡后自行裁决。',
    '你是企业智能问数助手。所有问题都必须通过工具闭环完成，不允许编造数据。',
    '标准流程：search_metrics -> query_metric；未命中或需临时分析时 search_context -> run_sql；仅语义近似或口径冲突时先 clarify。',
    'query_metric 的 dimensions 必须来自工具返回的维度白名单；不要绕过它手写标准指标 SQL。',
    'run_sql 只允许只读 SELECT/WITH；写操作、标记、删除、更新类请求必须明确拒绝并说明原因。',
    '结果必须说明来源：dbt 标准指标、临时 SQL 查询或知识库。',
    '如果指标字面或 synonyms 精确命中，并且预处理已给出过滤/分组条件，应直接 query_metric；未指定时间默认查询全部历史并在结果中说明。',
    '如果指标只是语义近似命中（例如“营收”近似“保费收入”），必须先 clarify 确认业务口径。',
    '处理包含代词、省略主语或省略时间的问题时，必须先从完整对话历史解析出明确的指标实体、过滤条件和时间范围，再把解析结果应用到工具参数。',
    '只有当当前问题和完整对话历史都无法确定必要实体或时间范围时，才调用 clarify；不要在历史已有答案时重复追问。',
    "query_metric 的 where 必须使用原生 Jinja 语法，例如 {{ Dimension('order__insure_unit_province') }} = '湖北省'；不要使用裸字段或 ==。",
    skillPrompt,
    semanticDescriptions,
  ]
    .filter(Boolean)
    .join('\n');
}

function isQueryResult(value: unknown): value is QueryResult {
  return (
    typeof value === 'object' &&
    value !== null &&
    Array.isArray((value as QueryResult).columns) &&
    typeof (value as QueryResult).rowCount === 'number'
  );
}

function messageText(message: unknown): string {
  if (typeof message !== 'object' || message === null) return '';
  const content = (message as { content?: unknown }).content;
  if (!Array.isArray(content)) return '';
  return content
    .map((block) =>
      typeof block === 'object' &&
      block !== null &&
      (block as { type?: string }).type === 'text'
        ? String((block as { text?: unknown }).text ?? '')
        : ''
    )
    .join('');
}

function rolloutPayload(event: AgentEvent): unknown {
  if (event.type === 'message_update') {
    return {
      type: event.type,
      updateType: event.assistantMessageEvent.type,
    };
  }
  if (event.type === 'message_end') {
    const message = event.message as {
      stopReason?: unknown;
      usage?: { reasoning?: number; output?: number };
    };
    return {
      type: event.type,
      stopReason: message.stopReason,
      thinkingTokens: message.usage?.reasoning,
      outputTokens: message.usage?.output,
    };
  }
  if (event.type === 'turn_end') {
    const message = event.message as {
      stopReason?: unknown;
      usage?: { reasoning?: number; output?: number };
    };
    return {
      type: event.type,
      stopReason: message.stopReason,
      thinkingTokens: message.usage?.reasoning,
      outputTokens: message.usage?.output,
      toolNames: event.toolResults.map((result) => result.toolName),
    };
  }
  if (event.type === 'agent_end') {
    return {
      type: event.type,
      messageCount: event.messages.length,
    };
  }
  return event;
}

export async function runFullAgentFlow(request: FullAgentRequest): Promise<SessionMessage> {
  const {
    response,
    message,
    user,
    session,
    semanticModels,
    dependencies,
    llm,
    preprocessed,
    fallbackContext,
    skillPrompt,
    clarification,
  } = request;
  const requestId = randomUUID();
  const requestStartedAt = Date.now();
  let lastOutputAt = Date.now();
  const writeSse = (event: string, data: unknown): void => {
    response.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };
  const emit = (event: string, data: unknown): void => {
    lastOutputAt = Date.now();
    writeSse(event, data);
    void appendRolloutEvent(session.id, requestId, event, data).catch(() => undefined);
  };
  const emitSse = (event: string, data: unknown): void => {
    lastOutputAt = Date.now();
    writeSse(event, data);
  };

  let reasoningSeq = 0;
  const emitReasoningDelta = (delta: string): void => {
    if (!delta) return;
    reasoningSeq += 1;
    emitSse('reasoning', { seq: reasoningSeq, delta });
  };

  const heartbeat = setInterval(() => {
    if (Date.now() - lastOutputAt < 3000) return;
    const elapsedSeconds = Math.floor((Date.now() - requestStartedAt) / 1000);
    writeSse('heartbeat', {
      text: `正在分析…（已 ${elapsedSeconds} 秒）`,
      elapsedSeconds,
    });
  }, 1000);

  emit('request', { message, user, mode: 'full' });

  const initialContext = [
    `用户问题：${message}`,
    preprocessed.startTime ? `开始时间：${preprocessed.startTime}` : '',
    preprocessed.endTime ? `结束时间：${preprocessed.endTime}` : '',
    preprocessed.groupBy?.length ? `建议分组维度：${preprocessed.groupBy.join(',')}` : '',
    preprocessed.where ? `建议过滤条件：${preprocessed.where}` : '',
    clarification
      ? `用户对澄清问题“${clarification.question}”选择了：${clarification.selectedOption}`
      : '',
  ]
    .filter(Boolean)
    .join('\n');

  const tools = createAgentTools(
    { ...dependencies, user, sessionId: session.id, requestId, semanticModels },
    emit
  );

  let finalText = '';
  let tableResult: QueryResult | null = null;
  let resultSource = '';
  let clarificationRequested = false;
  let turnCount = 0;
  let toolCallCount = 0;
  let hitTurnLimit = false;
  let hitLengthLimit = false;
  let lengthThinkingTokens = 0;
  let agentError = '';
  let terminalStopReason = '';

  if (llm.faux) {
    llm.faux.setResponses([
      () =>
        fauxAssistantMessage(
          [fauxToolCall('search_metrics', { query: message })],
          { stopReason: 'toolUse' }
        ),
      () =>
        fauxAssistantMessage(
          [
            fauxToolCall('query_metric', {
              metric: 'premium',
              dimensions: preprocessed.groupBy,
              where: preprocessed.where,
              start_time: preprocessed.startTime,
              end_time: preprocessed.endTime,
            }),
          ],
          { stopReason: 'toolUse' }
        ),
      () => fauxAssistantMessage('已完成查询。'),
    ]);
  }

  const agent = new Agent({
    initialState: {
      systemPrompt: fullAgentSystemPrompt(
        skillPrompt,
        renderSemanticDescriptions(semanticModels)
      ),
      model: llm.model,
      thinkingLevel: 'low',
      tools,
      messages: toAgentMessages(session.messages),
    },
    sessionId: session.conversationId ?? session.id,
    streamFn: llm.streamFn,
    shouldStopAfterTurn: () => {
      turnCount += 1;
      if (turnCount >= maxTurns) {
        hitTurnLimit = true;
        return true;
      }
      return clarificationRequested;
    },
    beforeToolCall: async (context) => {
      if (context.toolCall.name === 'run_sql') {
        const sql = String((context.args as { sql?: unknown }).sql ?? '');
        if (!/^\s*(?:with|select)\b/i.test(sql)) {
          return { block: true, reason: 'run_sql 只允许只读 SELECT/WITH 查询' };
        }
      }
      return undefined;
    },
  });

  agent.subscribe((event: AgentEvent) => {
    void appendRolloutEvent(session.id, requestId, event.type, rolloutPayload(event)).catch(
      () => undefined
    );
    if (event.type === 'message_update') {
      lastOutputAt = Date.now();
      if (event.assistantMessageEvent.type === 'thinking_delta') {
        emitReasoningDelta(String(event.assistantMessageEvent.delta ?? ''));
      }
    }
    if (event.type === 'tool_execution_start') {
      toolCallCount += 1;
      emit('tool_call', { name: event.toolName, input: event.args });
    } else if (event.type === 'tool_execution_end') {
      const result = event.result as
        | {
            details?: unknown;
            content?: { type?: string; text?: unknown }[];
          }
        | undefined;
      const output =
        result?.details ??
        (result?.content ?? [])
          .map((block) => (block.type === 'text' ? String(block.text ?? '') : ''))
          .join('\n');
      const details = output;
      emit('tool_result', { name: event.toolName, output, isError: event.isError });
      if (event.toolName === 'clarify') {
        clarificationRequested = true;
        return;
      }
      if (isQueryResult(details)) {
        if (event.toolName === 'query_metric') {
          tableResult = details;
          resultSource = 'dbt 标准指标';
          emit('table_result', { title: '标准指标查询', queryResult: details });
        }
        if (event.toolName === 'run_sql') {
          tableResult = details;
          resultSource = '临时 SQL 查询';
          emit('table_result', { title: '临时 SQL 查询', queryResult: details });
        }
      }
    } else if (event.type === 'message_start') {
      const message = event.message as { errorMessage?: unknown; stopReason?: unknown };
      if (message.stopReason === 'error' && message.errorMessage) {
        agentError = String(message.errorMessage);
      }
    } else if (event.type === 'message_end') {
      if ((event.message as { role?: unknown }).role !== 'assistant') return;
      const message = event.message as {
        content?: { type?: string }[];
        stopReason?: unknown;
        usage?: { reasoning?: number };
      };
      terminalStopReason = message.stopReason ? String(message.stopReason) : terminalStopReason;
      const hasToolCalls = (message.content ?? []).some(
        (block) => block.type === 'toolCall'
      );
      if (message.stopReason === 'length' && !hasToolCalls) {
        hitLengthLimit = true;
        lengthThinkingTokens = message.usage?.reasoning ?? 0;
        return;
      }
      const text = messageText(event.message).trim();
      if (text) {
        finalText = text;
        emit('message', { text });
      }
    }
  });

  try {
    await agent.prompt(initialContext);
  } catch (error) {
    agentError = (error as Error).message || '模型调用异常';
  } finally {
    clearInterval(heartbeat);
  }

  if (hitLengthLimit) {
    finalText = '推理预算耗尽，请简化问题或稍后重试。';
    emit('message', { text: finalText });
  }

  if (hitTurnLimit) {
    const tableText = tableResult
      ? `${renderMarkdownTable(tableResult)}\n\n[来源：${resultSource}]`
      : '';
    const notice = tableResult
      ? `Agent 已达到 ${maxTurns} 轮上限，以下为已获取的查询结果；如需继续完整分析，请补充表名、字段或口径。`
      : `Agent 已达到 ${maxTurns} 轮上限，本轮未完成全部查询。请补充表名、字段或口径后继续。`;
    finalText = [finalText, tableText, notice].filter(Boolean).join('\n\n');
    emit('message', { text: finalText });
  }

  if (!finalText) {
    if (agentError) {
      finalText = `模型调用失败：${agentError}`;
    } else if (tableResult) {
      finalText = `${renderMarkdownTable(tableResult)}\n\n[来源：${resultSource}]`;
    } else if (clarificationRequested) {
      finalText = '等待用户补充口径。';
    } else if (hitTurnLimit) {
      finalText = `Agent 已达到 ${maxTurns} 轮上限，未能完成该请求。请补充指标、时间或维度口径后重试。`;
    } else {
      const failureReason =
        agentError ||
        (terminalStopReason ? `终止原因：${terminalStopReason}` : '模型未返回可执行内容');
      finalText = `未能完成查询：${failureReason}`;
    }
    emit('message', { text: finalText });
  }

  emit('done', {
    requestId,
    mode: 'full',
    turns: turnCount,
    toolCallCount,
    hitTurnLimit,
    stopReason: hitLengthLimit ? 'length' : undefined,
    thinkingTokens: hitLengthLimit ? lengthThinkingTokens : undefined,
    reason:
      hitLengthLimit
        ? 'length'
        : agentError || terminalStopReason || undefined,
    error: agentError || undefined,
  });
  return {
    id: randomUUID(),
    role: 'assistant',
    text: finalText,
    createdAt: new Date().toISOString(),
  };
}
