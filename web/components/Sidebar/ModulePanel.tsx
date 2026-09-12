'use client';

import TaskList from './TaskList';
import SettingsPanel from '../AskSettings/SettingsPanel';
import { useAskDataStore } from '../../lib/store';

const help: Record<string, string> = {
  tasks: '管理问数任务并保留会话历史。',
  ingest: '导入文件或管理数据库连接。',
  settings: '配置模型、样例、上下文、安全策略与自定义 Skill。',
};

export default function ModulePanel() {
  const activeModule = useAskDataStore((state) => state.activeModule);
  const width = activeModule === 'settings' ? 420 : 280;

  return (
    <aside
      className="flex h-full shrink-0 flex-col border-r border-slate-200 bg-slate-50"
      style={{ width }}
    >
      <header className="flex h-12 items-center justify-between border-b border-slate-200 px-4 text-base font-semibold">
        {activeModule === 'tasks' ? '任务' : null}
        {activeModule === 'ingest' ? '数据接入' : null}
        {activeModule === 'settings' ? '问数设置' : null}
      </header>
      <div className="min-h-0 flex-1 overflow-auto p-3">
        {activeModule === 'tasks' ? <TaskList /> : null}
        {activeModule === 'settings' ? <SettingsPanel /> : null}
      </div>
      <footer className="border-t border-slate-200 px-4 py-3 text-xs text-slate-500">
        {help[activeModule]}
      </footer>
    </aside>
  );
}
