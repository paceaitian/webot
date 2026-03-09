// DiscussTool — 包装深度分析，对已保存笔记或新 URL 使用 Opus 模型进行深度分析
import type { Tool, ToolResult, ToolContext } from './base.js'
import type { PipelineEngine } from '../pipeline/engine.js'
import type { RawMessage } from '../types/index.js'
import { generateId } from '../utils/id.js'
import { createLogger } from '../utils/logger.js'

const log = createLogger('tool-discuss')

/**
 * DiscussTool — 对已保存的笔记或新 URL 进行深度分析（使用 Opus 模型 Extended Thinking）
 */
export class DiscussTool implements Tool {
  name = 'discuss'
  description = '对已保存的笔记或新 URL 进行深度分析，使用 Opus 模型的 Extended Thinking 能力。当用户要求深入讨论、分析、评论某个内容时使用。'
  parameters = {
    type: 'object' as const,
    properties: {
      url: {
        type: 'string',
        description: '要深度分析的 URL（可选，如果提供则先抓取再分析）',
      },
      jobId: {
        type: 'string',
        description: '已保存笔记的 jobId（可选，用于对已有笔记进行深度分析）',
      },
      instruction: {
        type: 'string',
        description: '分析方向或关注重点（可选）',
      },
    },
    required: [] as string[],
  }

  constructor(private pipeline: PipelineEngine) {}

  async execute(params: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
    const url = params.url as string | undefined
    const jobId = params.jobId as string | undefined
    const instruction = params.instruction as string | undefined

    // jobId 模式：对已有笔记二次处理
    if (jobId) {
      log.info({ jobId, instruction }, 'DiscussTool 执行 (reprocess)')
      try {
        const ctx = await this.pipeline.reprocess(jobId, 'discuss', context.responder, {
          userInput: instruction,
        })
        return this.buildResult(ctx)
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error)
        log.error({ jobId, error: msg }, 'DiscussTool reprocess 失败')
        return { content: `深度分析失败: ${msg}`, upgradeModel: 'claude-opus-4-6' }
      }
    }

    // url 模式：先抓取再深度分析
    if (url) {
      log.info({ url, instruction }, 'DiscussTool 执行 (新 URL)')
      const rawText = instruction ? `#discuss ${instruction} ${url}` : `#discuss ${url}`
      const raw: RawMessage = {
        eventId: generateId(),
        source: 'cli',
        rawText,
        receivedAt: new Date(),
      }
      try {
        const ctx = await this.pipeline.execute(raw, context.responder)
        return this.buildResult(ctx)
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error)
        log.error({ url, error: msg }, 'DiscussTool 执行失败')
        return { content: `深度分析失败: ${msg}`, upgradeModel: 'claude-opus-4-6' }
      }
    }

    // 两者都没有 → 错误提示
    return {
      content: '请提供 url 或 jobId 参数。url 用于分析新链接，jobId 用于对已保存的笔记进行深度分析。',
    }
  }

  /**
   * 根据管道执行结果构建 ToolResult
   */
  private buildResult(ctx: { status: string; written?: { title: string; filePath: string } }): ToolResult {
    if (ctx.status === 'completed' && ctx.written) {
      return {
        content: `深度分析完成:\n- 标题: ${ctx.written.title}\n- 路径: ${ctx.written.filePath}`,
        artifacts: [{ type: 'file', value: ctx.written.filePath }],
        upgradeModel: 'claude-opus-4-6',
      }
    }

    if (ctx.status === 'draft') {
      return {
        content: `已保存为草稿（AI 处理部分失败）:\n- 标题: ${ctx.written?.title ?? '未知'}\n- 路径: ${ctx.written?.filePath ?? '未知'}`,
        upgradeModel: 'claude-opus-4-6',
      }
    }

    return { content: `处理完成但状态异常: ${ctx.status}`, upgradeModel: 'claude-opus-4-6' }
  }
}
