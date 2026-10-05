# 语义模型重建设计

## 背景

当前语义模型管理使用非官方模板驱动，只能生成有限的基础层和 ratio 指标，无法覆盖 dbt MetricFlow 官方的 semantic model 层和五类指标。系统现有业务数据为 `askdata_import.order_detail`，实际 10,000 行、124 个字段。根据《# 任务：为 dbt 智能问数系统重建语义模型.md》，需要删除旧语义模型，并按官方结构重建。

## 目标

1. 建立官方 semantic model 基础层，声明实体、时间维度、分类维度和度量。
2. 建立并支持 `simple`、`ratio`、`derived`、`cumulative`、`conversion` 五类指标。
3. 语义模型编辑弹窗按模型类型动态展示参数表单。
4. 语义模型管理页全屏独立展示，不显示智能问数聊天窗口。
5. 提供已发布指标查询区，仅输出表格并支持查看生成 SQL。

## 数据口径

- 数据源：`askdata_import.order_detail`。
- dbt 模型：`order_detail`，由 `select * from askdata_import.order_detail` 输出。
- 默认时间轴：`order_effective_time`。
- 主实体：`order_id`。
- 关键实体：`order` primary、`policy` foreign、`product` foreign、`insurance_company` foreign、`channel` foreign、`department` foreign、`insure_unit` foreign、`customer` natural。
- 关键时间维度：`insure_time`、`order_pay_time`、`order_effective_time`、`order_expiration_time`、`unit_first_insurance_time`、`product_online_date`、`etl_time`、`parent_order_pay_time`。
- 关键分类维度：订单状态、订单类型、产品、产品线、保险公司、渠道、渠道类型、部门、投保单位省市、行业、职业等级、销售区域等。
- 关键度量：保费合计、保额合计、订单数、保单数、投保人数、减保人数、平均保费、保费 P95、支付口径保费、当前在保人数、佣金合计。

## 指标设计

- simple：`premium`、`premium_paid_time`、`premium_gd`、`policy_count`、`order_count`、`insured_persons`、`reduct_persons`、`avg_order_premium`、`premium_p95`、`current_insured_persons`。
- ratio：`avg_premium_per_policy`、`gd_premium_share`。
- derived：`net_person_change`、`premium_yoy`、`gd_premium_yoy`、`premium_vs_month_start`。
- cumulative：`premium_ytd`、`premium_rolling_30d`。
- conversion：`policy_cancellation_rate`。当前数据无“续保”订单类型，采用已确认口径：投保订单在 365 天内出现退保订单的转化率，转化主体为 `policy`。

## 后端设计

- 模板 ID：`semantic-model`、`simple-metric`、`ratio-metric`、`derived-metric`、`cumulative-metric`、`conversion-metric`。
- 保存草稿时保留结构化 JSON；发布时生成 YAML。
- semantic model 单独生成基础层文件；五类指标分别生成或合并到指标文件，保证引用关系完整。
- 校验名称格式、物理列存在性、默认时间轴、时间粒度、引用关系、`window` 与 `grain_to_date` 互斥、conversion 实体存在性。
- 新增已发布指标查询接口，后端调用 MetricFlow 编译 SQL 后执行只读查询，仅返回表格结果和生成 SQL，不支持任意 SQL 输入。

## 前端设计

- `semantic` 模块从侧边栏中移出，成为与数据接入类似的独立全屏工作台。
- 左侧为模型列表和创建入口，中间为模型编辑或指标查询。
- 不渲染 `MessageList`、`InputBox`、智能问数标题和结果面板。
- 编辑表单根据模板类型动态渲染文本、长文本、下拉、布尔和重复项，并展示各类型专有参数。
- 查询工作台支持指标多选、维度多选、时间范围、行数限制，执行后仅展示表格，并可查看生成 SQL。

## 清理范围

删除以下旧模型和指标：`schema.yml` 中 `fct_orders` 相关 semantic model 与 metrics、`fct_orders.sql`、`raw_orders.sql`、`semantic_refund_rate_local.yml`、`semantic_tc11_orders.yml`、`tc11_orders.sql`。

保留 `metricflow_time_spine` 和 `dbt-project/user_semantic_models/order_detail.sql`。

## 验证

1. `dbt parse --no-partial-parse`
2. `dbt compile`
3. 通过 MetricFlow 查询每类指标至少一个代表指标
4. 前端类型检查、测试和构建
5. 重建相关 Docker 服务并确认健康

## 非目标

- 不新增图表能力。
- 不允许在语义模型页执行任意 SQL。
- 不修改 pi-agent 源码。
- 不引入新依赖，除非实施中发现必须项并另行确认。

## 实施补充

`dbt-mysql` 最新版 1.7.0 强制依赖 `dbt-core~=1.7.0`，与本项目锁定的 `dbt-core 1.12.3` 不兼容。因此保留 dbt 1.12.3 + DuckDB 编译链路，在 MetricFlow bridge 中将生成的 SQL 转换为 MySQL 方言：

- 三段式 catalog.schema.table 转换为 MySQL schema.table。
- 保留 `WITH` CTE，不再从首个 `SELECT` 截断 SQL。
- `DATE_TRUNC` 按日、周、月、季、年、小时转换为 MySQL 日期函数。
- `GEN_RANDOM_UUID()` 转换为 `UUID()`。

累计指标依赖 registry 启动时创建并填充的 `askdata.metricflow_time_spine` 连续日期表。
