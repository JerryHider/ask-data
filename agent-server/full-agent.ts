import { randomUUID } from 'node:crypto';
import type { Response } from 'express';
import {
  Agent,
  type AgentEvent,
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

export function fullAgentSystemPrompt(skillPrompt = ''): string {
  return [
    '你是企业智能问数助手。所有问题都必须通过工具闭环完成，不允许编造数据。',
    '标准流程：search_metrics -> query_metric；未命中或需临时分析时 search_context -> run_sql；仅语义近似或口径冲突时先 clarify。',
    'query_metric 的 dimensions 必须来自工具返回的维度白名单；不要绕过它手写标准指标 SQL。',
    'run_sql 只允许只读 SELECT/WITH；写操作、标记、删除、更新类请求必须明确拒绝并说明原因。',
    '结果必须说明来源：dbt 标准指标、临时 SQL 查询或知识库。',
    '如果指标字面或 synonyms 精确命中，并且预处理已给出过滤/分组条件，应直接 query_metric；未指定时间默认查询全部历史并在结果中说明。',
    '如果指标只是语义近似命中（例如“营收”近似“保费收入”），必须先 clarify 确认业务口径。',
    skillPrompt,
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
  if (event.type === 'turn_end') {
    return {
      type: event.type,
      stopReason: (event.message as { stopReason?: unknown }).stopReason,
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
  const emit = (event: string, data: unknown): void => {
    response.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    void appendRolloutEvent(session.id, requestId, event, data).catch(() => undefined);
  };

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
  let hitTurnLimit = false;
  let agentError = '';

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
      systemPrompt: fullAgentSystemPrompt(skillPrompt),
      model: llm.model,
      tools,
    },
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
    if (event.type === 'tool_execution_start') {
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
      const text = messageText(event.message).trim();
      if (text) {
        finalText = text;
        emit('message', { text });
      }
    }
  });

  await agent.prompt(initialContext);

  if (hitTurnLimit) {
    const notice = `Agent 已达到 ${maxTurns} 轮上限，本轮未完成全部查询。请补充表名、字段或口径后继续。`;
    finalText = finalText ? `${finalText}\n\n${notice}` : notice;
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
      const context = await fallbackContext();
      finalText = context.examples.length
        ? `未能完成查询。已检索到相近样例：${context.examples[0].question}`
        : '未能完成查询。请补充指标、时间或维度口径。';
    }
    emit('message', { text: finalText });
  }

  emit('done', {
    requestId,
    mode: 'full',
    turns: turnCount,
    hitTurnLimit,
    error: agentError || undefined,
  });
  return {
    id: randomUUID(),
    role: 'assistant',
    text: finalText,
    createdAt: new Date().toISOString(),
  };
}
