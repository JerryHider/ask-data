import type { AgentTool } from '@earendil-works/pi-agent-core';
import Type from 'typebox';
import { appendRolloutEvent } from './rollout.js';
import type { QueryResult, SemanticModelRecord } from './types.js';
import { searchMetrics } from './metric-search.js';

export interface ToolDependencies {
  registryUrl: string;
  artifactParserUrl: string;
  metricFlowUrl: string;
  sandboxUrl: string;
  user: string;
  sessionId: string;
  requestId: string;
  semanticModels: SemanticModelRecord[];
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

function toolResult(details: unknown) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(details, null, 2) }],
    details,
  };
}

const maxModelResultRows = 100;

export function limitQueryResultForModel(result: QueryResult) {
  const returnedRowCount = Math.min(result.rows.length, maxModelResultRows);
  return {
    ...result,
    rows: result.rows.slice(0, maxModelResultRows),
    returnedRowCount,
    truncated: result.rows.length > maxModelResultRows,
  };
}

interface SemanticSearchMetric {
  name?: string;
  similarity?: number;
}

function semanticQuery(query: string): string {
  if (/营收|收入|营业额|销售额/.test(query)) {
    return `${query} 保费收入`;
  }
  return query;
}

const searchMetricsSchema = Type.Object({
  query: Type.String({ description: '用户问题或指标关键词' }),
});

const searchContextSchema = Type.Object({
  query: Type.String({ description: '用于检索 schema、样例和知识库的问题' }),
  top_k: Type.Optional(Type.Integer({ minimum: 1, maximum: 10 })),
});

const queryMetricSchema = Type.Object({
  metric: Type.String({ description: '标准指标名，来自 search_metrics' }),
  dimensions: Type.Optional(
    Type.Array(Type.String(), { description: '分组维度，必须来自指标维度白名单' })
  ),
  start_time: Type.Optional(Type.String()),
  end_time: Type.Optional(Type.String()),
  where: Type.Optional(Type.String({ description: 'MetricFlow where 子句' })),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 1000 })),
});

const runSqlSchema = Type.Object({
  sql: Type.String({ description: '只读 SELECT / WITH SQL' }),
  reason: Type.String({ description: '为什么需要临时 SQL' }),
});

const clarifySchema = Type.Object({
  question: Type.String(),
  options: Type.Optional(Type.Array(Type.String(), { minItems: 1 })),
  context: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
});

export function normalizeMetricFlowWhere(
  where: string | undefined,
  allowedDimensions: Iterable<string>
): string | undefined {
  if (!where) return undefined;
  const allowed = new Set(allowedDimensions);
  const resolveDimension = (dimension: string): string => {
    if (allowed.has(dimension)) return dimension;
    const fullyQualified = [...allowed].find((candidate) =>
      candidate.endsWith(`__${dimension}`)
    );
    if (fullyQualified) return fullyQualified;
    const isQualifiedAlias = [...allowed].some((candidate) =>
      dimension.endsWith(`__${candidate}`)
    );
    if (isQualifiedAlias) return dimension;
    {
      throw new Error(
        `where 中的维度不在白名单：${dimension}；可用维度：${[...allowed].join(', ')}`
      );
    }
    return dimension;
  };
  const withJinjaDimensions = where.replace(
    /\{\{\s*Dimension\(\s*(['"])([^'"]+)\1\s*\)\s*\}\}/g,
    (_match, _quote: string, dimension: string) =>
      `{{ Dimension('${resolveDimension(dimension)}') }}`
  );
  return withJinjaDimensions.replace(
    /([A-Za-z_][A-Za-z0-9_]*)\s*={1,2}\s*('(?:[^']|'')*'|"(?:[^"]|"")*")/g,
    (_match, dimension: string, value: string) =>
      `{{ Dimension('${resolveDimension(dimension)}') }} = ${value}`
  );
}

export function createAgentTools(
  dependencies: ToolDependencies,
  emit: (event: string, data: unknown) => void
): AgentTool[] {
  const searchMetricsTool: AgentTool<typeof searchMetricsSchema> = {
    name: 'search_metrics',
    label: 'Search metrics',
    description: '按关键词检索标准指标，返回 top-10 候选和分数。',
    parameters: searchMetricsSchema,
    execute: async (_toolCallId, params) => {
      const local = searchMetrics(params.query, dependencies.semanticModels);
      const semantic = await postJson<
        { query: string; top_k?: number },
        { metrics?: SemanticSearchMetric[] }
      >(`${dependencies.artifactParserUrl}/search`, {
        query: semanticQuery(params.query),
        top_k: 10,
      });
      const semanticScores = new Map(
        (semantic.metrics ?? []).map((metric) => [
          metric.name ?? '',
          metric.similarity ?? 0,
        ])
      );
      const candidates = local.candidates.map((candidate) => ({
        ...candidate,
        semanticScore: semanticScores.get(candidate.metricId) ?? 0,
      }));
      if (local.exactMatch) {
        return toolResult({
          candidates,
          exactMatch: true,
          semanticQuery: semanticQuery(params.query),
        });
      }
      const known = new Set(candidates.map((candidate) => candidate.metricId));
      for (const metric of semantic.metrics ?? []) {
        const metricId = metric.name ?? '';
        if (!metricId || known.has(metricId)) continue;
        const model = dependencies.semanticModels.find(
          (item) => item.config.name === metricId
        );
        if (!model) continue;
        candidates.push({
          metricId,
          label: model.config.label ?? metricId,
          description: model.config.description ?? '',
          score: (metric.similarity ?? 0) * 100,
          literalScore: 0,
          tokenScore: 0,
          semanticScore: metric.similarity ?? 0,
        });
      }
      if (/营收|收入|营业额|销售额/.test(params.query) && !known.has('premium')) {
        const premium = dependencies.semanticModels.find(
          (model) => model.config.name === 'premium'
        );
        if (premium) {
          candidates.push({
            metricId: 'premium',
            label: premium.config.label ?? 'premium',
            description: premium.config.description ?? '',
            score: 75,
            literalScore: 0,
            tokenScore: 0,
            semanticScore: 0.75,
            semanticSource: 'revenue_to_premium_candidate',
          });
        }
      }
      candidates.sort((left, right) => right.score - left.score);
      return toolResult({
        candidates: candidates.slice(0, 10),
        exactMatch: local.exactMatch,
        semanticQuery: semanticQuery(params.query),
      });
    },
  };

  const searchContextTool: AgentTool<typeof searchContextSchema> = {
    name: 'search_context',
    label: 'Search context',
    description: '检索 dbt schema、SQL 样例和知识库，用于非标准指标问题。',
    parameters: searchContextSchema,
    execute: async (_toolCallId, params) => {
      const result = await postJson<{ query: string; top_k?: number }, unknown>(
        `${dependencies.artifactParserUrl}/search`,
        { query: params.query, top_k: params.top_k ?? 5 }
      );
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
        details: result,
      };
    },
  };

  const queryMetricTool: AgentTool<typeof queryMetricSchema, QueryResult> = {
    name: 'query_metric',
    label: 'Query metric',
    description: '编译并执行标准 dbt 指标。dimensions 必须来自指标白名单。',
    parameters: queryMetricSchema,
    execute: async (_toolCallId, params) => {
      const metrics = await postJson<
        Record<string, never>,
        { name: string; available_dimensions: string[] }[]
      >(`${dependencies.metricFlowUrl}/list_metrics`, {});
      const metric = metrics.find((item) => item.name === params.metric);
      if (!metric) {
        throw new Error(`未知标准指标：${params.metric}`);
      }
      const allowed = new Set(metric.available_dimensions);
      const invalidDimensions = (params.dimensions ?? []).filter(
        (dimension) => !allowed.has(dimension)
      );
      if (invalidDimensions.length) {
        throw new Error(
          `非法分组维度：${invalidDimensions.join(', ')}；可用维度：${[...allowed].join(', ')}`
        );
      }
      const compiled = await postJson<
        {
          metrics: string[];
          group_by?: string[];
          where?: string;
          limit?: number;
          start_time?: string;
          end_time?: string;
        },
        { sql: string }
      >(`${dependencies.metricFlowUrl}/compile_sql`, {
        metrics: [params.metric],
        group_by: params.dimensions,
        where: normalizeMetricFlowWhere(params.where, allowed),
        limit: params.limit ?? 100,
        start_time: params.start_time,
        end_time: params.end_time,
      });
      const result = await postJson<
        { sql: string; datasource: string; user: string },
        QueryResult
      >(`${dependencies.sandboxUrl}/execute`, {
        sql: compiled.sql,
        datasource: 'mysql',
        user: dependencies.user,
      });
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(limitQueryResultForModel(result), null, 2),
          },
        ],
        details: result,
      };
    },
  };

  const runSqlTool: AgentTool<typeof runSqlSchema, QueryResult> = {
    name: 'run_sql',
    label: 'Run SQL',
    description: '执行只读 SQL。SQL 沙箱会做 AST、表、列和行数校验。',
    parameters: runSqlSchema,
    execute: async (_toolCallId, params) => {
      if (!/^\s*(?:with|select)\b/i.test(params.sql)) {
        throw new Error('run_sql 只允许 SELECT 或 WITH 查询，禁止写操作');
      }
      const result = await postJson<
        { sql: string; datasource: string; user: string },
        QueryResult
      >(`${dependencies.sandboxUrl}/execute`, {
        sql: params.sql,
        datasource: 'mysql',
        user: dependencies.user,
      });
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(limitQueryResultForModel(result), null, 2),
          },
        ],
        details: result,
      };
    },
  };

  const clarifyTool: AgentTool<typeof clarifySchema> = {
    name: 'clarify',
    label: 'Clarify',
    description: '当时间、口径或维度不确定时，向用户发起结构化澄清。',
    parameters: clarifySchema,
    execute: async (_toolCallId, params) => {
      const payload = {
        question: params.question,
        options: params.options ?? [],
        context: params.context ?? {},
      };
      emit('clarify', payload);
      await appendRolloutEvent(
        dependencies.sessionId,
        dependencies.requestId,
        'clarify',
        payload
      );
      return toolResult({ status: 'waiting_for_user', ...payload });
    },
  };

  return [searchMetricsTool, searchContextTool, queryMetricTool, runSqlTool, clarifyTool];
}
