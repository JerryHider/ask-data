'use client';

import { useAskDataStore, type ModuleKey } from '../../lib/store';

const modules: Array<{ key: ModuleKey; label: string; tooltip: string; icon: string }> = [
  { key: 'tasks', label: '任务', tooltip: '任务列表', icon: '☰' },
  { key: 'semantic', label: '语义', tooltip: '语义模型管理', icon: '≡' },
  { key: 'ingest', label: '接入', tooltip: '数据导入与连接', icon: '▤' },
  { key: 'settings', label: '设置', tooltip: '智能问数配置', icon: '⚙' },
  { key: 'skills', label: '技能', tooltip: '自定义 Skill', icon: '✦' },
];

export default function ActivityBar() {
  const activeModule = useAskDataStore((state) => state.activeModule);
  const setActiveModule = useAskDataStore((state) => state.setActiveModule);

  return (
    <aside className="flex h-full w-12 flex-col items-center border-r border-slate-200 bg-slate-900 py-3 text-slate-300">
      {modules.map((module) => (
        <button
          key={module.key}
          type="button"
          title={module.tooltip}
          aria-label={module.label}
          onClick={() => setActiveModule(module.key)}
          className={`relative mb-2 flex h-10 w-10 items-center justify-center rounded text-lg transition ${
            activeModule === module.key ? 'bg-slate-700 text-white' : 'hover:bg-slate-800'
          }`}
        >
          {activeModule === module.key ? (
            <span className="absolute left-0 top-2 bottom-2 w-0.5 rounded bg-blue-500" />
          ) : null}
          <span aria-hidden>{module.icon}</span>
        </button>
      ))}
      <div className="mt-auto flex h-8 w-8 items-center justify-center rounded-full bg-blue-600 text-sm text-white">
        A
      </div>
    </aside>
  );
}
