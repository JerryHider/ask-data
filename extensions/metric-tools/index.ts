import type { AgentTool } from '@earendil-works/pi-agent-core';
import Type from 'typebox';

const bridgeUrl = 'http://127.0.0.1:8002';
const sandboxUrl = 'http://127.0.0.1:8003';

const listMetricsSchema = Type.Object({});
const getDimensionsSchema = Type.Object({
  metric: Type.String({ description: `Metric name` }),
});
const queryMetricSchema = Type.Object({
  metrics: Type.Array(Type.String(), { minItems: 1, description: `Metric names` }),
  group_by: Type.Optional(Type.Array(Type.String(), { description: `Dimension names` })),
  where: Type.Optional(Type.String({ description: `MetricFlow where clause` })),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 1000, description: `Row limit` })),
});
const explainMetricSchema = Type.Object({
  metric: Type.String({ description: `Metric name` }),
});

function toToolResult(details: unknown) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(details, null, 2) }],
    details,
  };
}

async function postJson<TRequest, TResult>(
  url: string,
  payload: TRequest
): Promise<TResult> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await response.json();
  if (!response.ok) {
    const message =
      typeof data === 'object' && data !== null && 'message' in data
        ? String((data as { message?: unknown }).message)
        : `Request failed: ${response.status}`;
    throw new Error(message);
  }
  return data as TResult;
}

export const listMetricsTool: AgentTool<typeof listMetricsSchema> = {
  name: 'list_metrics',
  label: `List metrics`,
  description: `???? dbt ????????????????????????`,
  parameters: listMetricsSchema,
  execute: async () => toToolResult(
    await postJson<Record<string, never>, unknown[]>(`${bridgeUrl}/list_metrics`, {})
  ),
};

export const getDimensionsTool: AgentTool<typeof getDimensionsSchema> = {
  name: 'get_dimensions',
  label: `Get dimensions`,
  description: `Get dimensions available for a metric.`,
  parameters: getDimensionsSchema,
  execute: async (_toolCallId, params) => toToolResult(
    await postJson<{ metric: string }, string[]>(`${bridgeUrl}/get_dimensions`, params)
  ),
};

export const queryMetricTool: AgentTool<typeof queryMetricSchema> = {
  name: 'query_metric',
  label: `Query metric`,
  description: `?? dbt ???????? dbt ???????????????????????????? SQL?`,
  parameters: queryMetricSchema,
  execute: async (_toolCallId, params) => {
    const compiled = await postJson<
      {
        metrics: string[];
        group_by?: string[];
        where?: string;
        limit?: number;
      },
      { sql: string; dialect: string }
    >(`${bridgeUrl}/compile_sql`, {
      metrics: params.metrics,
      group_by: params.group_by,
      where: params.where,
      limit: params.limit ?? 100,
    });
    const result = await postJson<
      { sql: string; datasource: string; user: string },
      unknown
    >(`${sandboxUrl}/execute`, {
      sql: compiled.sql,
      datasource: 'mysql',
      user: 'admin',
    });
    return toToolResult(result);
  },
};

export const explainMetricTool: AgentTool<typeof explainMetricSchema> = {
  name: 'explain_metric',
  label: `Explain metric`,
  description: `?????????????????????`,
  parameters: explainMetricSchema,
  execute: async (_toolCallId, params) => toToolResult(
    await postJson<{ metric: string }, unknown>(`${bridgeUrl}/explain_metric`, params)
  ),
};

export const metricTools: AgentTool[] = [
  listMetricsTool,
  getDimensionsTool,
  queryMetricTool,
  explainMetricTool,
];
