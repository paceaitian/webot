// AI API 封装 — OpenAI 兼容格式（智谱 GLM-4.7）
import OpenAI from 'openai'
import type { NoteSchemaOutput } from './schemas/note-schema.js'
import { noteSchema } from './schemas/note-schema.js'
import { saveSystemPrompt, saveUserPrompt } from './prompts/save.js'
import { discussSystemPrompt, discussUserPrompt } from './prompts/discuss.js'
import { quoteSystemPrompt, quoteUserPrompt } from './prompts/quote.js'
import { minimalSystemPrompt, minimalUserPrompt } from './prompts/minimal.js'
import { visionSystemPrompt, visionUserPrompt } from './prompts/vision.js'
import { createLogger } from '../utils/logger.js'
import { withRetry } from '../utils/retry.js'

const log = createLogger('claude')

/** 默认模型 ID（可通过构造函数覆盖） */
const DEFAULT_MODEL = 'glm-4.7'

/** 判断错误是否可重试 */
function isRetryable(error: unknown): boolean {
  const msg = String(error)
  return /ECONNRESET|ETIMEDOUT|socket hang up|fetch failed|network|5\d{2}/i.test(msg)
}

/** 从 tool_call 提取 function arguments */
function extractToolArgs(toolCall: { type: string; function?: { arguments: string } }): string {
  if (toolCall.type === 'function' && toolCall.function) {
    return toolCall.function.arguments
  }
  throw new Error('非 function 类型的 tool_call')
}

/**
 * AI API 客户端封装（OpenAI 兼容格式）
 */
export class ClaudeClient {
  private client: OpenAI
  private model: string

  constructor(apiKey: string, baseUrl?: string, model?: string) {
    this.model = model ?? DEFAULT_MODEL
    this.client = new OpenAI({
      apiKey,
      baseURL: baseUrl || undefined,
      timeout: 120_000,
    })
  }

  /** #save 摘要生成 */
  async summarize(content: string, args?: string): Promise<NoteSchemaOutput & { model: string }> {
    log.info({ contentLength: content.length }, '#save 摘要生成')
    const result = await this.structuredCall(saveSystemPrompt, saveUserPrompt(content, args))
    return { ...result, model: this.model }
  }

  /** #discuss 深度分析 */
  async discuss(content: string, args?: string, onProgress?: (message: string) => void): Promise<NoteSchemaOutput & { model: string }> {
    log.info({ contentLength: content.length }, '#discuss 深度分析')
    onProgress?.('GLM-4.7 深度分析中...')
    const result = await this.structuredCall(discussSystemPrompt, discussUserPrompt(content, args))
    return { ...result, model: this.model }
  }

  /** #quote 段落提取 */
  async extractQuotes(content: string, args?: string): Promise<NoteSchemaOutput & { model: string }> {
    log.info({ contentLength: content.length }, '#quote 段落提取')
    const result = await this.structuredCall(quoteSystemPrompt, quoteUserPrompt(content, args))
    return { ...result, model: this.model }
  }

  /** 批量评分（function calling） */
  async scoreBatch(
    systemPrompt: string,
    userMessage: string,
    schema: Record<string, unknown> & { type: 'object' },
  ): Promise<Record<string, unknown>> {
    const start = Date.now()
    const response = await withRetry(async () => {
      return this.client.chat.completions.create({
        model: this.model,
        max_tokens: 8192,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage },
        ],
        tools: [{
          type: 'function' as const,
          function: {
            name: 'score_items',
            description: '对资讯条目进行评分和摘要',
            parameters: schema as Record<string, unknown>,
          },
        }],
        tool_choice: { type: 'function' as const, function: { name: 'score_items' } },
      })
    }, { maxRetries: 3, baseDelay: 2000, retryable: isRetryable })

    log.info({ model: this.model, duration: Date.now() - start }, '评分 API 调用完成')

    const toolCall = response.choices[0]?.message?.tool_calls?.[0]
    if (!toolCall) throw new Error('模型未返回结构化评分')
    return JSON.parse(extractToolArgs(toolCall)) as Record<string, unknown>
  }

  /** 综合分析（返回 Markdown） */
  async analyze(
    systemPrompt: string,
    userMessage: string,
    onProgress?: (message: string) => void,
  ): Promise<string> {
    const start = Date.now()
    onProgress?.('GLM-4.7 综合分析中...')

    const response = await withRetry(async () => {
      return this.client.chat.completions.create({
        model: this.model,
        max_tokens: 16000,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage },
        ],
      })
    }, { maxRetries: 3, baseDelay: 2000, retryable: isRetryable })

    log.info({ model: this.model, duration: Date.now() - start }, '综合分析 API 调用完成')
    return response.choices[0]?.message?.content ?? ''
  }

  /** 无指令最小元数据 */
  async minimal(content: string): Promise<NoteSchemaOutput & { model: string }> {
    log.info({ contentLength: content.length }, '最小元数据生成')
    const result = await this.structuredCall(minimalSystemPrompt, minimalUserPrompt(content))
    return { ...result, model: this.model }
  }

  /** 图片描述（Vision + function calling） */
  async describeImage(imageBuffer: Buffer, mimeType: string, text?: string): Promise<NoteSchemaOutput & { model: string }> {
    log.info({ mimeType, hasText: !!text, imageSize: imageBuffer.length }, '图片描述生成')
    const start = Date.now()
    const base64 = imageBuffer.toString('base64')

    const response = await withRetry(async () => {
      return this.client.chat.completions.create({
        model: this.model,
        max_tokens: 4096,
        messages: [
          { role: 'system', content: visionSystemPrompt },
          {
            role: 'user',
            content: [
              { type: 'image_url' as const, image_url: { url: `data:${mimeType};base64,${base64}` } },
              { type: 'text' as const, text: visionUserPrompt(text) },
            ],
          },
        ],
        tools: [{
          type: 'function' as const,
          function: {
            name: 'generate_note',
            description: '生成结构化笔记数据',
            parameters: noteSchema as Record<string, unknown>,
          },
        }],
        tool_choice: { type: 'function' as const, function: { name: 'generate_note' } },
      })
    }, { maxRetries: 3, baseDelay: 1000, retryable: isRetryable })

    log.info({ model: this.model, duration: Date.now() - start }, 'Vision API 调用完成')

    const toolCall = response.choices[0]?.message?.tool_calls?.[0]
    if (toolCall) {
      return { ...JSON.parse(extractToolArgs(toolCall)) as NoteSchemaOutput, model: this.model }
    }

    // fallback: 纯文本
    const rawText = response.choices[0]?.message?.content ?? ''
    return {
      title: text ?? '图片笔记',
      summary: rawText.slice(0, 80),
      key_points: '',
      tags: ['图片'],
      content: rawText,
      model: this.model,
    }
  }

  /** 结构化输出调用（function calling 强制模式） */
  private async structuredCall(
    systemPrompt: string,
    userMessage: string,
  ): Promise<NoteSchemaOutput> {
    const start = Date.now()

    const response = await withRetry(async () => {
      return this.client.chat.completions.create({
        model: this.model,
        max_tokens: 8192,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage },
        ],
        tools: [{
          type: 'function' as const,
          function: {
            name: 'generate_note',
            description: '生成结构化笔记数据',
            parameters: noteSchema as Record<string, unknown>,
          },
        }],
        tool_choice: { type: 'function' as const, function: { name: 'generate_note' } },
      })
    }, { maxRetries: 3, baseDelay: 1000, retryable: isRetryable })

    log.info({ model: this.model, duration: Date.now() - start }, 'API 调用完成')

    const toolCall = response.choices[0]?.message?.tool_calls?.[0]
    if (!toolCall) throw new Error('模型未返回结构化数据')
    return JSON.parse(extractToolArgs(toolCall)) as NoteSchemaOutput
  }
}
