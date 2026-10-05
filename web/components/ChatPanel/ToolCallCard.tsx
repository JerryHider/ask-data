'use client';

import { useState } from 'react';

export default function ToolCallCard({
  name,
  input,
  output,
  defaultOpen = false,
}: {
  name: string;
  input: Record<string, unknown>;
  output?: Record<string, unknown>;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
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
        <div className="grid gap-2 border-t border-slate-200 p-3 text-xs">
          <div>
            <p className="mb-1 font-semibold text-slate-500">入参</p>
            <pre className="max-h-32 overflow-auto rounded bg-slate-50 p-2">{JSON.stringify(input, null, 2)}</pre>
          </div>
          {output ? (
            <div>
              <p className="mb-1 font-semibold text-slate-500">出参</p>
              <pre className="max-h-32 overflow-auto rounded bg-slate-50 p-2">{JSON.stringify(output, null, 2)}</pre>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
