// Playwright 通用浏览器抓取器
import type { ExtractedContent } from '../types/index.js'
import type { BrowserPool } from './browser-pool.js'
import { createLogger } from '../utils/logger.js'

const log = createLogger('playwright')

/**
 * Playwright 抓取器 — 使用共享 BrowserPool
 */
export class PlaywrightExtractor {
  constructor(private pool: BrowserPool) {}

  /** 抓取通用网页 */
  async extract(url: string): Promise<ExtractedContent> {
    const browser = await this.pool.getBrowser()
    const context = await browser.newContext()

    try {
      const page = await context.newPage()
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 })

      const title = await page.title()
      const content = await page.evaluate(() => {
        // 移除脚本、样式等干扰元素
        const removeSelectors = ['script', 'style', 'nav', 'header', 'footer', 'iframe']
        for (const sel of removeSelectors) {
          document.querySelectorAll(sel).forEach(el => el.remove())
        }
        // 取 body 文本
        return document.body?.innerText ?? ''
      })

      log.info({ url, title, length: content.length }, 'Playwright 抓取成功')

      return {
        title: title || url,
        content,
        url,
        contentType: 'article',
      }
    } finally {
      await context.close()
    }
  }
}
