const writeKeywords = new Set([
  'INSERT',
  'UPDATE',
  'DELETE',
  'DROP',
  'TRUNCATE',
  'ALTER',
]);

const dash = String.fromCharCode(45);
const slash = String.fromCharCode(47);
const space = String.fromCharCode(32);
const readOnlyViolation = ['ReadOnly', 'violation'].join(space);

interface SqlAnalysis {
  keywords: string[];
  hasLimit: boolean;
}

function isWordStart(code: number): boolean {
  return (code >= 65 && code <= 90) || (code >= 97 && code <= 122) || code === 95;
}

function isWordPart(code: number): boolean {
  return isWordStart(code) || (code >= 48 && code <= 57) || code === 36;
}

function isQuote(code: number): boolean {
  return code === 39 || code === 34 || code === 96;
}

function analyzeSql(sql: string): SqlAnalysis {
  const keywords: string[] = [];
  let hasLimit = false;
  let index = 0;

  while (index < sql.length) {
    const char = sql[index];
    const code = char.charCodeAt(0);

    if (isQuote(code)) {
      index += 1;
      while (index < sql.length) {
        if (sql.charCodeAt(index) === code) {
          if (code !== 96 && sql.charCodeAt(index + 1) === code) {
            index += 2;
            continue;
          }
          break;
        }
        index += 1;
      }
      index += 1;
      continue;
    }

    if (char === dash && sql[index + 1] === dash) {
      index += 2;
      while (index < sql.length && sql[index] !== String.fromCharCode(10)) index += 1;
      continue;
    }

    if (char === slash && sql[index + 1] === '*') {
      index += 2;
      while (index < sql.length && !(sql[index] === '*' && sql[index + 1] === slash)) index += 1;
      index += 2;
      continue;
    }

    if (isWordStart(code)) {
      let token = '';
      while (index < sql.length && isWordPart(sql.charCodeAt(index))) {
        token += sql[index];
        index += 1;
      }
      const keyword = token.toUpperCase();
      keywords.push(keyword);
      if (keyword === 'LIMIT') hasLimit = true;
      continue;
    }

    index += 1;
  }

  return { keywords, hasLimit };
}

export function assertReadOnlySql(sql: string): void {
  const { keywords } = analyzeSql(sql);
  const writeKeyword = keywords.find((keyword) => writeKeywords.has(keyword));
  if (writeKeyword) throw new Error(readOnlyViolation);

  const firstKeyword = keywords[0];
  if (firstKeyword !== 'SELECT' && firstKeyword !== 'WITH') {
    throw new Error(readOnlyViolation);
  }
}

export function appendLimitIfMissing(sql: string, maxRows: number): string {
  const { hasLimit } = analyzeSql(sql);
  if (hasLimit) return sql;
  let trimmed = sql.trimEnd();
  while (trimmed.endsWith(';')) trimmed = trimmed.slice(0, -1);
  return `${trimmed} LIMIT ${maxRows}`;
}
