export const routingPrompt = `=== 问数路由决策规则 ===
第 1 步：新会话首次提问前调用 list_metrics。
第 2 步：判断问题是否命中某个标准指标：
  命中 → 必须调用 query_metric
  未命中但涉及标准表 → search_schema → 生成 SQL → execute_sql
  模糊 → ask_clarification
第 3 步：结果必须标注来源：
[来源：dbt 标准指标] 或 [来源：临时 SQL 查询]`;
