// Claude API 封装 — 5 种处理模式
import Anthropic from '@anthropic-ai/sdk'
import type { NoteSchemaOutput } from './schemas/note-schema.js'
import { noteSchema } from './schemas/note-schema.js'
import { saveSystemPrompt, saveUserPrompt } from './prompts/save.js'
import { discussSystemPrompt, discussUserPrompt } from './prompts/discuss.js'
import { quoteSystemPrompt, quoteUserPrompt } from './prompts/quote.js'
import { minimalSystemPrompt, minimalUserPrompt } from './prompts/minimal.js'
import { visionSystemPrompt, visionUserPrompt } from './prompts/vision.js'
import { createLogger } from '../utils/logger.js'

const log = createLogger('claude')

/** Claude 模型 ID */
const HAIKU = 'claude-haiku-4-5-20251001'
const SONNET = 'claude-sonnet-4-6'

/**
 * Claude API 客户端封装
 */
export class ClaudeClient {
  private client: Anthropic

  constructor(apiKey: string, baseUrl?: string) {
    this.client = new Anthropic({
      apiKey,
      ...(baseUrl ? { baseURL: baseUrl } : {}),
    })
  }

  /** #save 摘要生成（Haiku + Structured Output） */
  async summarize(content: string, args?: string): Promise<NoteSchemaOutput & { model: string }> {
    log.info({ contentLength: content.length }, '#save 摘要生成')
    const result = await this.structuredCall(
      HAIKU,
      saveSystemPrompt,
      saveUserPrompt(content, args),
      content,
    )
    return { ...result, model: HAIKU }
  }

  /** #discuss 深度分析（Sonnet + Extended Thinking） */
  async discuss(content: string, args?: string): Promise<NoteSchemaOutput & { model: string }> {
    log.info({ contentLength: content.length }, '#discuss 深度分析')
    const start = Date.now()

    const response = await this.client.messages.create({
      model: SONNET,
      max_tokens: 16000,
      thinking: {
        type: 'enabled',
        budget_tokens: 4096,
      },
      system: [{
        type: 'text',
        text: discussSystemPrompt,
        cache_control: { type: 'ephemeral' },
      }],
      messages: [{
        role: 'user',
        content: this.buildUserContent(discussUserPrompt(content, args), content),
      }],
    })

    log.info({
      model: SONNET,
      duration: Date.now() - start,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    }, '#discuss API 调用完成')

    // 从 Extended Thinking 响应中提取文本
    const textBlocks = response.content.filter(b => b.type === 'text')
    const rawText = textBlocks.map(b => b.text).join('\n')

    // 尝试解析 JSON，回退到纯文本
    try {
      const parsed = JSON.parse(rawText)
      return { ...parsed, model: SONNET }
    } catch {
      return {
        title: '深度分析',
        summary: rawText.slice(0, 200),
        tags: ['深度分析'],
        content: rawText,
        model: SONNET,
      }
    }
  }

  /** #quote 段落提取（Sonnet + Structured Output） */
  async extractQuotes(content: string, args?: string): Promise<NoteSchemaOutput & { model: string }> {
    log.info({ contentLength: content.length }, '#quote 段落提取')
    const result = await this.structuredCall(
      SONNET,
      quoteSystemPrompt,
      quoteUserPrompt(content, args),
      content,
    )
    return { ...result, model: SONNET }
  }

  /** 无指令最小元数据（Haiku） */
  async minimal(content: string): Promise<NoteSchemaOutput & { model: string }> {
    log.info({ contentLength: content.length }, '最小元数据生成')
    const result = await this.structuredCall(
      HAIKU,
      minimalSystemPrompt,
      minimalUserPrompt(content),
      content,
    )
    return { ...result, model: HAIKU }
  }

  /** 图片描述（Haiku + Vision） */
  async describeImage(imageBuffer: Buffer, mimeType: string, text?: string): Promise<NoteSchemaOutput & { model: string }> {
    log.info({ mimeType, hasText: !!text, imageSize: imageBuffer.length }, '图片描述生成')
    const start = Date.now()

    const mediaType = mimeType as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp'

    const response = await this.client.messages.create({
      model: HAIKU,
      max_tokens: 4096,
      system: [{
        type: 'text',
        text: visionSystemPrompt,
        cache_control: { type: 'ephemeral' },
      }],
      messages: [{
        role: 'user',
        content: [
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: mediaType,
              data: imageBuffer.toString('base64'),
            },
          },
          {
            type: 'text',
            text: visionUserPrompt(text),
          },
        ],
      }],
    })

    log.info({
      model: HAIKU,
      duration: Date.now() - start,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    }, 'Vision API 调用完成')

    const rawText = response.content
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join('\n')

    try {
      const parsed = JSON.parse(rawText)
      return { ...parsed, model: HAIKU }
    } catch {
      return {
        title: text ?? '图片笔记',
        summary: rawText.slice(0, 200),
        tags: ['图片'],
        content: rawText,
        model: HAIKU,
      }
    }
  }

  /** 结构化输出调用（Prompt Caching + JSON Schema） */
  private async structuredCall(
    model: string,
    systemPrompt: string,
    userMessage: string,
    rawContent?: string,
  ): Promise<NoteSchemaOutput> {
    const start = Date.now()
    const response = await this.client.messages.create({
      model,
      max_tokens: 8192,
      system: [{
        type: 'text',
        text: systemPrompt,
        cache_control: { type: 'ephemeral' },
      }],
      messages: [{
        role: 'user',
        content: this.buildUserContent(userMessage, rawContent),
      }],
      tools: [{
        name: 'generate_note',
        description: '生成结构化笔记数据',
        input_schema: noteSchema,
      }],
      tool_choice: { type: 'tool', name: 'generate_note' },
    })

    log.info({
      model,
      duration: Date.now() - start,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      cacheRead: (response.usage as unknown as Record<string, unknown>).cache_read_input_tokens ?? 0,
    }, 'Claude API 调用完成')

    // 从 tool_use 响应中提取结构化数据
    const toolUse = response.content.find(b => b.type === 'tool_use')
    if (!toolUse || toolUse.type !== 'tool_use') {
      throw new Error('Claude 未返回结构化数据')
    }

    return toolUse.input as NoteSchemaOutput
  }

  /** 构建用户消息内容（长文章单独缓存） */
  private buildUserContent(userMessage: string, rawContent?: string): string | Array<{ type: 'text'; text: string; cache_control?: { type: 'ephemeral' } }> {
    // 长内容（>2000 字符）拆分为独立缓存块
    if (rawContent && rawContent.length > 2000) {
      return [
        {
          type: 'text',
          text: rawContent,
          cache_control: { type: 'ephemeral' },
        },
        {
          type: 'text',
          text: userMessage,
        },
      ]
    }
    return userMessage
  }
}
