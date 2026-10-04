'use client';

import { useAskDataStore } from '../../lib/store';

export default function InputBox() {
  const streaming = useAskDataStore((state) => state.streaming);
  const value = useAskDataStore((state) => state.chatDraft);
  const setValue = useAskDataStore((state) => state.setChatDraft);
  const sendMessage = useAskDataStore((state) => state.sendMessage);
  const createSession = useAskDataStore((state) => state.createSession);
  const skillTestName = useAskDataStore((state) => state.skillTestName);
  const exitSkillTest = useAskDataStore((state) => state.exitSkillTest);

  return (
    <>
      {skillTestName ? (
        <div className='mb-2 flex items-center justify-between rounded bg-blue-50 px-3 py-2 text-xs text-blue-700'>
          <span>Skill 测试模式：{skillTestName}</span>
          <button type='button' onClick={() => void exitSkillTest()}>
            退出测试
          </button>
        </div>
      ) : null}
    <footer className="border-t border-slate-200 p-4">
      <form
        className="flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (!value.trim()) return;
          if (!useAskDataStore.getState().activeSessionId) {
            void createSession().then(() => {
              if (useAskDataStore.getState().activeSessionId) void sendMessage(value);
            });
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
    </>
  );
}
