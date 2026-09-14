'use client';

import { create } from 'zustand';

export type ModuleKey = 'tasks' | 'semantic' | 'ingest' | 'settings';
export type ChatRole = 'user' | 'assistant' | 'clarify' | 'tool';

export interface QueryResult {
  columns: string[];
  rows: Record<string, unknown>[];
  rowCount: number;
  durationMs: number;
  sql: string;
}

export interface DataQueryTable {
  schema: string;
  name: string;
  type: string;
  estimatedRowCount: number;
  columns: { name: string; dataType: string; nullable: boolean; key: string }[];
}

export interface ChatMessage {
  id: string;
  role: ChatRole;
  text: string;
  options?: string[];
  toolName?: string;
  toolInput?: Record<string, unknown>;
  toolOutput?: Record<string, unknown>;
}

export interface ClarificationReply {
  question: string;
  selectedOption: string;
}

export interface SessionSummary {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

interface AskDataState {
  activeModule: ModuleKey;
  activeSessionId: string | null;
  sessions: SessionSummary[];
  messages: ChatMessage[];
  streaming: boolean;
  reasoning: string;
  streamStatus: string | null;
  tableResult: { title: string; queryResult: QueryResult } | null;
  resultOpen: boolean;
  resultTab: 'table' | 'changes' | 'logs';
  logs: string[];
  skillTestId: string | null;
  skillTestName: string | null;
  dataQuerySql: string;
  dataQueryResult: QueryResult | null;
  dataQuerySelectedTable: DataQueryTable | null;
  setActiveModule: (module: ModuleKey) => void;
  setDataQuerySql: (sql: string) => void;
  setDataQueryResult: (result: QueryResult | null) => void;
  setDataQuerySelectedTable: (table: DataQueryTable | null) => void;
  clearDataQueryWorkspace: () => void;
  loadSessions: () => Promise<void>;
  createSession: () => Promise<void>;
  selectSession: (sessionId: string) => Promise<void>;
  deleteSession: (sessionId: string) => Promise<void>;
  sendMessage: (message: string, clarification?: ClarificationReply) => Promise<void>;
  setResultTab: (tab: 'table' | 'changes' | 'logs') => void;
  startSkillTest: (skill: { id: number; name: string }) => Promise<void>;
  exitSkillTest: () => Promise<void>;
}

function createId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random()}`;
}

async function parseSseStream(
  response: Response,
  onEvent: (event: string, data: unknown) => void
): Promise<void> {
  if (!response.body) return;
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const chunks = buffer.split('\n\n');
    buffer = chunks.pop() ?? '';
    for (const chunk of chunks) {
      const eventLine = chunk.split('\n').find((line) => line.startsWith('event: '));
      const dataLine = chunk.split('\n').find((line) => line.startsWith('data: '));
      if (!eventLine || !dataLine) continue;
      onEvent(eventLine.slice(7), JSON.parse(dataLine.slice(6)));
    }
  }
}

export const useAskDataStore = create<AskDataState>((set, get) => ({
  activeModule: 'tasks',
  activeSessionId: null,
  sessions: [],
  messages: [],
  streaming: false,
  reasoning: '',
  streamStatus: null,
  tableResult: null,
  resultOpen: false,
  resultTab: 'table',
  logs: [],
  skillTestId: null,
  skillTestName: null,
  dataQuerySql: '',
  dataQueryResult: null,
  dataQuerySelectedTable: null,
  setActiveModule: (activeModule) => set({ activeModule }),
  setDataQuerySql: (dataQuerySql) => set({ dataQuerySql }),
  setDataQueryResult: (dataQueryResult) => set({ dataQueryResult }),
  setDataQuerySelectedTable: (dataQuerySelectedTable) => set({ dataQuerySelectedTable }),
  clearDataQueryWorkspace: () =>
    set({ dataQuerySql: '', dataQueryResult: null, dataQuerySelectedTable: null }),
  loadSessions: async () => {
    const response = await fetch('/api/sessions');
    if (!response.ok) return;
    set({ sessions: await response.json() });
  },
  createSession: async () => {
    const skillTestId = get().skillTestId;
    const response = await fetch('/api/session', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(skillTestId ? { skill_test: skillTestId } : {}),
    });
    if (!response.ok) return;
    const data = (await response.json()) as { sessionId: string };
    set({
      activeSessionId: data.sessionId,
      messages: [],
      tableResult: null,
      resultOpen: false,
      reasoning: '',
      streamStatus: null,
    });
    await get().loadSessions();
  },
  selectSession: async (sessionId) => {
    const response = await fetch(`/api/sessions/${sessionId}/messages`);
    if (!response.ok) return;
    const messages = (await response.json()) as { id: string; role: ChatRole; text: string }[];
    set({ activeSessionId: sessionId, messages, reasoning: '', streamStatus: null });
  },
  deleteSession: async (sessionId) => {
    if (get().streaming) return;
    const response = await fetch(`/api/sessions/${sessionId}`, { method: 'DELETE' });
    if (!response.ok) return;
    if (get().activeSessionId === sessionId) {
      set({
        activeSessionId: null,
        messages: [],
        tableResult: null,
        resultOpen: false,
        logs: [],
        reasoning: '',
        streamStatus: null,
      });
    }
    await get().loadSessions();
  },
  sendMessage: async (message, clarification) => {
    const { activeSessionId, streaming } = get();
    if (!activeSessionId || streaming || !message.trim()) return;
    const userMessage = { id: createId(), role: 'user' as const, text: message.trim() };
    set({
      messages: [...get().messages, userMessage],
      streaming: true,
      reasoning: '',
      streamStatus: null,
    });
    try {
      const response = await fetch('/api/message', {
        method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        conversation_id: activeSessionId,
        sessionId: activeSessionId,
        message,
        clarification,
      }),
      });
      await parseSseStream(response, (event, data) => {
        const payload = data as Record<string, unknown>;
        if (event === 'reasoning') {
          set({ reasoning: get().reasoning + String(payload.delta ?? '') });
        } else if (event === 'heartbeat') {
          set({ streamStatus: String(payload.text ?? '') });
        } else if (event === 'done') {
          set({ streamStatus: null });
        } else if (event === 'message') {
          set({
            streamStatus: null,
            messages: [
              ...get().messages,
              { id: createId(), role: 'assistant', text: String(payload.text ?? '') },
            ],
          });
        } else if (event === 'tool_call') {
          set({
            streamStatus: null,
            logs: [...get().logs, `tool_call: ${String(payload.name)}`],
            messages: [
              ...get().messages,
              {
                id: createId(),
                role: 'tool',
                text: '',
                toolName: String(payload.name ?? ''),
                toolInput: (payload.input ?? {}) as Record<string, unknown>,
              },
            ],
          });
        } else if (event === 'tool_result') {
          set({ logs: [...get().logs, `tool_result: ${String(payload.name)}`] });
          const messages = [...get().messages];
          for (let index = messages.length - 1; index >= 0; index -= 1) {
            if (messages[index].toolName === payload.name && !messages[index].toolOutput) {
              messages[index] = {
                ...messages[index],
                toolOutput: (payload.output ?? {}) as Record<string, unknown>,
              };
              break;
            }
          }
          set({ messages });
        } else if (event === 'table_result') {
          set({
            tableResult: payload as { title: string; queryResult: QueryResult },
            resultOpen: true,
            resultTab: 'table',
          });
        } else if (event === 'clarify') {
          set({
            streamStatus: null,
            messages: [
              ...get().messages,
              {
                id: createId(),
                role: 'clarify',
                text: String(payload.question ?? ''),
                options: Array.isArray(payload.options) ? payload.options.map(String) : [],
              },
            ],
          });
        }
      });
    } catch (error) {
      set({
        streamStatus: null,
        messages: [
          ...get().messages,
          {
            id: createId(),
            role: 'assistant' as const,
            text: `请求失败：${(error as Error).message || '未知错误'}`,
          },
        ],
      });
    } finally {
      set({ streaming: false, streamStatus: null });
      await get().loadSessions();
    }
  },
  setResultTab: (resultTab) => set({ resultTab }),
  startSkillTest: async (skill) => {
    set({ skillTestId: String(skill.id), skillTestName: skill.name });
    await get().createSession();
    set({ activeModule: 'tasks' });
  },
  exitSkillTest: async () => {
    set({ skillTestId: null, skillTestName: null });
    await get().createSession();
  },
}));
