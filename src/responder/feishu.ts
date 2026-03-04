// 飞书卡片进度反馈响应器
import { basename } from 'node:path'
import type { Client } from '@larksuiteoapi/node-sdk'
import type { Responder } from './base.js'
import type { PipelineContext } from '../types/index.js'
import { createLogger } from '../utils/logger.js'

const log = createLogger('feishu-responder')

/** 标签颜色轮转 */
const TAG_COLORS = ['blue', 'turquoise', 'green', 'purple', 'violet', 'carmine']

/** 从 URL 提取域名 */
function extractDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}

/** 模型名简化：claude-haiku-4-5-20251001 → Haiku */
function shortModelName(model: string): string {
  if (/haiku/i.test(model)) return 'Haiku'
  if (/opus/i.test(model)) return 'Opus'
  if (/sonnet/i.test(model)) return 'Sonnet'
  return model
}

/** 时间格式化：YYYY-MM-DD HH:mm */
function formatTime(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

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
          content: JSON.stringify(this.buildSimpleCard('处理中', '正在接收消息...', 'blue')),
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
          content: JSON.stringify(this.buildSimpleCard('处理中', message, 'blue')),
        },
      })
    } catch (error) {
      log.warn({ error: String(error) }, '更新进度卡片失败')
    }
  }

  async onComplete(ctx: PipelineContext): Promise<void> {
    if (!this.cardMessageId) return

    const card = ctx.status === 'draft'
      ? this.buildDraftCard(ctx)
      : this.buildCompleteCard(ctx)

    try {
      await this.client.im.v1.message.patch({
        path: { message_id: this.cardMessageId },
        data: { content: JSON.stringify(card) },
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
          content: JSON.stringify(this.buildSimpleCard('处理失败', this.friendlyError(error.message), 'red')),
        },
      })
    } catch (patchError) {
      log.warn({ error: String(patchError) }, '更新错误卡片失败')
    }
  }

  /** 构建完成卡片（富文本排版） */
  private buildCompleteCard(ctx: PipelineContext): Record<string, unknown> {
    const title = ctx.processed?.title ?? '处理完成'
    const summary = ctx.processed?.summary ?? ''
    const keyPoints = ctx.processed?.keyPoints ?? ''
    const tags = ctx.processed?.tags ?? []
    const model = ctx.processed?.model ?? ''
    const filePath = ctx.written?.filePath ?? ''
    const url = ctx.extracted?.url ?? ''
    const command = ctx.parsed?.command.type ?? 'save'
    const contentLength = ctx.extracted?.content?.length ?? 0

    // --- Header：标题 + 域名副标题 + 指令/模型标签 ---
    const domain = url ? extractDomain(url) : ''
    const textTagList: Record<string, unknown>[] = [
      { tag: 'text_tag', text: { tag: 'plain_text', content: command }, color: 'blue' },
    ]
    if (model) {
      textTagList.push({
        tag: 'text_tag',
        text: { tag: 'plain_text', content: shortModelName(model) },
        color: 'turquoise',
      })
    }

    const header: Record<string, unknown> = {
      title: { tag: 'plain_text', content: title },
      template: 'green',
      text_tag_list: textTagList,
    }
    if (domain) {
      header.subtitle = { tag: 'plain_text', content: domain }
    }

    // --- Body ---
    const elements: Record<string, unknown>[] = []

    // L0 summary（加粗）
    if (summary) {
      elements.push({ tag: 'markdown', content: `**${summary}**` })
    }

    // L1 keyPoints（截断 ≤500 字）
    if (keyPoints) {
      elements.push({ tag: 'hr' })
      let kp = keyPoints
      if (kp.length > 500) {
        kp = kp.slice(0, 500) + "\n\n<font color='grey'>...完整内容见笔记</font>"
      }
      elements.push({ tag: 'markdown', content: `**摘要**\n${kp}` })
    }

    // Tags + filename（双栏布局）
    if (tags.length > 0 || filePath) {
      elements.push({ tag: 'hr' })
      const columns: Record<string, unknown>[] = []

      if (tags.length > 0) {
        const tagStr = tags.map((t, i) =>
          `<text_tag color='${TAG_COLORS[i % TAG_COLORS.length]}'>${t}</text_tag>`,
        ).join(' ')
        columns.push({
          tag: 'column', width: 'weighted', weight: 1,
          elements: [{ tag: 'markdown', content: tagStr }],
        })
      }

      if (filePath) {
        columns.push({
          tag: 'column', width: 'weighted', weight: 1,
          elements: [{
            tag: 'markdown',
            text_align: 'right',
            content: `<font color='grey'>${basename(filePath)}</font>`,
          }],
        })
      }

      elements.push({ tag: 'column_set', flex_mode: 'none', columns })
    }

    // 交互按钮（v2 schema，自适应宽度）
    if (ctx.jobId) {
      const jobId = ctx.jobId
      // 第一行：新建模式
      elements.push({
        tag: 'column_set',
        flex_mode: 'none',
        columns: [
          {
            tag: 'column', width: 'auto',
            elements: [{
              tag: 'button',
              text: { tag: 'plain_text', content: '深度分析' },
              type: 'primary',
              size: 'small',
              width: 'default',
              value: { jobId, command: 'discuss', mode: 'new' },
              confirm: {
                title: { tag: 'plain_text', content: '确认深度分析' },
                text: { tag: 'plain_text', content: '将使用 Opus 模型，耗时约 1-2 分钟。确认？' },
              },
            }],
          },
          {
            tag: 'column', width: 'auto',
            elements: [{
              tag: 'button',
              text: { tag: 'plain_text', content: '提取金句' },
              type: 'primary',
              size: 'small',
              width: 'default',
              value: { jobId, command: 'quote', mode: 'new' },
            }],
          },
        ],
      })
      // 第二行：替换模式
      elements.push({ tag: 'markdown', content: "<font color='grey'>以下将替换原笔记</font>" })
      elements.push({
        tag: 'column_set',
        flex_mode: 'none',
        columns: [
          {
            tag: 'column', width: 'auto',
            elements: [{
              tag: 'button',
              text: { tag: 'plain_text', content: '分析(替换)' },
              type: 'primary',
              size: 'small',
              width: 'default',
              value: { jobId, command: 'discuss', mode: 'replace' },
              confirm: {
                title: { tag: 'plain_text', content: '确认替换' },
                text: { tag: 'plain_text', content: '将使用 Opus 模型并替换原笔记。确认？' },
              },
            }],
          },
          {
            tag: 'column', width: 'auto',
            elements: [{
              tag: 'button',
              text: { tag: 'plain_text', content: '金句(替换)' },
              type: 'primary',
              size: 'small',
              width: 'default',
              value: { jobId, command: 'quote', mode: 'replace' },
            }],
          },
        ],
      })
      // 自定义分析表单（v2 form 组件）
      elements.push({
        tag: 'form',
        name: 'custom_form',
        elements: [
          {
            tag: 'column_set',
            flex_mode: 'none',
            columns: [
              {
                tag: 'column', width: 'auto',
                elements: [{
                  tag: 'select_static',
                  name: 'mode',
                  placeholder: { tag: 'plain_text', content: '默认：新建笔记' },
                  options: [
                    { text: { tag: 'plain_text', content: '新建笔记' }, value: 'new' },
                    { text: { tag: 'plain_text', content: '替换原笔记' }, value: 'replace' },
                  ],
                }],
              },
              {
                tag: 'column', width: 'weighted', weight: 1,
                elements: [{
                  tag: 'input',
                  name: 'user_input',
                  placeholder: { tag: 'plain_text', content: '输入自定义分析指令...' },
                }],
              },
              {
                tag: 'column', width: 'auto',
                elements: [{
                  tag: 'button',
                  text: { tag: 'plain_text', content: '发送' },
                  type: 'primary',
                  size: 'small',
                  width: 'default',
                  action_type: 'form_submit',
                  name: 'submit',
                  value: { jobId, command: 'custom' },
                }],
              },
            ],
          },
        ],
      })
    }

    // 底部 note：字数 · 模型 · 时间
    const noteParts: string[] = []
    if (contentLength > 0) noteParts.push(`${contentLength}字`)
    if (model) noteParts.push(shortModelName(model))
    noteParts.push(formatTime(ctx.completedAt ?? new Date()))
    elements.push({
      tag: 'markdown',
      content: `<font color='grey'>${noteParts.join(' · ')}</font>`,
    })

    return { schema: '2.0', header, body: { elements } }
  }

  /** 构建草稿卡片 */
  private buildDraftCard(ctx: PipelineContext): Record<string, unknown> {
    const title = ctx.processed?.title ?? '处理完成'

    const header: Record<string, unknown> = {
      title: { tag: 'plain_text', content: title },
      template: 'orange',
      text_tag_list: [
        { tag: 'text_tag', text: { tag: 'plain_text', content: '草稿' }, color: 'orange' },
      ],
    }

    const elements: Record<string, unknown>[] = [
      { tag: 'markdown', content: 'AI 处理失败，已保存为草稿' },
    ]

    if (ctx.jobId) {
      elements.push({
        tag: 'column_set',
        flex_mode: 'none',
        columns: [
          {
            tag: 'column', width: 'auto',
            elements: [{
              tag: 'button',
              text: { tag: 'plain_text', content: '重新处理' },
              type: 'primary',
              size: 'small',
              width: 'default',
              value: { jobId: ctx.jobId, command: 'save', mode: 'replace' },
            }],
          },
          {
            tag: 'column', width: 'auto',
            elements: [{
              tag: 'button',
              text: { tag: 'plain_text', content: '深度分析' },
              type: 'primary',
              size: 'small',
              width: 'default',
              value: { jobId: ctx.jobId, command: 'discuss', mode: 'replace' },
              confirm: {
                title: { tag: 'plain_text', content: '确认深度分析' },
                text: { tag: 'plain_text', content: '将使用 Opus 模型，耗时约 1-2 分钟。确认？' },
              },
            }],
          },
        ],
      })
    }

    return { schema: '2.0', header, body: { elements } }
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

  /** 构建简单卡片（处理中/错误，v2 schema） */
  private buildSimpleCard(title: string, content: string, color: string) {
    return {
      schema: '2.0',
      header: {
        title: { tag: 'plain_text', content: title },
        template: color,
      },
      body: {
        elements: [
          { tag: 'markdown', content },
        ],
      },
    }
  }
}
