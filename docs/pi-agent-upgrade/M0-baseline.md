# pi-agent 升级改造 M0 基线

## API 盘点

- 包版本：`@earendil-works/pi-agent-core@0.85.0`、`@earendil-works/pi-ai@0.85.0`。
- `AgentOptions`：`initialState`、`streamFn`、`beforeToolCall`、`afterToolCall`、`shouldStopAfterTurn`、`prepareNextTurn`、`sessionId`、`transport`、`toolExecution` 等。
- `AgentState`：`systemPrompt`、`model`、`thinkingLevel`、`tools`、`messages`。
- 生命周期事件：`agent_start`、`agent_end`、`turn_start`、`turn_end`、`message_start`、`message_update`、`message_end`、`tool_execution_start`、`tool_execution_update`、`tool_execution_end`。
- 无内置 `max_turns` 参数；轮次上限由 `shouldStopAfterTurn` 自行计数实现。
- `AgentTool`：`name`、`label`、`description`、`parameters`、`execute(toolCallId, params, signal, onUpdate)`；失败必须 `throw`，由 agent loop 生成错误工具结果。

## 六条回归 case

| Case | 当前基线 | 判定 |
| --- | --- | --- |
| 湖北省保费 | 字面命中 `premium`，省份过滤与取数正常 | 保持不劣化 |
| 湖北省分年份保费 | 与“湖北省保费”生成相同 SQL，无年份 `GROUP BY` | 缺陷 |
| 营收是多少 | `resolveMetric` 得 0 分，进入固定兜底文案 | 缺陷 |
| 各省份保费对比 | 依赖正则识别省份分组；未形成工具化决策 | 待 full 模式验证 |
| 把退保率高的用户标记出来 | 旧路由识别写意图后固定构造 `DELETE` 试探沙箱 | 高风险缺陷 |
| 毛利率和退保率的区别 | 未命中标准指标，不进入解释工具链 | 待 full 模式验证 |

## 当前限制

- `metricScore` 仅做字面包含，命中阈值为 `score > 0`。
- 19 个指标中只有 2 个配置 synonyms。
- artifact-parser 使用 Chroma L2 空间；“营收”类问法与 `premium` 的距离超过 370，语义召回不可用。
- SQL 沙箱已内置 sqlglot AST 校验、表/列权限、行级过滤和行数限制；Agent 层仍需只读护栏，避免把写意图送入沙箱。
