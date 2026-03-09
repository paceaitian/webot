// 上下文管理器 — 滑动窗口 + 压缩 + 超时切分
import type { SessionRepo, SessionMessage } from '../db/repositories/session-repo.js'
import type { MemoryRepo } from '../db/repositories/memory-repo.js'
import { createLogger } from '../utils/logger.js'

const log = createLogger('context-manager')

/** 上下文管理配置 */
export interface ContextManagerConfig {
  /** 发给 LLM 的最大消息数 */
  maxContextMessages: number
  /** 触发压缩的消息总数 */
  compressThreshold: number
  /** 超时切分阈值（毫秒） */
  sessionTimeoutMs: number
}

/**
 * 上下文管理器 — 负责会话消息的滑动窗口截取、超时切分、自动压缩
 */
export class ContextManager {
  private config: ContextManagerConfig

  constructor(
    private sessionRepo: SessionRepo,
    private memoryRepo: MemoryRepo,
    private compressFn: (messages: SessionMessage[]) => Promise<string>,
    config?: Partial<ContextManagerConfig>,
  ) {
    this.config = {
      maxContextMessages: config?.maxContextMessages ?? 20,
      compressThreshold: config?.compressThreshold ?? 30,
      sessionTimeoutMs: config?.sessionTimeoutMs ?? 2 * 60 * 60 * 1000,
    }
  }

  /**
   * 获取要发给 LLM 的消息（超时切分 + 滑动窗口）
   */
  async getContextMessages(sessionId: string, userId: string): Promise<SessionMessage[]> {
    const messages = this.sessionRepo.getHistory(sessionId)
    if (messages.length === 0) return []

    // 1. 检查超时切分：最后一条消息距今 > sessionTimeoutMs
    const lastMsg = messages[messages.length - 1]
    if (lastMsg.timestamp) {
      const elapsed = Date.now() - new Date(lastMsg.timestamp).getTime()
      if (elapsed > this.config.sessionTimeoutMs) {
        await this.handleSessionTimeout(sessionId, userId, messages)
        // 超时后 session 已清空，返回空
        return []
      }
    }

    // 2. 返回最近 maxContextMessages 条（保留头部 system_summary）
    return this.getRecentWithSummary(messages)
  }

  /**
   * 如果消息总数超过阈值，压缩旧消息
   */
  async compressIfNeeded(sessionId: string, userId: string): Promise<void> {
    const messages = this.sessionRepo.getHistory(sessionId)
    if (messages.length <= this.config.compressThreshold) return

    // 保留最近 maxContextMessages/2 条不压缩（至少 10 条）
    const keepCount = Math.max(10, Math.floor(this.config.maxContextMessages / 2))
    const toCompress = messages.slice(0, messages.length - keepCount)
    const toKeep = messages.slice(messages.length - keepCount)

    if (toCompress.length === 0) return

    // 调用压缩函数生成摘要
    const summary = await this.compressFn(toCompress)

    // 构建新的消息列表：1 条 summary + 保留的消息
    const summaryMessage: SessionMessage = {
      role: 'system_summary',
      content: summary,
      timestamp: new Date().toISOString(),
    }

    const newMessages = [summaryMessage, ...toKeep]
    this.sessionRepo.replaceMessages(sessionId, newMessages)

    // 存入长期记忆
    this.memoryRepo.save({
      userId,
      chatId: null,
      type: 'summary',
      content: summary,
    })

    log.info({ sessionId, compressed: toCompress.length, kept: toKeep.length }, '会话已压缩')
  }

  /** 超时处理：全部消息压缩为摘要 → 存入记忆 → 清空 session */
  private async handleSessionTimeout(
    sessionId: string,
    userId: string,
    messages: SessionMessage[],
  ): Promise<void> {
    // 过滤掉旧的 system_summary，只压缩实际对话
    const conversationMsgs = messages.filter(m => m.role !== 'system_summary')
    if (conversationMsgs.length > 0) {
      const summary = await this.compressFn(conversationMsgs)
      this.memoryRepo.save({
        userId,
        chatId: null,
        type: 'summary',
        content: summary,
      })
    }
    this.sessionRepo.clear(sessionId)
    log.info({ sessionId }, '会话超时，已归档并清空')
  }

  /** 从消息列表中取最近 N 条，保留头部 system_summary */
  private getRecentWithSummary(messages: SessionMessage[]): SessionMessage[] {
    if (messages.length <= this.config.maxContextMessages) {
      return messages
    }
    // 检查头部是否有 system_summary
    const hasSummary = messages[0]?.role === 'system_summary'
    if (hasSummary) {
      const recent = messages.slice(-(this.config.maxContextMessages - 1))
      return [messages[0], ...recent]
    }
    return messages.slice(-this.config.maxContextMessages)
  }
}
