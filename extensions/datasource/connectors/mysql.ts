import mysql from 'mysql2/promise';
import { appendLimitIfMissing, assertReadOnlySql } from '../sql-guard.js';
import { BaseConnector, type ColumnMeta, type QueryOptions, type QueryResult, type TableMeta } from '../types.js';

const idleTimeoutMs = 5 * 60 * 1000;

export class MySQLConnector extends BaseConnector {
  private connection?: mysql.Connection;
  private idleTimer?: NodeJS.Timeout;

  constructor(private readonly connectionString: string) {
    super();
  }

  private async getConnection(): Promise<mysql.Connection> {
    if (!this.connection) {
      this.connection = await mysql.createConnection(this.connectionString);
    }
    this.scheduleClose();
    return this.connection;
  }

  private scheduleClose(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => {
      void this.close();
    }, idleTimeoutMs);
  }

  async testConnection(): Promise<boolean> {
    const connection = await this.getConnection();
    await connection.ping();
    return true;
  }

  async listTables(): Promise<TableMeta[]> {
    const connection = await this.getConnection();
    const sql = `SELECT TABLE_NAME AS name, TABLE_SCHEMA AS schema_name,
TABLE_ROWS AS row_count, TABLE_COMMENT AS comment
FROM information_schema.TABLES
WHERE TABLE_SCHEMA = DATABASE()
ORDER BY TABLE_NAME`;
    const [rows] = await connection.query<mysql.RowDataPacket[]>(sql);
    return rows.map((row) => ({
      name: String(row.name),
      schema: String(row.schema_name),
      rowCount: row.row_count === null ? null : Number(row.row_count),
      comment: row.comment === null ? null : String(row.comment),
    }));
  }

  async describeTable(tableName: string): Promise<ColumnMeta[]> {
    const connection = await this.getConnection();
    const sql = `SELECT COLUMN_NAME AS name, COLUMN_TYPE AS type, IS_NULLABLE AS nullable,
COLUMN_COMMENT AS comment, COLUMN_KEY AS key_name
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?
ORDER BY ORDINAL_POSITION`;
    const [rows] = await connection.query<mysql.RowDataPacket[]>(sql, [tableName]);
    return rows.map((row) => ({
      name: String(row.name),
      type: String(row.type),
      nullable: String(row.nullable).toUpperCase() === 'YES',
      comment: row.comment === null ? null : String(row.comment),
      isPrimaryKey: String(row.key_name) === 'PRI',
    }));
  }

  async executeReadOnlySql(sql: string, opts: QueryOptions): Promise<QueryResult> {
    assertReadOnlySql(sql);
    const guardedSql = appendLimitIfMissing(sql, opts.maxRows);
    const connection = await this.getConnection();
    const startedAt = performance.now();
    const [rows, fields] = await connection.query<mysql.RowDataPacket[]>({
      sql: guardedSql,
      timeout: opts.timeoutMs,
    });
    const columns = fields ? fields.map((field) => field.name) : Object.keys(rows[0] ?? {});
    return {
      columns,
      rows,
      rowCount: rows.length,
      durationMs: Math.round(performance.now() - startedAt),
      sql: guardedSql,
    };
  }

  async close(): Promise<void> {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = undefined;
    if (this.connection) {
      await this.connection.end();
      this.connection = undefined;
    }
  }
}
