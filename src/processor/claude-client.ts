// Claude API 封装 — 5 种处理模式
import Anthropic from '@anthropic-ai/sdk'
import crypto from 'crypto'
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

/** 判断错误是否为代理层可重试错误（连接断开、超时等） */
function isProxyRetryable(error: unknown): boolean {
  const msg = String(error)
  return /chunks|520|ECONNRESET|ETIMEDOUT|socket hang up|fetch failed|network/i.test(msg)
}

/** Claude 模型 ID */
const HAIKU = 'claude-haiku-4-5-20251001'
const OPUS = 'claude-opus-4-6'

/** Claude Code 请求指纹 — 用于通过 NewAPI 代理的 Opus 模型验证 */
const CC_HEADERS: Record<string, string> = {
  'User-Agent': 'claude-cli/2.1.39 (external, cli)',
  'x-app': 'cli',
  'anthropic-beta': 'claude-code-20250219,prompt-caching-scope-2026-01-05,effort-2025-11-24,adaptive-thinking-2026-01-28',
  'x-stainless-lang': 'js',
  'x-stainless-package-version': '0.73.0',
  'x-stainless-os': 'Windows',
  'x-stainless-arch': 'x64',
  'x-stainless-runtime': 'node',
  'x-stainless-runtime-version': process.version,
}

/** Claude Code 标识 system blocks — 代理验证需要 */
const CC_SYSTEM_BLOCKS: Array<{ type: 'text'; text: string; cache_control: { type: 'ephemeral' } }> = [
  {
    type: 'text',
    text: "You are Claude Code, Anthropic's official CLI for Claude.",
    cache_control: { type: 'ephemeral' },
  },
  {
    type: 'text',
    text: 'You are an interactive CLI tool that helps users with software engineering tasks.',
    cache_control: { type: 'ephemeral' },
  },
]

/** 生成 Claude Code 格式的 metadata.user_id */
function generateCCUserId(): string {
  return `user_${crypto.randomBytes(32).toString('hex')}_account__session_${crypto.randomUUID()}`
}

/**
 * Claude API 客户端封装
 */
export class ClaudeClient {
  private client: Anthropic
  private useProxy: boolean

  constructor(apiKey: string, baseUrl?: string) {
    this.useProxy = !!baseUrl
    this.client = new Anthropic({
      apiKey,
      timeout: 120_000,  // 全局 120s 超时（discuss 可能较慢）
      ...(baseUrl ? { baseURL: baseUrl } : {}),
      ...(baseUrl ? { defaultHeaders: CC_HEADERS } : {}),
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

  /** #discuss 深度分析（Opus + Extended Thinking + 流式 + tool_choice: auto） */
  async discuss(content: string, args?: string, onProgress?: (message: string) => void): Promise<NoteSchemaOutput & { model: string }> {
    log.info({ contentLength: content.length }, '#discuss 深度分析')
    const start = Date.now()

    // U1: 通知开始深度思考
    onProgress?.('Opus 深度思考中...')

    const response = await withRetry(async () => {
      const stream = this.client.messages.stream({
        model: OPUS,
        max_tokens: 16000,
        // CC Switch 整流器自动处理 thinking 错误，始终启用
        thinking: { type: 'enabled' as const, budget_tokens: 8192 },
        ...this.proxyMetadata(),
        system: this.buildSystem(discussSystemPrompt),
        messages: [{
          role: 'user',
          content: this.buildUserContent(discussUserPrompt(content, args), content),
        }],
        tools: [{
          name: 'generate_note',
          description: '生成结构化笔记数据',
          input_schema: noteSchema,
        }],
        // auto 兼容 thinking（tool 强制模式不兼容）
        tool_choice: { type: 'auto' },
      }, { timeout: 300_000 })  // Opus+thinking 需要更长超时

      // 流式展示 thinking 过程（打字机效果推送到飞书卡片）
      let thinkingLineCount = 0
      stream.on('thinking', (_delta: string, snapshot: string) => {
        // 每积累 ~3 行新内容推送一次，避免过于频繁
        const lines = snapshot.split('\n').length
        if (lines - thinkingLineCount >= 3) {
          thinkingLineCount = lines
          // 截取最新部分展示（避免卡片内容过长）
          const display = snapshot.length > 800
            ? '...\n' + snapshot.slice(-800)
            : snapshot
          onProgress?.(`**Opus 思考中...**\n\n${display}`)
        }
      })

      // 检测 tool_use 阶段，报告生成进度
      let generatingReported = false
      stream.on('inputJson', () => {
        if (!generatingReported) {
          generatingReported = true
          onProgress?.('AI 生成笔记...')
        }
      })

      return await stream.finalMessage()
    }, { maxRetries: 3, baseDelay: 2000, retryable: isProxyRetryable })

    log.info({
      model: OPUS,
      duration: Date.now() - start,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    }, '#discuss API 调用完成')

    // 优先从 tool_use 块提取结构化数据（prompt 引导模型必用工具）
    const toolUse = response.content.find(b => b.type === 'tool_use')
    if (toolUse && toolUse.type === 'tool_use') {
      return { ...(toolUse.input as NoteSchemaOutput), model: OPUS }
    }

    // fallback: 纯文本（不应触发，但保险）
    const rawText = response.content
      .filter(b => b.type === 'text')
      .map(b => (b as { text: string }).text)
      .join('\n')

    return {
      title: '深度分析',
      summary: rawText.slice(0, 80),
      key_points: '',
      tags: ['深度分析'],
      content: rawText,
      model: OPUS,
    }
  }

  /** #quote 段落提取（Opus + Structured Output） */
  async extractQuotes(content: string, args?: string): Promise<NoteSchemaOutput & { model: string }> {
    log.info({ contentLength: content.length }, '#quote 段落提取')
    const result = await this.structuredCall(
      OPUS,
      quoteSystemPrompt,
      quoteUserPrompt(content, args),
      content,
    )
    return { ...result, model: OPUS }
  }

  /** 批量评分（Sonnet + Structured Output） */
  async scoreBatch(
    systemPrompt: string,
    userMessage: string,
    schema: Record<string, unknown> & { type: 'object' },
  ): Promise<Record<string, unknown>> {
    const start = Date.now()
    const response = await withRetry(async () => {
      const stream = this.client.messages.stream({
        model: OPUS,
        max_tokens: 8192,
        ...this.proxyMetadata(),
        system: this.buildSystem(systemPrompt),
        messages: [{ role: 'user', content: userMessage }],
        tools: [{
          name: 'score_items',
          description: '对资讯条目进行评分和摘要',
          input_schema: schema,
        }],
        tool_choice: { type: 'tool', name: 'score_items' },
      })
      return await stream.finalMessage()
    }, { maxRetries: 3, baseDelay: 2000, retryable: isProxyRetryable })
    log.info({
      model: OPUS,
      duration: Date.now() - start,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    }, '评分 API 调用完成')
    const toolUse = response.content.find(b => b.type === 'tool_use')
    if (!toolUse || toolUse.type !== 'tool_use') throw new Error('Opus 未返回结构化评分')
    return toolUse.input as Record<string, unknown>
  }

  /** 综合分析（Opus + Extended Thinking，返回 Markdown） */
  async analyze(
    systemPrompt: string,
    userMessage: string,
    onProgress?: (message: string) => void,
  ): Promise<string> {
    const start = Date.now()
    onProgress?.('Opus 综合分析中...')

    const response = await withRetry(async () => {
      const stream = this.client.messages.stream({
        model: OPUS,
        max_tokens: 16000,
        thinking: { type: 'enabled' as const, budget_tokens: 10000 },
        ...this.proxyMetadata(),
        system: this.buildSystem(systemPrompt),
        messages: [{ role: 'user', content: userMessage }],
      }, { timeout: 300_000 })

      // 流式 thinking 进度
      let thinkingLineCount = 0
      stream.on('thinking', (_delta: string, snapshot: string) => {
        const lines = snapshot.split('\n').length
        if (lines - thinkingLineCount >= 3) {
          thinkingLineCount = lines
          const display = snapshot.length > 800
            ? '...\n' + snapshot.slice(-800)
            : snapshot
          onProgress?.(`**Opus 分析中...**\n\n${display}`)
        }
      })

      return await stream.finalMessage()
    }, { maxRetries: 3, baseDelay: 2000, retryable: isProxyRetryable })
    log.info({
      model: OPUS,
      duration: Date.now() - start,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    }, '综合分析 API 调用完成')

    return response.content
      .filter(b => b.type === 'text')
      .map(b => (b as { text: string }).text)
      .join('\n')
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

  /** 图片描述（Haiku + Vision + Structured Output） */
  async describeImage(imageBuffer: Buffer, mimeType: string, text?: string): Promise<NoteSchemaOutput & { model: string }> {
    log.info({ mimeType, hasText: !!text, imageSize: imageBuffer.length }, '图片描述生成')
    const start = Date.now()

    const mediaType = mimeType as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp'

    const response = await withRetry(async () => {
      const stream = this.client.messages.stream({
        model: HAIKU,
        max_tokens: 4096,
        ...this.proxyMetadata(),
        system: this.buildSystem(visionSystemPrompt),
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
        // A5: 使用 tool_use 获取结构化输出
        tools: [{
          name: 'generate_note',
          description: '生成结构化笔记数据',
          input_schema: noteSchema,
        }],
        tool_choice: { type: 'tool', name: 'generate_note' },
      })
      return await stream.finalMessage()
    }, { maxRetries: 3, baseDelay: 1000, retryable: isProxyRetryable })

    log.info({
      model: HAIKU,
      duration: Date.now() - start,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    }, 'Vision API 调用完成')

    // 优先从 tool_use 提取结构化数据
    const toolUse = response.content.find(b => b.type === 'tool_use')
    if (toolUse && toolUse.type === 'tool_use') {
      return { ...(toolUse.input as NoteSchemaOutput), model: HAIKU }
    }

    // fallback: 纯文本解析（不应触发）
    const rawText = response.content
      .filter(b => b.type === 'text')
      .map(b => (b as { text: string }).text)
      .join('\n')

    return {
      title: text ?? '图片笔记',
      summary: rawText.slice(0, 80),
      key_points: '',
      tags: ['图片'],
      content: rawText,
      model: HAIKU,
    }
  }

  /** 结构化输出调用（流式 + Prompt Caching + JSON Schema + 代理重试） */
  private async structuredCall(
    model: string,
    systemPrompt: string,
    userMessage: string,
    rawContent?: string,
  ): Promise<NoteSchemaOutput> {
    const start = Date.now()

    const response = await withRetry(async () => {
      const stream = this.client.messages.stream({
        model,
        max_tokens: 8192,
        ...this.proxyMetadata(),
        system: this.buildSystem(systemPrompt),
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
      return await stream.finalMessage()
    }, { maxRetries: 3, baseDelay: 1000, retryable: isProxyRetryable })

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

  /** 构建 system blocks（代理模式下合并到 2 个 CC 标识块中，不能超过 2 块） */
  private buildSystem(prompt: string): Array<{ type: 'text'; text: string; cache_control: { type: 'ephemeral' } }> {
    const promptBlock = { type: 'text' as const, text: prompt, cache_control: { type: 'ephemeral' as const } }
    if (!this.useProxy) return [promptBlock]
    // NewAPI 代理只允许恰好 2 个 system blocks，把实际 prompt 追加到第二个 CC block
    return [
      CC_SYSTEM_BLOCKS[0],
      { ...CC_SYSTEM_BLOCKS[1], text: CC_SYSTEM_BLOCKS[1].text + '\n\n' + prompt },
    ]
  }

  /** 代理模式下附加 metadata.user_id（NewAPI 验证需要） */
  private proxyMetadata(): { metadata?: { user_id: string } } {
    if (!this.useProxy) return {}
    return { metadata: { user_id: generateCCUserId() } }
  }
}
