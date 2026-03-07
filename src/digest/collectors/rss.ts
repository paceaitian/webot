// RSS/Atom 零依赖解析器 — 正则提取 feed 条目，支持 24h 过滤和并发采集

import { createLogger } from '../../utils/logger.js'
import type { DigestItem, CollectorResult } from './types.js'
import { FEEDS, type FeedSource } from './feeds.js'

const log = createLogger('rss')

/** 请求超时 ms */
const FETCH_TIMEOUT = 15_000
/** User-Agent 标识 — 使用浏览器 UA 避免被拒 */
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
/** 24 小时毫秒数 */
const MS_24H = 24 * 60 * 60 * 1000
/** hn-blogs 组并发上限 */
const HN_CONCURRENCY = 10

/**
 * 解码 XML 实体（&amp; &lt; &gt; &quot; &#xx; &#xHH;）
 * @param s - 含 XML 实体的字符串
 */
export function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCharCode(parseInt(dec, 10)))
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
}

/**
 * 从 XML 块中提取指定标签的文本内容
 * @param block - XML 片段
 * @param tag - 标签名
 */
export function extractTag(block: string, tag: string): string | undefined {
  // 匹配 <tag>...</tag>（含 CDATA）
  const re = new RegExp(`<${tag}[^>]*>\\s*(?:<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>|([\\s\\S]*?))\\s*</${tag}>`, 'i')
  const m = block.match(re)
  if (!m) return undefined
  const raw = m[1] ?? m[2] ?? ''
  return decodeEntities(raw.trim())
}

/**
 * 从 XML 块提取链接，兼容 RSS `<link>text</link>` 和 Atom `<link href="..." />`
 * @param block - XML 片段
 */
export function extractLink(block: string): string | undefined {
  // Atom: <link rel="alternate" href="..." /> 或 <link href="..." />
  const atomRe = /<link[^>]*\brel=["']alternate["'][^>]*\bhref=["']([^"']+)["'][^>]*\/?>/i
  const atomAlt = block.match(atomRe)
  if (atomAlt) return decodeEntities(atomAlt[1].trim())

  const atomHref = block.match(/<link[^>]*\bhref=["']([^"']+)["'][^>]*\/?>/i)
  if (atomHref) return decodeEntities(atomHref[1].trim())

  // RSS: <link>text</link>
  const rssLink = extractTag(block, 'link')
  if (rssLink) return rssLink

  return undefined
}

/**
 * 解析 RSS/Atom XML 文本，提取条目列表
 * @param xml - 原始 XML 文本
 * @param sourceName - 数据源名称
 */
export function parseRssXml(xml: string, sourceName: string): DigestItem[] {
  const items: DigestItem[] = []

  // RSS <item>...</item>
  const rssItems = xml.match(/<item[\s>][\s\S]*?<\/item>/gi) ?? []
  for (const block of rssItems) {
    const title = extractTag(block, 'title')
    const link = extractLink(block)
    if (!title || !link) continue
    const description = extractTag(block, 'description') ?? extractTag(block, 'content:encoded')
    const pubDate = extractTag(block, 'pubDate') ?? extractTag(block, 'dc:date')
    items.push({
      title: stripHtml(title),
      url: link,
      source: sourceName,
      description: description ? truncate(stripHtml(description), 300) : undefined,
      publishedAt: pubDate ?? undefined,
    })
  }

  // Atom <entry>...</entry>
  const atomEntries = xml.match(/<entry[\s>][\s\S]*?<\/entry>/gi) ?? []
  for (const block of atomEntries) {
    const title = extractTag(block, 'title')
    const link = extractLink(block)
    if (!title || !link) continue
    const description = extractTag(block, 'summary') ?? extractTag(block, 'content')
    const pubDate = extractTag(block, 'published') ?? extractTag(block, 'updated')
    items.push({
      title: stripHtml(title),
      url: link,
      source: sourceName,
      description: description ? truncate(stripHtml(description), 300) : undefined,
      publishedAt: pubDate ?? undefined,
    })
  }

  return items
}

/**
 * 过滤 24h 内的条目，无日期的保留
 * @param items - 待过滤条目
 */
export function filterRecent(items: DigestItem[]): DigestItem[] {
  const cutoff = Date.now() - MS_24H
  return items.filter(item => {
    if (!item.publishedAt) return true
    const ts = new Date(item.publishedAt).getTime()
    // 解析失败视为无日期，保留
    if (isNaN(ts)) return true
    return ts >= cutoff
  })
}

/**
 * 采集指定组的全部 RSS 源
 * - hn-blogs 组：10 路并发
 * - 其他组：全量并发
 * @param group - 组名
 * @param feeds - 可选覆盖源列表（测试用）
 */
export async function collectRssGroup(
  group: FeedSource['group'],
  feeds?: FeedSource[],
): Promise<CollectorResult> {
  const start = Date.now()
  const sources = feeds ?? FEEDS.filter(f => f.group === group)
  log.info({ group, count: sources.length }, '开始采集 RSS 组')

  let allItems: DigestItem[] = []
  const errors: string[] = []

  if (group === 'hn-blogs') {
    // 10 路并发池
    allItems = await concurrentFetch(sources, HN_CONCURRENCY, errors)
  } else {
    // 全量并发
    allItems = await concurrentFetch(sources, sources.length, errors)
  }

  const recent = filterRecent(allItems)
  const duration = Date.now() - start
  log.info({ group, total: allItems.length, recent: recent.length, duration }, 'RSS 组采集完成')

  return {
    name: `rss-${group}`,
    items: recent,
    duration,
    error: errors.length > 0 ? `${errors.length} 个源失败: ${errors.slice(0, 5).join('; ')}` : undefined,
  }
}

// ---- 内部工具函数 ----

/** 并发采集，限制最大并发数 */
async function concurrentFetch(
  sources: FeedSource[],
  concurrency: number,
  errors: string[],
): Promise<DigestItem[]> {
  const results: DigestItem[] = []
  const queue = [...sources]

  async function worker(): Promise<void> {
    while (queue.length > 0) {
      const source = queue.shift()
      if (!source) break
      try {
        const items = await fetchFeed(source)
        results.push(...items)
      } catch (err) {
        const msg = `${source.name}: ${err instanceof Error ? err.message : String(err)}`
        errors.push(msg)
        log.warn({ source: source.name, err: msg }, 'RSS 源采集失败')
      }
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, sources.length) }, () => worker())
  await Promise.all(workers)
  return results
}

/** 429 重试最大次数 */
const MAX_429_RETRIES = 2

/** 请求单个 feed 并解析，429 限流时自动重试 */
async function fetchFeed(source: FeedSource): Promise<DigestItem[]> {
  for (let attempt = 0; attempt <= MAX_429_RETRIES; attempt++) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT)
    try {
      const resp = await fetch(source.url, {
        signal: controller.signal,
        headers: { 'User-Agent': USER_AGENT },
      })

      // 429 限流：读取 Retry-After 头，延迟重试
      if (resp.status === 429 && attempt < MAX_429_RETRIES) {
        const retryAfter = resp.headers.get('Retry-After')
        const delay = retryAfter ? parseInt(retryAfter, 10) * 1000 : 3000
        log.warn({ source: source.name, delay, attempt: attempt + 1 }, 'RSS 429 限流，延迟重试')
        clearTimeout(timer)
        await new Promise(r => setTimeout(r, Math.min(delay, 10_000)))
        continue
      }

      if (!resp.ok) {
        throw new Error(`HTTP ${resp.status}`)
      }
      const xml = await resp.text()
      return parseRssXml(xml, source.name)
    } finally {
      clearTimeout(timer)
    }
  }
  throw new Error('HTTP 429')
}

/** 去除 HTML 标签 */
function stripHtml(s: string): string {
  return s.replace(/<[^>]+>/g, '').trim()
}

/** 截断字符串 */
function truncate(s: string, max: number): string {
  if (s.length <= max) return s
  return s.slice(0, max) + '...'
}
