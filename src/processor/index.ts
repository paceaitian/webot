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

  constructor(apiKey: string, baseUrl?: string) {
    this.claude = new ClaudeClient(apiKey, baseUrl)
  }

  async process(parsed: ParsedMessage, extracted: ExtractedContent): Promise<ProcessedResult> {
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
        tags: result.tags,
        content: result.content,
        model: result.model,
        isDraft: false,
      }
    }

    // 根据指令类型分发
    const contentText = extracted.content
    let result

    switch (command.type) {
      case 'save':
        result = await this.claude.summarize(contentText, command.args)
        break
      case 'discuss':
        result = await this.claude.discuss(contentText, command.args)
        break
      case 'quote':
        result = await this.claude.extractQuotes(contentText, command.args)
        break
      case 'none':
      default:
        result = await this.claude.minimal(contentText)
        break
    }

    log.info({ title: result.title, model: result.model, tags: result.tags.length }, 'AI 处理完成')

    return {
      title: result.title,
      summary: result.summary,
      tags: result.tags,
      content: result.content,
      model: result.model,
      isDraft: false,
    }
  }
}
