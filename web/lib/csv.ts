export function buildCsv(
  columns: string[],
  rows: Record<string, unknown>[]
): string {
  return [
    columns.join(','),
    ...rows.map((row) =>
      columns
        .map((column) => `"${String(row[column] ?? '').replace(/"/g, '""')}"`)
        .join(',')
    ),
  ].join('\n');
}
