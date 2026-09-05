import { describe, expect, it } from 'vitest';
import { connectorRegistry } from '../extensions/datasource/registry.js';
import { appendLimitIfMissing, assertReadOnlySql } from '../extensions/datasource/sql-guard.js';

describe(`datasource registry`, () => {
  it(`reserves future connector keys`, () => {
    expect(connectorRegistry.getOrNull('postgresql')).toBeNull();
    expect(connectorRegistry.getOrNull('clickhouse')).toBeNull();
    expect(connectorRegistry.getOrNull('starrocks')).toBeNull();
  });
});

describe(`read-only SQL guard`, () => {
  it(`rejects write operations`, () => {
    expect(() => assertReadOnlySql(`DELETE FROM fct_orders`)).toThrowError(`ReadOnly violation`);
  });

  it(`appends the row limit when missing`, () => {
    expect(appendLimitIfMissing(`SELECT * FROM fct_orders`, 1000)).toBe(
      `SELECT * FROM fct_orders LIMIT 1000`,
    );
  });
});

const mysqlUrl = process.env.DATASOURCE_MYSQL_URL;
const mysqlTest = mysqlUrl ? it : it.skip;

mysqlTest(`lists tables from MySQL`, async () => {
  const connector = connectorRegistry.get('mysql');
  const tables = await connector.listTables();
  expect(tables.map((table) => table.name)).toContain('fct_orders');
});
