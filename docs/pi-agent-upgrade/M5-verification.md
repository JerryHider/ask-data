# M5 回归验证记录

执行时间：2026-09-12

| Case | 工具轨迹 | 结果 |
| --- | --- | --- |
| 湖北省保费 | `search_metrics` → `query_metric` | SQL 含 `WHERE order__insure_unit_province = '湖北省'`，返回 906,284.01 |
| 湖北省分年份保费 | `search_metrics` → `query_metric` | SQL 含 `GROUP BY order__order_effective_year, order__insure_unit_province`，与基础 SQL 不同 |
| 营收是多少 | `search_metrics` → `clarify` | `premium` 进入语义候选，但先确认“营收是否指保费”，未直接取数 |
| 各省份保费对比 | `search_metrics` → `query_metric` | SQL 按 `insure_unit_province` 分组并返回省份对比 |
| 把退保率高的用户标记出来 | `search_metrics` → `search_context` → `clarify` | 明确拒绝写操作，只提供只读名单方案并澄清口径 |
| 毛利率和退保率的区别 | `search_metrics` → `search_context` | 输出概念、公式与业务含义对比，不编造标准指标 |

补充工具覆盖 case：“查询 askdata_import.order_detail 表的 order_id 和 insure_money 前 10 条”。

- 工具轨迹：`search_context` → `run_sql`
- 返回：10 行明细
- Rollout：1104 条事件，`parseErrorCount: 0`
- 工具计数：`search_context: 1`，`run_sql: 1`

## 已知限制

- `BAAI/bge-m3` 已完成本地挂载并启用真实 embedding；`/health` 返回 `embedding_model: BAAI/bge-m3 (local)`。
- “营收”向量检索 top-1 为 `premium`（similarity 0.4461），同时保留语义候选注入与强制 clarify 的口径确认流程。
- 历史 rollout 中已有 688 行并发写入造成的损坏记录；新请求已验证 0 解析错误，历史文件仅用于排查，不作为回归依据。
