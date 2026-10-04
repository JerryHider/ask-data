export type SettingsSectionKey =
  | 'llm'
  | 'sql-examples'
  | 'context'
  | 'rag'
  | 'skills'
  | 'sandbox';

export const settingsSections: {
  key: SettingsSectionKey;
  label: string;
  description: string;
}[] = [
  { key: 'llm', label: 'LLM 模型配置', description: '管理模型连接参数和激活配置。' },
  { key: 'sql-examples', label: 'NL→SQL 转换样例', description: '维护自然语言到 SQL 的转换样例。' },
  { key: 'context', label: '上下文设置', description: '配置会话历史、压缩和澄清策略。' },
  { key: 'rag', label: 'RAG 知识库', description: '管理知识库空间和文档。' },
  { key: 'skills', label: '自定义 Skill', description: '管理和测试自定义问数 Skill。' },
  { key: 'sandbox', label: '沙箱设置', description: '配置查询超时、行数和脱敏策略。' },
];
