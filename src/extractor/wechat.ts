// 微信公众号专用抓取器
import type { ExtractedContent } from '../types/index.js'
import type { BrowserPool } from './browser-pool.js'
import { createLogger } from '../utils/logger.js'

const log = createLogger('wechat')

/** 微信 User-Agent */
const WECHAT_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 MicroMessenger/7.0.20.1781'

/**
 * 微信公众号专用抓取器
 * 处理 JS 渲染、懒加载图片、元数据提取
 */
export class WechatExtractor {
  constructor(private pool: BrowserPool) {}

  /**
   * 抓取微信公众号文章
   */
  async extract(url: string): Promise<ExtractedContent> {
    const browser = await this.pool.getBrowser()
    const context = await browser.newContext({
      userAgent: WECHAT_UA,
    })

    try {
      const page = await context.newPage()
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 })

      // 等待文章内容加载
      await page.waitForSelector('#js_content', { timeout: 10_000 }).catch(() => {
        log.warn('未找到 #js_content，文章可能已删除或下架')
      })

      // 强制显示内容（微信有时隐藏）
      await page.evaluate(() => {
        const content = document.getElementById('js_content')
        if (content) {
          content.style.visibility = 'visible'
          content.style.display = 'block'
        }
      })

      // 自动滚动触发懒加载
      await autoScroll(page)

      // 提取元数据
      const metadata = await page.evaluate(() => {
        const title = document.getElementById('activity-name')?.textContent?.trim() ?? ''
        const author = document.getElementById('js_name')?.textContent?.trim() ?? ''
        const publishTime = document.getElementById('publish_time')?.textContent?.trim() ?? ''

        // 检查文章有效性
        const pageContent = document.body?.innerText ?? ''
        const isDeleted = pageContent.includes('该内容已被发布者删除')
          || pageContent.includes('此内容因违规无法查看')
          || pageContent.includes('该公众号已被封禁')

        return { title, author, publishTime, isDeleted }
      })

      if (metadata.isDeleted) {
        throw new Error('微信文章已删除或下架')
      }

      // 提取正文
      const content = await page.evaluate(() => {
        const el = document.getElementById('js_content')
        return el?.innerText ?? ''
      })

      log.info({
        url,
        title: metadata.title,
        author: metadata.author,
      }, '微信文章提取成功')

      return {
        title: metadata.title || url,
        content,
        url,
        author: metadata.author || undefined,
        publishedAt: metadata.publishTime || undefined,
        siteName: metadata.author || '微信公众号',
        contentType: 'article',
      }
    } finally {
      await context.close()
    }
  }
}

/** 自动滚动页面触发懒加载 */
async function autoScroll(page: import('playwright').Page): Promise<void> {
  await page.evaluate(async () => {
    await new Promise<void>((resolve) => {
      let totalHeight = 0
      const distance = 300
      const timer = setInterval(() => {
        window.scrollBy(0, distance)
        totalHeight += distance
        if (totalHeight >= document.body.scrollHeight) {
          clearInterval(timer)
          resolve()
        }
      }, 100)
      // 最多滚动 5 秒
      setTimeout(() => { clearInterval(timer); resolve() }, 5000)
    })
  })
}
