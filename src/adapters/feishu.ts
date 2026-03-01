// 飞书 WSClient 适配器
import * as lark from '@larksuiteoapi/node-sdk'
import { BaseAdapter } from './base.js'
import { FeishuResponder } from '../responder/feishu.js'
import type { RawMessage } from '../types/index.js'
import type { PipelineEngine } from '../pipeline/engine.js'
import { createLogger } from '../utils/logger.js'

const log = createLogger('feishu-adapter')

/**
 * 飞书适配器 — WebSocket 长连接接收消息
 */
export class FeishuAdapter extends BaseAdapter {
  private client: lark.Client
  private wsClient: lark.WSClient

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
    // 注册消息事件处理
    this.wsClient.start({
      eventDispatcher: new lark.EventDispatcher({}).register({
        'im.message.receive_v1': async (data) => {
          try {
            await this.handleMessage(data)
          } catch (error) {
            log.error({ error: String(error) }, '消息处理异常')
          }
        },
      }),
    })

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

  /** 获取飞书客户端（供外部使用） */
  getClient(): lark.Client {
    return this.client
  }
}
