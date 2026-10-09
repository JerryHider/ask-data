import type { AgentTool } from '@earendil-works/pi-agent-core';
import Type from 'typebox';

const sandboxUrl = 'http://127.0.0.1:8003';

const executeSqlSchema = Type.Object({
  sql: Type.String({ description: `Read-only SQL statement` }),
  datasource: Type.String({ description: `Datasource name` }),
  reason: Type.String({ description: `Business reason for this SQL execution` }),
});

export const executeSqlTool: AgentTool<typeof executeSqlSchema> = {
  name: 'execute_sql',
  label: `Execute SQL`,
  description: `reason 填写执行此 SQL 的业务原因，用于合规审计`,
  parameters: executeSqlSchema,
  execute: async (_toolCallId, params) => {
    const response = await fetch(`${sandboxUrl}/execute`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        sql: params.sql,
        datasource: params.datasource,
        user: 'admin',
      }),
    });
    const payload = await response.json();
    if (!response.ok) {
      const message =
        typeof payload === 'object' && payload !== null && 'message' in payload
          ? String((payload as { message?: unknown }).message)
          : `Sandbox execution failed: ${response.status}`;
      throw new Error(message);
    }
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }],
      details: payload,
    };
  },
};

export const sqlSandboxTools: AgentTool[] = [executeSqlTool];
