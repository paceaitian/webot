// SaveTool — 包装现有 PipelineEngine，抓取网页生成摘要写入 Obsidian
import type { Tool, ToolResult, ToolContext } from './base.js'
import type { PipelineEngine } from '../pipeline/engine.js'
import type { RawMessage } from '../types/index.js'
import { generateId } from '../utils/id.js'
import { createLogger } from '../utils/logger.js'

const log = createLogger('tool-save')

/**
 * SaveTool — 抓取网页内容，生成 AI 摘要，写入 Obsidian 笔记
 */
export class SaveTool implements Tool {
  name = 'save'
  description = '抓取网页内容，生成 AI 摘要和标签，写入 Obsidian 笔记库。当用户分享 URL 或要求保存/收藏某个链接时使用。'
  parameters = {
    type: 'object' as const,
    properties: {
      url: {
        type: 'string',
        description: '要抓取的网页 URL',
      },
      instruction: {
        type: 'string',
        description: '用户的额外指示，如关注重点、标签建议等（可选）',
      },
    },
    required: ['url'],
  }

  constructor(private pipeline: PipelineEngine) {}

  async execute(params: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
    const url = params.url as string
    const instruction = params.instruction as string | undefined

    log.info({ url }, 'SaveTool 执行')

    // 构造 RawMessage，复用现有管道
    const rawText = instruction ? `#save ${instruction} ${url}` : url
    const raw: RawMessage = {
      eventId: generateId(),
      source: 'cli',
      rawText,
      receivedAt: new Date(),
    }

    try {
      const ctx = await this.pipeline.execute(raw, context.responder)

      if (ctx.status === 'completed' && ctx.written) {
        return {
          content: `笔记已保存到 Obsidian:\n- 标题: ${ctx.written.title}\n- 路径: ${ctx.written.filePath}`,
          artifacts: [{ type: 'file', value: ctx.written.filePath }],
        }
      }

      if (ctx.status === 'draft') {
        return {
          content: `已保存为草稿（AI 处理部分失败）:\n- 标题: ${ctx.written?.title ?? '未知'}\n- 路径: ${ctx.written?.filePath ?? '未知'}`,
        }
      }

      return { content: `处理完成但状态异常: ${ctx.status}` }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      log.error({ url, error: msg }, 'SaveTool 执行失败')
      return { content: `保存失败: ${msg}` }
    }
  }
}
