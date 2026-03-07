# 每日简报 v2 — 按渠道展示 + 分层评分 + 新增源

> **创建时间**: 2026-03-07T12:14:00+08:00
> **状态**: 已批准

---

## 背景

v1 简报将所有渠道混合排名，导致社交/财经渠道（微博/知乎/抖音/小红书）因技术偏向评分被完全淘汰（Top 30 中 0 条），信息维度严重丢失。同时缺少国内科技（36氪/IT之家）和财经（华尔街见闻/财联社）数据源。

## 设计决策

### 1. 按渠道展示（Layout B 分组）

不再混合排名，每个渠道独立展示 Top N 条目。渠道按 4 个分组组织：

| 分组 | 渠道 | 每渠道条目数 |
|------|------|-------------|
| 技术精选 | HN(5) / PH(3) / GitHub Trending(5) / V2EX(3) / RSS 精选(5) | 21 |
| 国内热点 | 微博(5) / 知乎(5) / 抖音(3) / 小红书(3) / 虎扑(3) / 贴吧(3) / 头条(3) | 25 |
| 国内科技 | 36氪(3) / IT之家(3) / 酷安(3) / 澎湃(3) | 12 |
| 财经快讯 | 华尔街见闻(3) / 财联社(3) / MKTNews(3) | 9 |

卡片总条目：~67 条。

### 2. 分层评分

| 渠道类型 | 评分方式 | AI 摘要 |
|----------|----------|---------|
| 技术渠道（HN/PH/V2EX/GitHub/RSS） | Sonnet 三维评分（相关性/质量/时效性） | 生成中文标题 + 摘要 |
| 社交/热点/财经（其余所有） | **不评分**，保留平台原生排名 | **不生成**，直接用原标题 |

好处：省掉 ~60% Sonnet API 调用，社交/财经不再被技术偏向淘汰。

### 3. 新增 10 个 NewsNow 数据源

| 分组 | 平台 | mycc ID | 类型 |
|------|------|---------|------|
| 国内科技 | 36氪 | `36kr` | realtime |
| 国内科技 | IT之家 | `ithome` | realtime |
| 国内科技 | 酷安 | `coolapk` | hottest |
| 国内热点 | 虎扑 | `hupu` | hottest |
| 国内热点 | 百度贴吧 | `tieba` | hottest |
| 国内热点 | 今日头条 | `toutiao` | hottest |
| 国内热点 | 澎湃新闻 | `thepaper` | realtime |
| 财经 | 华尔街见闻 | `wallstreetcn` | realtime |
| 财经 | 财联社 | `cls-telegraph` | realtime |
| 财经 | MKTNews | `mktnews` | realtime |

总 NewsNow 渠道从 7 → 17。

### 4. 跨渠道去重

同一 URL 出现在多个渠道时，只保留在**第一个出现的渠道**中（采集顺序决定优先级）。

### 5. Opus 分析调整

`quickRead`（30 秒速读）和 `correlations`（跨源关联）仅基于**技术渠道的评分条目**生成。

### 6. Obsidian 存档

按渠道分组的表格，技术渠道显示 AI 标题 + 评分，社交/财经显示原标题。

## 卡片结构

```
header: 每日简报 — {date} | {N} 源 | {M} 条

30 秒速读（基于技术渠道 AI 分析）

── 技术精选 ──
  Hacker News    Top 5  (AI 中文标题 + 摘要)
  Product Hunt   Top 3  (AI 中文标题 + 摘要)
  GitHub Trending Top 5 (repo + stars today)
  V2EX           Top 3  (AI 中文标题 + 摘要)
  RSS 精选       Top 5  (AI 中文标题 + 摘要)

── 国内热点 ──
  微博热搜       Top 5  (原标题)
  知乎热榜       Top 5  (原标题)
  抖音热榜       Top 3  (原标题)
  小红书         Top 3  (原标题)
  虎扑           Top 3  (原标题)
  百度贴吧       Top 3  (原标题)
  今日头条       Top 3  (原标题)

── 国内科技 ──
  36氪           Top 3  (原标题)
  IT之家         Top 3  (原标题)
  酷安           Top 3  (原标题)
  澎湃新闻       Top 3  (原标题)

── 财经快讯 ──
  华尔街见闻     Top 3  (原标题)
  财联社         Top 3  (原标题)
  MKTNews        Top 3  (原标题)

footer: {N} 渠道 | {M} 条 | Opus | {T}min
```

## 影响范围

| 文件 | 变更类型 | 说明 |
|------|----------|------|
| `src/digest/collectors/newsnow.ts` | 修改 | 新增 10 源，重组分组 |
| `src/digest/collectors/types.ts` | 修改 | 新增 ChannelGroup / ChannelConfig 类型 |
| `src/digest/index.ts` | 重写 | 按渠道处理 + 分层评分逻辑 |
| `src/digest/prompts/score.ts` | 修改 | 评分提示词调整（移除社交惩罚） |
| `src/digest/reporter.ts` | 重写 | 分组卡片布局 + 渠道分区 |
| `src/digest/prompts/analyze.ts` | 修改 | 仅接收技术渠道数据 |
