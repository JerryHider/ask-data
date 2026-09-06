'use client';

import { useState } from 'react';

export default function ToolCallCard({
  name,
  input,
}: {
  name: string;
  input: Record<string, unknown>;
}) {
  const [open, setOpen] = useState(false);
  return (
    <section className="mt-3 rounded border border-slate-200 bg-white">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between px-3 py-2 text-xs font-semibold text-slate-600"
      >
        <span>工具调用：{name}</span>
        <span>{open ? '收起' : '展开'}</span>
      </button>
      {open ? (
        <pre className="max-h-48 overflow-auto border-t border-slate-200 p-3 text-xs">
          {JSON.stringify(input, null, 2)}
        </pre>
      ) : null}
    </section>
  );
}
