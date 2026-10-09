import type { AgentTool } from '@earendil-works/pi-agent-core';
import Type from 'typebox';

const parserUrl = 'http://127.0.0.1:8001/search';
const maxCharacters = 12000;

const searchSchema = Type.Object({
  query: Type.String({ description: `Natural language question` }),
  top_k: Type.Optional(Type.Integer({ description: `Top K, between 1 and 20` })),
});

export const searchSchemaTool: AgentTool<typeof searchSchema> = {
  name: 'search_schema',
  label: `Search schema`,
  description: `根据自然语言问题检索相关 dbt 模型、指标定义、SQL 样例与业务知识。生成 SQL 前必须调用此工具确认字段名与指标口径。`,
  parameters: searchSchema,
  execute: async (_toolCallId, params) => {
    const response = await fetch(parserUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query: params.query, top_k: params.top_k }),
    });
    if (!response.ok) {
      throw new Error(`artifact-parser search failed: ${response.status}`);
    }
    const payload = await response.json();
    let serialized = JSON.stringify(payload, null, 2);
    let truncated = false;
    if (serialized.length > maxCharacters) {
      serialized = serialized.slice(0, maxCharacters);
      truncated = true;
    }
    return {
      content: [
        {
          type: 'text' as const,
          text: truncated
            ? `${serialized}\n[提示：检索结果过长，已自动截断，请缩小查询范围]`
            : serialized,
        },
      ],
      details: { truncated, payload },
    };
  },
};

export const dbtArtifactTools: AgentTool[] = [searchSchemaTool];
