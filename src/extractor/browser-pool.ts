// 共享浏览器池 — 单例 Browser 供多个 extractor 复用
import { chromium, type Browser } from 'playwright'
import { createLogger } from '../utils/logger.js'

const log = createLogger('browser-pool')

/**
 * 共享浏览器池 — 单例 Browser 实例，通过 newContext() 区分使用场景
 */
export class BrowserPool {
  private browserPromise: Promise<Browser> | null = null
  private closed = false

  /** 获取共享 Browser 实例（懒初始化，并发安全） */
  async getBrowser(): Promise<Browser> {
    if (this.closed) throw new Error('BrowserPool 已关闭')
    if (!this.browserPromise) {
      this.browserPromise = chromium.launch({ headless: true })
        .then(browser => {
          log.info('共享浏览器已启动')
          return browser
        })
        .catch(err => {
          this.browserPromise = null  // 启动失败时重置，允许重试
          throw err
        })
    }
    return this.browserPromise
  }

  /** 关闭共享浏览器 */
  async close(): Promise<void> {
    this.closed = true
    if (this.browserPromise) {
      const browser = await this.browserPromise
      this.browserPromise = null
      await browser.close()
      log.info('共享浏览器已关闭')
    }
  }
}
