import type { SemanticModelRecord } from './types.js';

export interface MetricCandidate {
  metricId: string;
  label: string;
  description: string;
  score: number;
  literalScore: number;
  tokenScore: number;
  semanticScore: number;
  semanticSource?: string;
}

export interface SemanticSearchResult {
  candidates: MetricCandidate[];
  exactMatch: boolean;
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[_\s]+/g, '');
}

function literalScore(message: string, aliases: string[]): number {
  const normalized = normalize(message);
  return aliases.reduce((score, alias) => {
    const normalizedAlias = normalize(alias);
    if (!normalizedAlias) return score;
    if (normalized.includes(normalizedAlias)) {
      return Math.max(score, normalizedAlias.length * 2 + 5);
    }
    return score;
  }, 0);
}

function tokens(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9\u4e00-\u9fff]+/)
    .filter(Boolean);
}

function tokenScore(message: string, aliases: string[]): number {
  const queryTokens = new Set(tokens(message));
  if (queryTokens.size === 0) return 0;
  return aliases.reduce((score, alias) => {
    const aliasTokens = new Set(tokens(alias));
    const overlap = [...queryTokens].filter((token) => aliasTokens.has(token)).length;
    return Math.max(score, overlap / Math.max(aliasTokens.size, 1));
  }, 0);
}

export function searchMetrics(
  query: string,
  models: SemanticModelRecord[]
): SemanticSearchResult {
  const ranked = models
    .filter((model) => model.template_id !== 'semantic-model')
    .map((model) => {
      const aliases = [
        model.config.name,
        model.config.label,
        ...(model.config.synonyms ?? []),
      ]
        .map((alias) => alias?.trim())
        .filter(Boolean) as string[];
      const literal = literalScore(query, aliases);
      const token = tokenScore(query, aliases) * 12;
      const score = literal + token;
      return {
        metricId: model.config.name ?? '',
        label: model.config.label ?? model.config.name ?? '',
        description: model.config.description ?? '',
        score,
        literalScore: literal,
        tokenScore: token,
        semanticScore: 0,
      } satisfies MetricCandidate;
    })
    .filter((candidate) => candidate.metricId)
    .sort((left, right) => right.score - left.score)
    .slice(0, 10);

  return {
    candidates: ranked,
    exactMatch: Boolean(ranked[0]?.literalScore),
  };
}
