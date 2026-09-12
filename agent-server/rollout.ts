import { appendFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

const rolloutDir = path.resolve(process.cwd(), '..', 'data', 'rollouts');
let writeQueue: Promise<void> = Promise.resolve();

async function appendRolloutRecord(
  sessionId: string,
  requestId: string,
  type: string,
  payload: unknown
): Promise<void> {
  if (!/^[a-f0-9-]{36}$/i.test(sessionId) || !/^[a-f0-9-]{36}$/i.test(requestId)) {
    throw new Error('Invalid rollout identifiers');
  }
  const directory = path.join(rolloutDir, sessionId);
  await mkdir(directory, { recursive: true });
  const record = {
    timestamp: new Date().toISOString(),
    sessionId,
    requestId,
    type,
    payload,
  };
  await appendFile(path.join(directory, `${requestId}.jsonl`), `${JSON.stringify(record)}\n`, 'utf8');
}

export function appendRolloutEvent(
  sessionId: string,
  requestId: string,
  type: string,
  payload: unknown
): Promise<void> {
  const write = writeQueue.then(() =>
    appendRolloutRecord(sessionId, requestId, type, payload)
  );
  writeQueue = write.catch(() => undefined);
  return write;
}
