export interface SessionMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  createdAt: string;
}

export interface SessionRecord {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  skillTestId?: string;
  messages: SessionMessage[];
}

export interface QueryResult {
  columns: string[];
  rows: Record<string, unknown>[];
  rowCount: number;
  durationMs: number;
  sql: string;
}

export interface SemanticModelRecord {
  id: number;
  name: string;
  template_id: string;
  config: {
    name?: string;
    label?: string;
    description?: string;
    synonyms?: string[];
    source_table?: string;
    source_schema?: string | null;
  };
}

export interface SemanticMetric {
  name: string;
  description: string;
  type: string;
  available_dimensions: string[];
}

export interface QueryMetricOptions {
  startTime?: string;
  endTime?: string;
  groupBy?: string[];
  where?: string;
}
