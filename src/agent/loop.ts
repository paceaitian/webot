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
    this.anthropic = createAnthropic({
      apiKey: config.apiKey,
      baseURL: config.baseURL || undefined,
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
