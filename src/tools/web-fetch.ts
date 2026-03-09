// WebFetchTool — 纯抓取网页内容返回正文，不写入 Obsidian
import type { Tool, ToolResult, ToolContext } from './base.js'
import type { ContentExtractor } from '../extractor/index.js'
import type { ParsedMessage, RawMessage } from '../types/index.js'
import { generateId } from '../utils/id.js'
import { createLogger } from '../utils/logger.js'

const log = createLogger('tool-web-fetch')

/** 正文截断阈值（字符数） */
const MAX_CONTENT_LENGTH = 8000

/**
 * WebFetchTool — 抓取网页内容并返回正文（不保存到 Obsidian）
 * 适用于"帮我看看这个网页说了什么"、"读一下这个链接"等场景
 */
export class WebFetchTool implements Tool {
  name = 'web_fetch'
  description =
    '抓取网页内容并返回正文（不保存到 Obsidian）。适用于"帮我看看这个网页说了什么"、"读一下这个链接"、"总结一下这篇文章"等只需要阅读内容而不需要保存的场景。'
  parameters = {
    type: 'object' as const,
    properties: {
      url: {
        type: 'string',
        description: '要抓取的网页 URL',
      },
    },
    required: ['url'],
  }

  constructor(private extractor: ContentExtractor) {}

  async execute(params: Record<string, unknown>, _context: ToolContext): Promise<ToolResult> {
    const url = params.url as string
    log.info({ url }, 'WebFetchTool 执行')

    // 构造 ParsedMessage，extractor 只看 content 字段
    const raw: RawMessage = {
      eventId: generateId(),
      source: 'cli',
      rawText: url,
      receivedAt: new Date(),
    }
    const parsed: ParsedMessage = {
      raw,
      command: { type: 'save' },
      content: { type: 'url', url },
    }

    try {
      const extracted = await this.extractor.extract(parsed)
      log.info({ url, title: extracted.title }, 'WebFetchTool 抓取完成')

      // 构建元信息头
      const metaParts: string[] = [`标题: ${extracted.title}`]
      if (extracted.url) metaParts.push(`URL: ${extracted.url}`)
      if (extracted.siteName) metaParts.push(`来源: ${extracted.siteName}`)
      if (extracted.author) metaParts.push(`作者: ${extracted.author}`)
      if (extracted.publishedAt) metaParts.push(`发布时间: ${extracted.publishedAt}`)

      // 正文截断
      const originalLength = extracted.content.length
      let body = extracted.content
      if (originalLength > MAX_CONTENT_LENGTH) {
        body = extracted.content.slice(0, MAX_CONTENT_LENGTH)
        body += `\n\n（正文已截断，原文 ${originalLength} 字符）`
      }

      const content = `${metaParts.join('\n')}\n\n---\n\n${body}`
      return { content }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      log.error({ url, error: msg }, 'WebFetchTool 抓取失败')
      return { content: `网页抓取失败: ${msg}` }
    }
  }
}
