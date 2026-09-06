'use client';

import TaskList from './TaskList';
import ModelListPanel from '../SemanticModel/ModelListPanel';
import FileImportPanel from '../DataImport/FileImportPanel';
import DbConnectionPanel from '../DataImport/DbConnectionPanel';
import SettingsPanel from '../AskSettings/SettingsPanel';
import SkillListPanel from '../Skills/SkillListPanel';
import { useAskDataStore } from '../../lib/store';

const help: Record<string, string> = {
  tasks: '管理问数任务并保留会话历史。',
  semantic: '维护语义模型与指标口径。',
  ingest: '导入文件或管理数据库连接。',
  settings: '配置模型、样例、上下文与安全策略。',
  skills: '沉淀可复用的问数技能。',
};

export default function ModulePanel() {
  const activeModule = useAskDataStore((state) => state.activeModule);
  const width = activeModule === 'semantic' || activeModule === 'skills' ? 420 : 280;

  return (
    <aside
      className="flex h-full shrink-0 flex-col border-r border-slate-200 bg-slate-50"
      style={{ width }}
    >
      <header className="flex h-12 items-center justify-between border-b border-slate-200 px-4 text-base font-semibold">
        {activeModule === 'tasks' ? '任务' : null}
        {activeModule === 'semantic' ? '语义模型' : null}
        {activeModule === 'ingest' ? '数据接入' : null}
        {activeModule === 'settings' ? '问数设置' : null}
        {activeModule === 'skills' ? 'Skills' : null}
      </header>
      <div className="min-h-0 flex-1 overflow-auto p-3">
        {activeModule === 'tasks' ? <TaskList /> : null}
        {activeModule === 'semantic' ? <ModelListPanel /> : null}
        {activeModule === 'ingest' ? (
          <div className="space-y-4">
            <FileImportPanel />
            <DbConnectionPanel />
          </div>
        ) : null}
        {activeModule === 'settings' ? <SettingsPanel /> : null}
        {activeModule === 'skills' ? <SkillListPanel /> : null}
      </div>
      <footer className="border-t border-slate-200 px-4 py-3 text-xs text-slate-500">
        {help[activeModule]}
      </footer>
    </aside>
  );
}
