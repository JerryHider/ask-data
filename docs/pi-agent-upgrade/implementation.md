# pi-agent 完全体升级 M0–M5 落地说明

## 模式切换

- 默认：`AGENT_FLOW_MODE=full`，所有请求进入 pi-agent loop。
- 回滚：`AGENT_FLOW_MODE=legacy`，保留原有路由四周，便于观察后删除。
- 轮次上限：8 轮，通过 `shouldStopAfterTurn` 计数；达到上限会输出未完成原因。

## 工具面

| 工具 | 能力 | 护栏 |
| --- | --- | --- |
| `search_metrics` | 字面 + 分词 + 语义候选，返回 top-10 | “营收”只作为 `premium` 语义候选，不写入 synonyms |
| `search_context` | 检索 dbt schema、指标与知识索引 | 仅提供上下文 |
| `query_metric` | MetricFlow 编译 + sandbox 执行 | dimensions 必须来自指标白名单 |
| `run_sql` | 临时只读 SQL | Agent 层仅允许 SELECT/WITH；sandbox再做 AST/权限/行数校验 |
| `clarify` | 结构化澄清事件 | 调用后本轮停止，等待用户结构化回复 |

## 事件与日志

- SSE：`request`、`tool_call`、`tool_result`、`table_result`、`clarify`、`message`、`done`。
- JSONL：`data/rollouts/<sessionId>/<requestId>.jsonl`。
- 写入方式：进程内串行队列，避免并发追加导致 JSONL 行交错。
- 回放：`node tools/rollout-replay.mjs <file>`。
- 统计：`node tools/rollout-stats.mjs <file|directory>`。

## 语义模型

- 新增 `order_effective_year`、`order_effective_month` 派生维度。
- 批量补充 19 个指标的 synonyms；“营收/销售额/收入”刻意不加入等价词。
- artifact-parser 使用 cosine 空间，并索引 name、label、description、synonyms。
- 本地已挂载 `BAAI/bge-m3`，`artifact-parser` 使用真实 BGE embedding；索引文本仅保留名称、标签、描述和同义词，避免维度列表稀释语义召回。
