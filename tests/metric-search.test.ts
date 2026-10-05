import { describe, expect, it } from 'vitest';
import { searchMetrics } from '../agent-server/metric-search.js';
import type { SemanticModelRecord } from '../agent-server/types.js';

const models: SemanticModelRecord[] = [
  {
    id: 1,
    name: 'premium',
    template_id: 'metric',
    config: {
      name: 'premium',
      label: '保费',
      description: '订单保费合计。',
      synonyms: ['保费收入', '总保费'],
    },
  },
  {
    id: 2,
    name: 'policy_count',
    template_id: 'metric',
    config: {
      name: 'policy_count',
      label: '保单数',
      description: '去重保单号数量。',
    },
  },
];

describe('metric search', () => {
  it('keeps literal exact matches first', () => {
    const result = searchMetrics('湖北省保费', models);
    expect(result.exactMatch).toBe(true);
    expect(result.candidates[0]?.metricId).toBe('premium');
    expect(result.candidates[0]?.literalScore).toBeGreaterThan(0);
  });

  it('does not silently treat revenue as premium', () => {
    const result = searchMetrics('营收是多少', models);
    expect(result.exactMatch).toBe(false);
    expect(result.candidates.every((candidate) => candidate.literalScore === 0)).toBe(true);
  });
});
