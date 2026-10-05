'use client';

import AuditLogTab from './AuditLogTab';
import TableTab from './TableTab';
import { useAskDataStore } from '../../lib/store';

export default function ResultPanel() {
  const resultOpen = useAskDataStore((state) => state.resultOpen);
  const resultTab = useAskDataStore((state) => state.resultTab);
  const setResultTab = useAskDataStore((state) => state.setResultTab);

  if (!resultOpen) return null;

  return (
    <aside className="flex h-full w-[360px] shrink-0 flex-col border-l border-slate-200 bg-white">
      <header className="flex h-12 items-center gap-1 border-b border-slate-200 px-3">
        {(['table', 'changes', 'logs'] as const).map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => setResultTab(tab)}
            className={`rounded px-3 py-1 text-sm ${
              resultTab === tab ? 'bg-blue-50 text-blue-700' : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            {tab === 'table' ? '表格' : tab === 'changes' ? '变更' : '日志'}
          </button>
        ))}
      </header>
      <div className="min-h-0 flex-1 overflow-auto p-3">
        {resultTab === 'table' ? <TableTab /> : null}
        {resultTab === 'changes' ? <p className="text-sm text-slate-600">只读查询，无变更。</p> : null}
        {resultTab === 'logs' ? <AuditLogTab /> : null}
      </div>
      <footer className="border-t border-slate-200 px-4 py-2 text-xs text-slate-500">
        [来源：dbt 标准指标]
      </footer>
    </aside>
  );
}
