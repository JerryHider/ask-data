import type { AgentTool } from '@earendil-works/pi-agent-core';
import Type from 'typebox';

const askClarificationSchema = Type.Object({
  question: Type.String({ description: `Clarification question` }),
  options: Type.Optional(Type.Array(Type.String(), { description: `Answer options` })),
});

export interface ClarifyState {
  clarifiedContext?: Record<string, string>;
  clarificationCount?: number;
}

export const askClarificationTool: AgentTool<typeof askClarificationSchema> = {
  name: 'ask_clarification',
  label: `Ask clarification`,
  description: `问题涉及时间范围/指标口径/维度切片模糊时必须调用此工具向用户确认。`,
  parameters: askClarificationSchema,
  execute: async (_toolCallId, params) => {
    const question = params.question;
    const options = params.options ?? [];
    await fetch('http://127.0.0.1:8003/audit', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        user: 'admin',
        event_type: 'clarification',
        decision: 'allowed',
        question,
      }),
    }).catch((error: unknown) => console.error(error));
    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify({ question, options }, null, 2),
        },
      ],
      details: { question, options },
    };
  },
};
