# Event2People

`Event2People`（界面品牌名为 `LANCHI SIGNAL`）是一个 event-first 的前沿信号发现与人物跟进工具。它不从“公司列表”或“联系人名单”出发，而是从刚刚发生的高价值事件出发：GitHub 上突然增长的项目、arXiv 上正在变热的论文、Kickstarter 上开始验证需求的新产品。系统会把这些事件结构化，再把事件背后值得关注的人识别出来，沉淀进可执行的 Pipeline。

一句话概括：`发现事件 -> 理解事件 -> 找到人 -> 保存到 Pipeline -> 发起跟进`

## 产品介绍

### 这个产品解决什么问题

很多“找人”工作都卡在两个地方：

- 信号分散在项目、论文、众筹平台里，很难形成统一视图
- 看到了项目，不一定能快速定位到值得联系的人

Event2People 的目标，是把“项目 / 论文 / 众筹信号”直接转成“值得跟进的人”。

### 核心能力

- 多源事件发现：聚合 GitHub Trending、arXiv、Kickstarter Technology 的近期信号
- 事件卡片化：生成中文标题、摘要、指标、来源链接和上下文
- 人物映射：把项目维护者、论文作者、创始人等关联到同一事件
- Pipeline 工作台：保存人选，集中查看原始项目、联系方式和可复制文案
- 运行时配置：可在 `/settings` 中配置 Tavily 与 LLM，不必反复改环境变量
- 数据刷新：支持手动刷新，也支持默认每 60 分钟一次的自动刷新
- 稳定发布：新数据先写入新版本 dataset，发布后再切换前台，避免刷新中页面抖动

### 主要页面

- `/github`：看正在快速增长的 GitHub 项目
- `/arxiv`：看近 90 天内更活跃、更值得跟进的论文
- `/kickstarter`：看开始验证需求的新产品和硬件信号
- `/pipeline`：沉淀值得跟进的人，集中做后续动作
- `/settings`：配置 Tavily、OpenAI 和其他 LLM 运行参数
- `/admin/refresh`：查看刷新记录并手动触发数据刷新

## 技术栈

- Next.js 16 App Router
- TypeScript
- Prisma
- SQLite
- Vitest

## 部署建议

### 推荐部署形态

当前项目最适合部署在“单个长期运行的 Node.js 进程 + 持久化磁盘”上。

原因很直接：

- 数据库使用 SQLite
- 运行时配置默认写入 `.local/settings.json`
- 自动刷新通过应用进程内 scheduler 启动
- 页面和 API 都依赖服务端动态能力，不适合静态导出

更适合的环境：

- 自托管 Linux / macOS 服务器
- 单实例 Docker 容器 + 持久卷
- 单实例 PaaS + 持久磁盘

### 不推荐的部署形态

- 纯静态托管
- 无持久化磁盘的 Serverless
- 多实例负载均衡但不共享数据库和本地文件的部署

否则很容易遇到这些问题：

- SQLite 数据不可写或重启后丢失
- `/settings` 保存的运行时配置丢失
- 自动刷新在多实例上重复执行

### 生产环境注意事项

- 当前仓库没有内置登录和权限系统。
- 如果要对外部署，至少应在反向代理层保护 `/settings` 和 `/admin/refresh`，例如 Basic Auth、IP 白名单或仅内网访问。
- 当前 `db:setup` / `db:push` 的初始化流程是围绕 `prisma/dev.db` 设计的；如果你要把 SQLite 文件换到别的路径，需要先调整 `package.json` 脚本。
- `npm run db:setup` 会重建数据库并重新写入示例数据，只适合首次初始化或主动重置数据时使用，不适合日常升级。

## 本地部署

### 1. 准备环境

- Node.js 20+
- npm
- `sqlite3` 命令行工具（`npm run db:setup` 依赖它）

### 2. 配置环境变量

```bash
cp .env.example .env
```

默认配置下：

- `DATABASE_URL="file:./dev.db"` 对应仓库内的 `prisma/dev.db`
- 自动刷新默认开启，间隔为 60 分钟
- 未配置 LLM 时，系统会回退到模板文案

### 3. 安装并启动

```bash
npm install
npm run db:setup
npm run dev
```

启动后可直接访问：

- `http://localhost:3000/github`
- `http://localhost:3000/arxiv`
- `http://localhost:3000/kickstarter`
- `http://localhost:3000/pipeline`
- `http://localhost:3000/settings`
- `http://localhost:3000/admin/refresh`

### 4. 首次运行建议

`db:setup` 会先写入示例数据，便于本地直接看界面。若要拉取真实数据，启动后进入 `/admin/refresh` 手动刷新一次即可。

## 生产部署

下面是一套最稳妥的单机 Node.js 部署方式。

### 1. 安装系统依赖

- Node.js 20+
- npm
- `sqlite3`
- 反向代理，推荐 Nginx 或 Caddy

### 2. 拉取代码并安装依赖

```bash
npm ci
```

### 3. 配置环境变量

建议从示例文件开始：

```bash
cp .env.example .env
```

生产环境至少建议调整这些值：

```bash
DATABASE_URL="file:./dev.db"
NEXT_PUBLIC_APP_URL="https://your-domain.com"
AUTO_REFRESH_ENABLED="true"
AUTO_REFRESH_INTERVAL_MINUTES="60"
GITHUB_TOKEN=""
SEMANTIC_SCHOLAR_API_KEY=""
TAVILY_API_KEY=""
OPENAI_API_KEY=""
OPENAI_MODEL="gpt-5-mini"
OPENAI_BASE_URL=""
EVENT2PEOPLE_SETTINGS_PATH="/var/lib/event2people/settings.json"
```

说明：

- `DATABASE_URL="file:./dev.db"` 在当前项目里对应 `prisma/dev.db`
- `EVENT2PEOPLE_SETTINGS_PATH` 用来把 `/settings` 保存的配置移到持久化目录；不设置时默认写到仓库内 `.local/settings.json`
- `TAVILY_API_KEY` 和 LLM 配置也可以稍后在 `/settings` 页面里保存
- `.env.example` 中保留了 `ADMIN_REFRESH_SECRET`，但当前仓库代码没有实际使用它

### 4. 首次初始化数据库

只在第一次部署或你明确要重置数据时执行：

```bash
npm run db:setup
```

注意：这个命令会重建 `prisma/dev.db` 并写入示例数据。

### 5. 构建并启动

```bash
npm run build
npm run start
```

默认服务监听 `3000` 端口。

### 6. 让服务常驻

生产环境建议使用 `systemd`、`pm2` 或容器编排来保持进程常驻，并通过 Nginx / Caddy 反向代理到应用端口。

### 7. 持久化这些文件

至少要保证以下内容位于持久化磁盘：

- `prisma/dev.db`
- `.local/settings.json` 或 `EVENT2PEOPLE_SETTINGS_PATH` 指向的文件

### 8. 首次验收

部署完成后建议检查：

- `/github` 能正常打开
- `/settings` 可以保存配置
- `/admin/refresh` 能手动触发刷新
- `/pipeline` 可以正常保存和移除人物

## 升级与运维

- 日常重启或发布新代码时，通常不需要再次执行 `npm run db:setup`
- 如果只是更新代码，推荐流程通常是：`npm ci` -> `npm run build` -> `npm run start`
- 如果启用了自动刷新，应用启动后会由进程内 scheduler 按 `AUTO_REFRESH_INTERVAL_MINUTES` 执行刷新
- 如果不希望自动刷新，可把 `AUTO_REFRESH_ENABLED` 设为 `false`

## 常用命令

```bash
npm run dev
npm run build
npm run start
npm run lint
npm test
npm run db:setup
```
