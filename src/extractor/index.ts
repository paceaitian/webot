// 内容抓取路由 — 微信/通用/降级
import type { ParsedMessage, ExtractedContent } from '../types/index.js'
import type { Extractor } from '../pipeline/engine.js'
import { isWechatUrl } from '../parser/message-parser.js'
import { extractWithReadability } from './readability.js'
import { PlaywrightExtractor } from './playwright.js'
import { WechatExtractor } from './wechat.js'
import { createLogger } from '../utils/logger.js'

const log = createLogger('extractor')

/**
 * 内容抓取路由器
 * - mp.weixin.qq.com → WechatExtractor
 * - 其他 URL → Readability 优先 → 失败降级 Playwright
 */
export class ContentExtractor implements Extractor {
  private playwrightExtractor = new PlaywrightExtractor()
  private wechatExtractor = new WechatExtractor()
  private attachmentDir?: string

  constructor(attachmentDir?: string) {
    this.attachmentDir = attachmentDir
  }

  /** 初始化浏览器实例 */
  async init(): Promise<void> {
    // 懒初始化，按需启动浏览器
  }

  /** 关闭所有浏览器 */
  async close(): Promise<void> {
    await this.playwrightExtractor.close()
    await this.wechatExtractor.close()
  }

  /**
   * 根据 URL 类型路由到对应抓取器
   */
  async extract(parsed: ParsedMessage): Promise<ExtractedContent> {
    const content = parsed.content
    if (content.type !== 'url' && content.type !== 'mixed') {
      throw new Error(`Extractor 不处理 ${content.type} 类型内容`)
    }

    const url = content.url
    const start = Date.now()

    // 微信公众号专用路径
    if (isWechatUrl(url)) {
      log.info({ url }, '使用微信专用抓取器')
      const result = await this.wechatExtractor.extract(url, this.attachmentDir)
      log.info({ url, duration: Date.now() - start, extractor: 'wechat' }, '抓取完成')
      return result
    }

    // 通用路径：Readability 优先
    try {
      log.info({ url }, '尝试 Readability 提取')
      const result = await extractWithReadability(url)
      log.info({ url, duration: Date.now() - start, extractor: 'readability' }, '抓取完成')
      return result
    } catch (readabilityError) {
      log.warn({ url, error: String(readabilityError) }, 'Readability 失败，降级到 Playwright')
      const result = await this.playwrightExtractor.extract(url)
      log.info({ url, duration: Date.now() - start, extractor: 'playwright' }, '抓取完成（降级）')
      return result
    }
  }
}
