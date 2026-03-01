// Readability 通用网页正文提取（fast path）
import { Readability } from '@mozilla/readability'
import { JSDOM } from 'jsdom'
import type { ExtractedContent } from '../types/index.js'
import { createLogger } from '../utils/logger.js'

const log = createLogger('readability')

/** fetch 超时（15 秒） */
const FETCH_TIMEOUT = 15_000

/**
 * 使用 fetch + Readability 提取网页正文
 * 适用于大部分静态网页（非微信公众号）
 */
export async function extractWithReadability(url: string): Promise<ExtractedContent> {
  log.info({ url }, '开始 Readability 提取')

  const response = await fetch(url, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT),
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    },
  })

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`)
  }

  const html = await response.text()
  const dom = new JSDOM(html, { url })
  const reader = new Readability(dom.window.document)
  const article = reader.parse()

  if (!article) {
    throw new Error('Readability 无法解析该页面')
  }

  log.info({ title: article.title, length: article.textContent.length }, 'Readability 提取成功')

  return {
    title: article.title || url,
    content: article.textContent,
    url,
    author: article.byline ?? undefined,
    siteName: article.siteName ?? undefined,
    contentType: 'article',
  }
}
