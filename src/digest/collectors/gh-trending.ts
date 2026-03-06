// GitHub Trending 采集器 — 抓取 github.com/trending 页面，正则解析仓库列表

import { createLogger } from '../../utils/logger.js'
import type { DigestItem, CollectorResult } from './types.js'

const log = createLogger('gh-trending')

/** 请求超时 ms */
const FETCH_TIMEOUT = 30_000
/** User-Agent 标识 */
const USER_AGENT = 'webot/0.1'
/** GitHub Trending 页面地址 */
const TRENDING_URL = 'https://github.com/trending'

/**
 * 采集 GitHub Trending 仓库列表
 * 抓取 HTML 页面后通过正则提取每个仓库的路径、描述、语言、今日星数
 */
export async function collectGhTrending(): Promise<CollectorResult> {
  const start = Date.now()
  log.info('开始采集 GitHub Trending')

  try {
    const html = await fetchTrendingPage()
    const items = parseTrendingHtml(html)
    const duration = Date.now() - start
    log.info({ count: items.length, duration }, 'GitHub Trending 采集完成')

    return {
      name: 'github-trending',
      items,
      duration,
    }
  } catch (err) {
    const duration = Date.now() - start
    const msg = err instanceof Error ? err.message : String(err)
    log.error({ err: msg, duration }, 'GitHub Trending 采集失败')

    return {
      name: 'github-trending',
      items: [],
      duration,
      error: msg,
    }
  }
}

/** 请求 GitHub Trending 页面 HTML */
async function fetchTrendingPage(): Promise<string> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT)

  try {
    const resp = await fetch(TRENDING_URL, {
      signal: controller.signal,
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'text/html',
      },
    })

    if (!resp.ok) {
      throw new Error(`HTTP ${resp.status}`)
    }

    return await resp.text()
  } finally {
    clearTimeout(timer)
  }
}

/**
 * 从 GitHub Trending HTML 中解析仓库列表
 * 每个仓库在 `<article class="Box-row">` 块中
 */
function parseTrendingHtml(html: string): DigestItem[] {
  const items: DigestItem[] = []

  // 提取所有 <article class="Box-row">...</article> 块
  const articleRegex = /<article\s+class="Box-row"[\s\S]*?<\/article>/gi
  const articles = html.match(articleRegex) ?? []

  for (const block of articles) {
    const parsed = parseArticleBlock(block)
    if (parsed) items.push(parsed)
  }

  return items
}

/** 解析单个仓库 article 块 */
function parseArticleBlock(block: string): DigestItem | undefined {
  // 仓库路径：<h2> 中的 <a href="/owner/repo">
  const repoMatch = block.match(/<h2[^>]*>[\s\S]*?<a[^>]*href="\/([^"]+)"[\s\S]*?<\/h2>/i)
  if (!repoMatch) return undefined

  const repoPath = repoMatch[1].trim()
  // 清理路径中的空白（GitHub HTML 中 owner 和 repo 之间可能有换行）
  const cleanPath = repoPath.replace(/\s+/g, '')

  // 从路径提取 owner/repo
  const parts = cleanPath.split('/')
  if (parts.length < 2) return undefined
  const fullName = `${parts[0]}/${parts[1]}`

  // 描述：<p class="col-9 ...">...</p>
  const descMatch = block.match(/<p\s+class="col-9[^"]*"[^>]*>([\s\S]*?)<\/p>/i)
  const description = descMatch ? descMatch[1].replace(/<[^>]+>/g, '').trim() : undefined

  // 语言：<span itemprop="programmingLanguage">...</span>
  const langMatch = block.match(/<span\s+itemprop="programmingLanguage">([\s\S]*?)<\/span>/i)
  const language = langMatch ? langMatch[1].trim() : undefined

  // 今日星数：末尾 "X stars today"
  const starsMatch = block.match(/([\d,]+)\s+stars?\s+today/i)
  const starsToday = starsMatch ? starsMatch[1].replace(/,/g, '') : undefined

  const extra: Record<string, string> = {}
  if (language) extra.language = language
  if (starsToday) extra.starsToday = starsToday

  return {
    title: fullName,
    url: `https://github.com/${fullName}`,
    source: 'github-trending',
    description: description || undefined,
    extra: Object.keys(extra).length > 0 ? extra : undefined,
  }
}
