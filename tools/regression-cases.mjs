import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const baseUrl = process.env.ASKDATA_BASE_URL ?? 'http://127.0.0.1:3001';
const cases = [
  '湖北省保费',
  '湖北省分年份保费',
  '营收是多少',
  '各省份保费对比',
  '把退保率高的用户标记出来',
  '毛利率和退保率的区别',
];

async function createSession() {
  const response = await fetch(`${baseUrl}/api/session`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  });
  if (!response.ok) throw new Error(`create session failed: ${response.status}`);
  const data = await response.json();
  return data.sessionId;
}

async function runCase(message) {
  const sessionId = await createSession();
  const response = await fetch(`${baseUrl}/api/message`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ conversation_id: sessionId, sessionId, message }),
  });
  if (!response.body) throw new Error('message stream is empty');

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const events = [];
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const chunks = buffer.split('\n\n');
    buffer = chunks.pop() ?? '';
    for (const chunk of chunks) {
      const eventLine = chunk.split('\n').find((line) => line.startsWith('event: '));
      const dataLine = chunk.split('\n').find((line) => line.startsWith('data: '));
      if (!eventLine || !dataLine) continue;
      events.push({
        event: eventLine.slice(7),
        data: JSON.parse(dataLine.slice(6)),
      });
    }
  }

  return {
    message,
    sessionId,
    events,
    toolCalls: events
      .filter((event) => event.event === 'tool_call')
      .map((event) => event.data.name),
    clarify: events.find((event) => event.event === 'clarify')?.data ?? null,
    result: events.find((event) => event.event === 'table_result')?.data ?? null,
    finalText: [...events]
      .reverse()
      .find((event) => event.event === 'message')?.data.text ?? '',
    done: events.find((event) => event.event === 'done')?.data ?? null,
  };
}

const results = [];
for (const message of cases) {
  process.stdout.write(`RUN ${message}\n`);
  results.push(await runCase(message));
}

const outputDir = path.resolve('data', 'regression');
await mkdir(outputDir, { recursive: true });
const outputPath = path.join(outputDir, 'full-agent.json');
await writeFile(outputPath, `${JSON.stringify(results, null, 2)}\n`, 'utf8');
process.stdout.write(`WROTE ${outputPath}\n`);
