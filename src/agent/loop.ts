// Agent 核心循环 — ReAct 模式（Reason + Act）
import { generateText, jsonSchema } from 'ai'
import { createAnthropic } from '@ai-sdk/anthropic'
import type { ToolRegistry } from '../tools/registry.js'
import type { SessionRepo, SessionMessage } from '../db/repositories/session-repo.js'
import type { ToolContext } from '../tools/base.js'
import { buildSystemPrompt } from './system-prompt.js'
import { createLogger } from '../utils/logger.js'

const log = createLogger('agent-loop')

/** Agent 循环的最大迭代次数 */
const MAX_ITERATIONS = 15

/** Claude Code 请求指纹 — 用于通过代理验证 */
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

/** CC 标识 system blocks — 代理要求恰好 2 个 */
const CC_SYSTEM_BLOCKS = [
  {
    type: 'text' as const,
    text: "You are Claude Code, Anthropic's official CLI for Claude.",
    cache_control: { type: 'ephemeral' as const },
  },
  {
    type: 'text' as const,
    text: 'You are an interactive CLI tool that helps users with software engineering tasks.',
    cache_control: { type: 'ephemeral' as const },
  },
]

/**
 * 创建代理兼容的 fetch — 修复 AI SDK 与代理的兼容性问题：
 * 1. 替换 system 为 CC 双 block 格式（代理要求恰好 2 个 block + cache_control）
 * 2. 修复 tools 的 input_schema（AI SDK Anthropic provider 丢失属性）
 */
function createProxyFetch(toolSchemas: Map<string, Record<string, unknown>>): typeof globalThis.fetch {
  return async (url: RequestInfo | URL, init?: RequestInit) => {
    if (init?.body && typeof init.body === 'string') {
      try {
        const body = JSON.parse(init.body)
        // 修复 1: 替换 system 为 CC 双 block 格式
        let systemText = ''
        if (Array.isArray(body.system)) {
          systemText = body.system.map((b: { text?: string }) => b.text || '').join('\n')
        } else if (typeof body.system === 'string') {
          systemText = body.system
        }
        body.system = [
          CC_SYSTEM_BLOCKS[0],
          {
            ...CC_SYSTEM_BLOCKS[1],
            text: CC_SYSTEM_BLOCKS[1].text + (systemText ? '\n\n' + systemText : ''),
          },
        ]
        // 修复 2: 用 registry 的原始 schema 替换 AI SDK 生成的空 input_schema
        if (Array.isArray(body.tools)) {
          for (const tool of body.tools) {
            const schema = toolSchemas.get(tool.name)
            if (schema) {
              tool.input_schema = schema
            }
          }
        }
        init = { ...init, body: JSON.stringify(body) }
      } catch {
        // JSON 解析失败，原样发送
      }
    }
    return globalThis.fetch(url, init)
  }
}

/** AgentLoop 配置 */
export interface AgentLoopConfig {
  apiKey: string
  baseURL?: string
  /** 默认模型（默认 haiku） */
  defaultModel?: string
}

/**
 * Agent 核心循环 — 接收用户输入，通过 ReAct 循环调用工具完成任务
 */
export class AgentLoop {
  private anthropic: ReturnType<typeof createAnthropic>

  constructor(
    private registry: ToolRegistry,
    private sessionRepo: SessionRepo,
    private config: AgentLoopConfig,
  ) {
    // 代理 URL 需要追加 /v1（Anthropic 原生 SDK 自动追加，AI SDK 不会）
    const baseURL = config.baseURL
      ? (config.baseURL.endsWith('/v1') ? config.baseURL : `${config.baseURL}/v1`)
      : undefined

    // 构建 tool schema 映射（供 createProxyFetch 修复 input_schema 用）
    const toolSchemas = new Map<string, Record<string, unknown>>()
    for (const t of registry.getAll()) {
      toolSchemas.set(t.name, t.parameters)
    }

    this.anthropic = createAnthropic({
      apiKey: config.apiKey,
      baseURL,
      // 代理模式：CC 指纹头 + 自定义 fetch 注入 system blocks + 修复 tools
      ...(config.baseURL ? { headers: CC_HEADERS, fetch: createProxyFetch(toolSchemas) } : {}),
    })
  }

  /**
   * 执行 Agent 循环
   * @returns Agent 最终的文本回复
   */
  async run(input: string, context: ToolContext): Promise<string> {
    this.sessionRepo.addMessage(context.chatId, { role: 'user', content: input })

    const modelId = this.config.defaultModel ?? 'claude-haiku-4-5-20251001'
    let currentModel = modelId
    let iterations = 0

    while (iterations++ < MAX_ITERATIONS) {
      const history = this.sessionRepo.getHistory(context.chatId)

      log.info({ iteration: iterations, model: currentModel, messageCount: history.length }, 'Agent 循环迭代')

      try {
        // 构建 Vercel AI SDK tools
        const aiTools = this.buildAITools(context)

        const result = await generateText({
          model: this.anthropic(currentModel),
          system: buildSystemPrompt(this.registry.getDefinitions()),
          messages: this.convertMessages(history),
          tools: aiTools,
        })

        // 有工具调用
        if (result.toolCalls && result.toolCalls.length > 0) {
          // tool results 已由 AI SDK 自动执行（因为 tool 有 execute）
          // 记录到 session
          for (const toolCall of result.toolCalls) {
            this.sessionRepo.addMessage(context.chatId, {
              role: 'assistant',
              content: `[调用工具 ${toolCall.toolName}]`,
            })
          }

          for (const toolResult of result.toolResults) {
            const output = toolResult.output
            const resultText = typeof output === 'string'
              ? output
              : JSON.stringify(output)
            this.sessionRepo.addMessage(context.chatId, {
              role: 'tool_result',
              content: resultText,
              toolUseId: toolResult.toolCallId,
            })

            // 检查是否有模型升级建议
            if (typeof output === 'object' && output !== null) {
              const r = output as Record<string, unknown>
              if (r._upgradeModel && typeof r._upgradeModel === 'string') {
                currentModel = r._upgradeModel
                log.info({ newModel: currentModel }, '模型已升级')
              }
            }
          }

          // 如果有文本回复（部分模型在 tool_use 同时返回文本）
          if (result.text) {
            this.sessionRepo.addMessage(context.chatId, { role: 'assistant', content: result.text })
            log.info({ iterations, textLength: result.text.length }, 'Agent 循环结束（工具 + 文本）')
            return result.text
          }

          // 继续循环让 LLM 看到工具结果
          continue
        }

        // 纯文本回复 → 结束循环
        const text = result.text || '（无回复）'
        this.sessionRepo.addMessage(context.chatId, { role: 'assistant', content: text })
        log.info({ iterations, textLength: text.length }, 'Agent 循环结束')
        return text

      } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error)
        log.error({ error: errMsg, iteration: iterations }, 'LLM 调用失败')
        return `抱歉，处理时出错: ${errMsg}`
      }
    }

    const maxMsg = `任务步骤过多（超过 ${MAX_ITERATIONS} 轮），已停止执行。`
    this.sessionRepo.addMessage(context.chatId, { role: 'assistant', content: maxMsg })
    return maxMsg
  }

  /** 构建 Vercel AI SDK tools 对象 */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private buildAITools(context: ToolContext): Record<string, any> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tools: Record<string, any> = {}
    for (const t of this.registry.getAll()) {
      const toolRef = t
      tools[t.name] = {
        description: t.description,
        parameters: jsonSchema(t.parameters),
        execute: async (params: Record<string, unknown>) => {
          log.info({ tool: toolRef.name }, '执行工具')
          await context.responder.onProgress({} as never, `正在执行 ${toolRef.name}...`)
          const result = await toolRef.execute(params, context)
          if (result.upgradeModel) {
            return { ...result, _upgradeModel: result.upgradeModel }
          }
          return result.content
        },
      }
    }
    return tools
  }

  /** 将 SessionMessage 转为 Vercel AI SDK messages 格式 */
  private convertMessages(messages: SessionMessage[]): Array<{ role: 'user' | 'assistant'; content: string }> {
    return messages.map((m) => ({
      role: m.role === 'tool_result' ? 'user' as const : m.role as 'user' | 'assistant',
      content: m.content,
    }))
  }
}
