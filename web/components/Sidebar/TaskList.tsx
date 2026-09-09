'use client';

import { useState } from 'react';
import { useAskDataStore } from '../../lib/store';

export default function TaskList() {
  const sessions = useAskDataStore((state) => state.sessions);
  const activeSessionId = useAskDataStore((state) => state.activeSessionId);
  const createSession = useAskDataStore((state) => state.createSession);
  const selectSession = useAskDataStore((state) => state.selectSession);
  const deleteSession = useAskDataStore((state) => state.deleteSession);
  const streaming = useAskDataStore((state) => state.streaming);
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
            <div
              className={`flex items-stretch gap-2 rounded border ${
                session.id === activeSessionId
                  ? 'border-blue-500 bg-blue-50'
                  : 'border-slate-200 bg-white'
              }`}
            >
              <button
                type="button"
                onClick={() => void selectSession(session.id)}
                className="min-w-0 flex-1 px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-100"
              >
                <span className="block truncate">{session.title}</span>
              </button>
              <button
                type="button"
                disabled={streaming}
                onClick={(event) => {
                  event.stopPropagation();
                  if (!window.confirm('确定删除该历史会话吗？删除后不可恢复。')) return;
                  void deleteSession(session.id);
                }}
                className="rounded border border-transparent px-2 py-1 text-xs text-red-600 hover:border-red-300 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                删除
              </button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
