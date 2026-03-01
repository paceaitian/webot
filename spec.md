---
summary: "飞书机器人→网页抓取→Claude 摘要→Obsidian 笔记的碎片收集系统"
---

# Webot 碎片收集系统 规格说明

## 项目概述

通过飞书机器人发送链接/文本/图片 → 后端自动抓取网页内容 → Claude API 生成摘要/标签 → 写入 Obsidian 笔记库

---

## 技术栈

### 运行时

- 语言：TypeScript（ESM, strict mode）
- 运行时：Node.js >= 20.0.0
- 进程管理：pm2

### 入口

- 飞书 WSClient（`@larksuiteoapi/node-sdk`）— WebSocket 长连接
- CLI 模式（readline）— 开发调试

### 抓取

- Playwright — 浏览器自动化（微信公众号需 JS 渲染）
- @mozilla/readability + jsdom — 通用网页正文提取（fast path）
- cheerio — HTML 清理

### AI

- @anthropic-ai/sdk — Claude API（Structured Outputs）
- Haiku 4.5 — 简单任务（摘要/元数据）
- Sonnet 4.5 — 深度分析（Extended Thinking）

### 持久化

- better-sqlite3 — SQLite（消息去重、处理记录、重试队列）
- gray-matter — Frontmatter 生成
- fs/promises — 原子写入 Obsidian

### 工具链

- 包管理：npm
- 构建工具：tsc
- 测试框架：vitest
- 日志：pino + pino-pretty
- ID：nanoid

---

## 编码规范

- 命名约定：camelCase（变量/函数）、PascalCase（类/接口/类型）
- ESM 模块，导入路径必须带 `.js` 后缀
- 类型检查：TypeScript strict（no implicit any）
- 日志使用 `createLogger('模块名')`，禁止 `console.log`
- ID 统一使用 nanoid，禁止 uuid

---

## 目录结构

```
K:/AI/webot/
├── src/
│   ├── index.ts              # 主入口
│   ├── config.ts             # 环境变量配置
│   ├── types/                # 类型定义
│   ├── adapters/             # 输入适配器（CLI/飞书）
│   ├── pipeline/             # 管道引擎
│   ├── parser/               # 消息解析
│   ├── extractor/            # 内容抓取
│   ├── processor/            # AI 处理
│   ├── writer/               # Obsidian 写入
│   ├── responder/            # 响应反馈
│   ├── db/                   # SQLite 数据层
│   └── utils/                # 通用工具
├── tests/                    # 测试
├── data/                     # SQLite（gitignore）
└── CLAUDE.md
```

---

## 禁止事项

- 禁止使用 `console.log`（使用 pino logger）
- 禁止使用 `uuid`（使用 nanoid）
- 禁止使用 CommonJS（require/module.exports）

---

## 依赖列表

> 安装新依赖时同步更新此列表

### 生产依赖

| 包名 | 版本 | 用途 |
|------|------|------|
| @larksuiteoapi/node-sdk | ^1.24.0 | 飞书 WebSocket + API |
| @anthropic-ai/sdk | ^0.39.0 | Claude API（Structured Outputs） |
| playwright | ^1.51.0 | 浏览器自动化 |
| @mozilla/readability | ^0.5.0 | 通用网页正文提取 |
| jsdom | ^25.0.0 | Readability 所需 DOM |
| cheerio | ^1.0.0 | HTML 清理 |
| better-sqlite3 | ^12.0.0 | SQLite |
| gray-matter | ^4.0.3 | Frontmatter 生成 |
| pino | ^9.0.0 | 结构化日志 |
| pino-pretty | ^13.0.0 | 开发环境日志格式化 |
| nanoid | ^5.0.0 | ID 生成 |
| dotenv | ^16.4.0 | 环境变量加载 |

### 开发依赖

| 包名 | 版本 | 用途 |
|------|------|------|
| typescript | ^5.7.0 | TypeScript 编译器 |
| tsx | ^4.0.0 | TS 直接运行 |
| vitest | ^3.0.0 | 测试框架 |
| @types/node | ^22.0.0 | Node.js 类型 |
| @types/better-sqlite3 | ^7.6.0 | better-sqlite3 类型 |
| @types/jsdom | ^21.0.0 | jsdom 类型 |
