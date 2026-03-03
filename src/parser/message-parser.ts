// 消息解析器 — 指令解析 + URL 提取 + 内容分类
import type { RawMessage, MessageContent, Command, CommandType, ParsedMessage } from '../types/index.js'

/** 指令正则：仅匹配 #save / #discuss / #quote 关键词 */
const COMMAND_KEYWORD_REGEX = /^#(save|discuss|quote)\b/i

/** 指令参数正则：匹配指令后的非 URL 文本参数 */
const COMMAND_ARGS_REGEX = /^#(?:save|discuss|quote)\s+((?:(?!https?:\/\/).)+)/i

/** URL 正则：匹配 http/https 链接 */
const URL_REGEX = /https?:\/\/[^\s<>"{}|\\^`\[\]]+/gi

/** 微信链接检测 */
const WECHAT_URL_REGEX = /mp\.weixin\.qq\.com/i

/**
 * 解析原始消息，提取指令、URL 和内容
 */
export function parseMessage(raw: RawMessage): ParsedMessage {
  const text = raw.rawText.trim()

  // 解析指令
  let command = parseCommand(text)

  // 移除指令部分，获取剩余文本
  const textWithoutCommand = removeCommand(text)

  // 解析内容类型
  const content = parseContent(raw, textWithoutCommand)

  // URL/mixed 内容无显式指令时，默认走 #save 摘要
  if (command.type === 'none' && (content.type === 'url' || content.type === 'mixed')) {
    command.type = 'save'
  }

  return { raw, command, content }
}

/**
 * 从文本中解析指令
 */
export function parseCommand(text: string): Command {
  const match = text.match(COMMAND_KEYWORD_REGEX)
  if (!match) {
    return { type: 'none' }
  }

  const type = match[1].toLowerCase() as CommandType
  const argsMatch = text.match(COMMAND_ARGS_REGEX)
  const args = argsMatch?.[1]?.trim() || undefined

  return { type, args }
}

/**
 * 移除文本中的指令部分
 */
function removeCommand(text: string): string {
  return text.replace(COMMAND_KEYWORD_REGEX, '').trim()
}

/**
 * 解析消息内容类型
 */
function parseContent(raw: RawMessage, text: string): MessageContent {
  // 图片消息
  if (raw.imageBuffer) {
    return {
      type: 'image',
      imageBuffer: raw.imageBuffer,
      mimeType: raw.imageMimeType ?? 'image/jpeg',
      text: text || undefined,
    }
  }

  // 提取 URL
  const urls = extractUrls(text)

  if (urls.length === 0) {
    // 纯文本
    return { type: 'text', text }
  }

  // 移除 URL 后的剩余文本
  const textWithoutUrls = text.replace(URL_REGEX, '').trim()

  if (textWithoutUrls.length > 0) {
    // URL + 文本 = 混合
    return { type: 'mixed', url: urls[0], text: textWithoutUrls }
  }

  // 纯 URL
  return { type: 'url', url: urls[0] }
}

/**
 * 从文本中提取所有 URL
 */
export function extractUrls(text: string): string[] {
  return text.match(URL_REGEX) ?? []
}

/**
 * 判断 URL 是否为微信公众号链接
 */
export function isWechatUrl(url: string): boolean {
  return WECHAT_URL_REGEX.test(url)
}
