import type { AgentTool } from '@earendil-works/pi-agent-core';
import Type from 'typebox';

const queryResultSchema = Type.Object({
  columns: Type.Array(Type.String()),
  rows: Type.Array(Type.Record(Type.String(), Type.Unknown())),
  rowCount: Type.Integer(),
  durationMs: Type.Integer(),
  sql: Type.String(),
});

const renderTableSchema = Type.Object({
  data: queryResultSchema,
  title: Type.String({ description: `Table title` }),
});

function escapeCell(value: unknown): string {
  return String(value ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

export function renderMarkdownTable(data: {
  columns: string[];
  rows: Record<string, unknown>[];
  rowCount: number;
}): string {
  const header = `| ${data.columns.map(escapeCell).join(' | ')} |`;
  const separator = `| ${data.columns.map(() => '---').join(' | ')} |`;
  const body = data.rows.slice(0, 20).map(
    (row) => `| ${data.columns.map((column) => escapeCell(row[column])).join(' | ')} |`
  );
  const suffix =
    data.rowCount > 20
      ? `... 共 ${data.rowCount} 行，完整表格见右侧结果区`
      : '';
  return [header, separator, ...body, suffix].filter(Boolean).join('\n');
}

export const renderTableTool: AgentTool<typeof renderTableSchema> = {
  name: 'render_table',
  label: `Render table`,
  description: `所有查询结果必须调用此工具呈现。禁止直接在消息中手写 Markdown 表格。`,
  parameters: renderTableSchema,
  execute: async (_toolCallId, params) => {
    const markdown = renderMarkdownTable(params.data);
    return {
      content: [{ type: 'text' as const, text: markdown }],
      details: { title: params.title, queryResult: params.data, markdown },
    };
  },
};
