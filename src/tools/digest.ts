// DigestTool — 包装每日简报引擎，生成科技资讯简报并推送飞书 / 写入 Obsidian
import type { Tool, ToolResult, ToolContext } from './base.js'
import type { DigestEngine } from '../digest/index.js'
import type { PipelineContext } from '../types/index.js'
import { buildDigestCard, writeDigestToObsidian } from '../digest/reporter.js'
import { generateId } from '../utils/id.js'
import { createLogger } from '../utils/logger.js'

const log = createLogger('tool-digest')

/**
 * DigestTool — 生成每日科技简报
 *
 * 执行完整的采集 → 评分 → 分析流程，
 * 可选推送飞书卡片，写入 Obsidian Vault 存档。
 */
export class DigestTool implements Tool {
  name = 'digest'
  description =
    '生成每日科技简报。执行多源采集、AI 评分和深度分析，输出包含 30 秒速读、今日必读 Top 5、跨源关联等内容的完整简报。当用户要求生成简报、查看今日科技新闻汇总、或触发 #digest 指令时使用。'
  parameters = {
    type: 'object' as const,
    properties: {},
    required: [] as string[],
  }

  /** 执行锁：防止同一 chat 并发触发多次 digest */
  private runningChats = new Set<string>()

  constructor(
    private digestEngine: DigestEngine,
    private vaultPath: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private feishuClient?: any,
    private digestChatId?: string,
  ) {}

  /** 延迟注入飞书客户端（适配器启动后调用） */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  setFeishuClient(client: any, chatId: string): void {
    this.feishuClient = client
    this.digestChatId = chatId
  }

  /** 执行每日简报流程 */
  async execute(_params: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
    // 执行锁：同一 chatId 正在执行时跳过
    const lockKey = context.chatId ?? 'global'
    if (this.runningChats.has(lockKey)) {
      log.warn({ chatId: lockKey }, '简报正在执行中，跳过重复请求')
      return { content: '简报正在生成中，请稍候...' }
    }
    this.runningChats.add(lockKey)

    log.info('DigestTool 执行开始')

    // 构造一个最小 PipelineContext 用于 responder 进度推送
    const pseudoCtx: PipelineContext = {
      id: generateId(),
      raw: { eventId: generateId(), source: 'cli', rawText: '#digest', receivedAt: new Date() },
      source: 'cli',
      stage: 'respond',
      status: 'running',
      startedAt: new Date(),
    }

    // 将 responder 进度推送桥接到 DigestEngine 的 onProgress 回调
    const onProgress = (msg: string): void => {
      context.responder.onProgress(pseudoCtx, msg).catch((err: unknown) => {
        log.warn({ err: String(err) }, '进度推送失败')
      })
    }

    try {
      // 阶段 1：执行采集 → 评分 → 分析
      this.digestEngine.setOnProgress(onProgress)
      const digest = await this.digestEngine.run()

      const artifacts: Array<{ type: string; value: string }> = []

      // 阶段 2：推送飞书卡片（有 feishuClient + digestChatId 时）
      if (this.feishuClient && this.digestChatId) {
        try {
          const card = buildDigestCard(digest)
          const cardResp = await this.feishuClient.cardkit.v1.card.create({
            data: { type: 'card_json', data: JSON.stringify(card) },
          })
          const cardId = cardResp.data?.card_id
          if (cardId) {
            await this.feishuClient.im.v1.message.create({
              params: { receive_id_type: 'chat_id' },
              data: {
                receive_id: this.digestChatId,
                msg_type: 'interactive',
                content: JSON.stringify({ type: 'card', data: { card_id: cardId } }),
              },
            })
            artifacts.push({ type: 'card', value: cardId })
            log.info({ cardId }, '简报卡片已发送')
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          log.error({ err: msg }, '飞书卡片发送失败，继续写入 Obsidian')
        }
      } else {
        log.info('无飞书客户端配置，跳过卡片推送（CLI 模式）')
      }

      // 阶段 3：写入 Obsidian
      const filePath = await writeDigestToObsidian(digest, this.vaultPath)
      artifacts.push({ type: 'file', value: filePath })
      log.info({ filePath }, '简报已存档到 Obsidian')

      // 构建返回给 LLM 的摘要文本
      const summary = this.buildSummary(digest)

      return { content: summary, artifacts }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      log.error({ err: msg }, 'DigestTool 执行失败')
      return { content: `每日简报生成失败: ${msg}` }
    } finally {
      this.runningChats.delete(lockKey)
    }
  }

  /**
   * 构建返回给 LLM 的简报摘要文本
   * 包含速读、Top 5 标题、渠道统计
   */
  private buildSummary(digest: import('../digest/collectors/types.js').DailyDigestV2): string {
    const { date, groups, analysis, totalDuration } = digest
    const channelCount = groups.reduce((s, g) => s + g.channels.length, 0)
    const totalArticles = groups.reduce(
      (sum, g) => sum + g.channels.reduce((s, c) => s + c.items.length, 0),
      0,
    )
    const minutes = Math.round(totalDuration / 60_000)

    const lines: string[] = [
      `每日简报已生成 — ${date}`,
      `${channelCount} 渠道 | ${totalArticles} 条 | 耗时 ${minutes} 分钟`,
      '',
      '## 30 秒速读',
      analysis.quickRead || '暂无',
      '',
      '## 今日必读 Top 5',
    ]

    for (const [i, entry] of analysis.top5.entries()) {
      lines.push(`${i + 1}. ${entry.item.aiTitle ?? entry.item.title} — ${entry.item.source}`)
    }

    if (analysis.correlations) {
      lines.push('', '## 跨源关联', analysis.correlations)
    }

    return lines.join('\n')
  }
}
