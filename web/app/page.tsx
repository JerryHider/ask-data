'use client';

import { useEffect } from 'react';
import ActivityBar from '../components/Sidebar/ActivityBar';
import DataWorkspace from '../components/DataImport/DataWorkspace';
import SemanticWorkspace from '../components/SemanticModel/SemanticWorkspace';
import ModulePanel from '../components/Sidebar/ModulePanel';
import MessageList from '../components/ChatPanel/MessageList';
import InputBox from '../components/ChatPanel/InputBox';
import ResultPanel from '../components/ResultPanel/ResultPanel';
import { useAskDataStore } from '../lib/store';

export default function HomePage() {
  const loadSessions = useAskDataStore((state) => state.loadSessions);
  const createSession = useAskDataStore((state) => state.createSession);
  const activeModule = useAskDataStore((state) => state.activeModule);

  useEffect(() => {
    void loadSessions();
  }, [loadSessions]);

  return (
    <main className="flex h-screen w-screen overflow-hidden bg-slate-100">
      <ActivityBar />
      {activeModule === 'semantic' ? (
        <SemanticWorkspace />
      ) : activeModule === 'ingest' ? (
        <DataWorkspace />
      ) : (
        <>
          <ModulePanel />
          <section className="flex min-w-0 flex-1 flex-col border-x border-slate-200 bg-white">
            <header className="flex h-12 items-center justify-between border-b border-slate-200 px-4">
              <span className="font-semibold">智能问数</span>
              <span className="rounded bg-blue-50 px-2 py-1 text-xs text-blue-700">Plan</span>
            </header>
            <MessageList />
            <InputBox />
          </section>
          <ResultPanel />
          <button
            type="button"
            onClick={() => void createSession()}
            className="sr-only"
            aria-label="新建任务"
          />
        </>
      )}
    </main>
  );
}
