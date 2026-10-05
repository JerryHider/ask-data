import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';

const input = process.argv[2];
if (!input) {
  console.error('Usage: node tools/rollout-stats.mjs <rollout.jsonl|rollout-directory>');
  process.exit(1);
}

async function listFiles(target) {
  const info = await stat(target);
  if (info.isFile()) return [target];
  const entries = await readdir(target, { withFileTypes: true, recursive: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.jsonl'))
    .map((entry) => path.join(entry.parentPath, entry.name));
}

const files = await listFiles(input);
const events = [];
let parseErrorCount = 0;
for (const file of files) {
  for (const line of (await readFile(file, 'utf8')).split('\n')) {
    if (!line.trim()) continue;
    try {
      events.push(JSON.parse(line));
    } catch {
      parseErrorCount += 1;
    }
  }
}
const toolCalls = events.filter((event) => event.type === 'tool_execution_start');
const toolCounts = toolCalls.reduce((counts, event) => {
  const name = event.payload?.toolName ?? 'unknown';
  counts[name] = (counts[name] ?? 0) + 1;
  return counts;
}, {});

console.log(
  JSON.stringify(
    {
      input,
      fileCount: files.length,
      parseErrorCount,
      requestCount: events.filter((event) => event.type === 'request').length,
      eventCount: events.length,
      toolCallCount: toolCalls.length,
      toolCounts,
      clarifyCount: events.filter((event) => event.type === 'clarify').length,
      turnCount: events.filter((event) => event.type === 'turn_start').length,
      hitTurnLimit: events.some(
        (event) => event.type === 'done' && event.payload?.hitTurnLimit === true
      ),
    },
    null,
    2
  )
);
