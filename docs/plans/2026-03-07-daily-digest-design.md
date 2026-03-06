# 每日简报功能设计

> 日期: 2026-03-07
> 状态: 已批准

## 目标

webot 新增每日简报功能：每天 09:00 自动从 95 个信息源采集内容，AI 深度分析后推送综合简报到飞书，同时存档到 Obsidian。

## 架构决策

**方案 C：webot 内建独立模块 + 可独立运行**

- `src/digest/` 独立模块，有清晰的入口接口
- webot 进程内通过 `node-cron` 调度
- 飞书发 `#digest` 可手动触发
- 复用 webot 基础设施（Claude client / 飞书 SDK / SQLite / Obsidian writer）

## 数据源（95 源）

### 7 个免认证 Collector（参考 mycc collect）

| Collector | 数据源 | 采集方式 |
|-----------|--------|---------|
| `gh-trending` | GitHub Trending | fetch HTML → 正则解析 |
| `newsnow:tech-news` | HN / Product Hunt / V2EX | NewsNow API |
| `newsnow:trends` | 微博 / 知乎 / 抖音 | NewsNow API |
| `newsnow:xhs` | 小红书 | NewsNow API |
| `rss:ai` | Ben's Bites / MIT 科技评论中文 | RSS 解析 |
| `rss:dev` | 阮一峰 / 少数派 | RSS 解析 |
| `rss:startup` | TechCrunch / 极客公园 | RSS 解析 |

### HN 88 顶级博客 RSS

第 8 个 collector `rss:hn-blogs`，88 个 RSS 源并行抓取，24h 时间窗口过滤。源自 Karpathy 推荐的 HN Popularity Contest 2025 榜单。

### 采集策略

- `Promise.allSettled` 8 路 collector 并行，每个 60s 超时
- RSS 源内部 10 路并发（`rss:hn-blogs`）
- 单个失败不阻断整体
- SQLite 去重（URL 维度）

## AI 处理（两阶段）

### 阶段 1：Sonnet 评分 + 摘要

每批 10-15 条，结构化输出（JSON schema）：
- 三维评分（1-10）：相关性 / 质量 / 时效性
- 中文标题（英文条目自动翻译）
- 2-3 句中文摘要
- 分类：AI / 安全 / 工程 / 工具 / 创业 / 热点 / 其他

### 阶段 2：Opus + Extended Thinking 跨源综合

输入：阶段 1 筛选的 Top 30（按总分排序），输出 Markdown：
- 30 秒速读：3-5 句宏观趋势
- 今日必读 Top 5：附推荐理由
- 实体关联：同一话题跨源出现 → 信号增强
- 行动项：值得关注/尝试/收藏的建议

## 输出

### 飞书卡片（webot 应用机器人 + CardKit）

结构：
1. Header：📰 每日简报 — YYYY-MM-DD
2. 30 秒速读（趋势总结）
3. 今日必读 Top 5（每篇含摘要 + [查看原文] + [收藏到 Obsidian] 按钮）
4. 分类速览（统计）
5. 行动项
6. 底部元信息（源数 · 入选数 · 模型 · 时间）

交互按钮：
- 查看原文 → `open_url`
- 收藏到 Obsidian → `callback` 触发 webot save 管道

### Obsidian 存档

写入 `{vault}/digest/YYYY-MM-DD.md`，含 frontmatter：

```yaml
---
type: digest
date: 2026-03-07
sources: 95
articles: 47
top5: [url1, url2, ...]
tags: [AI, 安全, 工程]
---
```

## 调度

- `node-cron`：`0 9 * * *`（每天 09:00）
- `#digest` 指令：手动触发
- 环境变量 `DIGEST_CRON` 可自定义时间
- 环境变量 `DIGEST_CHAT_ID` 指定推送目标群

## 模块结构

### 新增文件（~8 个）

```
src/digest/
├── index.ts              # DigestEngine 主调度
├── collectors/
│   ├── types.ts          # CollectorResult / DigestItem 类型
│   ├── gh-trending.ts    # GitHub Trending
│   ├── newsnow.ts        # NewsNow 统一采集
│   ├── rss.ts            # RSS 通用解析器
│   └── feeds.ts          # RSS 源配置
├── prompts/
│   ├── score.ts          # Sonnet 评分+摘要
│   └── analyze.ts        # Opus 跨源综合
└── reporter.ts           # 简报生成（飞书卡片 + Obsidian MD）
```

### 改动现有文件（~5 个）

| 文件 | 改动 |
|------|------|
| `src/index.ts` | 初始化 DigestEngine + node-cron 定时 |
| `src/config.ts` | 新增 DIGEST_CRON / DIGEST_CHAT_ID |
| `src/parser/message-parser.ts` | 识别 `#digest` 指令 |
| `src/adapters/feishu.ts` | `#digest` 路由到 DigestEngine |
| `package.json` | 新增 node-cron 依赖 |

### 新增依赖

- `node-cron`：定时调度
- RSS 解析：原生 fetch + 正则（零依赖）

## 技术约束

- 遵循 webot 编码规范：ESM / strict / createLogger / nanoid
- RSS 解析参考 ai-daily-digest 正则方案，不引入第三方库
- collector 超时 60s，AI 调用超时 300s
- 采集失败容错：单源失败记录日志但不阻断
