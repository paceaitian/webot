// 指数退避重试工具
import { createLogger } from './logger.js'

const log = createLogger('retry')

export interface RetryOptions {
  /** 最大重试次数（默认 3） */
  maxRetries?: number
  /** 基础延迟毫秒（默认 1000） */
  baseDelay?: number
  /** 延迟倍数（默认 2） */
  multiplier?: number
  /** 可重试的错误判断函数 */
  retryable?: (error: unknown) => boolean
}

/**
 * 指数退避重试执行器
 * 失败时等待 baseDelay * multiplier^attempt 毫秒后重试
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const {
    maxRetries = 3,
    baseDelay = 1000,
    multiplier = 2,
    retryable = () => true,
  } = options

  let lastError: unknown

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn()
    } catch (error) {
      lastError = error

      if (attempt >= maxRetries || !retryable(error)) {
        throw error
      }

      const delay = baseDelay * Math.pow(multiplier, attempt)
      log.warn({ attempt: attempt + 1, maxRetries, delay, error: String(error) }, '重试中...')
      await new Promise((resolve) => setTimeout(resolve, delay))
    }
  }

  throw lastError
}
