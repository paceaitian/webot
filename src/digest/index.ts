// 每日简报主调度引擎 — 协调采集器、Sonnet 评分、Opus 分析，输出完整 DailyDigest

import { createLogger } from '../utils/logger.js'
import { ClaudeClient } from '../processor/claude-client.js'
import { collectGhTrending } from './collectors/gh-trending.js'
import { collectNewsNow } from './collectors/newsnow.js'
import { collectRssGroup } from './collectors/rss.js'
import { scoreSystemPrompt, scoreUserPrompt, scoreSchema } from './prompts/score.js'
import { analyzeSystemPrompt, analyzeUserPrompt } from './prompts/analyze.js'
import type {
  DigestItem,
  CollectorResult,
  ScoredItem,
  DigestAnalysis,
  DailyDigest,
} from './collectors/types.js'

const log = createLogger('digest-engine')

/** 单个 collector 超时 ms */
const COLLECTOR_TIMEOUT = 60_000
/** 评分每批条目数 */
const SCORE_BATCH_SIZE = 15
/** 分析取 Top N */
const ANALYZE_TOP_N = 30

/** Sonnet 评分返回的单条结构 */
interface ScoreResult {
  index: number
  relevance: number
  quality: number
  timeliness: number
  ai_title: string
  ai_summary: string
  category: 'AI' | '安全' | '工程' | '工具' | '创业' | '热点' | '其他'
}

/**
 * 每日简报主调度引擎
 * 执行完整的采集 → 评分 → 分析流程，输出 DailyDigest
 */
export class DigestEngine {
  constructor(
    private claude: ClaudeClient,
    private onProgress?: (message: string) => void,
  ) {}

  /**
   * 执行完整的每日简报流程：采集 → 评分 → 分析
   * @returns 完整的每日简报数据
   */
  async run(): Promise<DailyDigest> {
    const start = Date.now()
    const date = new Date().toISOString().slice(0, 10)

    // 阶段 1：采集
    this.onProgress?.('📡 正在采集 8 路数据源...')
    const collections = await this.collect()
    const totalItems = collections.reduce((sum, c) => sum + c.items.length, 0)
    const successCount = collections.filter(c => !c.error).length
    log.info({ totalItems, successCount, totalCollectors: collections.length }, '采集完成')
    this.onProgress?.(`采集完成: ${totalItems} 条来自 ${successCount}/${collections.length} 个源`)

    // 阶段 2：去重
    const uniqueItems = this.dedup(collections)
    log.info({ before: totalItems, after: uniqueItems.length }, 'URL 去重完成')

    // 阶段 3：Sonnet 评分
    this.onProgress?.(`🔍 Sonnet 评分中 (${uniqueItems.length} 条)...`)
    const scoredItems = await this.score(uniqueItems)
    log.info({ scored: scoredItems.length }, '评分完成')

    // 阶段 4：Opus 分析 Top N
    const top = scoredItems.slice(0, ANALYZE_TOP_N)
    this.onProgress?.(`🧠 Opus 综合分析 Top ${top.length} 条...`)
    const analysis = await this.analyze(top)
    log.info('综合分析完成')

    const totalDuration = Date.now() - start
    this.onProgress?.(`✅ 简报完成，耗时 ${Math.round(totalDuration / 1000)}s`)

    return {
      date,
      collections,
      scoredItems,
      analysis,
      totalDuration,
    }
  }

  /**
   * 采集阶段：8 路 collector 并行，每个 60s 超时
   * 失败的 collector 返回空结果
   */
  private async collect(): Promise<CollectorResult[]> {
    const collectors: Array<{ name: string; fn: () => Promise<CollectorResult> }> = [
      { name: 'github-trending', fn: () => collectGhTrending() },
      { name: 'newsnow-tech-news', fn: () => collectNewsNow('tech-news') },
      { name: 'newsnow-trends', fn: () => collectNewsNow('trends') },
      { name: 'newsnow-xhs', fn: () => collectNewsNow('xhs') },
      { name: 'rss-ai', fn: () => collectRssGroup('ai') },
      { name: 'rss-dev', fn: () => collectRssGroup('dev') },
      { name: 'rss-startup', fn: () => collectRssGroup('startup') },
      { name: 'rss-hn-blogs', fn: () => collectRssGroup('hn-blogs') },
    ]

    // 带超时的并行执行
    const results = await Promise.allSettled(
      collectors.map(({ name, fn }) =>
        Promise.race([
          fn(),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('collector 超时 60s')), COLLECTOR_TIMEOUT),
          ),
        ]).catch((err: unknown) => {
          const msg = err instanceof Error ? err.message : String(err)
          log.error({ collector: name, err: msg }, 'collector 失败')
          return {
            name,
            items: [],
            duration: COLLECTOR_TIMEOUT,
            error: msg,
          } satisfies CollectorResult
        }),
      ),
    )

    return results.map((r, i) => {
      if (r.status === 'fulfilled') return r.value
      // Promise.allSettled + catch 保证不会走到这里，但类型安全需要
      const msg = r.reason instanceof Error ? r.reason.message : String(r.reason)
      return {
        name: collectors[i].name,
        items: [],
        duration: COLLECTOR_TIMEOUT,
        error: msg,
      }
    })
  }

  /**
   * URL 维度去重，保留首次出现的条目
   */
  private dedup(collections: CollectorResult[]): DigestItem[] {
    const seen = new Set<string>()
    const result: DigestItem[] = []
    for (const col of collections) {
      for (const item of col.items) {
        if (!seen.has(item.url)) {
          seen.add(item.url)
          result.push(item)
        }
      }
    }
    return result
  }

  /**
   * Sonnet 评分：每批 15 条，映射回 ScoredItem
   * 评分失败的批次跳过
   */
  private async score(items: DigestItem[]): Promise<ScoredItem[]> {
    const allScored: ScoredItem[] = []
    const totalBatches = Math.ceil(items.length / SCORE_BATCH_SIZE)

    for (let i = 0; i < items.length; i += SCORE_BATCH_SIZE) {
      const batch = items.slice(i, i + SCORE_BATCH_SIZE)
      const batchIndex = Math.floor(i / SCORE_BATCH_SIZE) + 1
      this.onProgress?.(`评分进度: ${batchIndex}/${totalBatches}`)

      try {
        const result = await this.claude.scoreBatch(
          scoreSystemPrompt,
          scoreUserPrompt(batch),
          scoreSchema,
        )

        // 从结构化输出映射回原始 DigestItem
        const scoredItems = result.scored_items as ScoreResult[] | undefined
        if (!scoredItems || !Array.isArray(scoredItems)) {
          log.error({ batchIndex }, '评分结果格式异常，跳过该批次')
          continue
        }

        for (const scored of scoredItems) {
          // index 从 1 开始
          const original = batch[scored.index - 1]
          if (!original) {
            log.warn({ index: scored.index, batchIndex }, '评分序号越界，跳过')
            continue
          }

          allScored.push({
            ...original,
            relevance: scored.relevance,
            quality: scored.quality,
            timeliness: scored.timeliness,
            totalScore: scored.relevance + scored.quality + scored.timeliness,
            aiTitle: scored.ai_title,
            aiSummary: scored.ai_summary,
            category: scored.category,
          })
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        log.error({ batchIndex, err: msg }, '评分批次失败，跳过')
      }
    }

    // 按总分降序排序
    allScored.sort((a, b) => b.totalScore - a.totalScore)
    return allScored
  }

  /**
   * Opus 综合分析：传入 Top N 条目，返回 DigestAnalysis
   */
  private async analyze(top: ScoredItem[]): Promise<DigestAnalysis> {
    try {
      const markdown = await this.claude.analyze(
        analyzeSystemPrompt,
        analyzeUserPrompt(top),
        this.onProgress,
      )
      return this.parseAnalysis(markdown, top)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      log.error({ err: msg }, 'Opus 分析失败，使用降级结果')
      // 降级：直接用评分数据构造
      return this.fallbackAnalysis(top)
    }
  }

  /**
   * 解析 Opus Markdown 输出为 DigestAnalysis 结构
   * 按标题关键词分割，失败时降级
   */
  private parseAnalysis(md: string, top: ScoredItem[]): DigestAnalysis {
    try {
      const quickRead = this.extractSection(md, '30 秒速读', '今日必读') || ''
      const top5Section = this.extractSection(md, '今日必读', '跨源关联') || ''
      const correlations = this.extractSection(md, '跨源关联', '行动项') || ''
      const actionItems = this.extractLastSection(md, '行动项') || ''

      // 解析 Top 5
      const top5 = this.parseTop5(top5Section, top)

      // 至少要有速读内容，否则视为解析失败
      if (!quickRead && !top5Section) {
        log.warn('分析内容为空，使用降级结果')
        return this.fallbackAnalysis(top, md)
      }

      return { quickRead, top5, correlations, actionItems }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      log.warn({ err: msg }, '分析解析失败，使用降级结果')
      return this.fallbackAnalysis(top, md)
    }
  }

  /**
   * 提取两个标题关键词之间的内容
   * @param md - 完整 Markdown 文本
   * @param startKey - 起始标题关键词
   * @param endKey - 结束标题关键词
   */
  private extractSection(md: string, startKey: string, endKey: string): string {
    // 匹配包含关键词的标题行（支持 ###、##、**加粗** 等格式）
    const startPattern = new RegExp(`(?:^|\\n)[#*\\s]*${this.escapeRegex(startKey)}[^\\n]*\\n`, 'i')
    const endPattern = new RegExp(`(?:^|\\n)[#*\\s]*${this.escapeRegex(endKey)}`, 'i')

    const startMatch = md.match(startPattern)
    if (!startMatch || startMatch.index === undefined) return ''

    const contentStart = startMatch.index + startMatch[0].length
    const rest = md.slice(contentStart)
    const endMatch = rest.match(endPattern)

    const content = endMatch?.index !== undefined ? rest.slice(0, endMatch.index) : rest
    return content.trim()
  }

  /**
   * 提取最后一个标题关键词之后的全部内容
   */
  private extractLastSection(md: string, key: string): string {
    const pattern = new RegExp(`(?:^|\\n)[#*\\s]*${this.escapeRegex(key)}[^\\n]*\\n`, 'i')
    const match = md.match(pattern)
    if (!match || match.index === undefined) return ''
    return md.slice(match.index + match[0].length).trim()
  }

  /**
   * 解析 Top 5 条目：尝试匹配序号+标题，与 scored items 关联
   */
  private parseTop5(section: string, top: ScoredItem[]): DigestAnalysis['top5'] {
    const result: DigestAnalysis['top5'] = []

    // 按序号分割（支持 1. 2. 等格式）
    const entries = section.split(/(?=\n\s*\d+[\.\)、])/g).filter(s => s.trim())

    for (const entry of entries) {
      if (result.length >= 5) break

      // 提取标题文本（去除 Markdown 链接格式）
      const titleMatch = entry.match(/\d+[\.\)、]\s*(?:\*\*)?(?:\[([^\]]+)\]|([^\n*（(]+))/)
      const title = (titleMatch?.[1] || titleMatch?.[2] || '').trim()

      // 提取推荐理由（标题之后的文本）
      const reasonLines = entry
        .split('\n')
        .slice(1)
        .map(l => l.trim())
        .filter(l => l && !l.startsWith('---'))
      const reason = reasonLines.join(' ').trim()

      // 模糊匹配 scored item：先尝试标题包含匹配，再降级到序号
      const matched = this.fuzzyMatchItem(title, top) || top[result.length]
      if (matched) {
        result.push({
          item: matched,
          reason: reason || matched.aiSummary,
        })
      }
    }

    // 不足 5 条时补齐
    while (result.length < 5 && result.length < top.length) {
      const existing = new Set(result.map(r => r.item.url))
      const next = top.find(item => !existing.has(item.url))
      if (!next) break
      result.push({
        item: next,
        reason: next.aiSummary,
      })
    }

    return result
  }

  /**
   * 模糊匹配：标题关键词在 scored items 中查找
   */
  private fuzzyMatchItem(title: string, items: ScoredItem[]): ScoredItem | undefined {
    if (!title) return undefined

    // 提取关键词（去除常见虚词，取前 3 个有意义的词）
    const keywords = title
      .replace(/[【】\[\]()（）""''：:，,。.!！?？]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 1)
      .slice(0, 4)

    if (keywords.length === 0) return undefined

    // 计算每个 item 匹配的关键词数
    let bestMatch: ScoredItem | undefined
    let bestScore = 0

    for (const item of items) {
      const target = `${item.aiTitle} ${item.title}`.toLowerCase()
      const matchCount = keywords.filter(kw => target.includes(kw.toLowerCase())).length
      if (matchCount > bestScore) {
        bestScore = matchCount
        bestMatch = item
      }
    }

    // 至少匹配 1 个关键词
    return bestScore >= 1 ? bestMatch : undefined
  }

  /** 转义正则特殊字符 */
  private escapeRegex(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  }

  /**
   * 降级分析结果：解析失败时使用
   */
  private fallbackAnalysis(top: ScoredItem[], rawMd?: string): DigestAnalysis {
    return {
      quickRead: rawMd || top.slice(0, 5).map(i => `- ${i.aiTitle}`).join('\n'),
      top5: top.slice(0, 5).map(item => ({
        item,
        reason: item.aiSummary,
      })),
      correlations: '',
      actionItems: '',
    }
  }
}
