// 飞书卡片进度反馈响应器
import { basename } from 'node:path'
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

    // U5: tags 展示
    const tags = ctx.processed?.tags
    if (tags && tags.length > 0) {
      elements.push({
        tag: 'div',
        text: { tag: 'plain_text', content: `🏷️ ${tags.join(' · ')}` },
      })
    }

    // U4: 路径脱敏（只显示文件名）
    if (filePath) {
      elements.push({
        tag: 'div',
        text: { tag: 'plain_text', content: `📁 ${basename(filePath)}` },
      })
    }

    if (isDraft) {
      elements.push({
        tag: 'div',
        text: { tag: 'plain_text', content: '⚠️ AI 处理失败，已保存为草稿' },
      })

      // U9: 草稿卡片添加重新处理按钮
      if (ctx.jobId) {
        elements.push({ tag: 'hr' })
        elements.push({
          tag: 'action',
          actions: [
            {
              tag: 'button',
              text: { tag: 'plain_text', content: '🔄 重新处理' },
              type: 'primary',
              value: { jobId: ctx.jobId, command: 'save', mode: 'replace' },
            },
            {
              tag: 'button',
              text: { tag: 'plain_text', content: '🔍 深度分析' },
              type: 'default',
              value: { jobId: ctx.jobId, command: 'discuss', mode: 'replace' },
              confirm: {
                title: { tag: 'plain_text', content: '确认深度分析' },
                text: { tag: 'plain_text', content: '将使用 Opus 模型，耗时约 1-2 分钟。确认？' },
              },
            },
          ],
        })
      }
    }

    // 非草稿 + 有 jobId 时添加交互按钮（reprocess 结果也显示，允许链式操作）
    if (!isDraft && ctx.jobId) {
      const jobId = ctx.jobId

      // 分隔线
      elements.push({ tag: 'hr' })

      // 第一行：新建笔记（默认）
      elements.push({
        tag: 'action',
        actions: [
          {
            tag: 'button',
            text: { tag: 'plain_text', content: '🔍 深度分析' },
            type: 'primary',
            value: { jobId, command: 'discuss', mode: 'new' },
            confirm: {
              title: { tag: 'plain_text', content: '确认深度分析' },
              text: { tag: 'plain_text', content: '将使用 Opus 模型，耗时约 1-2 分钟。确认？' },
            },
          },
          {
            tag: 'button',
            text: { tag: 'plain_text', content: '💎 提取金句' },
            type: 'default',
            value: { jobId, command: 'quote', mode: 'new' },
          },
        ],
      })

      // 提示文字
      elements.push({
        tag: 'div',
        text: { tag: 'plain_text', content: '⚠️ 以下操作将替换原笔记：' },
      })

      // 第二行：替换原笔记
      elements.push({
        tag: 'action',
        actions: [
          {
            tag: 'button',
            text: { tag: 'plain_text', content: '🔄 分析(替换)' },
            type: 'default',
            value: { jobId, command: 'discuss', mode: 'replace' },
            confirm: {
              title: { tag: 'plain_text', content: '确认替换' },
              text: { tag: 'plain_text', content: '将使用 Opus 模型深度分析，并替换原笔记。确认？' },
            },
          },
          {
            tag: 'button',
            text: { tag: 'plain_text', content: '🔄 金句(替换)' },
            type: 'default',
            value: { jobId, command: 'quote', mode: 'replace' },
            confirm: {
              title: { tag: 'plain_text', content: '确认替换' },
              text: { tag: 'plain_text', content: '将提取金句，并替换原笔记。确认？' },
            },
          },
        ],
      })

      // 自定义需求表单（含模式选择）
      elements.push({
        tag: 'form',
        name: 'custom_request',
        elements: [
          {
            tag: 'select_static',
            name: 'mode',
            placeholder: { tag: 'plain_text', content: '默认：新建笔记' },
            options: [
              { text: { tag: 'plain_text', content: '新建笔记' }, value: 'new' },
              { text: { tag: 'plain_text', content: '替换原笔记' }, value: 'replace' },
            ],
          },
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
            this.buildCard('❌ 处理失败', this.friendlyError(error.message), 'red'),
          ),
        },
      })
    } catch (patchError) {
      log.warn({ error: String(patchError) }, '更新错误卡片失败')
    }
  }

  /** U2: 技术错误 → 友好提示 */
  private friendlyError(msg: string): string {
    const map: Array<[RegExp, string]> = [
      [/net::ERR_NAME_NOT_RESOLVED/i, '网页地址无法解析，请检查链接是否正确'],
      [/net::ERR_CONNECTION_REFUSED/i, '目标网站拒绝连接'],
      [/net::ERR_TIMED_OUT|ETIMEDOUT|timeout/i, '请求超时，稍后将自动重试'],
      [/ENOTFOUND/i, '域名无法解析，请检查链接'],
      [/\b529\b|overloaded/i, 'AI 服务繁忙，稍后将自动重试'],
      [/rate.?limit|429/i, 'AI 请求频率超限，稍后将自动重试'],
      [/\b5\d{2}\b|internal.?server/i, '服务器内部错误，稍后将自动重试'],
    ]
    for (const [re, friendly] of map) {
      if (re.test(msg)) return friendly
    }
    return msg
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
