'use client';

import { useState } from 'react';
import { useAskDataStore } from '../../lib/store';

const commands = ['/login', '/audit', '/sync-dbt'];

export default function InputBox() {
  const [value, setValue] = useState('');
  const streaming = useAskDataStore((state) => state.streaming);
  const sendMessage = useAskDataStore((state) => state.sendMessage);
  const createSession = useAskDataStore((state) => state.createSession);

  return (
    <footer className="border-t border-slate-200 p-4">
      <div className="mb-2 flex flex-wrap gap-2 text-xs text-slate-500">
        {commands.map((command) => (
          <button
            key={command}
            type="button"
            onClick={() => setValue(`${command} `)}
            className="rounded border border-slate-200 bg-slate-50 px-2 py-1"
          >
            {command}
          </button>
        ))}
      </div>
      <form
        className="flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (!value.trim()) return;
          if (!useAskDataStore.getState().activeSessionId) {
            void createSession().then(() => void sendMessage(value));
          } else {
            void sendMessage(value);
          }
          setValue('');
        }}
      >
        <input
          value={value}
          onChange={(event) => setValue(event.target.value)}
          disabled={streaming}
          placeholder="输入业务问题或命令"
          className="flex-1 rounded border border-slate-300 px-4 py-2 text-sm"
        />
        <button
          type="submit"
          disabled={streaming}
          className="rounded bg-blue-600 px-4 py-2 text-sm text-white disabled:bg-slate-400"
        >
          发送
        </button>
      </form>
    </footer>
  );
}
