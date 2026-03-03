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

    const elements: Record<string, unknown>[] = [
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

    // 非草稿 + 有 jobId + 非二次处理时添加交互按钮
    if (!isDraft && ctx.jobId && !ctx.isReprocess) {
      const jobId = ctx.jobId

      // 分隔线
      elements.push({ tag: 'hr' })

      // 操作按钮组
      elements.push({
        tag: 'action',
        actions: [
          {
            tag: 'button',
            text: { tag: 'plain_text', content: '🔍 深度分析' },
            type: 'primary',
            value: { jobId, command: 'discuss' },
          },
          {
            tag: 'button',
            text: { tag: 'plain_text', content: '💎 提取金句' },
            type: 'default',
            value: { jobId, command: 'quote' },
          },
        ],
      })

      // 自定义需求表单（tag 必须是 "form"，非 "form_container"）
      elements.push({
        tag: 'form',
        name: 'custom_request',
        elements: [
          {
            tag: 'input',
            name: 'user_input',
            placeholder: { tag: 'plain_text', content: '输入自定义处理需求...' },
            label: { tag: 'plain_text', content: '自定义需求' },
            label_position: 'top',
            max_length: 200,
          },
          {
            tag: 'button',
            text: { tag: 'plain_text', content: '发送' },
            type: 'primary',
            action_type: 'form_submit',
            name: 'submit_custom',
            value: { jobId, command: 'custom' },
          },
        ],
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
