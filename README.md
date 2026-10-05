# AskData 智能问数平台

AskData 是一个基于 **pi-agent + dbt MetricFlow** 的本地智能问数系统。它将自然语言问题、语义指标、SQL 沙箱、RAG 知识库和自定义 Skill 组合在一起，帮助业务用户在受控口径下完成数据查询与分析。

## 核心能力

- **智能问数**：通过 pi-agent 完成指标检索、澄清、MetricFlow 查询、临时 SQL 查询和结果解释。
- **语义模型**：维护 dbt 语义模型、实体、维度、度量和标准指标，支持发布、依赖检测和字段级错误提示。
- **数据接入**：导入 CSV/Excel 数据，管理数据库连接，浏览已有表结构并执行只读查询。
- **SQL 沙箱**：对临时 SQL 做只读校验、超时控制、行数限制、敏感信息脱敏和审计记录。
- **RAG 知识库**：维护业务口径文档和知识片段，为问数提供上下文。
- **NL→SQL 样例**：维护自然语言与 SQL 的映射样例，辅助生成更符合业务口径的查询。
- **自定义 Skill**：通过提示词和工具白名单扩展特定业务场景的问数行为。
- **会话与过程可视化**：保留历史会话，实时展示推理过程、工具调用、表格结果和日志。

## 技术架构

```text
web(Next.js)
  └── agent-server(pi-agent)
        ├── registry          语义模型、指标、配置、样例、知识库、Skill
        ├── metricflow-bridge dbt MetricFlow SQL 编译
        ├── sandbox           只读 SQL 执行与安全控制
        ├── data-ingest       文件导入与数据落库
        └── artifact-parser   dbt artifact 解析与向量检索
                    └── chroma 向量库
mysql
```

## 环境要求

- Docker Desktop
- Docker Compose
- Node.js `>= 20`
- pnpm `>= 10`
- Python `>= 3.11`

> 使用 Docker Compose 启动时，应用依赖会自动构建，无需手工安装全部 Python 依赖。

## 快速开始

### 1. 配置环境变量

复制环境变量示例文件：

```bash
cp .env.example .env
```

编辑 `.env`，至少填写以下内容：

```dotenv
MYSQL_DATABASE=askdata
MYSQL_USER=askdata
MYSQL_PASSWORD=your-mysql-password
MYSQL_ROOT_PASSWORD=your-mysql-root-password
ENCRYPTION_KEY=your-fernet-key
```

`ENCRYPTION_KEY` 必须是有效的 Fernet Key。可在本地生成：

```bash
python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
```

> 不要提交真实 `.env` 文件。如果更换 `ENCRYPTION_KEY`，已经加密保存的模型 API Key 将无法解密。

### 2. 启动服务

```bash
docker compose up -d --build
```

首次启动会构建多个镜像，耗时取决于网络和机器性能。

### 3. 访问平台

打开：

```text
http://127.0.0.1:3001
```

常用服务地址：

| 服务 | 地址 |
| --- | --- |
| Web | `http://127.0.0.1:3001` |
| Agent Server | Docker 内部 `http://agent-server:3000` |
| Registry | Docker 内部 `http://registry:8004` |
| MetricFlow Bridge | Docker 内部 `http://metricflow-bridge:8002` |
| SQL Sandbox | Docker 内部 `http://sandbox:8003` |
| Data Ingest | Docker 内部 `http://data-ingest:8005` |
| Artifact Parser | Docker 内部 `http://artifact-parser:8001` |

## 使用流程

1. 进入 **问数设置 → LLM 模型配置**，添加模型 API Key 并激活模型。
2. 进入 **数据导入与连接**，导入业务数据或配置数据库连接。
3. 进入 **语义模型**，创建 dbt 模型、语义模型和标准指标。
4. 回到 **智能问数**，输入业务问题，例如：
   - `湖北省在去年投保的女性人数有多少？`
   - `湖北省男性投保保费是多少？`
5. 在右侧结果面板查看表格、变更过程、推理轨迹和执行日志。

## 本地开发

安装依赖：

```bash
corepack enable
corepack pnpm install
```

启动前端开发服务：

```bash
corepack pnpm --filter @askdata/web run dev
```

启动 Agent Server 开发服务：

```bash
corepack pnpm --filter @askdata/agent-server run dev
```

## 测试与检查

运行前端和 Agent 测试：

```bash
corepack pnpm test
```

运行 Web 类型检查：

```bash
corepack pnpm --filter @askdata/web run typecheck
```

运行 Agent Server 类型检查：

```bash
corepack pnpm --filter @askdata/agent-server run typecheck
```

运行 Python 测试：

```bash
python -m unittest discover -s tests -p "*.py" -v
```

## 项目结构

```text
agent-server/          pi-agent 服务、工具调用和会话流
web/                   Next.js 前端
services/
  registry/            配置、语义模型、指标、样例、知识库和 Skill 管理
  metricflow-bridge/   dbt MetricFlow 查询编译
  sandbox/             只读 SQL 执行与安全控制
  data-ingest/         文件导入与数据入库
  artifact-parser/     dbt artifact 解析与向量索引
dbt-project/           dbt 项目、模型和语义模型
extensions/            数据源、SQL 防护、指标工具等扩展
docker/                MySQL 初始化脚本
docs/                  设计文档、业务口径和升级记录
tests/                 单元与回归测试
```

## 常用运维命令

查看服务状态：

```bash
docker compose ps
```

查看日志：

```bash
docker compose logs -f agent-server
```

重建并启动全部服务：

```bash
docker compose up -d --build
```

停止服务：

```bash
docker compose down
```

## 注意事项

- 本项目默认面向本地/内网环境，生产部署前请补充 HTTPS、认证、授权和网络安全策略。
- 业务数据、会话记录和向量索引保存在 `data/` 目录，请按需备份。
- 语义模型发布后会同步生成 `dbt-project/user_semantic_models/` 下的 YAML 文件。
- 临时 SQL 只允许 `SELECT` / `WITH`，禁止执行写操作。

## License

仅供项目内部使用。
