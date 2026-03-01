// 飞书卡片进度反馈响应器
import type { Client } from '@larksuiteoapi/node-sdk'
import type { Responder } from './base.js'
import type { PipelineContext } from '../types/index.js'
import { createLogger } from '../utils/logger.js'

const log = createLogger('feishu-responder')

/**
 * 飞书响应器 — 通过卡片消息反馈处理进度
 */
export class FeishuResponder implements Responder {
  private cardMessageId: string | null = null

  constructor(
    private client: Client,
    private chatId: string,
    _replyMessageId: string,
  ) {
    // replyMessageId 保留用于未来回复消息功能
    void _replyMessageId
  }

  /** 发送"处理中"卡片 */
  async sendProcessingCard(): Promise<void> {
    try {
      const resp = await this.client.im.v1.message.create({
        params: { receive_id_type: 'chat_id' },
        data: {
          receive_id: this.chatId,
          msg_type: 'interactive',
          content: JSON.stringify(this.buildCard('⏳ 处理中...', '正在接收消息', 'blue')),
        },
      })
      this.cardMessageId = resp.data?.message_id ?? null
    } catch (error) {
      log.warn({ error: String(error) }, '发送处理中卡片失败')
    }
  }

  async onProgress(_ctx: PipelineContext, message: string): Promise<void> {
    if (!this.cardMessageId) return
    try {
      await this.client.im.v1.message.patch({
        path: { message_id: this.cardMessageId },
        data: {
          content: JSON.stringify(this.buildCard('⏳ 处理中', message, 'blue')),
        },
      })
    } catch (error) {
      log.warn({ error: String(error) }, '更新进度卡片失败')
    }
  }

  async onComplete(ctx: PipelineContext): Promise<void> {
    if (!this.cardMessageId) return

    const isDraft = ctx.status === 'draft'
    const color = isDraft ? 'orange' : 'green'
    const icon = isDraft ? '⚠️' : '✅'
    const title = ctx.processed?.title ?? '处理完成'
    const summary = ctx.processed?.summary ?? ''
    const filePath = ctx.written?.filePath ?? ''

    const elements = [
      { tag: 'div', text: { tag: 'plain_text', content: summary } },
    ]

    if (filePath) {
      elements.push({
        tag: 'div',
        text: { tag: 'plain_text', content: `📁 ${filePath}` },
      })
    }

    if (isDraft) {
      elements.push({
        tag: 'div',
        text: { tag: 'plain_text', content: '⚠️ AI 处理失败，已保存为草稿' },
      })
    }

    try {
      await this.client.im.v1.message.patch({
        path: { message_id: this.cardMessageId },
        data: {
          content: JSON.stringify({
            config: { wide_screen_mode: true },
            header: {
              title: { tag: 'plain_text', content: `${icon} ${title}` },
              template: color,
            },
            elements,
          }),
        },
      })
    } catch (error) {
      log.warn({ error: String(error) }, '更新完成卡片失败')
    }
  }

  async onError(_ctx: PipelineContext, error: Error): Promise<void> {
    if (!this.cardMessageId) return
    try {
      await this.client.im.v1.message.patch({
        path: { message_id: this.cardMessageId },
        data: {
          content: JSON.stringify(
            this.buildCard('❌ 处理失败', error.message, 'red'),
          ),
        },
      })
    } catch (patchError) {
      log.warn({ error: String(patchError) }, '更新错误卡片失败')
    }
  }

  /** 构建简单卡片 */
  private buildCard(title: string, content: string, color: string) {
    return {
      config: { wide_screen_mode: true },
      header: {
        title: { tag: 'plain_text', content: title },
        template: color,
      },
      elements: [
        { tag: 'div', text: { tag: 'plain_text', content } },
      ],
    }
  }
}
