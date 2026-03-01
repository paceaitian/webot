# Webot — 碎片收集系统

## 技术栈
- Node.js + TypeScript（ESM, strict mode）
- 飞书 WSClient 入口 / CLI 调试模式
- Playwright + Readability 抓取
- Claude API (Structured Outputs)
- SQLite (better-sqlite3) 持久化
- Obsidian 文件系统写入

## 编码约定
- ESM 模块（`import/export`），导入路径必须带 `.js` 后缀
- 严格类型：no implicit any，导出函数必须有中文 JSDoc
- 日志使用 `createLogger('模块名')`，禁止 `console.log`
- ID 统一使用 `nanoid`（`src/utils/id.ts`），禁止 `uuid`
- 错误处理：管道部分失败时保存草稿继续写入
- 重试使用 `withRetry()`（`src/utils/retry.ts`）

## 项目结构
- `src/adapters/` — 输入适配器（CLI / 飞书）
- `src/pipeline/` — 管道引擎（调度 + 状态管理）
- `src/parser/` — 消息解析（指令 + URL 提取）
- `src/extractor/` — 内容抓取（Readability / Playwright / 微信）
- `src/processor/` — AI 处理（Claude API 封装 + Prompt 模板）
- `src/writer/` — Obsidian 写入（frontmatter + 原子写入）
- `src/responder/` — 响应反馈（CLI / 飞书卡片）
- `src/db/` — SQLite 数据层（去重 + 重试队列）
- `src/utils/` — 通用工具（logger / id / retry）
