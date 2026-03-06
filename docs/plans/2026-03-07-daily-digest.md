# Daily Digest 实现计划

> 基于 `docs/plans/2026-03-07-daily-digest-design.md` 设计文档
> 日期: 2026-03-07

## 概览

webot 新增 `src/digest/` 模块，实现每日简报：8 路 collector 并行采集 95 源 → Sonnet 评分摘要 → Opus 跨源综合分析 → 飞书卡片 + Obsidian 存档。

**新增文件**: 10 个 | **修改文件**: 5 个 | **新依赖**: `node-cron`

---

## Task 1: 安装依赖 + 扩展配置

### 1a. 安装 node-cron

```bash
npm install node-cron
npm install -D @types/node-cron
```

### 1b. 扩展 `src/config.ts`

在 `AppConfig` 接口新增 2 个字段：

```ts
/** 每日简报 cron 表达式（默认 '0 9 * * *'） */
digestCron: string
/** 每日简报推送目标群 chat_id */
digestChatId: string
```

`loadConfig()` 新增：

```ts
digestCron: process.env.DIGEST_CRON ?? '0 9 * * *',
digestChatId: process.env.DIGEST_CHAT_ID ?? '',
```

### 1c. `.env.example` 追加

```
DIGEST_CRON=0 9 * * *
DIGEST_CHAT_ID=
```

### 验证

```bash
npx tsc --noEmit
```

---

## Task 2: Digest 类型定义 — `src/digest/collectors/types.ts`

定义所有 collector 共享的类型：

```ts
/** 单条采集结果 */
export interface DigestItem {
  /** 标题 */
  title: string
  /** 链接 */
  url: string
  /** 来源标识（如 'github-trending'、'hackernews'） */
  source: string
  /** 摘要/描述（可选，RSS 自带） */
  description?: string
  /** 发布时间（可选） */
  publishedAt?: string
  /** 额外元数据 */
  extra?: Record<string, string>
}

/** Collector 采集结果 */
export interface CollectorResult {
  /** collector 名称 */
  name: string
  /** 采集到的条目 */
  items: DigestItem[]
  /** 采集耗时 ms */
  duration: number
  /** 错误信息（部分失败时） */
  error?: string
}

/** Sonnet 评分后的条目 */
export interface ScoredItem extends DigestItem {
  /** 相关性评分 1-10 */
  relevance: number
  /** 质量评分 1-10 */
  quality: number
  /** 时效性评分 1-10 */
  timeliness: number
  /** 总分（三维加权） */
  totalScore: number
  /** AI 生成的中文标题 */
  aiTitle: string
  /** AI 生成的中文摘要（2-3 句） */
  aiSummary: string
  /** 分类 */
  category: 'AI' | '安全' | '工程' | '工具' | '创业' | '热点' | '其他'
}

/** Opus 综合分析结果 */
export interface DigestAnalysis {
  /** 30 秒速读（3-5 句宏观趋势） */
  quickRead: string
  /** 今日必读 Top 5 */
  top5: Array<{
    item: ScoredItem
    reason: string
  }>
  /** 跨源关联发现 */
  correlations: string
  /** 行动项建议 */
  actionItems: string
}

/** 完整的每日简报 */
export interface DailyDigest {
  /** 日期 YYYY-MM-DD */
  date: string
  /** 所有采集结果 */
  collections: CollectorResult[]
  /** 评分后的条目（按总分降序） */
  scoredItems: ScoredItem[]
  /** Opus 综合分析 */
  analysis: DigestAnalysis
  /** 总耗时 ms */
  totalDuration: number
}
```

### 验证

```bash
npx tsc --noEmit
```

---

## Task 3: RSS 源配置 — `src/digest/collectors/feeds.ts`

定义所有 RSS 源。分 4 组：`ai`、`dev`、`startup`、`hn-blogs`。

```ts
export interface FeedSource {
  name: string
  url: string
  group: 'ai' | 'dev' | 'startup' | 'hn-blogs'
}

export const FEEDS: FeedSource[] = [
  // === AI ===
  { name: "Ben's Bites", url: 'https://bensbites.beehiiv.com/feed', group: 'ai' },
  { name: 'MIT 科技评论中文', url: 'https://www.mittrchina.com/rss', group: 'ai' },
  // === Dev ===
  { name: '阮一峰周刊', url: 'https://www.ruanyifeng.com/blog/atom.xml', group: 'dev' },
  { name: '少数派', url: 'https://sspai.com/feed', group: 'dev' },
  // === Startup ===
  { name: 'TechCrunch', url: 'https://techcrunch.com/feed/', group: 'startup' },
  { name: '极客公园', url: 'https://www.geekpark.net/rss', group: 'startup' },
  // === HN 88 Blogs ===
  // 从 hn-popular-blogs-2025.opml 提取的 88 个 RSS 源
  { name: 'Paul Graham', url: 'https://www.paulgraham.com/rss.html', group: 'hn-blogs' },
  { name: 'Simon Willison', url: 'https://simonwillison.net/atom/everything/', group: 'hn-blogs' },
  // ... 完整 88 源从 OPML 解析填入
]
```

**实现要点**：
- 从 `hn-popular-blogs-2025.opml` gist 解析提取所有 `xmlUrl`
- 使用 subagent 解析 OPML 并生成完整 `FEEDS` 数组
- 对无法访问的 RSS 做标注（运行时自动跳过报错）

### 验证

```bash
npx tsc --noEmit
```

---

## Task 4: RSS 通用解析器 — `src/digest/collectors/rss.ts`

零依赖 RSS 解析，参考 ai-daily-digest 正则方案：

```ts
import { createLogger } from '../../utils/logger.js'
import type { DigestItem, CollectorResult } from './types.js'
import { FEEDS, type FeedSource } from './feeds.js'

const log = createLogger('rss-collector')

/** 24 小时时间窗口 */
const DAY_MS = 24 * 60 * 60 * 1000

/** 从 RSS/Atom XML 提取条目（正则，零依赖） */
function parseRssXml(xml: string, sourceName: string): DigestItem[] {
  const items: DigestItem[] = []
  // RSS 2.0: <item>...</item>
  // Atom: <entry>...</entry>
  const entryRegex = /<(?:item|entry)[\s>]([\s\S]*?)<\/(?:item|entry)>/gi
  let match: RegExpExecArray | null
  while ((match = entryRegex.exec(xml)) !== null) {
    const block = match[1]
    const title = extractTag(block, 'title')
    const link = extractLink(block)
    const description = extractTag(block, 'description') || extractTag(block, 'summary')
    const pubDate = extractTag(block, 'pubDate') || extractTag(block, 'published') || extractTag(block, 'updated')
    if (title && link) {
      items.push({
        title: decodeEntities(title),
        url: link,
        source: sourceName,
        description: description ? decodeEntities(description).slice(0, 300) : undefined,
        publishedAt: pubDate || undefined,
      })
    }
  }
  return items
}

function extractTag(block: string, tag: string): string | null { /* 正则提取 */ }
function extractLink(block: string): string | null { /* 兼容 RSS link 和 Atom link href */ }
function decodeEntities(s: string): string { /* &amp; &lt; 等解码 */ }

/** 过滤 24h 内的条目 */
function filterRecent(items: DigestItem[]): DigestItem[] {
  const cutoff = Date.now() - DAY_MS
  return items.filter(item => {
    if (!item.publishedAt) return true  // 无日期的保留
    return new Date(item.publishedAt).getTime() > cutoff
  })
}

/** 采集指定组的 RSS */
export async function collectRssGroup(
  group: string,
  feeds?: FeedSource[],
): Promise<CollectorResult> {
  const start = Date.now()
  const sources = feeds ?? FEEDS.filter(f => f.group === group)

  // hn-blogs 10 路并发，其他组串行（源少）
  const concurrency = group === 'hn-blogs' ? 10 : sources.length
  const allItems: DigestItem[] = []
  const errors: string[] = []

  // 简易并发池
  const pool = [...sources]
  const workers = Array.from({ length: Math.min(concurrency, pool.length) }, async () => {
    while (pool.length > 0) {
      const feed = pool.shift()!
      try {
        const resp = await fetch(feed.url, {
          signal: AbortSignal.timeout(15_000),
          headers: { 'User-Agent': 'webot/0.1' },
        })
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
        const xml = await resp.text()
        const items = filterRecent(parseRssXml(xml, feed.name))
        allItems.push(...items)
      } catch (err) {
        errors.push(`${feed.name}: ${String(err)}`)
        log.warn({ feed: feed.name, error: String(err) }, 'RSS 采集失败')
      }
    }
  })

  await Promise.all(workers)

  return {
    name: `rss:${group}`,
    items: allItems,
    duration: Date.now() - start,
    error: errors.length > 0 ? `${errors.length} 源失败` : undefined,
  }
}
```

### 验证

```bash
npx tsc --noEmit
# 单独测试 RSS 解析（后续 Task 13 集成测试）
```

---

## Task 5: NewsNow Collector — `src/digest/collectors/newsnow.ts`

调用 `newsnow.busiyi.world` API，复用 mycc collect 的 4 个类别：

```ts
import { createLogger } from '../../utils/logger.js'
import type { DigestItem, CollectorResult } from './types.js'

const log = createLogger('newsnow-collector')
const BASE_URL = 'https://newsnow.busiyi.world/api'

/** NewsNow 支持的源 */
const NEWSNOW_SOURCES = {
  'tech-news': ['hackernews', 'producthunt', 'v2ex'],
  'trends': ['weibo', 'zhihu', 'douyin'],
  'xhs': ['xiaohongshu'],
} as const

type NewsNowGroup = keyof typeof NEWSNOW_SOURCES

/** 采集指定组的 NewsNow 数据 */
export async function collectNewsNow(group: NewsNowGroup): Promise<CollectorResult> {
  const start = Date.now()
  const sources = NEWSNOW_SOURCES[group]
  const allItems: DigestItem[] = []
  const errors: string[] = []

  for (const source of sources) {
    try {
      const resp = await fetch(`${BASE_URL}/${source}`, {
        signal: AbortSignal.timeout(15_000),
        headers: { 'User-Agent': 'webot/0.1' },
      })
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
      const data = await resp.json() as { items?: Array<{ title: string; url: string; [k: string]: unknown }> }

      for (const item of data.items ?? []) {
        allItems.push({
          title: item.title,
          url: item.url,
          source,
          description: (item.description ?? item.summary ?? '') as string,
          publishedAt: (item.pubDate ?? item.time ?? '') as string,
        })
      }
    } catch (err) {
      errors.push(`${source}: ${String(err)}`)
      log.warn({ source, error: String(err) }, 'NewsNow 采集失败')
    }
  }

  return {
    name: `newsnow:${group}`,
    items: allItems,
    duration: Date.now() - start,
    error: errors.length > 0 ? `${errors.length} 源失败` : undefined,
  }
}
```

**注意**：NewsNow API 响应格式需实际测试确认，首次运行时记录完整响应到日志，后续调整字段映射。

### 验证

```bash
npx tsc --noEmit
```

---

## Task 6: GitHub Trending Collector — `src/digest/collectors/gh-trending.ts`

fetch HTML → 正则解析 trending 列表：

```ts
import { createLogger } from '../../utils/logger.js'
import type { DigestItem, CollectorResult } from './types.js'

const log = createLogger('gh-trending-collector')

/** 采集 GitHub Trending */
export async function collectGhTrending(): Promise<CollectorResult> {
  const start = Date.now()
  const items: DigestItem[] = []

  try {
    const resp = await fetch('https://github.com/trending', {
      signal: AbortSignal.timeout(30_000),
      headers: { 'User-Agent': 'webot/0.1' },
    })
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
    const html = await resp.text()

    // 解析 trending 列表（article.Box-row）
    const repoRegex = /href="\/([^"]+?)"[^>]*class="[^"]*Link[^"]*"/g
    // 更可靠：匹配 <article> 块中的 h2 > a 链接
    const articleRegex = /<article[^>]*>([\s\S]*?)<\/article>/gi
    let match: RegExpExecArray | null

    while ((match = articleRegex.exec(html)) !== null) {
      const block = match[1]
      // 提取仓库路径：h2 > a href="/owner/repo"
      const linkMatch = block.match(/href="\/([^"]+?\/[^"]+?)"/)
      if (!linkMatch) continue
      const repoPath = linkMatch[1]
      // 提取描述
      const descMatch = block.match(/<p[^>]*>([\s\S]*?)<\/p>/)
      const desc = descMatch ? descMatch[1].replace(/<[^>]+>/g, '').trim() : ''
      // 提取语言
      const langMatch = block.match(/itemprop="programmingLanguage"[^>]*>([^<]+)/)
      const lang = langMatch ? langMatch[1].trim() : ''
      // 提取星数
      const starsMatch = block.match(/(\d[\d,]*)\s*stars\s*today/i)
      const starsToday = starsMatch ? starsMatch[1] : ''

      items.push({
        title: repoPath,
        url: `https://github.com/${repoPath}`,
        source: 'github-trending',
        description: desc,
        extra: {
          ...(lang ? { language: lang } : {}),
          ...(starsToday ? { starsToday } : {}),
        },
      })
    }

    log.info({ count: items.length }, 'GitHub Trending 采集完成')
  } catch (err) {
    log.error({ error: String(err) }, 'GitHub Trending 采集失败')
    return { name: 'gh-trending', items: [], duration: Date.now() - start, error: String(err) }
  }

  return { name: 'gh-trending', items, duration: Date.now() - start }
}
```

### 验证

```bash
npx tsc --noEmit
```

---

## Task 7: Sonnet 评分 Prompt — `src/digest/prompts/score.ts`

Sonnet 批量评分 + 摘要，使用 JSON schema 结构化输出：

```ts
/** Sonnet 评分系统提示 */
export const scoreSystemPrompt = `你是一位科技信息分析师，负责对每日采集的科技资讯进行评分和摘要。

评分维度（1-10 分）：
- 相关性：对 AI/编程/创业领域从业者的实用价值
- 质量：内容深度、原创性、可信度
- 时效性：新闻热度、时间敏感度

输出要求：
- 标题：中文（英文条目自动翻译，保留专有名词）
- 摘要：2-3 句中文，概括核心信息
- 分类：AI / 安全 / 工程 / 工具 / 创业 / 热点 / 其他（单选）`

/** 构建评分用户消息 */
export function scoreUserPrompt(items: Array<{ title: string; url: string; source: string; description?: string }>): string {
  const formatted = items.map((item, i) =>
    `[${i + 1}] ${item.title}\n来源: ${item.source}\nURL: ${item.url}${item.description ? `\n描述: ${item.description}` : ''}`
  ).join('\n\n')
  return `请对以下 ${items.length} 条资讯进行评分和摘要：\n\n${formatted}`
}

/** Sonnet 评分 JSON schema（用于 tool_choice 结构化输出） */
export const scoreSchema = {
  type: 'object' as const,
  properties: {
    scored_items: {
      type: 'array' as const,
      items: {
        type: 'object' as const,
        properties: {
          index: { type: 'number' as const, description: '条目序号（从 1 开始）' },
          relevance: { type: 'number' as const, description: '相关性评分 1-10' },
          quality: { type: 'number' as const, description: '质量评分 1-10' },
          timeliness: { type: 'number' as const, description: '时效性评分 1-10' },
          ai_title: { type: 'string' as const, description: '中文标题' },
          ai_summary: { type: 'string' as const, description: '2-3 句中文摘要' },
          category: {
            type: 'string' as const,
            enum: ['AI', '安全', '工程', '工具', '创业', '热点', '其他'],
          },
        },
        required: ['index', 'relevance', 'quality', 'timeliness', 'ai_title', 'ai_summary', 'category'],
      },
    },
  },
  required: ['scored_items'],
}
```

### 验证

```bash
npx tsc --noEmit
```

---

## Task 8: Opus 综合分析 Prompt — `src/digest/prompts/analyze.ts`

Opus + Extended Thinking 跨源关联分析：

```ts
/** Opus 综合分析系统提示 */
export const analyzeSystemPrompt = `你是一位资深科技分析师，负责从每日资讯中提取深层洞察。

你的目标是帮助读者用最少时间获取最大信息价值。

输出格式（Markdown）：
1. **30 秒速读**：3-5 句话概括今日科技圈宏观趋势
2. **今日必读 Top 5**：每篇包含推荐理由（为什么值得读）
3. **跨源关联**：发现同一话题在不同平台出现的信号增强（如 HN 热议 + GitHub trending + 知乎热搜同时出现某技术）
4. **行动项**：具体的建议（值得尝试的工具/关注的项目/收藏的文章）

风格：直接、有观点、避免空泛概括。用数据和例子说话。`

/** 构建综合分析用户消息 */
export function analyzeUserPrompt(scoredItems: Array<{
  aiTitle: string
  url: string
  source: string
  aiSummary: string
  totalScore: number
  category: string
}>): string {
  const formatted = scoredItems.map((item, i) =>
    `[${i + 1}] ${item.aiTitle} (${item.category}, 评分${item.totalScore})\n来源: ${item.source}\nURL: ${item.url}\n摘要: ${item.aiSummary}`
  ).join('\n\n')

  const today = new Date().toISOString().slice(0, 10)
  return `以下是 ${today} 采集的 Top ${scoredItems.length} 条资讯（已按综合评分降序排列）：\n\n${formatted}\n\n请进行跨源综合分析。`
}
```

### 验证

```bash
npx tsc --noEmit
```

---

## Task 9: ClaudeClient 扩展 — Sonnet 模型 + 批量评分方法

修改 `src/processor/claude-client.ts`：

### 9a. 新增 Sonnet 模型常量

```ts
const SONNET = 'claude-sonnet-4-6-20250514'
```

### 9b. 新增 `scoreBatch()` 方法

```ts
/** 批量评分（Sonnet + Structured Output） */
async scoreBatch(
  systemPrompt: string,
  userMessage: string,
  schema: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const start = Date.now()
  const stream = this.client.messages.stream({
    model: SONNET,
    max_tokens: 8192,
    ...this.proxyMetadata(),
    system: this.buildSystem(systemPrompt),
    messages: [{ role: 'user', content: userMessage }],
    tools: [{
      name: 'score_items',
      description: '对资讯条目进行评分和摘要',
      input_schema: schema,
    }],
    tool_choice: { type: 'tool', name: 'score_items' },
  })
  const response = await stream.finalMessage()
  log.info({ model: SONNET, duration: Date.now() - start, inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens }, '评分 API 调用完成')
  const toolUse = response.content.find(b => b.type === 'tool_use')
  if (!toolUse || toolUse.type !== 'tool_use') throw new Error('Sonnet 未返回结构化评分')
  return toolUse.input as Record<string, unknown>
}
```

### 9c. 新增 `analyze()` 方法

```ts
/** 综合分析（Opus + Extended Thinking，返回 Markdown） */
async analyze(
  systemPrompt: string,
  userMessage: string,
  onProgress?: (message: string) => void,
): Promise<string> {
  const start = Date.now()
  onProgress?.('Opus 综合分析中...')

  const stream = this.client.messages.stream({
    model: OPUS,
    max_tokens: 16000,
    thinking: { type: 'enabled', budget_tokens: 10000 },
    ...this.proxyMetadata(),
    system: this.buildSystem(systemPrompt),
    messages: [{ role: 'user', content: userMessage }],
  }, { timeout: 300_000 })

  // 流式 thinking 进度
  let thinkingLineCount = 0
  stream.on('thinking', (_delta: string, snapshot: string) => {
    const lines = snapshot.split('\n').length
    if (lines - thinkingLineCount >= 3) {
      thinkingLineCount = lines
      const display = snapshot.length > 800 ? '...\n' + snapshot.slice(-800) : snapshot
      onProgress?.(`**Opus 分析中...**\n\n${display}`)
    }
  })

  const response = await stream.finalMessage()
  log.info({ model: OPUS, duration: Date.now() - start, inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens }, '综合分析 API 调用完成')

  // 提取文本输出
  return response.content
    .filter(b => b.type === 'text')
    .map(b => (b as { text: string }).text)
    .join('\n')
}
```

### 验证

```bash
npx tsc --noEmit
```

---

## Task 10: DigestEngine 主调度 — `src/digest/index.ts`

核心引擎，协调采集 → 评分 → 分析 → 报告全流程：

```ts
import { createLogger } from '../utils/logger.js'
import { ClaudeClient } from '../processor/claude-client.js'
import { collectRssGroup } from './collectors/rss.js'
import { collectNewsNow } from './collectors/newsnow.js'
import { collectGhTrending } from './collectors/gh-trending.js'
import { scoreSystemPrompt, scoreUserPrompt, scoreSchema } from './prompts/score.js'
import { analyzeSystemPrompt, analyzeUserPrompt } from './prompts/analyze.js'
import type { DigestItem, CollectorResult, ScoredItem, DigestAnalysis, DailyDigest } from './collectors/types.js'

const log = createLogger('digest')

export class DigestEngine {
  constructor(
    private claude: ClaudeClient,
    private onProgress?: (message: string) => void,
  ) {}

  async run(): Promise<DailyDigest> {
    const start = Date.now()
    const today = new Date().toISOString().slice(0, 10)

    // ===== 阶段 1：8 路 collector 并行采集 =====
    this.onProgress?.('采集中... 8 路 collector 并行')
    const collections = await this.collect()
    const allItems = collections.flatMap(c => c.items)
    log.info({ total: allItems.length, collectors: collections.length }, '采集完成')
    this.onProgress?.(`采集完成: ${allItems.length} 条`)

    // URL 去重
    const seen = new Set<string>()
    const unique = allItems.filter(item => {
      if (seen.has(item.url)) return false
      seen.add(item.url)
      return true
    })

    // ===== 阶段 2：Sonnet 批量评分 =====
    this.onProgress?.(`Sonnet 评分中... ${unique.length} 条`)
    const scored = await this.score(unique)
    scored.sort((a, b) => b.totalScore - a.totalScore)
    log.info({ scored: scored.length }, '评分完成')

    // ===== 阶段 3：Opus 综合分析（Top 30） =====
    const top30 = scored.slice(0, 30)
    this.onProgress?.('Opus 跨源综合分析中...')
    const analysis = await this.analyze(top30)
    log.info('综合分析完成')

    return {
      date: today,
      collections,
      scoredItems: scored,
      analysis,
      totalDuration: Date.now() - start,
    }
  }

  /** 8 路 collector 并行采集（Promise.allSettled） */
  private async collect(): Promise<CollectorResult[]> {
    const collectors = [
      () => collectGhTrending(),
      () => collectNewsNow('tech-news'),
      () => collectNewsNow('trends'),
      () => collectNewsNow('xhs'),
      () => collectRssGroup('ai'),
      () => collectRssGroup('dev'),
      () => collectRssGroup('startup'),
      () => collectRssGroup('hn-blogs'),
    ]

    const results = await Promise.allSettled(
      collectors.map(fn =>
        Promise.race([
          fn(),
          new Promise<CollectorResult>((_, reject) =>
            setTimeout(() => reject(new Error('collector 超时 60s')), 60_000)
          ),
        ])
      )
    )

    return results.map((r, i) => {
      if (r.status === 'fulfilled') return r.value
      log.error({ index: i, error: String(r.reason) }, 'collector 失败')
      return { name: `collector-${i}`, items: [], duration: 0, error: String(r.reason) }
    })
  }

  /** Sonnet 批量评分（每批 15 条） */
  private async score(items: DigestItem[]): Promise<ScoredItem[]> {
    const BATCH_SIZE = 15
    const scored: ScoredItem[] = []

    for (let i = 0; i < items.length; i += BATCH_SIZE) {
      const batch = items.slice(i, i + BATCH_SIZE)
      try {
        const result = await this.claude.scoreBatch(
          scoreSystemPrompt,
          scoreUserPrompt(batch),
          scoreSchema,
        )
        const scoredBatch = (result as { scored_items: Array<Record<string, unknown>> }).scored_items
        for (const s of scoredBatch) {
          const idx = (s.index as number) - 1
          if (idx < 0 || idx >= batch.length) continue
          const item = batch[idx]
          scored.push({
            ...item,
            relevance: s.relevance as number,
            quality: s.quality as number,
            timeliness: s.timeliness as number,
            totalScore: (s.relevance as number) + (s.quality as number) + (s.timeliness as number),
            aiTitle: s.ai_title as string,
            aiSummary: s.ai_summary as string,
            category: s.category as ScoredItem['category'],
          })
        }
      } catch (err) {
        log.error({ batch: i, error: String(err) }, '评分批次失败')
      }
      this.onProgress?.(`评分进度: ${Math.min(i + BATCH_SIZE, items.length)}/${items.length}`)
    }

    return scored
  }

  /** Opus 综合分析 */
  private async analyze(top: ScoredItem[]): Promise<DigestAnalysis> {
    const markdown = await this.claude.analyze(
      analyzeSystemPrompt,
      analyzeUserPrompt(top),
      this.onProgress,
    )

    // 从 Markdown 解析各段落（简单正则分割）
    return this.parseAnalysis(markdown, top)
  }

  /** 解析 Opus Markdown 输出为结构化 DigestAnalysis */
  private parseAnalysis(md: string, top: ScoredItem[]): DigestAnalysis {
    // 按 ## 标题分割段落，提取各部分
    // 降级：解析失败时整段作为 quickRead
    // ... 实现细节
  }
}
```

### 验证

```bash
npx tsc --noEmit
```

---

## Task 11: Reporter — 飞书卡片 + Obsidian 存档 — `src/digest/reporter.ts`

### 11a. 飞书 CardKit 简报卡片

卡片结构：
1. Header：每日简报 — 日期 + text_tag(源数/入选数)
2. 30 秒速读（markdown）
3. 分割线
4. 今日必读 Top 5（每篇：标题 + 摘要 + [查看原文] open_url 按钮 + [收藏] callback 按钮）
5. 分类统计（markdown 表格）
6. 行动项（markdown）
7. 底部元信息（grey font：源数 · 入选数 · Sonnet+Opus · 耗时）

```ts
import type * as lark from '@larksuiteoapi/node-sdk'
import type { DailyDigest, ScoredItem } from './collectors/types.js'
import { createLogger } from '../utils/logger.js'

const log = createLogger('digest-reporter')

/** 构建飞书简报卡片 */
export function buildDigestCard(digest: DailyDigest): Record<string, unknown> {
  const { date, scoredItems, analysis, totalDuration, collections } = digest
  const totalSources = collections.reduce((sum, c) => sum + c.items.length, 0)

  const header = {
    title: { tag: 'plain_text', content: `每日简报 — ${date}` },
    template: 'indigo',
    text_tag_list: [
      { tag: 'text_tag', text: { tag: 'plain_text', content: `${totalSources} 源` }, color: 'blue' },
      { tag: 'text_tag', text: { tag: 'plain_text', content: `${scoredItems.length} 入选` }, color: 'green' },
    ],
  }

  const elements: Record<string, unknown>[] = []

  // 30 秒速读
  elements.push({ tag: 'markdown', content: `**30 秒速读**\n\n${analysis.quickRead}` })
  elements.push({ tag: 'hr' })

  // Top 5
  elements.push({ tag: 'markdown', content: '**今日必读**' })
  for (const { item, reason } of analysis.top5) {
    elements.push({ tag: 'markdown', content: `**${item.aiTitle}**\n${item.aiSummary}\n*${reason}*` })
    // 按钮行
    elements.push({
      tag: 'column_set',
      horizontal_align: 'left',
      columns: [
        {
          tag: 'column', width: 'weighted', weight: 1,
          vertical_spacing: '8px', horizontal_align: 'left', vertical_align: 'top',
          elements: [{
            tag: 'button', text: { tag: 'plain_text', content: '查看原文' },
            type: 'primary_filled', size: 'small', width: 'fill',
            behaviors: [{ type: 'open_url', default_url: item.url }],
          }],
        },
        {
          tag: 'column', width: 'weighted', weight: 1,
          vertical_spacing: '8px', horizontal_align: 'left', vertical_align: 'top',
          elements: [{
            tag: 'button', text: { tag: 'plain_text', content: '收藏到 Obsidian' },
            type: 'primary_filled', size: 'small', width: 'fill',
            behaviors: [{ type: 'callback', value: { command: 'save', url: item.url } }],
          }],
        },
      ],
    })
  }
  elements.push({ tag: 'hr' })

  // 跨源关联
  if (analysis.correlations) {
    elements.push({ tag: 'markdown', content: `**跨源关联**\n\n${analysis.correlations}` })
  }

  // 行动项
  if (analysis.actionItems) {
    elements.push({ tag: 'markdown', content: `**行动项**\n\n${analysis.actionItems}` })
  }

  // 底部元信息
  const mins = Math.round(totalDuration / 60_000)
  elements.push({
    tag: 'markdown',
    content: `<font color='grey'>${totalSources} 源 · ${scoredItems.length} 入选 · Sonnet+Opus · ${mins}min</font>`,
  })

  return { schema: '2.0', config: { update_multi: true }, header, body: { direction: 'vertical', elements } }
}
```

### 11b. Obsidian 存档

```ts
import { writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'

/** 写入 Obsidian 每日简报存档 */
export async function writeDigestToObsidian(
  digest: DailyDigest,
  vaultPath: string,
): Promise<string> {
  const dir = join(vaultPath, 'digest')
  await mkdir(dir, { recursive: true })
  const filePath = join(dir, `${digest.date}.md`)

  const top5Urls = digest.analysis.top5.map(t => t.item.url)
  const categories = [...new Set(digest.scoredItems.map(i => i.category))]

  const frontmatter = [
    '---',
    'type: digest',
    `date: ${digest.date}`,
    `sources: ${digest.collections.reduce((s, c) => s + c.items.length, 0)}`,
    `articles: ${digest.scoredItems.length}`,
    `top5: [${top5Urls.map(u => `"${u}"`).join(', ')}]`,
    `tags: [${categories.join(', ')}]`,
    '---',
  ].join('\n')

  const body = [
    `# 每日简报 — ${digest.date}\n`,
    `## 30 秒速读\n\n${digest.analysis.quickRead}\n`,
    `## 今日必读\n`,
    ...digest.analysis.top5.map(({ item, reason }, i) =>
      `### ${i + 1}. ${item.aiTitle}\n\n${item.aiSummary}\n\n> ${reason}\n\n[原文链接](${item.url})\n`
    ),
    `## 跨源关联\n\n${digest.analysis.correlations}\n`,
    `## 行动项\n\n${digest.analysis.actionItems}\n`,
    `## 全部条目\n`,
    '| # | 标题 | 来源 | 分类 | 评分 |',
    '|---|------|------|------|------|',
    ...digest.scoredItems.slice(0, 30).map((item, i) =>
      `| ${i + 1} | [${item.aiTitle}](${item.url}) | ${item.source} | ${item.category} | ${item.totalScore} |`
    ),
  ].join('\n')

  await writeFile(filePath, `${frontmatter}\n\n${body}`, 'utf-8')
  return filePath
}
```

### 验证

```bash
npx tsc --noEmit
```

---

## Task 12: 集成 — index.ts + message-parser + feishu adapter

### 12a. `src/parser/message-parser.ts` 添加 `#digest` 指令

正则扩展：

```ts
const COMMAND_KEYWORD_REGEX = /^#(save|discuss|quote|help|digest)\b/i
const COMMAND_ARGS_REGEX = /^#(?:save|discuss|quote|digest)\s+((?:(?!https?:\/\/).)+)/i
```

`src/types/pipeline.ts` CommandType 扩展：

```ts
export type CommandType = 'save' | 'discuss' | 'quote' | 'help' | 'digest' | 'none'
```

### 12b. `src/index.ts` 初始化 DigestEngine + node-cron

```ts
import cron from 'node-cron'
import { DigestEngine } from './digest/index.js'
import { buildDigestCard, writeDigestToObsidian } from './digest/reporter.js'

// main() 内，飞书模式下初始化:
if (!config.cliMode && config.digestChatId) {
  const feishuAdapter = activeAdapter as FeishuAdapter
  const digestEngine = new DigestEngine(processor.getClaudeClient())

  // 定时任务
  cron.schedule(config.digestCron, async () => {
    log.info('定时触发每日简报...')
    await runDigest(digestEngine, feishuAdapter, config)
  })
  log.info({ cron: config.digestCron }, '每日简报定时任务已注册')
}
```

### 12c. `src/adapters/feishu.ts` — `#digest` 路由

在 `handleMessage` 或 pipeline 中识别 `#digest` 指令后，调用 DigestEngine 而非普通管道。

### 12d. `src/processor/claude-client.ts` — 暴露 client 给 DigestEngine

AIProcessor 新增 `getClaudeClient()` 方法，或 DigestEngine 直接接收 ClaudeClient 实例。

### 验证

```bash
npx tsc --noEmit
```

---

## Task 13: 端到端验证

### 13a. 单个 collector 测试

```bash
# 用 tsx 直接运行测试脚本
npx tsx -e "
import { collectGhTrending } from './src/digest/collectors/gh-trending.js'
const r = await collectGhTrending()
console.log(JSON.stringify({ name: r.name, count: r.items.length, duration: r.duration, first: r.items[0] }, null, 2))
"
```

### 13b. RSS 解析测试

```bash
npx tsx -e "
import { collectRssGroup } from './src/digest/collectors/rss.js'
const r = await collectRssGroup('ai')
console.log(JSON.stringify({ name: r.name, count: r.items.length, items: r.items.slice(0, 3) }, null, 2))
"

```

### 13c. 全流程测试（`#digest` 手动触发）

飞书发送 `#digest`，验证：
1. 8 路 collector 全部返回结果（无超时挂起）
2. Sonnet 评分输出完整（每条有评分+摘要+分类）
3. Opus 分析输出 4 段结构化 Markdown
4. 飞书卡片正确渲染（Header + Top 5 + 按钮）
5. Obsidian `digest/YYYY-MM-DD.md` 文件写入成功
6. "收藏到 Obsidian" 按钮回调触发 save 管道

### 13d. 编译 + 测试

```bash
npx tsc --noEmit
npx vitest run
```

---

## 执行顺序建议

```
Task 1 (依赖+配置)
  ↓
Task 2 (类型) → Task 3 (feeds 配置)
  ↓
Task 4~6 (3 个 collector，可并行)
  ↓
Task 7~8 (2 个 prompt，可并行)
  ↓
Task 9 (ClaudeClient 扩展)
  ↓
Task 10 (DigestEngine 主调度)
  ↓
Task 11 (Reporter)
  ↓
Task 12 (集成)
  ↓
Task 13 (验证)
```

**可并行的 Task 组**：
- Task 4 + Task 5 + Task 6（三个 collector 无依赖）
- Task 7 + Task 8（两个 prompt 无依赖）

**预计新增代码量**：~800-1000 行（10 新文件 + 5 文件修改）
