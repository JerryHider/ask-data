import { describe, expect, it } from 'vitest';
import {
  fullAgentSystemPrompt,
  renderSemanticDescriptions,
  toAgentMessages,
} from '../agent-server/full-agent.js';
import { normalizeMetricFlowWhere } from '../agent-server/agent-tools.js';
import type { SessionMessage } from '../agent-server/types.js';

const history: SessionMessage[] = [
  {
    id: 'user-1',
    role: 'user',
    text: '湖北省保费',
    createdAt: '2026-09-13T08:00:00.000Z',
  },
  {
    id: 'assistant-1',
    role: 'assistant',
    text: '湖北省保费为 906284.01 元。',
    createdAt: '2026-09-13T08:00:05.000Z',
  },
];

describe('full agent conversation history', () => {
  it('converts the archived transcript to native agent messages', () => {
    const messages = toAgentMessages(history);

    expect(messages).toHaveLength(2);
    expect(messages[0]).toMatchObject({
      role: 'user',
      content: '湖北省保费',
    });
    expect(messages[1]).toMatchObject({
      role: 'assistant',
      stopReason: 'stop',
    });
    expect((messages[1] as { content: { text?: string }[] }).content[0]?.text).toBe(
      '湖北省保费为 906284.01 元。'
    );
  });
});

describe('full agent ambiguity rules', () => {
  it('requires clarification for scope, granularity, and inheritance ambiguity', () => {
    const prompt = fullAgentSystemPrompt();

    expect(prompt).toContain('当前系统日期：');
    expect(prompt).toContain('相对时间（如“去年”“上月”“本月”）必须基于该日期解析');
    expect(prompt).toContain('立即停止推理并调用 clarify');
    expect(prompt).toContain('范围歧义');
    expect(prompt).toContain('粒度歧义');
    expect(prompt).toContain('维度继承 vs 重置');
    expect(prompt).toContain('湖北省内各市州 / 全国各区域');
  });
});

describe('semantic model descriptions', () => {
  it('renders entity, dimension, and measure descriptions for the agent', () => {
    const context = renderSemanticDescriptions([
      {
        id: 1,
        name: 'semantic_insurance_order',
        template_id: 'semantic-model',
        status: 'published',
        updated_at: '2026-09-27T00:00:00.000Z',
        config: {
          name: 'semantic_insurance_order',
          description: 'Insurance orders',
          entities: [{ name: 'order_id', description: 'Primary order key' }],
          dimensions: [{ name: 'province', description: 'Insured province' }],
          measures: [{ name: 'premium', description: 'Gross written premium' }],
        },
      },
    ]);

    expect(context).toContain('=== 语义模型描述 ===');
    expect(context).toContain('- model semantic_insurance_order: Insurance orders');
    expect(context).toContain('- entity order_id: Primary order key');
    expect(context).toContain('- dimension province: Insured province');
    expect(context).toContain('- measure premium: Gross written premium');
  });
});

describe('metric flow where normalization', () => {
  it('normalizes model-generated equality filters to native Jinja syntax', () => {
    expect(
      normalizeMetricFlowWhere("insure_unit_province == '湖北省'", [
        'order__insure_unit_province',
        'order__order_effective_year',
      ])
    ).toBe("{{ Dimension('order__insure_unit_province') }} = '湖北省'");
  });

  it('keeps already valid Jinja filters unchanged', () => {
    const where = "{{ Dimension('order__insure_unit_province') }} = '湖北省'";
    expect(normalizeMetricFlowWhere(where, ['order__insure_unit_province'])).toBe(where);
  });

  it('keeps short and fully qualified dimension names inside Jinja filters', () => {
    expect(
      normalizeMetricFlowWhere("{{ Dimension('insure_unit_province') }} = '湖北省'", [
        'insure_unit_province',
      ])
    ).toBe("{{ Dimension('insure_unit_province') }} = '湖北省'");
    expect(
      normalizeMetricFlowWhere("{{ Dimension('order__insure_unit_province') }} = '湖北省'", [
        'insure_unit_province',
      ])
    ).toBe("{{ Dimension('order__insure_unit_province') }} = '湖北省'");
  });
});
