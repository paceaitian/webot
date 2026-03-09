# Webot — 个人知识管理 AI Agent

飞书机器人 → 网页抓取 → Claude AI 处理 → Obsidian 笔记，一站式碎片信息收集与知识管理系统。

## 功能概览

### AI Agent（自然语言交互）

所有消息经 LLM 理解后自动选择合适工具执行，无需记忆固定指令格式：

| 工具 | 功能 | 示例 |
|------|------|------|
| `save` | 抓取网页 → 生成摘要/标签 → 写入 Obsidian | "帮我保存这篇文章 https://..." |
| `discuss` | 深度分析（Opus Extended Thinking） | "深度分析一下这篇 https://..." |
| `web_fetch` | 纯抓取网页内容，不写入笔记 | "帮我看看这个链接说了什么" |
| `search_vault` | 搜索 Obsidian 笔记库 | "搜索关于 Claude 的笔记" |
| `read_note` | 读取指定笔记内容 | "读一下 inbox/xxx.md" |
| `web_search` | 网络搜索（Serper API） | "搜索 Vercel AI SDK 最新文档" |
| `create_note` | 直接创建 Obsidian 笔记 | "创建一个关于今天会议的笔记" |
| `memory` | 保存/检索长期记忆 | "记住我是前端工程师" |
| `digest` | 生成每日科技简报 | "生成今日简报" 或 `#digest` |

### 每日科技简报

自动采集 20+ 渠道信息源，AI 评分排序，生成飞书卡片 + Obsidian 存档：

- **技术精选**：Hacker News、GitHub Trending、V2EX、Product Hunt、RSS 博客（90+ 源）
- **国内热点**：微博、知乎、抖音、小红书、60 秒读世界
- **AI 资讯**：AI 新闻快报、RSS AI 源
- **财经动态**：新浪财经、华尔街见闻

### 上下文管理 + 长期记忆

- **滑动窗口**：每次对话只加载最近 20 条消息，防止上下文爆炸
- **自动压缩**：消息超过 30 条时，Haiku 自动压缩旧消息为摘要
- **超时切分**：2 小时无活动自动归档旧对话，开始新轮次
- **群聊隔离**：按 `chatId:userId` 隔离，群聊中每人独立上下文
- **长期记忆**：保存用户偏好、事实信息、对话摘要，每次对话自动注入

## 技术架构

```
飞书 WSClient ──┐                     ┌── Obsidian 笔记库
                ├── Agent (ReAct) ────┤
CLI readline ───┘    │                └── 飞书卡片反馈
                     │
              ToolRegistry (9 工具)
                     │
        ┌────────────┼────────────┐
        │            │            │
   PipelineEngine  DigestEngine  ContextManager
   (抓取→AI→写入)  (采集→评分)   (压缩→记忆)
```

### 技术栈

| 层级 | 技术 |
|------|------|
| 语言 | TypeScript（ESM, strict mode） |
| 运行时 | Node.js >= 20.0.0 |
| 入口 | 飞书 WSClient（WebSocket 长连接）/ CLI |
| 抓取 | Playwright + @mozilla/readability + cheerio |
| AI | Claude API — Haiku（轻量任务）/ Sonnet（评分）/ Opus（深度分析） |
| Agent | Vercel AI SDK（`generateText` + ReAct 循环） |
| 持久化 | SQLite（better-sqlite3）— 消息去重、任务队列、会话、记忆 |
| 笔记 | Obsidian 文件系统 + gray-matter frontmatter |
| 进程管理 | pm2 |
| 日志 | pino + pino-pretty |
| 测试 | vitest（182 测试） |

### 目录结构

```
src/
├── index.ts              # 主入口
├── config.ts             # 环境变量配置
├── adapters/             # 输入适配器（CLI / 飞书）
├── agent/                # Agent 核心
│   ├── loop.ts           #   ReAct 循环（MAX_ITERATIONS=15）
│   ├── system-prompt.ts  #   动态 prompt + 记忆注入
│   └── context-manager.ts#   滑动窗口 + 压缩 + 超时切分
├── tools/                # 工具系统（9 个）
│   ├── base.ts           #   Tool/ToolContext/ToolResult 接口
│   ├── registry.ts       #   ToolRegistry（Map 热插拔）
│   ├── save.ts           #   保存笔记
│   ├── discuss.ts        #   深度分析
│   ├── web-fetch.ts      #   纯抓取
│   ├── search-vault.ts   #   搜索笔记
│   ├── read-note.ts      #   读取笔记
│   ├── web-search.ts     #   网络搜索
│   ├── create-note.ts    #   创建笔记
│   ├── memory.ts         #   长期记忆管理
│   └── digest.ts         #   每日简报
├── pipeline/             # 管道引擎（抓取 → AI → 写入）
├── parser/               # 消息解析（指令 + URL 提取）
├── extractor/            # 内容抓取
│   ├── browser-pool.ts   #   共享 Playwright 浏览器池
│   ├── readability.ts    #   通用网页（Readability fast path）
│   ├── playwright.ts     #   JS 渲染页面
│   └── wechat.ts         #   微信公众号专用
├── processor/            # AI 处理（Claude API 封装）
├── writer/               # Obsidian 写入（frontmatter + 原子写入）
├── responder/            # 响应反馈（CLI / 飞书卡片 CardKit 流式）
├── digest/               # 每日简报
│   ├── collectors/       #   数据源采集器（RSS / NewsNow / GitHub / 60s API）
│   ├── channels.ts       #   22 渠道 × 4 分组配置
│   ├── prompts/          #   评分 + 分析 Prompt
│   └── reporter.ts       #   飞书卡片 + Obsidian 存档
├── db/                   # SQLite 数据层
│   ├── migrations.ts     #   版本化迁移（v1~v4）
│   └── repositories/     #   message / job / session / memory
└── utils/                # 通用工具（logger / id / retry）
```

## 快速开始

### 1. 安装依赖

```bash
npm install
npx playwright install chromium
```

### 2. 配置环境变量

```bash
cp .env.example .env
```

编辑 `.env`：

```env
# 必填
ANTHROPIC_API_KEY=sk-ant-...
OBSIDIAN_VAULT_PATH=C:/Users/xxx/Documents/Obsidian

# 飞书模式（不填则使用 CLI 模式）
FEISHU_APP_ID=cli_xxx
FEISHU_APP_SECRET=xxx

# 可选
ANTHROPIC_BASE_URL=          # API 代理地址
DB_PATH=data/webot.db        # SQLite 路径（默认）
LOG_LEVEL=info                # 日志级别
SERPER_API_KEY=               # 网络搜索功能
DIGEST_CRON=0 9 * * *        # 简报定时（默认每天 9:00）
DIGEST_CHAT_ID=               # 简报推送飞书群 ID
```

### 3. 开发运行

```bash
# CLI 模式（交互式调试）
npm run dev:cli

# 飞书模式
npm run dev

# 编译
npm run build

# 生产运行（pm2）
pm2 start dist/index.js --name webot
```

### 4. 测试

```bash
# 全量测试
npm test

# 监听模式
npm run test:watch

# 类型检查
npm run typecheck
```

## 飞书配置

### 创建飞书应用

1. 前往[飞书开放平台](https://open.feishu.cn/)创建企业自建应用
2. 添加「机器人」能力
3. 开启「事件与回调」→ 选择「WebSocket 长连接」模式
4. 订阅事件：`im.message.receive_v1`
5. 开启「卡片回调」→ 选择「长连接」模式
6. 获取 `App ID` 和 `App Secret` 填入 `.env`

### 消息交互

- **私聊**：直接发送消息即可
- **群聊**：需要 @机器人 触发（飞书默认行为）
- **快捷指令**：`#save`、`#discuss`、`#digest`、`#help`
- **自然语言**：直接描述需求，Agent 自动理解并执行

### 卡片交互

处理完成后的飞书卡片支持：
- 深度分析 / 提取金句 — 一键二次处理
- 替换 / 新建 — 选择覆盖或另存
- 自定义指令输入

## 数据库 Schema

| 表 | 版本 | 用途 |
|----|------|------|
| `messages` | v1 | 消息去重（event_id 唯一） |
| `jobs` | v1+v2 | 处理任务队列 + 重试 + extracted_json 缓存 |
| `sessions` | v3 | Agent 多轮对话（JSON messages 数组） |
| `memories` | v4 | 长期记忆（preference / fact / summary） |

## 项目统计

| 指标 | 数值 |
|------|------|
| 源码文件 | 63 个 |
| 测试文件 | 20 个 |
| 测试用例 | 182 个 |
| Agent 工具 | 9 个 |
| 简报数据源 | 20+ 渠道（90+ RSS 源） |
| 数据库版本 | v4（4 表 + 索引） |

## License

Private — 个人使用
