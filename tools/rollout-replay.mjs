import { readFile } from 'node:fs/promises';

const file = process.argv[2];
if (!file) {
  console.error('Usage: node tools/rollout-replay.mjs <rollout.jsonl>');
  process.exit(1);
}

const lines = (await readFile(file, 'utf8')).trim().split('\n').filter(Boolean);
for (const line of lines) {
  const event = JSON.parse(line);
  console.log(
    `${event.timestamp} ${event.type} ${JSON.stringify(event.payload)}`
  );
}
