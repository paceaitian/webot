// 飞书 WSClient 适配器
import * as lark from '@larksuiteoapi/node-sdk'
import { BaseAdapter } from './base.js'
import { FeishuResponder } from '../responder/feishu.js'
import type { RawMessage, CommandType } from '../types/index.js'
import type { PipelineEngine } from '../pipeline/engine.js'
import { createLogger } from '../utils/logger.js'

const log = createLogger('feishu-adapter')

/**
 * 飞书适配器 — WebSocket 长连接接收消息 + 卡片回调
 */
export class FeishuAdapter extends BaseAdapter {
  private client: lark.Client
  private wsClient: lark.WSClient
  private digestHandler?: (onProgress: (msg: string) => void) => Promise<void>

  constructor(
    pipeline: PipelineEngine,
    appId: string,
    appSecret: string,
  ) {
    super(pipeline)

    this.client = new lark.Client({
      appId,
      appSecret,
      appType: lark.AppType.SelfBuild,
    })

    this.wsClient = new lark.WSClient({
      appId,
      appSecret,
      loggerLevel: lark.LoggerLevel.warn,
    })
  }

  async start(): Promise<void> {
    const eventDispatcher = new lark.EventDispatcher({}).register({
      'im.message.receive_v1': async (data) => {
        try {
          await this.handleMessage(data)
        } catch (error) {
          log.error({ error: String(error) }, '消息处理异常')
        }
      },
      // 新版卡片回调事件（飞书后台「事件与回调」→「卡片回调」→「长连接」）
      'card.action.trigger': async (data: unknown) => {
        try {
          await this.handleCardAction(data as unknown as Record<string, unknown>)
          return {
            toast: {
              type: 'success' as const,
              content: '操作已受理',
              i18n: { zh_cn: '操作已受理', en_us: 'Action accepted' },
            },
          }
        } catch (error) {
          log.error({ error: String(error) }, '卡片回调处理异常')
          return {
            toast: {
              type: 'error' as const,
              content: '处理失败',
              i18n: { zh_cn: '处理失败', en_us: 'Action failed' },
            },
          }
        }
      },
    })

    await this.wsClient.start({ eventDispatcher })

    log.info('飞书 WebSocket 已连接，等待消息...')
  }

  async stop(): Promise<void> {
    log.info('飞书适配器已停止')
  }

  /** 处理收到的飞书消息 */
  private async handleMessage(data: Record<string, unknown>): Promise<void> {
    const message = (data as { message?: Record<string, unknown> }).message
    if (!message) return

    const messageId = message.message_id as string
    const chatId = message.chat_id as string
    const msgType = message.message_type as string
    const contentStr = message.content as string

    log.info({ messageId, chatId, msgType }, '收到飞书消息')

    // 创建响应器（用于卡片进度反馈）
    const responder = new FeishuResponder(this.client, chatId, messageId)

    // 3 秒内发送处理中卡片（快速 ACK）
    await responder.sendProcessingCard()

    // 构造 RawMessage
    const raw = await this.buildRawMessage(messageId, msgType, contentStr)

    // #digest 指令拦截 — 不走常规管道
    if (raw.rawText.trim().toLowerCase().startsWith('#digest') && this.digestHandler) {
      await responder.onProgress({} as import('../types/index.js').PipelineContext, '正在生成每日简报...')
      const progressCb = (msg: string) => {
        responder.onProgress({} as import('../types/index.js').PipelineContext, msg).catch(() => {})
      }
      setImmediate(() => this.digestHandler!(progressCb))
      return
    }

    // 异步执行管道
    setImmediate(async () => {
      try {
        await this.pipeline.execute(raw, responder)
      } catch (error) {
        log.error({ messageId, error: String(error) }, '管道执行失败')
      }
    })
  }

  /** 从飞书消息构造 RawMessage */
  private async buildRawMessage(
    messageId: string,
    msgType: string,
    contentStr: string,
  ): Promise<RawMessage> {
    let rawText = ''
    let imageBuffer: Buffer | undefined
    let imageMimeType: string | undefined

    switch (msgType) {
      case 'text': {
        const parsed = JSON.parse(contentStr)
        rawText = parsed.text ?? ''
        // 群聊 @ 机器人时，文本前缀包含 @_user_N，需剥离
        rawText = rawText.replace(/@_user_\d+\s*/g, '').trim()
        break
      }
      case 'image': {
        const parsed = JSON.parse(contentStr)
        const imageKey = parsed.image_key as string
        if (imageKey) {
          try {
            const imgResp = await this.client.im.v1.messageResource.get({
              path: { message_id: messageId, file_key: imageKey },
              params: { type: 'image' },
            })
            const stream = imgResp.getReadableStream()
            if (stream) {
              const chunks: Buffer[] = []
              for await (const chunk of stream) {
                chunks.push(Buffer.from(chunk as Uint8Array))
              }
              imageBuffer = Buffer.concat(chunks)
              imageMimeType = 'image/jpeg'
            }
          } catch (imgError) {
            log.warn({ imageKey, error: String(imgError) }, '图片下载失败')
          }
        }
        break
      }
      case 'post': {
        // 富文本：遍历 post content 提取文本和链接
        rawText = this.extractPostContent(contentStr)
        break
      }
      default:
        rawText = contentStr
    }

    return {
      eventId: messageId,
      source: 'feishu',
      rawText,
      imageBuffer,
      imageMimeType,
      receivedAt: new Date(),
    }
  }

  /** 从富文本 post 中提取纯文本和链接 */
  private extractPostContent(contentStr: string): string {
    try {
      const parsed = JSON.parse(contentStr)
      const content = parsed.content as Array<Array<{ tag: string; text?: string; href?: string }>>
      if (!content) return ''

      const parts: string[] = []
      for (const line of content) {
        for (const node of line) {
          if (node.tag === 'text' && node.text) {
            parts.push(node.text)
          } else if (node.tag === 'a' && node.href) {
            parts.push(node.href)
            if (node.text) parts.push(node.text)
          }
        }
      }
      return parts.join(' ')
    } catch {
      return contentStr
    }
  }

  /** 处理卡片交互回调（按钮点击/overflow 选择/表单提交） */
  private async handleCardAction(data: Record<string, unknown>): Promise<void> {
    const action = data.action as {
      value?: Record<string, string>
      tag?: string
      option?: string         // overflow 选中项的 value 字符串
      form_value?: Record<string, string>
    } | undefined
    if (!action?.value) return

    const actionValue = action.value as Record<string, string>
    const jobId = actionValue.jobId
    let command = actionValue.command
    let mode: string | undefined = actionValue.mode

    // overflow 回调：command 和 mode 从 option 字符串解析（如 'discuss_replace'）
    if (!command && action.option && typeof action.option === 'string') {
      const sep = action.option.indexOf('_')
      command = sep > 0 ? action.option.slice(0, sep) : action.option
      mode = sep > 0 ? action.option.slice(sep + 1) : 'replace'
    }

    if (!jobId || !command) return

    // 新版回调 open_chat_id 在 context 中
    const context = data.context as { open_chat_id?: string; open_message_id?: string } | undefined
    const chatId = context?.open_chat_id ?? (data.open_chat_id as string) ?? ''
    log.info({ jobId, command, chatId, mode }, '收到卡片交互回调')

    // 表单兼容：从 form_value 获取 mode
    if (!mode && command === 'custom') {
      mode = action.form_value?.mode
    }
    mode = mode ?? 'replace'  // 旧卡片无 mode 字段时保持原行为

    // 获取用户自定义输入（表单提交时）
    const userInput = command === 'custom' ? action.form_value?.user_input : undefined

    // 创建响应器反馈进度
    const responder = new FeishuResponder(this.client, chatId, '')
    await responder.sendProcessingCard()

    // 异步执行二次处理
    setImmediate(async () => {
      try {
        await this.pipeline.reprocess(jobId, command as CommandType | 'custom', responder, {
          userInput,
          replaceOriginal: mode === 'replace',
        })
      } catch (error) {
        log.error({ jobId, command, error: String(error) }, '二次处理失败')
      }
    })
  }

  /** 设置 #digest 处理器（接收 onProgress 回调用于流式进度更新） */
  setDigestHandler(handler: (onProgress: (msg: string) => void) => Promise<void>): void {
    this.digestHandler = handler
  }

  /** 获取飞书客户端（供外部使用） */
  getClient(): lark.Client {
    return this.client
  }
}
