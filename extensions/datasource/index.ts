import type { AgentTool } from '@earendil-works/pi-agent-core';
import Type from 'typebox';
import { connectorRegistry } from './registry.js';

function toToolResult(details: unknown) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(details, null, 2) }],
    details,
  };
}

const listDatasourcesSchema = Type.Object({});
const listTablesSchema = Type.Object({
  datasource: Type.String({ description: `Datasource name` }),
});
const describeTableSchema = Type.Object({
  datasource: Type.String({ description: `Datasource name` }),
  table: Type.String({ description: `Table name` }),
});

export const listDatasourcesTool: AgentTool<typeof listDatasourcesSchema> = {
  name: 'list_datasources',
  label: `List datasources`,
  description: `List registered datasource names.`,
  parameters: listDatasourcesSchema,
  execute: async () => toToolResult(connectorRegistry.listNames()),
};

export const listTablesTool: AgentTool<typeof listTablesSchema> = {
  name: 'list_tables',
  label: `List tables`,
  description: `List tables in a registered datasource.`,
  parameters: listTablesSchema,
  execute: async (_toolCallId, params) => toToolResult(
    await connectorRegistry.get(params.datasource).listTables(),
  ),
};

export const describeTableTool: AgentTool<typeof describeTableSchema> = {
  name: 'describe_table',
  label: `Describe table`,
  description: `Describe columns for a table in a datasource.`,
  parameters: describeTableSchema,
  execute: async (_toolCallId, params) => toToolResult(
    await connectorRegistry.get(params.datasource).describeTable(params.table),
  ),
};

export const datasourceTools: AgentTool[] = [
  listDatasourcesTool,
  listTablesTool,
  describeTableTool,
];
