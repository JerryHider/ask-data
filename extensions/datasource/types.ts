export interface TableMeta {
  name: string;
  schema: string;
  rowCount: number | null;
  comment: string | null;
}

export interface ColumnMeta {
  name: string;
  type: string;
  nullable: boolean;
  comment: string | null;
  isPrimaryKey: boolean;
}

export interface QueryResult {
  columns: string[];
  rows: Record<string, unknown>[];
  rowCount: number;
  durationMs: number;
  sql: string;
}

export interface QueryOptions {
  timeoutMs: number;
  maxRows: number;
}

export abstract class BaseConnector {
  abstract testConnection(): Promise<boolean>;
  abstract listTables(): Promise<TableMeta[]>;
  abstract describeTable(tableName: string): Promise<ColumnMeta[]>;
  abstract executeReadOnlySql(sql: string, opts: QueryOptions): Promise<QueryResult>;
  abstract close(): Promise<void>;
}
