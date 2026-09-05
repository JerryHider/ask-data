================================================================================
   AskData 平台产品设计文档（AGENTS.md）
   基于 pi-agent + dbt 的本地智能问数系统，界面参照 WorkBuddy
================================================================================
文档版本：v1.0 完整版（单文件，取代此前所有分册）
生成日期：2026-09-05
目标读者：OpenAI Codex CLI / Codex Agent
生效方式：保存为项目根目录 AGENTS.md，Codex 启动会话自动读取，
          无需导入任何其他文档
编写规范：每个模块均含【目标】【上下文】【具体要求】【约束】
          【完成条件】五要素；所有验收标准为可执行断言

================================================================================
第 0 章  全局硬性约束（最高优先级，覆盖所有模块）
================================================================================

G-01  部署形态
      本地部署优先。所有服务通过 docker-compose 在单机运行，
      不依赖任何云服务。唯一例外：LLM API（可配置为本地 Ollama
      或远端 OpenAI/Anthropic，通过 LLM 配置面板或 .env 切换，
      见 M14）。

G-02  数据源扩展
      当前仅实现 MySQL 连接器作为默认数据源。必须通过 BaseConnector
      适配器模式预留 PostgreSQL / ClickHouse / StarRocks 接口，
      新增数据源只允许新建一个文件实现 BaseConnector，
      禁止修改已有连接器代码。

G-03  输出形态
      所有问数结果仅输出表格（对话区 Markdown 表格 + 结果区
      HTML 表格 + CSV 导出），禁止引入 ECharts / Chart.js /
      Recharts / D3 等任何图表库。禁止在前后端代码中出现
      render_chart、plot、figure 等图表相关函数或组件。
      文件导入的数据预览、统计信息一律以表格/列表呈现。

G-04  界面风格
      前端必须复刻 WorkBuddy 式布局：
      活动栏（48px）+ 模块面板（280px）+ 对话区（flex-1）+
      结果区（360px）四区结构。详细交互规范见第 11 章，
      不得自行发挥。

G-05  禁止事项
      - 禁止修改 pi-agent（@earendil-works/*）npm 包源码
      - 禁止绕过沙箱直接连接数据库执行 SQL
      - 禁止在代码中硬编码任何密码、API Key、连接串
        （一律从 .env 或 registry 加密存储读取）
      - 禁止生成任何图表（见 G-03）
      - 禁止引入本规范未列出的额外依赖（如需新增，先在对话中
        说明理由并获得确认）
      - 禁止密钥明文出现在任何 GET 响应或日志中
        （一律掩码 "****"）

G-06  技术栈锁定
      后端 Agent：TypeScript 5.x + Node.js 20 LTS + ESM
      胶水服务：Python 3.11 + FastAPI + Pydantic v2
      前端：Next.js 14 (App Router) + TypeScript + Tailwind CSS
      状态管理：Zustand（禁止 Redux）
      Markdown 渲染：react-markdown + remark-gfm
      向量库：Chroma（本地 Docker 单实例）
      元数据/审计库：SQLite（本地文件，SQLAlchemy ORM 隔离，
      后续可替换 PostgreSQL）
      包管理：pnpm（前端/Agent）、uv（Python 服务）

G-07  完成条件全局定义
      每个模块的完成条件必须全部满足才可标记完成：
      a. 代码通过 TypeScript strict 模式编译（tsc --noEmit 无错误）
      b. 模块自带测试用例全部通过
      c. docker-compose up 后该模块服务健康检查返回 200
      d. 在对应章节"完成状态"处标记 [DONE]

G-08  遇到未定义细节的处理
      本文档未覆盖的情况（错误码格式、样式 token 等），先遵循
      已有约定；仍无约定则在对话中提问确认，禁止自行假设。
      优先级：本文件 > 用户当次对话指令 > 通用最佳实践。

================================================================================
第 1 章  系统架构总览与目录结构
================================================================================

【架构总览（文字描述）】

四层结构：

  表现层（web，Next.js）
    活动栏 / 模块面板 / 对话区 / 结果区
        │ HTTP(SSE)
  Agent 执行层（agent-server，Node + pi-agent）
    createAgentSession + 10 个扩展模块
    （datasource / dbt-artifact / metric-tools / dual-router /
     sql-sandbox / permission / audit / clarify / table-render /
     skills-loader）
        │ HTTP
  服务层（Python FastAPI）
    registry(8004)      元数据中心：语义模型/连接/LLM配置/
                         样例/知识库/沙箱设置/Skills/审计入口
    artifact-parser(8001)  dbt 工件解析 + 向量索引 + 检索
    metricflow-bridge(8002) 指标编译（本地 dbt parse + MetricFlow）
    sandbox(8003)       SQL 安全执行 + 权限细校验 + 审计写入
    data-ingest(8005)   CSV/Excel 解析导入
        │
  数据层
    mysql:8.0           默认数据源（含 askdata_import 导入 schema）
    chroma              向量库（schema/metrics/join_hints/
                        sql_examples/knowledge_* collections）
    SQLite              registry 元数据 + 审计
    ollama（可选）       本地 LLM

【目录结构（必须严格按此创建）】

askdata/
├── AGENTS.md                    # 本文件（唯一规范文档）
├── docker-compose.yml
├── .env.example
├── extensions/                  # pi-agent TypeScript 扩展
│   ├── index.ts                 # 统一注册入口
│   ├── datasource/              # M2
│   ├── dbt-artifact/            # M3
│   ├── metric-tools/            # M4
│   ├── dual-router/             # M5
│   ├── sql-sandbox/             # M6
│   ├── permission/              # M7
│   ├── audit/                   # M8
│   ├── clarify/                 # M9
│   ├── table-render/            # M10
│   └── skills-loader/           # M15 注入扩展
├── services/
│   ├── artifact-parser/         # M3：parser.py + main.py + embedder.py
│   ├── metricflow-bridge/       # M4：main.py（含 /reparse 端点）
│   ├── sandbox/                 # M6+M7+M8：main.py + models.py
│   ├── registry/                # M12-M15：main.py + templates.py
│   └── data-ingest/             # M13：main.py
├── agent-server/
│   └── server.ts                # 第 12 章：Express + SSE
├── web/
│   ├── app/                     # App Router（单页 page.tsx）
│   ├── components/
│   │   ├── Sidebar/             # ActivityBar / ModulePanel /
│   │   │                         TaskList
│   │   ├── ChatPanel/           # MessageList / ToolCallCard /
│   │   │                         ClarifyCard / InputBox
│   │   ├── ResultPanel/         # TableTab / AuditLogTab /
│   │   │                         ResultPanel
│   │   ├── SemanticModel/       # ModelListPanel / TemplatePicker /
│   │   │                         ModelEditorModal
│   │   ├── DataImport/          # FileImportPanel / DbConnectionPanel
│   │   ├── AskSettings/         # SettingsPanel / LlmConfigForm /
│   │   │                         SqlExampleEditor / RagSpaceManager
│   │   └── Skills/              # SkillListPanel / SkillEditorModal
│   └── lib/
├── dbt-project/                 # 用户已有 dbt 工程（ro 挂载）
│   ├── target/                  # manifest.json 等
│   └── user_semantic_models/    # 唯一 rw 子目录：M12 发布的 YAML
├── data/                        # 宿主机持久化卷
│   ├── mysql/  chroma/  tmp_uploads/
│   ├── registry.db  audit.db  auth.db
│   ├── sessions/                # 会话 JSON
│   └── skills/                  # Skill Markdown 副本
└── tests/                       # vitest 端到端测试

【完成条件】
1. 上述目录全部创建（空目录放 .gitkeep）
2. pnpm init + 安装 typescript @types/node（devDependencies）
3. tsconfig.json 开启 strict: true，target ES2022，module NodeNext
4. git commit："chore: init project skeleton"

================================================================================
第 2 章  M2【数据源连接器】
================================================================================

【目标】
实现 MySQL 连接器作为默认本地数据源，通过 BaseConnector 抽象类
预留 PostgreSQL / ClickHouse / StarRocks 扩展点；连接配置支持
运行时从 registry 动态加载（配合 M13 数据库连接管理）。

【上下文】
pi-agent 本身无数据源能力。本模块是 M3（Schema 检索）与 M6
（SQL 执行）的基础。静态默认连接来自 .env；用户新增的连接由
agent-server 调 /api/datasources/refresh 动态注入。

【具体要求】

1. extensions/datasource/types.ts 定义抽象接口：

   abstract class BaseConnector {
     abstract testConnection(): Promise<boolean>
     abstract listTables(): Promise<TableMeta[]>
     abstract describeTable(tableName: string): Promise<ColumnMeta[]>
     abstract executeReadOnlySql(
       sql: string, opts: { timeoutMs: number; maxRows: number }
     ): Promise<QueryResult>
     abstract close(): Promise<void>
   }

   类型定义：
   TableMeta  { name; schema; rowCount; comment }
   ColumnMeta { name; type; nullable; comment; isPrimaryKey }
   QueryResult { columns: string[];
                 rows: Record<string, unknown>[];
                 rowCount; durationMs; sql }

2. extensions/datasource/connectors/mysql.ts 实现 MySQLConnector：
   - 依赖：mysql2/promise（唯一数据库驱动）
   - 默认连接串从 process.env.DATASOURCE_MYSQL_URL 读取
   - executeReadOnlySql 内部必须：
     a. 解析 SQL，若含 INSERT/UPDATE/DELETE/DROP/TRUNCATE/ALTER
        抛 Error("ReadOnly violation")
     b. 无 LIMIT 子句自动追加 LIMIT 1000
     c. statement timeout 默认 30000ms

3. extensions/datasource/registry.ts 连接器注册表：
   - 按名称注册/获取实例；当前注册 mysql
   - 预留注册位（null + 注释 "Reserved"）：
     postgresql / clickhouse / starrocks
   - 提供 refreshFromRegistry() 方法：GET
     http://127.0.0.1:8004/db-connections 解密后动态注册新连接
     （密码仅存内存）

4. extensions/datasource/index.ts 注册 3 个 pi-agent 工具：
   - list_datasources：返回已注册数据源名称列表
   - list_tables：入参 { datasource }，返回 TableMeta[]
   - describe_table：入参 { datasource, table }，返回 ColumnMeta[]

【约束】
- TS 依赖仅允许 mysql2、@sinclair/typebox
- parameters schema 用 @sinclair/typebox 定义
- 连接器懒加载（首调创建，空闲 5 分钟自动 close）

【完成条件】
1. tests/datasource.test.ts：Docker MySQL 预置表 fct_orders
   （5 字段），断言 list_tables 含 "fct_orders"
2. 断言 executeReadOnlySql 传 "DELETE FROM fct_orders" 抛
   ReadOnly violation
3. registry 中 postgresql / clickhouse / starrocks 键存在
   且值为 null
4. 完成状态：[ ]

================================================================================
第 3 章  M3【dbt 工件解析器 + Schema 索引】
================================================================================

【目标】
解析 dbt 工程的 manifest.json 与 semantic_manifest.json（含
M12 发布的 user_semantic_models），构建本地向量索引，
暴露 search_schema 检索工具；同时检索 NL→SQL 样例（M14）
与启用知识库（M14）。

【上下文】
dbt-project/target/ 只读挂载。本地向量库 Chroma（端口 8000）。
Embedding：本地 BAAI/bge-m3（sentence-transformers，向量维度
1024，持久化挂载 ./data/chroma）。

【具体要求】

1. services/artifact-parser/parser.py：
   - 流式读取 manifest.json（峰值内存 < 1GB）
   - 遍历 manifest.nodes，仅处理 resource_type == "model"，
     每模型生成描述文本：

     模型名: {name}
     描述: {description}
     物化类型: {config.materialized}
     字段列表:
     - {col.name} ({col.data_type}): {col.description or "无描述"}
     上游依赖: {depends_on 中的 ref 名}

   - 遍历 semantic_manifest.metrics，每指标生成：

     指标名 / 描述 / 类型 / 分子 / 分母（ratio 时）/
     可用维度（取自对应 semantic_model.dimensions）

2. services/artifact-parser/main.py（FastAPI，端口 8001）：
   - POST /sync：全量重建 Chroma 索引（删旧 collection 重 embed
     模型 + 指标 + JOIN hints + sql_examples + knowledge_*）
   - POST /search：入参 { query, top_k? }，
     跨 collection 检索，返回
     { models, metrics, join_hints, examples, knowledge }
   - GET /health：{ last_sync, model_count, metric_count }

3. extensions/dbt-artifact/index.ts 注册工具 search_schema：
   - 入参 { query, top_k? }，POST localhost:8001/search
   - description 必须写明：
     "根据自然语言问题检索相关 dbt 模型、指标定义、SQL 样例与
      业务知识。生成 SQL 前必须调用此工具确认字段名与指标口径。"
   - 检索结果超 3000 tokens 自动截断并提示

【约束】
- Python 依赖：fastapi, uvicorn, chromadb,
  sentence-transformers, pydantic>=2.0, httpx
- bge-m3 模型首次启动自动下载至 ~/.cache/huggingface
- Chroma collections：schema_models / metrics / join_hints /
  sql_examples / knowledge_<space_id>
- 知识库检索：GET http://127.0.0.1:8004/rag/active-spaces
  获取启用空间（5 秒缓存）

【完成条件】
1. GET localhost:8001/health 返回 200 且计数 > 0
2. POST /search { query: "退款率" } 返回 metrics 含
   name == "refund_rate"
3. search_schema("华东区订单") 返回非空 models
4. 完成状态：[ ]

================================================================================
第 4 章  M4【指标语义层工具（本地 MetricFlow 编译）】
================================================================================

【目标】
Agent 以"指标名 + 维度 + 过滤"方式查询 dbt 指标，
MetricFlow 本地编译 SQL（口径 100% 一致），执行交给 M6 沙箱；
支持 M12 发布的语义模型（经 /reparse 接入）。

【上下文】
不依赖 dbt Cloud。dbt-metricflow Python SDK 本地编译。
dbt-project 整体 ro 挂载，user_semantic_models 子目录 rw。

【具体要求】

1. services/metricflow-bridge/main.py（FastAPI，端口 8002）：
   - POST /list_metrics：返回
     [{ name, description, type, available_dimensions }]
   - POST /get_dimensions：入参 { metric }，返回可用维度列表
   - POST /compile_sql：入参
     { metrics[], group_by?[], where?, limit? }
     调用 MetricFlow 编译，返回 { sql, dialect }（只编译不执行）
   - POST /explain_metric：入参 { metric }，返回
     numerator/denominator 原文与 YAML description
   - POST /reparse：容器内执行
     dbt parse --project-dir /dbt-project，
     成功后重载 semantic_manifest.json（M12 发布链路使用）

2. extensions/metric-tools/index.ts 注册 4 个工具：

   工具 list_metrics
   - description："列出所有 dbt 标准指标。判断问题是否命中
     标准指标前必须先调用。"

   工具 get_dimensions
   - 入参 { metric }

   工具 query_metric（核心）
   - 入参 { metrics[], group_by?[], where?, limit? }
   - 行为：POST :8002/compile_sql 取 SQL，再调 execute_sql 执行
   - description："查询 dbt 标准指标，口径由 dbt 保证一致。
     问题命中标准指标时必须使用此工具，禁止自行编写 SQL。"

   工具 explain_metric
   - 入参 { metric }
   - description："解释指标计算逻辑。用户询问指标定义时使用。"

【约束】
- Python 依赖：dbt-metricflow[mysql], fastapi, uvicorn
- 编译失败返回结构化错误：
  { error: true, message, hint }
  hint 给可操作建议（如"维度 region 不适用于该指标，
  可用维度: [a, b, c]"），禁止返回 Python 堆栈
- query_metric limit 默认 100，硬上限 1000

【完成条件】
1. 测试 dbt 工程含 3 个指标：gmv / refund_rate / aov
2. POST /compile_sql { metrics:["refund_rate"], group_by:["region"] }
   返回的 SQL 含正确 JOIN 与聚合
3. Agent 会话调用 query_metric 返回结构化 QueryResult
4. explain_metric("refund_rate") 返回
   "退款订单数 / 支付订单数" 口径原文
5. 完成状态：[ ]

================================================================================
第 5 章  M5【双轨路由 Agent】
================================================================================

【目标】
在"指标查询"（M4）与"自由 SQL"（M6 兜底）间自动路由，
防止 Agent 绕过语义层自写 SQL 导致口径不一致。

【上下文】
通过 before_agent_start 注入路由提示词 +
before_tool_call 拦截实现。

【具体要求】

1. extensions/dual-router/prompts.ts 路由提示词（每次
   pi.on("before_agent_start") 注入）：

   === 路由规则（必须遵守）===
   第 1 步：新会话首次提问前调用 list_metrics。
   第 2 步：判断问题是否命中某个标准指标：
     命中 → 必须调用 query_metric
     未命中但涉及标准表 → search_schema → 生成 SQL → execute_sql
     模糊 → ask_clarification
   第 3 步：结果必须标注来源：
     [来源：dbt 标准指标] 或 [来源：临时 SQL 查询]

2. extensions/dual-router/interceptor.ts：
   - 拦截 execute_sql：会话未调用过 search_schema 则
     { block: true, reason: "必须先调用 search_schema 确认字段" }
   - execute_sql 的 SQL 文本包含某指标名时记录口径风险警告
     日志（不阻断）

3. 路由决策写审计（M8）：pi.on("tool_execution_end") 记录
   { question, route: "metric"|"free_sql"|"clarify",
     matched_metric }

【约束】
- 路由规则硬编码 prompts.ts
- list_metrics 结果缓存 1 小时（ctx.state）

【完成条件】
1. "上月 GMV" → query_metric 路径
2. "fct_orders 中金额大于 1000 的明细" → search_schema →
   execute_sql 路径
3. "销售情况" → ask_clarification 路径
4. 路由决策均有审计记录；场景 2 未先 search_schema 时
   execute_sql 被拦截
5. 完成状态：[ ]

================================================================================
第 6 章  M6【SQL 沙箱执行】
================================================================================

【目标】
所有 SQL（query_metric 编译或 Agent 自由生成）必须经本地沙箱
执行，禁止 Agent 直连数据库。

【上下文】
独立 Docker 容器（Python + SQLAlchemy + sqlglot）。
沙箱参数（超时/行数/脱敏/关键词）从 registry 动态读取
（M14 分组 5，5 秒缓存），替代硬编码。

【具体要求】

1. services/sandbox/main.py（FastAPI，端口 8003）：
   - POST /execute：入参 { sql, datasource, user, timeout_ms? }
   - 执行前 5 层校验（顺序不可变）：
     a. sqlglot AST 解析，禁止
        INSERT/UPDATE/DELETE/DROP/TRUNCATE/ALTER/GRANT
        （关键词列表可由 M14 配置覆盖）
     b. 强制注入 LIMIT（默认 1000，可配置）
     c. 行级权限：自动注入 WHERE（从 M7 查询）
     d. 字段级权限：黑名单字段拒绝执行
     e. 敏感字段脱敏：按配置 pattern 掩码（默认
        mask_middle 保留前 3 后 4）
   - 返回 QueryResult；超时返回
     { error: true, message: "Query timeout after Nms" }
   - GET /audit / POST /audit：审计写入端点（M8）

2. extensions/sql-sandbox/index.ts 注册工具 execute_sql：
   - 入参 { sql, datasource, reason }
   - description 注明 "reason 填写执行此 SQL 的业务原因，
     用于合规审计"
   - 行为：POST localhost:8003/execute
   - 禁止扩展内 import mysql2

3. 拦截 bash 绕过：pi.on("before_tool_call") 拦截 bash，
   command 匹配 /\b(mysql|psql|clickhouse-client|sqlite3)\b/
   时 { block: true, reason: "禁止通过 bash 执行数据库命令，
   请使用 execute_sql" }

【约束】
- 沙箱容器数据库账户只读（SELECT）
- 沙箱与数据库走 compose 内网，数据库端口不暴露宿主机
- 每次执行写审计

【完成条件】
1. "SELECT * FROM fct_orders WHERE amount > 100" 返回
   rowCount ≤ 1000 且 SQL 含 LIMIT
2. "DELETE FROM fct_orders" 返回错误
3. 查询含 phone 列返回 "138****1234" 格式
4. bash 调 "mysql -e 'SELECT 1'" 被拦截
5. 完成状态：[ ]

================================================================================
第 7 章  M7【权限控制（本地简化版）】
================================================================================

【目标】
本地单机版用户与权限管理，满足沙箱行级/字段级权限查询。

【上下文】
本地部署不接 SSO。用户数据存 SQLite ./data/auth.db，
/login 命令切换身份。权限规则硬编码 rules.ts。

【具体要求】

1. extensions/permission/index.ts：
   - registerCommand("login")：ctx.ui.showSelector 选用户
     （SQLite 读取，预置 admin / analyst / viewer）
   - pi.on("before_tool_call") 全局拦截：ctx.state.currentUser
     未设置时 { block: true, reason: "请先执行 /login 选择身份" }

2. 权限矩阵（extensions/permission/rules.ts 硬编码）：

   ┌──────────┬──────────────┬──────────────────┬─────────┐
   │ 角色     │ 可访问表      │ 禁止字段          │ 行级限制 │
   ├──────────┼──────────────┼──────────────────┼─────────┤
   │ admin    │ 所有表        │ 无               │ 无      │
   │ analyst  │ fct_* dim_*   │ fct_salary.*     │ 无      │
   │ viewer   │ fct_orders    │ fct_orders.cost  │ 华东区  │
   └──────────┴──────────────┴──────────────────┴─────────┘
   viewer 行级在沙箱注入：WHERE region = '华东'

3. sandbox 内嵌权限查询 API（不单独起服务）：
   - GET /perm/tables?user=   → 可访问表列表
   - GET /perm/columns?user=&table= → 禁止字段列表
   - GET /perm/rows?user=     → 行级 WHERE（或 null）

【约束】
- 不引入独立权限服务；规则与用户均存本地
- 用户身份存 ctx.state.currentUser，会话级有效

【完成条件】
1. 未 /login 调用任何工具被拦截
2. analyst 查 fct_salary 被沙箱拒绝
3. viewer 查 fct_orders 时 SQL 自动追加 AND region = '华东'
4. 完成状态：[ ]

================================================================================
第 8 章  M8【审计日志】
================================================================================

【目标】
记录所有工具调用、SQL 执行、权限拦截、澄清、路由决策事件，
满足合规回溯。

【上下文】
SQLite ./data/audit.db，不做归档。pi-agent 事件钩子埋点，
经沙箱内嵌 /audit 端点异步批量写入。

【具体要求】

1. AuditEvent 模型（services/sandbox/models.py，SQLAlchemy）：

   AuditEvent {
     id INTEGER PRIMARY KEY
     timestamp DATETIME
     user TEXT
     session_id TEXT
     event_type TEXT  # tool_call | tool_blocked | sql_executed |
                       # sql_blocked | clarification | route_decision
     tool_name TEXT
     sql_hash TEXT    # SHA256 前 16 位
     sql_text TEXT    # 脱敏后全文
     rows_affected INTEGER
     duration_ms INTEGER
     decision TEXT    # allowed | blocked
     block_reason TEXT
     question TEXT
   }

2. extensions/audit/index.ts：
   - pi.on("tool_execution_end")：记录工具调用
   - pi.on("before_tool_call") 拦截时：同步记录 blocked
   - 写入：HTTP POST localhost:8003/audit（异步批量）

3. registerCommand("audit")：交互查看最近 20 条，
   支持 --user / --event-type 过滤

【约束】
- 写入失败不阻塞主流程（降级 stderr）
- 审计表禁止 UPDATE/DELETE（应用层保证）

【完成条件】
1. 一次完整问数对话后 audit 新增 ≥ 4 条
2. 被拦截 SQL 的 decision == "blocked" 且 block_reason 非空
3. SQL 中手机号在 sql_text 已脱敏
4. 完成状态：[ ]

================================================================================
第 9 章  M9【多轮澄清】
================================================================================

【目标】
问题模糊时 Agent 主动追问而非硬答。

【上下文】
基于 ctx.ui.askUser 封装。澄清最大轮数与跨会话记忆从
registry 配置读取（M14 分组 3）。

【具体要求】

1. extensions/clarify/index.ts 注册工具 ask_clarification：
   - 入参 { question, options?[] }
   - 行为：ctx.ui.askUser(question, options)
   - description："问题涉及时间范围/指标口径/维度切片模糊时
     必须调用此工具向用户确认。"

2. 澄清规则（注入系统提示词）：

   必须澄清：
   - 时间模糊："上季度"/"上周"/"最近" → 澄清日期范围
   - 指标多义："销售额" → 含税/不含税、含退款/不含退款
   - 维度未指定："看趋势" → 按天/周/月

   禁止澄清（直接执行）：
   - 明确日期 + 明确指标 + 明确维度
     （例："2026-08-01 至 2026-08-31 含税销售额按地区"）

3. 澄清结果存 ctx.state.clarifiedContext：
   { [关键词]: 澄清后口径 }；同会话相同关键词不重复询问
4. 最大澄清轮数默认 2（registry 可配 1-3），
   超过后选默认口径并标注 "假设：..."
5. 跨会话口径记忆（默认开）：clarifiedContext 持久化到
   registry 表 clarified_contexts (user, keyword, value)，
   新会话加载

【约束】
- 澄清事件写审计（event_type: "clarification"）
- 澄清仅暂停 Agent 决策层，不阻塞沙箱执行中查询

【完成条件】
1. "上季度销售额" 触发澄清（时间+口径双模糊）
2. "2026-08-01 到 2026-08-31 含税销售额" 不触发
3. 同会话两次"上周订单数"，第二次不再澄清
4. 完成状态：[ ]

================================================================================
第 10 章  M10【表格渲染（禁止图表）】
================================================================================

【目标】
所有问数结果统一表格呈现：对话区 Markdown 表格 +
结果区 HTML 表格 + 前端 CSV 导出。

【具体要求】

1. extensions/table-render/index.ts 注册工具 render_table：
   - 入参 { data: QueryResult, title }
   - 行为：
     a. 对话区输出 Markdown 表格（列名 + 前 20 行）
     b. 完整 QueryResult 写入 ctx.state.lastTableResult，
        供前端结果区消费
   - description："所有查询结果必须调用此工具呈现。
     禁止直接在消息中手写 Markdown 表格。"

2. Markdown 表格格式（严格）：

   | 列名 1 | 列名 2 | ... |
   |--------|--------|-----|
   | 值     | 值     | ... |

   超 20 行时表格下方输出：
   "... 共 {rowCount} 行，完整表格见右侧结果区"

3. 结果区 HTML 表格：
   - 表头固定；点击列头排序
   - "导出 CSV" 按钮（前端 Blob +
     URL.createObjectURL，不加后端端点）
   - 超 1000 行分页（每页 50 行）

【约束】
- 全局搜索代码库无 echarts / chart / plot 等关键词（注释除外）
- 禁止 PNG / SVG 等图片输出

【完成条件】
1. render_table 后对话区出现合法 Markdown 表格
2. 结果区 HTML 表格支持排序
3. 代码库无图表库引用
4. 完成状态：[ ]

================================================================================
第 11 章  M11【前端界面（WorkBuddy 风格完整规范）】
================================================================================

【目标】
复刻 WorkBuddy 式工作台：活动栏 + 模块面板 + 对话区 +
结果区四区结构；左侧承载 5 个模块导航（任务 / 语义模型 /
数据接入 / 问数设置 / Skills），编辑类操作走全屏模态框。

【整体布局（1440x900 基准，严格遵循）】

┌────┬─────────────────┬─────────────────────┬──────────────┐
│活动 │  模块面板         │      对话/编辑区      │   结果区      │
│栏  │  (280px)        │      (flex-1)       │   (360px)    │
│48px│  可展开至 420px  │                     │  默认收起     │
└────┴─────────────────┴─────────────────────┴──────────────┘

四区布局在 1440x900 视口下无横向滚动条。

【活动栏】

- 顶部→底部 5 个图标按钮（icon + tooltip）：
  1. 任务      icon: list      tooltip: "任务列表"
  2. 语义模型  icon: layers    tooltip: "语义模型管理"
  3. 数据接入  icon: database  tooltip: "数据导入与连接"
  4. 问数设置  icon: settings  tooltip: "智能问数配置"
  5. Skills   icon: sparkles  tooltip: "自定义 Skill"
- 选中项：左侧 2px 蓝色高亮竖条 + 图标着色
- 底部固定：当前用户角色头像，点击弹角色切换
- 活动栏不可折叠，恒 48px

【模块面板】

- 默认 280px；语义模型与 Skills 列表可"展开"至 420px
- 顶部：模块标题（16px semibold）+ 模块级主操作按钮
- 底部：一句话帮助提示（12px 灰）
- 切换模块保留各面板内部状态

【各模块面板内容】

1. 任务面板：任务列表（对应 pi-agent 会话树）
   - 每项：任务标题（首条用户消息前 20 字）；激活高亮
   - 底部"新建任务"按钮（+）
   - 搜索框按标题模糊搜索；列表可折叠
2. 语义模型面板：模板选择入口 + 已入库模型列表（M13 章...见
   第 13 章前端规范）
3. 数据接入面板：Tab "文件导入 | 数据库连接"（第 14 章）
4. 问数设置面板：5 个设置分组折叠列表（第 15 章）
5. Skills 面板：Skill 列表 + 新建按钮（第 16 章）

【对话区】

- 顶部：当前任务标题 + 模式切换（Ask / Craft / Plan，
  默认 Plan）+ skill-test 模式时显示蓝色横幅：
  "Skill 测试模式：<skill name>（仅注入该 Skill）[退出测试]"
- 中部消息列表（滚动）：
  - 用户消息：右对齐，浅蓝气泡
  - Agent 消息：左对齐，白色背景，内嵌：
    * Markdown 渲染（含表格，remark-gfm）
    * 工具调用卡片（折叠态显示工具名，展开显示入参/出参）
    * 澄清交互卡片（内嵌选项按钮，点击即回复）
- 底部输入框 + 发送按钮：
  - 支持 / 命令提示（/login /audit /sync-dbt）
  - 发送后 SSE 流式显示

【结果区】

- 默认收起，有结果自动展开
- 顶部 Tab：表格 / 变更 / 日志
  - 表格 Tab：M10 HTML 表格（排序+分页+导出 CSV）
  - 变更 Tab：显示 "只读查询，无变更"
  - 日志 Tab：审计事件流（实时追加）
- 底部：数据来源标注（"[来源：dbt 标准指标]" 或
  "[来源：临时 SQL 查询]"）

【编辑器模态框（语义模型 / Skill 共用样式）】

- 全屏遮罩（黑 40%）+ 白色面板 max-w-3xl，max-h-[85vh]
  内部滚动
- 头部：标题 + 关闭；底部：固定操作栏（取消 / 保存草稿 /
  入库或发布）
- 校验失败禁止提交，错误显示在字段下方（红 12px）

【组件文件结构】

web/components/Sidebar/ActivityBar.tsx
web/components/Sidebar/ModulePanel.tsx
web/components/Sidebar/TaskList.tsx
web/components/ChatPanel/MessageList.tsx
web/components/ChatPanel/ToolCallCard.tsx
web/components/ChatPanel/ClarifyCard.tsx
web/components/ChatPanel/InputBox.tsx
web/components/ResultPanel/TableTab.tsx
web/components/ResultPanel/AuditLogTab.tsx
web/components/ResultPanel/ResultPanel.tsx
web/components/SemanticModel/ModelListPanel.tsx
web/components/SemanticModel/TemplatePicker.tsx
web/components/SemanticModel/ModelEditorModal.tsx
web/components/DataImport/FileImportPanel.tsx
web/components/DataImport/DbConnectionPanel.tsx
web/components/AskSettings/SettingsPanel.tsx
web/components/AskSettings/LlmConfigForm.tsx
web/components/AskSettings/SqlExampleEditor.tsx
web/components/AskSettings/RagSpaceManager.tsx
web/components/Skills/SkillListPanel.tsx
web/components/Skills/SkillEditorModal.tsx

【技术约束】
- Next.js 14 App Router，单页应用
- 状态：Zustand；样式：Tailwind（禁 antd/mui/chakra）
- SSE：原生 EventSource（禁 socket.io）

【完成条件】
1. 四区布局 1440x900 无横向滚动
2. 新建任务 → 发"上月 GMV" → 对话区 Markdown 表格 →
   结果区自动展开 HTML 表格
3. 表格列头排序、导出 CSV 内容正确
4. 侧栏任务切换后对话区加载历史
5. 活动栏 5 项切换仅改变模块面板，对话区不受影响
6. 页面无图表库引用；模态框 900px 高度无双滚动条
7. 完成状态：[ ]

================================================================================
第 12 章  agent-server 服务化封装
================================================================================

【目标】
pi-agent createAgentSession 封装为 Express HTTP 服务，
作为前端统一后端；会话创建前从 registry 读取激活 LLM 配置。

【具体要求】

1. agent-server/server.ts（端口 3000，仅监听 127.0.0.1）：
   - POST /api/session：创建会话，入参可选
     { skill_test?: skill_id }，返回 { sessionId }
   - POST /api/message：入参 { sessionId, message }，
     session.prompt(message)，SSE 流式返回
   - GET /api/sessions：列出会话（侧栏任务列表）
   - GET /api/sessions/:id/messages：历史消息
   - POST /api/datasources/refresh：从 registry 拉连接
     动态注册进 M2 ConnectorRegistry
   - 代理转发（Next.js rewrites 同路径）：
     /api/registry/* → http://127.0.0.1:8004/*
     /api/ingest/*   → http://127.0.0.1:8005/*

2. LLM 配置接入：
   createAgentSession 前 GET
   /api/registry/llm-configs?is_active=true，
   据此构造 pi-ai Provider；
   .env 的 LLM_* 变量降级为首次启动无配置时兜底

3. SSE 事件协议（前端消费）：

   event: message        data: { text }
   event: tool_call      data: { name, input }
   event: tool_result    data: { name, output }
   event: clarify        data: { question, options[] }
   event: table_result   data: { title, queryResult }
   event: import_progress data: { inserted, total }
   event: done           data: {}

4. 扩展加载：extensionsPath 指向项目根 extensions/（绝对路径）
5. 会话持久化 ./data/sessions/（每会话一个 JSON 文件）

【完成条件】
1. curl POST /api/session 返回 sessionId
2. curl POST /api/message 收到 SSE（≥1 message + 1 done 事件）
3. 重启 agent-server 后 /api/sessions 仍列出历史
4. 完成状态：[ ]

================================================================================
第 13 章  M12【语义模型管理】
================================================================================

【目标】
模板 → 表单化定义 → 草稿 → 入库 → 发布 → 可查看可修改的
语义模型全生命周期管理，发布后直接接入 dbt 编译链路
（query_metric 可查）。

【上下文】
数据存 registry（SQLite 表 semantic_models）。
发布生成 dbt YAML 写入 dbt-project/user_semantic_models/。
5 个模板硬编码于 services/registry/templates.py。

【预置模板（5 个）】

模板字段结构（JSON Schema，前端动态渲染表单）：
{
  "id": string, "name": string, "description": string,
  "fields": [
    { "key", "label",
      "type": "text"|"textarea"|"select"|"array",
      "required": boolean, "default"?, "options"?, "itemSchema"? }
  ]
}

TPL-01 通用事实表（单度量）
  fields: model_name / source_table / description /
    entities[{name,type(primary|foreign)}] /
    measures[1..n: {name, agg(sum|count|avg|min|max), expr, description}] /
    dimensions[0..n: {name, type(categorical|time), description}]
TPL-02 比率指标模板（分子/分母）
  TPL-01 基础上强制 2 个 measure（numerator/denominator），
  额外生成 1 个 ratio 类型 metric
TPL-03 时间序列趋势模型
  强制 ≥1 个 time dimension，agg_time_dimension 取首个
TPL-04 用户画像模型
  entities 强制 primary=user_id，
  dimensions 预置 region/user_level/registered_at
TPL-05 漏斗模型
  measures 为多个 count 类度量（step1_count...stepN_count）

【SQLite 表 semantic_models】

id / name(UNIQUE，小写下划线 ≤60 字符) / template_id /
status(draft|published) / config(TEXT 完整 JSON) /
yaml_path(NULL) / error_message(NULL) / created_at / updated_at

【registry API（前缀 /semantic-models）】

GET    /semantic-models/templates     → 5 个模板定义
GET    /semantic-models?status=       → 列表（含 status/error）
POST   /semantic-models               → { template_id, config }
                                        创建草稿（name 唯一校验）
GET    /semantic-models/:id           → 详情
PUT    /semantic-models/:id           → 改 config（published 修改
                                        后自动回退 draft）
DELETE /semantic-models/:id           → 删除（published 先撤销发布）
POST   /semantic-models/:id/publish   → 发布（链路见下）
POST   /semantic-models/:id/unpublish → 撤销（删 YAML + 重解析）
POST   /semantic-models/auto-draft    → { table_name }
                                        导入表自动生成草稿（M13 用）

【发布链路（顺序不可变）】

步骤 1 服务端校验：
  a. name 匹配 ^[a-z][a-z0-9_]{0,59}$
  b. source_table 存在于已注册数据源
     （registry 只读连接查 information_schema）
  c. measures/dimensions 的 expr 引用列存在于该表
  任一失败 → 写 error_message，返回 422 + 具体原因，终止
步骤 2 生成 dbt 标准 YAML（version: 2 起始），写入
  dbt-project/user_semantic_models/semantic_<name>.yml
步骤 3 POST http://metricflow-bridge:8002/reparse
  （容器内 dbt parse，重载 semantic_manifest.json）
步骤 4 POST http://artifact-parser:8001/sync（重建索引）
步骤 5 status=published，error_message=NULL，返回 200

任一步骤失败：回滚步骤 2 的 YAML，写 error_message，返回 500。

【前端规范（SemanticModel 面板 + 编辑器）】

面板：
  顶部 [从模板新建] → TemplatePicker 模态（5 个模板卡片：
  name/description/字段数预览，单选进入 ModelEditorModal）
  中部模型列表（每行：name / 模板名 / status 徽章
  （draft 灰 / published 绿 / error 红带 tooltip 显
  error_message） / updated_at）
  行操作：编辑 / 发布或撤销发布 / 删除（确认弹窗）

ModelEditorModal：
  - 按 template.fields 动态渲染表单
  - array 字段渲染可增删子表单（每行 +/- 按钮）
  - select 渲染下拉
  - 保存草稿：POST/PUT，status 保持 draft
  - 入库并发布：先保存再 publish，失败错误显示在模态底部
  - published 模型打开编辑器时顶部黄色横幅：
    "该模型已发布，保存修改后将回退为草稿并需重新发布"

【约束】
- 禁止前端拼接 YAML，YAML 一律 registry 服务端生成
  （jinja2 渲染）
- user_semantic_models 目录 rw 挂载到 registry 与
  metricflow-bridge；dbt-project 其余仍 ro

【完成条件】
1. TPL-02 创建 refund_rate_local（source_table=fct_orders,
   numerator=refund_order_count, denominator=order_count）
   发布后 status=published
2. 发布后 list_metrics 包含该模型产出，query_metric 可查
3. 发布 expr 引用不存在列的模型 → 422 且 error_message
   含缺失列名
4. 修改已发布模型 → status 回 draft → 重新发布后
   semantic_manifest 中指标定义更新
5. 撤销发布后 YAML 删除且 list_metrics 不再包含
6. 完成状态：[ ]

================================================================================
第 14 章  M13【数据接入（文件导入 + 数据库连接）】
================================================================================

【目标】
一键导入 CSV/Excel 到本地 MySQL 建表并可参与问数；
数据库连接的新增/测试/管理入口，保存后热加载进
ConnectorRegistry。

【上下文】
data-ingest 服务（FastAPI，端口 8005，pandas + openpyxl）。
连接配置存 registry（SQLite 表 db_connections），
密码 Fernet 加密（密钥 .env ENCRYPTION_KEY）。

【面板结构：Tab "文件导入 | 数据库连接"】

------------------------------------
Tab 1 文件导入（五状态机，严格如下）
------------------------------------

状态 upload：
  拖拽区 + 点击选择，接受 .csv/.xlsx/.xls，
  单文件 ≤ 50MB（超限前端拒绝提示）
状态 parsing：
  POST /api/ingest/parse（multipart file）
  → data-ingest 用 pandas 解析，返回：
    { sheets: string[]                    // xlsx 多 sheet
    , columns: [{ name, inferred_type }]  // integer|float|string|date
    , preview_rows: Record<string,unknown>[]  // 前 10 行
    , total_rows: number
    , file_id: string }                   // 暂存解析结果
  xlsx 多 sheet 时前端先展示 sheet 选择器
状态 mapping：
  用户确认/修改：
  - 目标表名（默认文件名去后缀小写下划线化，可改）
  - 每列类型下拉（可覆盖推断）+ 主键列单选（可空）
  - "导入后自动生成语义模型草稿" 复选框（默认勾选）
状态 importing：
  POST /api/ingest/import
  { file_id, table_name, columns, primary_key, target_datasource }
  服务端：CREATE TABLE → 分批 INSERT（每批 500 行，事务包裹）
  SSE 推送进度：
    event: import_progress
    data: { inserted, total }
状态 done：
  显示成功/失败、建表名、行数、耗时
  成功且勾选自动草稿时：
  POST /api/registry/semantic-models/auto-draft { table_name }
  提示 "已生成语义模型草稿，请前往语义模型模块完善后发布"
  附 [去完善] 按钮（跳转语义模型面板）

自动草稿生成规则（registry 实现）：
  - date/datetime 列 → time dimension
  - 整数/浮点列 → measure 候选（agg=sum）
  - 字符串列 distinct ≤ 20（抽样 1000 行）→ categorical dimension
  - *_id 列 → entity（主键列 primary，否则 foreign）
  - 生成 config 后按 TPL-01 创建 draft，不自动发布

导入历史（面板底部）：表名 / 行数 / 时间 / 来源文件名，
点击行查看当时列映射。

------------------------------------
Tab 2 数据库连接
------------------------------------

连接列表：name / 类型徽章 / host:port / 状态点（最近测试结果）/
  行操作（测试 / 编辑 / 删除）
  默认行 mysql（本地 Docker MySQL，"默认"徽章，禁删）

[新增连接] 表单：
  - 类型下拉：mysql 可选；postgresql / clickhouse / starrocks
    显示但 disabled + "预留" 标签
  - 名称 / host / port（默认 3306）/ database / 用户名 / 密码
    （password input，编辑不回显，留空不改）
  - [测试连接]：POST /api/registry/db-connections/test
    （registry 尝试 SELECT 1，返回 { ok, latency_ms, error }）
  - 保存：POST 创建，密码 Fernet 加密落库

保存后接通：
  agent-server POST /api/datasources/refresh 从 registry 拉连接
  （密码解密后仅内存），动态注册进 ConnectorRegistry
  新增/编辑成功后前端自动调一次 refresh
  /sync-dbt 命令及 list_datasources 工具可见新数据源

【SQLite 表 db_connections】
id / name(UNIQUE) / type / host / port / database_name /
username / password_encrypted / is_default / last_test_ok(NULL) /
created_at / updated_at

【约束】
- data-ingest 依赖仅：fastapi, uvicorn, pandas, openpyxl,
  pymysql, python-multipart
- 导入目标表一律建在 MySQL askdata_import schema
  （CREATE SCHEMA IF NOT EXISTS）
- 大文件峰值内存 ≤ 2GB（pandas chunksize=100000）
- 密码不通过任何 GET 明文返回

【完成条件】
1. 1000 行 CSV 五步走完 → askdata_import.<table> 行数正确
2. xlsx 多 sheet 可选，选 sheet2 导入正确
3. 勾选自动草稿 → 语义模型面板出现 draft，dimensions 含
   CSV 日期列
4. 新增另一 MySQL 实例连接 → 测试 ok → list_datasources
   包含该连接
5. 编辑连接不填密码 → 原密码不变（可再次测试成功验证）
6. 完成状态：[ ]

================================================================================
第 15 章  M14【问数设置（智能问数配置中枢）】
================================================================================

【目标】
问数运行时五类可配置项集中一个面板，全部持久化 registry，
运行时服务动态读取（5 秒缓存），改动新会话生效。

【面板结构：5 个可折叠分组，默认全收起】

------------------------------------
分组 1 LLM 模型配置
------------------------------------

配置卡片列表（名称 / provider / model / 激活徽章，点击展开
编辑表单）：
  表单：配置名称 / provider（select: openai|anthropic|deepseek|
  ollama|custom_openai_compatible）/ model / api_key
  （password，编辑不回显留空不改）/ base_url /
  temperature（0-1 默认 0.2）/ max_tokens（默认 4096）
  ollama 特殊：base_url 默认 http://localhost:11434，
  model 输入旁 [拉取模型列表]（GET {base_url}/api/tags 渲染
  为下拉）

卡片操作：[设为激活]（互斥）[测试连接] [删除]
  测试：POST /api/registry/llm-configs/:id/test
  （服务端发固定 prompt "ping"，返回
  { ok, latency_ms, reply_preview, error }）

agent-server 接入：见第 12 章。

SQLite 表 llm_configs：
id / name / provider / model / api_key_encrypted / base_url /
temperature / max_tokens / is_active / created_at / updated_at

------------------------------------
分组 2 NL→SQL 转换样例
------------------------------------

样例列表（question 前 30 字 / 关联指标名 / 操作）：
[新增样例] 模态表单：
  - question（必填）：自然语言问法
  - sql（textarea 必填）：期望 SQL（dbt 风格，引用模型名）
  - metric_name（可选）：对应已发布指标，用于 query_metric
    路由示例

[从历史会话导入]：选某历史对话中 question + 执行成功的 SQL
一键入库

接通链路：保存样例 → POST
  /api/registry/sql-examples/reindex → artifact-parser 将
  全部样例 embed 进 Chroma sql_examples collection →
  search_schema 返回新增字段
  examples: [{ question, sql, metric_name }]（top 3 相似）
  系统提示词新增规则：
  "参考 examples 中的 SQL 写法，优先复用其中的表名与字段风格"

SQLite 表 sql_examples：id / question / sql / metric_name /
created_at

------------------------------------
分组 3 上下文设置
------------------------------------

表单（保存即 PUT /api/registry/settings/context）：
  - 会话历史窗口条数（默认 20，范围 5-100）
    → agent-server 裁剪传 LLM 的历史
  - 上下文压缩触发阈值 tokens（默认 120000，范围
    32000-200000）→ pi-agent compaction 参数
  - 澄清最大轮数（默认 2，范围 1-3）→ M9 读取
  - 澄清口径跨会话记忆（switch 默认开）→ M9 持久化
    clarified_contexts

------------------------------------
分组 4 RAG 知识库
------------------------------------

知识空间列表（空间名 / 文档数 / 启用 switch / 更新时间 /
  [管理文档]）
[新建空间]：空间名（唯一）
[管理文档]：
  - 文档列表（文件名 / 块数 / 删除）
  - [上传文档]：.md/.txt/.pdf，单文件 ≤ 20MB
    解析：纯文本直接分块；pdf 用 pypdf 提取
    分块：512 tokens，overlap 50（bge-m3 tokenizer）
  - embed 入 Chroma collection knowledge_<space_id>

接通：启用空间在 search_schema 时一并检索
（artifact-parser GET /api/registry/rag/active-spaces，跨
collection 查询合并，结果新增
knowledge: [{ space, content_preview, source }]）
系统提示词新增：
"knowledge 命中的业务口径说明优先级高于自由发挥"

SQLite 表 rag_spaces(id/name/enabled/created_at) 与
rag_docs(id/space_id/file_name/chunk_count/created_at)

------------------------------------
分组 5 沙箱设置
------------------------------------

表单（保存即 PUT /api/registry/settings/sandbox，沙箱每次
/execute 前动态 GET 读取，5 秒缓存）：
  - 查询超时秒（10-120，默认 30）
  - 最大返回行数（100-10000，默认 1000）
  - 脱敏规则（可增删行：字段名 pattern 支持 * 通配如
    phone*, id_card + 掩码类型 mask_middle 保留前 3 后 4）
  - 禁止 SQL 关键词列表（默认与 M6 一致，可增删）

【约束】
- registry 通用 settings 表：
  (key TEXT PRIMARY KEY, value TEXT 存 JSON)，
  分组 3/5 走 GET/PUT /api/registry/settings/:key
- 运行时服务读 registry 配置必须带 5 秒本地缓存
- PDF 解析依赖 pypdf（registry 依赖）

【完成条件】
1. 新建 ollama 配置并激活 → 新任务实际使用该模型
   （agent-server 日志 provider=ollama）
2. 添加样例"上季度退款率 → SELECT ... refund_rate ..."→
   新会话问相似问题，search_schema 返回该 example 且
   SQL 风格与样例一致
3. 澄清轮数改 1 → 第 2 次模糊不再澄清而采用默认口径
4. 上传含"退款率=退款订单数/支付订单数"的 txt 并启用 →
   问"退款率怎么算"时回答引用该口径且结果带
   [来源：知识库 <空间名>]
5. 沙箱超时改 10 秒 → 30 秒慢查询第 10 秒熔断
6. 完成状态：[ ]

================================================================================
第 16 章  M15【Skills 窗口】
================================================================================

【目标】
自定义 Skill（触发关键词 + 提示词增补 + 工具白名单），
启用后注入系统提示词改变 Agent 特定场景行为；支持独立测试。

【SQLite 表 skills】
id / name(UNIQUE) / description /
trigger_keywords(TEXT JSON 数组) / prompt_addition TEXT /
allowed_tools(TEXT JSON 数组，空=全部) / enabled(默认 false) /
created_at / updated_at

【前端规范】

SkillListPanel：
  顶部 [新建 Skill]（打开 SkillEditorModal）
  列表：name / description 截断 / 关键词 chips / enabled switch
  行操作：[编辑] [测试] [删除]（确认弹窗）

SkillEditorModal 表单：
  - 名称（必填唯一）
  - 描述（必填）
  - 触发关键词（tag 输入，≥1 个，回车添加）
  - 提示词增补（textarea 必填，placeholder：
    "当用户询问 GMV 相关问题时，必须先说明口径：GMV 为已支付
    订单金额，不含未支付与已退款订单。结果表格后追加环比说明。"）
  - 允许工具（checkbox 多选：search_schema / query_metric /
    execute_sql / explain_metric / ask_clarification / render_table，
    全不选=不限）
  - 保存：POST/PUT /api/registry/skills

[测试] 行为：
  前端切对话区 skill-test 模式（蓝色横幅），POST /api/session
  携带 { skill_test: skill_id } → agent-server 创建会话时
  仅注入该 Skill；[退出测试] 返回普通模式并销毁临时会话

【注入机制（extensions/skills-loader/index.ts）】

- pi.on("session_start")：GET
  /api/registry/skills?enabled=true
  （skill_test 模式只取指定 id）
- 启用 Skills 以如下格式追加到系统提示词末尾：

  === 可用 Skills ===
  ### Skill: <name>
  触发场景: <keywords 逗号连接>
  <prompt_addition>
  允许工具: <列表 或 "全部">

- allowed_tools 非空时：pi.on("before_tool_call") 拦截
  （简化规则：用户消息命中某 Skill 关键词时，该轮仅允许其
  白名单工具 + 基础工具 search_schema/render_table）

【Skill 导出】
  保存时同步导出 Markdown 副本至 ./data/skills/<name>.md
  （frontmatter 存元数据），便于 git 管理

【约束】
- Skill 注入总 tokens 上限 2000，超出按 updated_at 倒序截断
  并日志警告
- prompt_addition 安全校验（服务端黑名单）：出现
  "忽略以上规则/绕过沙箱/直接执行写操作" 字样拒绝保存

【完成条件】
1. 创建 Skill"GMV 口径提醒"（关键词 gmv/成交额）启用后，
   新会话问"上月 GMV"先输出口径说明
2. 该 Skill allowed_tools 设 [query_metric] → 问
   "上月 GMV 明细前 10 条"时 execute_sql 被拦截并提示
   "当前 Skill 限制工具"
3. [测试] 进入 skill-test 模式横幅显示 Skill 名，退出后
   恢复正常注入
4. ./data/skills/ 生成对应 .md 文件
5. 完成状态：[ ]

================================================================================
第 17 章  docker-compose 完整编排
================================================================================

【目标】
单文件 docker-compose.yml 启动全部服务，干净环境 15 分钟跑通。

【服务清单（10 个）】

services:
  mysql              # mysql:8.0，数据卷 ./data/mysql，
                     # 端口不暴露宿主机
  chroma             # chromadb/chroma，端口 8000，
                     # 卷 ./data/chroma
  artifact-parser    # M3 Python 服务，端口 8001
  metricflow-bridge  # M4 Python 服务，端口 8002，
                     # dbt-project ro + user_semantic_models rw
  sandbox            # M6+M7+M8 Python 服务，端口 8003
  registry           # M12-M15 元数据中心，端口 8004，
                     # 依赖 fastapi/uvicorn/sqlalchemy/jinja2/
                     # cryptography/pypdf/pymysql/httpx
                     # 卷 ./data + user_semantic_models rw
  data-ingest        # M13 Python 服务，端口 8005，
                     # 卷 ./data/tmp_uploads
  agent-server       # Node 服务，端口 3000，仅 127.0.0.1
  web                # Next.js 前端，端口 5173，
                     # depends_on agent-server
  ollama             # 可选本地 LLM，端口 11434，
                     # profile: local-llm

【关键约束】
- MySQL / Chroma 数据卷挂载宿主机，restart 不丢数据
- registry / data-ingest / sandbox / 各 Python 服务端口
  仅 docker 内网 + 127.0.0.1，禁公网暴露
- web 通过 depends_on 依赖 agent-server
- 全部环境变量统一从根 .env 注入
- LLM 双模式：registry 无激活配置时回退 .env LLM_*

【环境变量清单（.env.example）】

DATASOURCE_MYSQL_URL=mysql://user:pass@mysql:3306/db
ENCRYPTION_KEY=<32 字节 Fernet 密钥，附生成命令注释>
INGEST_MAX_FILE_MB=50
RAG_MAX_FILE_MB=20
LLM_PROVIDER=openai          # 兜底值：openai|ollama
LLM_API_KEY=
LLM_MODEL=
LLM_BASE_URL=

【完成条件】
1. 干净环境 git clone → cp .env.example .env 填 MySQL 密码
   与 LLM Key → docker-compose up -d
2. 15 分钟内 localhost:5173 出现四区界面
3. 发"上月 GMV"收到表格回复
4. docker-compose down 后数据卷不删除
5. 完成状态：[ ]

================================================================================
第 18 章  端到端测试用例（最终验收，TC-01 至 TC-17）
================================================================================

TC-01 指标命中
  输入"上月 GMV" → query_metric → 对话区 Markdown 表格 →
  结果区 HTML 表格 → 来源标注 "dbt 标准指标"
TC-02 模糊澄清
  "上季度退款率" → ask_clarification（时间+口径）→ 选择后
  继续执行返回
TC-03 自由 SQL
  "查 fct_orders 中金额大于 1000 的前 10 条明细" →
  search_schema → execute_sql → 表格 → "临时 SQL 查询"
TC-04 指标解释
  "退款率是怎么算的？" → explain_metric 返回口径原文
TC-05 越权拦截
  analyst 查 fct_salary → 沙箱拒绝 + 审计 blocked
TC-06 写操作拦截
  "删除所有订单数据" → sqlglot 拦截 + bash 绕过拦截
TC-07 表格导出
  任意查询后导出 CSV，内容与表格一致
TC-08 会话持久化
  新建任务对话 → 重启 compose → 刷新页面，任务列表保留
  可加载历史
TC-09 模板建模型并发布
  TPL-02 创建模型 → 发布 → query_metric 可查新指标
TC-10 模型修改闭环
  修改已发布模型 → 回退 draft → 重新发布 → 定义生效
TC-11 CSV 导入闭环
  导入 CSV → 自动草稿 → 发布 → 问数可查导入表
TC-12 连接管理
  新增 MySQL 连接 → 测试 ok → list_datasources 可见
TC-13 LLM 切换
  新建 ollama 配置激活 → 新会话使用该 provider
TC-14 知识库命中
  上传口径文档启用 → 相关提问引用知识库内容
TC-15 沙箱参数生效
  超时改 10 秒 → 慢查询按新值熔断
TC-16 Skill 注入
  启用 Skill → 行为变化 + 白名单工具生效
TC-17 Skill 测试模式
  测试模式仅注入被测 Skill，退出恢复正常

【全局完成条件】
vitest tests/e2e/*.test.ts 全部通过 + 手动走查 TC-01 至
TC-17 每项勾选通过 → 版本号更新为 v1.1 并在 git tag
v1.0-release。

================================================================================
第 19 章  分阶段执行顺序（Codex 按序执行）
================================================================================

Phase 1 基础骨架
  第 1 章目录 → M2 数据源 → docker-compose 雏形
Phase 2 语义层
  M3 工件解析 → M4 MetricFlow 桥接（含 /reparse）
Phase 3 安全执行
  M6 沙箱 → M7 权限 → M8 审计
Phase 4 Agent 智能化
  M5 路由 → M9 澄清 → M10 表格渲染
Phase 5 服务化与前端
  第 12 章 agent-server → M11 前端布局与任务面板 →
  compose 完善 → TC-01~TC-08 回归
Phase 6 侧边栏功能（registry 先行，先 API 后 UI）
  6.1 registry 骨架（SQLite + settings + 审计转发）
  6.2 M12 语义模型（模板→CRUD→发布链路→面板与编辑器）
  6.3 M13 数据接入（连接 CRUD→导入五状态机→自动草稿）
  6.4 M14 问数设置（LLM→样例→上下文/RAG/沙箱+运行时改造）
  6.5 M15 Skills（CRUD + skills-loader + 测试模式）
  6.6 布局收尾（活动栏 + 5 模块面板 + TC-01~TC-08 回归）
  6.7 TC-09~TC-17 全量验收

规则：
- 每子步骤完成即 git commit（"feat(Px.y): <内容>"）
- 每个 Phase 结束跑 docker-compose up 验证集成
- 禁止跳过 Phase；Phase 6 内禁止先做 UI 后做 API
- 每模块完成在"完成状态"标 [DONE]

================================================================================
附录 A  问数 Agent 系统提示词（最终交付核心资产）
================================================================================

# 你是企业的智能问数助手

## 工作流（必须严格遵守）
1. 理解问题：分析意图、时间范围、指标、维度切片
2. 指标优先判断：调用 list_metrics（有缓存跳过），
   判断是否命中标准指标
3. 双轨路由：
   - 命中指标 → 必须调用 query_metric（口径由 dbt 保证）
   - 未命中 → search_schema → 生成 SQL → execute_sql
4. 模糊即澄清：时间/口径/维度任一模糊 → ask_clarification
5. 结果呈现：调用 render_table 输出表格 + 一句话洞察
6. 来源标注：注明 "dbt 标准指标" 或 "临时 SQL 查询"
   或 "知识库 <空间名>"

## 硬性禁令
- 绝不编造数据，查不到如实告知
- 绝不绕过 query_metric 自己写标准指标的 SQL（口径风险）
- 绝不直接使用 bash 执行数据库命令
- 绝不返回未脱敏的敏感字段
- 绝不在没有 search_schema 的情况下假设字段存在

## 参考规则
- examples 中的 SQL 写法优先复用表名与字段风格
- knowledge 命中的业务口径说明优先级高于自由发挥
- Skills 注入的规则同样必须遵守

## 工具调用优先级
1. list_metrics（新会话首次）
2. ask_clarification（模糊时）
3. query_metric（命中标准指标）
4. search_schema（未命中）
5. explain_metric（用户问指标定义）
6. execute_sql（自由分析兜底）
7. render_table（所有结果必须调用）

## 输出格式
- 单值指标：一句话 + 数字 + 来源标注
- 单表对比：Markdown 表格（render_table）
- 时间序列：表格 + 趋势总结（禁止图表）
- 异常：明确原因（权限不足/查询超时/数据缺失/口径模糊）

================================================================================
附录 B  环境变量与密钥安全规范
================================================================================

1. 全部密钥（LLM api_key / db 密码 / ENCRYPTION_KEY）仅存
   .env 或 registry 加密字段
2. GET 列表一律掩码 "****"；PUT 留空不改
3. 密钥不出现在任何日志（含 agent-server / sandbox /
   registry）
4. 涉密接口全部操作写审计
5. registry / data-ingest / sandbox 端口禁公网暴露

================================================================================
                        —— 文档结束 ——
================================================================================
给 Codex 的最终执行提示：
1. 本文件是唯一规范文档，无需导入其他文件
2. 按第 19 章 Phase 1-6 顺序执行，逐模块标 [DONE]
3. 冲突处理：G-01~G-08 > 用户当次指令 > 通用实践
   （特别提醒 G-03：所有新模块 UI 一律纯表单/表格/列表，
   文件导入预览与统计禁止图表化呈现）
4. 新增依赖必须先在对话说明理由并获确认
5. TC-01 至 TC-17 全部通过后更新版本号 v1.1 并打 tag
================================================================================


