'use client';

import { useState } from 'react';
import { useAskDataStore } from '../../lib/store';

export default function TaskList() {
  const sessions = useAskDataStore((state) => state.sessions);
  const activeSessionId = useAskDataStore((state) => state.activeSessionId);
  const createSession = useAskDataStore((state) => state.createSession);
  const selectSession = useAskDataStore((state) => state.selectSession);
  const [keyword, setKeyword] = useState('');
  const filtered = sessions.filter((session) => session.title.includes(keyword));

  return (
    <section className="flex h-full flex-col gap-3">
      <input
        value={keyword}
        onChange={(event) => setKeyword(event.target.value)}
        placeholder="搜索任务"
        className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
      />
      <button
        type="button"
        onClick={() => void createSession()}
        className="rounded bg-blue-600 px-3 py-2 text-sm text-white hover:bg-blue-700"
      >
        + 新建任务
      </button>
      <ul className="min-h-0 flex-1 space-y-2 overflow-auto">
        {filtered.map((session) => (
          <li key={session.id}>
            <button
              type="button"
              onClick={() => void selectSession(session.id)}
              className={`w-full rounded border px-3 py-2 text-left text-sm ${
                session.id === activeSessionId
                  ? 'border-blue-500 bg-blue-50 text-blue-800'
                  : 'border-slate-200 bg-white hover:bg-slate-100'
              }`}
            >
              {session.title}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
