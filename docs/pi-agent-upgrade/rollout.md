# Rollout 日志说明

- 存储：`data/rollouts/<sessionId>/<requestId>.jsonl`
- 记录：`request`、Agent 生命周期事件、`tool_call`、`tool_result`、`clarify`、`table_result`、`message`、`done`
- 回放：`node tools/rollout-replay.mjs data/rollouts/<sessionId>/<requestId>.jsonl`
- 统计：`corepack pnpm run rollout:stats data/rollouts/<sessionId>/<requestId>.jsonl`
- 模式：`AGENT_FLOW_MODE=full`（默认）或 `legacy`（回滚）
