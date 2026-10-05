'use client';

import { useAskDataStore } from '../../lib/store';

export default function AuditLogTab() {
  const logs = useAskDataStore((state) => state.logs);
  return (
    <ul className="space-y-2 text-xs text-slate-600">
      {logs.length === 0 ? <li>暂无事件。</li> : null}
      {logs.map((log, index) => (
        <li key={`${index}-${log}`} className="rounded border border-slate-200 bg-slate-50 p-2">
          {log}
        </li>
      ))}
    </ul>
  );
}
