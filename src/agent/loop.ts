// Agent 核心循环 — ReAct 模式（Reason + Act）
import { generateText, jsonSchema, stepCountIs } from 'ai'
import { createOpenAI } from '@ai-sdk/openai'
import type { ToolRegistry } from '../tools/registry.js'
import type { SessionRepo, SessionMessage } from '../db/repositories/session-repo.js'
import type { ToolContext } from '../tools/base.js'
import type { ContextManager } from './context-manager.js'
import type { MemoryRepo, Memory } from '../db/repositories/memory-repo.js'
import { buildSystemPrompt } from './system-prompt.js'
import { createLogger } from '../utils/logger.js'

const log = createLogger('agent-loop')

/** Agent 循环最大工具调用轮数 */
const MAX_STEPS = 10

/** 默认模型 */
const DEFAULT_MODEL = 'glm-4.7'

/** AgentLoop 配置 */
export interface AgentLoopConfig {
  apiKey: string
  baseURL?: string
  /** 默认模型 */
  defaultModel?: string
}

/**
 * Agent 核心循环 — 接收用户输入，通过 ReAct 循环调用工具完成任务
 */
export class AgentLoop {
  private openai: ReturnType<typeof createOpenAI>

  constructor(
    private registry: ToolRegistry,
    private sessionRepo: SessionRepo,
    private config: AgentLoopConfig,
    private contextManager?: ContextManager,
    private memoryRepo?: MemoryRepo,
  ) {
    this.openai = createOpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseURL || undefined,
    })
  }

  /**
   * 执行 Agent 循环
   * @returns Agent 最终的文本回复
   */
  async run(input: string, context: ToolContext): Promise<string> {
    this.sessionRepo.addMessage(context.sessionId, { role: 'user', content: input })

    const modelId = this.config.defaultModel ?? DEFAULT_MODEL

    // 使用 ContextManager 获取消息（滑动窗口 + 压缩）
    let history: SessionMessage[]
    if (this.contextManager) {
      await this.contextManager.compressIfNeeded(context.sessionId, context.userId)
      history = await this.contextManager.getContextMessages(context.sessionId, context.userId)
    } else {
      history = this.sessionRepo.getHistory(context.sessionId)
    }

    // 加载用户记忆注入 system prompt
    let memories: Memory[] = []
    if (this.memoryRepo) {
      const userMemories = this.memoryRepo.getUserMemories(context.userId, ['preference', 'fact'])
      const summaries = this.memoryRepo.getRecentSummaries(context.userId, 5)
      memories = [...userMemories, ...summaries]
    }

    log.info({ model: modelId, messageCount: history.length }, 'Agent 开始处理')

    try {
      const aiTools = this.buildAITools(context)

      const result = await generateText({
        model: this.openai.chat(modelId),
        system: buildSystemPrompt(this.registry.getDefinitions(), memories),
        messages: this.convertMessages(history),
        tools: aiTools,
        stopWhen: stepCountIs(MAX_STEPS),
        onStepFinish: async ({ toolCalls }) => {
          if (toolCalls && toolCalls.length > 0) {
            const names = toolCalls.map((tc: { toolName: string }) => tc.toolName).join(', ')
            log.info({ tools: names }, '工具调用完成')
          }
        },
      })

      const text = result.text || '（无回复）'
      this.sessionRepo.addMessage(context.sessionId, { role: 'assistant', content: text })

      log.info({
        steps: result.steps?.length ?? 0,
        textLength: text.length,
      }, 'Agent 处理完成')

      return text
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error)
      log.error({ error: errMsg }, 'LLM 调用失败')
      return `抱歉，处理时出错: ${errMsg}`
    }
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
          log.info({ tool: toolRef.name, params }, '执行工具')

          // 校验必需参数 — GLM-4.7 有时传空对象
          const required = (toolRef.parameters.required as string[] | undefined) ?? []
          const missing = required.filter(k => params[k] === undefined || params[k] === '')
          if (missing.length > 0) {
            const hint = missing.map(k => {
              const prop = (toolRef.parameters.properties as Record<string, { description?: string }>)?.[k]
              return `${k}: ${prop?.description ?? '必填'}`
            }).join('; ')
            log.warn({ tool: toolRef.name, missing }, '工具缺少必需参数')
            return `参数错误：缺少 ${missing.join(', ')}。请提供：${hint}`
          }

          await context.responder.onProgress({} as never, `正在执行 ${toolRef.name}...`)
          const result = await toolRef.execute(params, context)
          return result.content
        },
      }
    }
    return tools
  }

  /** 将 SessionMessage 转为 Vercel AI SDK messages 格式 */
  private convertMessages(messages: SessionMessage[]): Array<{ role: 'user' | 'assistant'; content: string }> {
    return messages.map((m) => ({
      role: (m.role === 'tool_result' || m.role === 'system_summary') ? 'user' as const : m.role as 'user' | 'assistant',
      content: m.role === 'system_summary' ? `[对话摘要] ${m.content}` : m.content,
    }))
  }
}
