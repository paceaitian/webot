// 消息相关类型定义

/** 消息来源 */
export type MessageSource = 'feishu' | 'cli'

/** 消息内容类型 */
export type ContentType = 'text' | 'url' | 'image' | 'mixed'

/** 消息内容 — 文本 */
export interface TextContent {
  type: 'text'
  text: string
}

/** 消息内容 — URL */
export interface UrlContent {
  type: 'url'
  url: string
  /** URL 附带的文本描述 */
  text?: string
}

/** 消息内容 — 图片 */
export interface ImageContent {
  type: 'image'
  /** 图片 Buffer（飞书下载后） */
  imageBuffer: Buffer
  /** 图片 MIME 类型 */
  mimeType: string
  /** 图片附带的文本描述 */
  text?: string
}

/** 消息内容 — 混合（URL + 文本） */
export interface MixedContent {
  type: 'mixed'
  url: string
  text: string
}

/** 消息内容联合类型 */
export type MessageContent = TextContent | UrlContent | ImageContent | MixedContent

/** 原始消息（适配器输出） */
export interface RawMessage {
  /** 消息唯一 ID（飞书 message_id 或 CLI 生成） */
  eventId: string
  /** 消息来源 */
  source: MessageSource
  /** 原始文本 */
  rawText: string
  /** 图片数据（可选） */
  imageBuffer?: Buffer
  /** 图片 MIME 类型 */
  imageMimeType?: string
  /** 接收时间 */
  receivedAt: Date
}
