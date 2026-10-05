import Type from 'typebox';

export interface PermissionRule {
  tables: Set<string> | null;
  columns: Record<string, Set<string>>;
  rows: string | null;
}

export const permissionRules: Record<string, PermissionRule> = {
  admin: {
    tables: null,
    columns: {},
    rows: null,
  },
  analyst: {
    tables: new Set(['fct_*', 'dim_*']),
    columns: { fct_salary: new Set(['*']) },
    rows: null,
  },
  viewer: {
    tables: new Set(['fct_orders']),
    columns: { fct_orders: new Set(['cost']) },
    rows: "region = '??'",
  },
};

export function normalizeUser(user: string | undefined): string | null {
  return user ?? null;
}

export function isDatabaseBypassCommand(command: string): boolean {
  return /\b(mysql|psql|clickhouse-client|sqlite3)\b/.test(command);
}

export const permissionSchemas = {
  login: Type.Object({}),
};
