// AI Processor 路由 — 按 command 分发到 ClaudeClient 对应方法
import type { ParsedMessage, ExtractedContent, ProcessedResult } from '../types/index.js'
import type { Processor } from '../pipeline/engine.js'
import { ClaudeClient } from './claude-client.js'
import { createLogger } from '../utils/logger.js'

const log = createLogger('processor')

/**
 * AI 处理器 — 根据指令类型分发到对应 Claude 方法
 */
export class AIProcessor implements Processor {
  private claude: ClaudeClient

  constructor(apiKey: string, baseUrl?: string, model?: string) {
    this.claude = new ClaudeClient(apiKey, baseUrl, model)
  }

  /** 获取 ClaudeClient 实例（供 DigestEngine 使用） */
  getClaudeClient(): ClaudeClient {
    return this.claude
  }

  async process(parsed: ParsedMessage, extracted: ExtractedContent, onProgress?: (message: string) => void): Promise<ProcessedResult> {
    const { command, content } = parsed

    log.info({ command: command.type, contentType: extracted.contentType }, 'AI 处理开始')

    // 图片类型走 Vision
    if (content.type === 'image') {
      const result = await this.claude.describeImage(
        content.imageBuffer,
        content.mimeType,
        content.text,
      )
      return {
        title: result.title,
        summary: result.summary,
        keyPoints: result.key_points,
        tags: result.tags,
        content: result.content,
        model: result.model,
        isDraft: false,
      }
    }

    // 根据指令类型分发
    const contentText = extracted.content
    let result

    // S3: 长文截断（避免 Opus 成本失控）
    const maxLen = command.type === 'discuss' ? 40_000 : 20_000
    const truncatedText = contentText.length > maxLen
      ? contentText.slice(0, maxLen) + '\n\n[... 内容已截断]'
      : contentText

    switch (command.type) {
      case 'save':
        result = await this.claude.summarize(truncatedText, command.args)
        break
      case 'discuss':
        result = await this.claude.discuss(truncatedText, command.args, onProgress)
        break
      case 'quote':
        result = await this.claude.extractQuotes(truncatedText, command.args)
        break
      case 'help':
      case 'none':
      default:
        result = await this.claude.minimal(truncatedText)
        break
    }

    // 防御性访问 — GLM-4.7 function calling 可能缺少字段
    const tags = result.tags ?? []
    log.info({ title: result.title, model: result.model, tags: tags.length }, 'AI 处理完成')

    return {
      title: result.title ?? '未命名',
      summary: result.summary ?? '',
      keyPoints: result.key_points ?? '',
      tags,
      content: result.content ?? '',
      model: result.model,
      isDraft: false,
    }
  }
}
