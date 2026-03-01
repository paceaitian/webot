// Playwright 通用浏览器抓取器
import { chromium, type Browser } from 'playwright'
import type { ExtractedContent } from '../types/index.js'
import { createLogger } from '../utils/logger.js'

const log = createLogger('playwright')

/**
 * Playwright 抓取器 — 单例 Browser + 按需 Context
 */
export class PlaywrightExtractor {
  private browser: Browser | null = null

  /** 初始化浏览器实例 */
  async init(): Promise<void> {
    if (this.browser) return
    this.browser = await chromium.launch({ headless: true })
    log.info('Playwright 浏览器已启动')
  }

  /** 关闭浏览器 */
  async close(): Promise<void> {
    if (this.browser) {
      await this.browser.close()
      this.browser = null
      log.info('Playwright 浏览器已关闭')
    }
  }

  /** 抓取通用网页 */
  async extract(url: string): Promise<ExtractedContent> {
    await this.init()
    const context = await this.browser!.newContext()

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
