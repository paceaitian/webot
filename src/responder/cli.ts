// CLI 响应器 — console 输出阶段状态/结果
import type { Responder } from './base.js'
import type { PipelineContext } from '../types/index.js'

/** CLI 模式下的 console 输出响应器 */
export class CliResponder implements Responder {
  async onProgress(ctx: PipelineContext, message: string): Promise<void> {
    process.stdout.write(`[${ctx.stage}] ${message}\n`)
  }

  async onComplete(ctx: PipelineContext): Promise<void> {
    const duration = ctx.completedAt
      ? ctx.completedAt.getTime() - ctx.startedAt.getTime()
      : 0

    process.stdout.write('\n--- 处理完成 ---\n')
    process.stdout.write(`状态: ${ctx.status}\n`)

    if (ctx.parsed) {
      process.stdout.write(`指令: ${ctx.parsed.command.type}\n`)
      process.stdout.write(`内容类型: ${ctx.parsed.content.type}\n`)
    }

    if (ctx.processed) {
      process.stdout.write(`标题: ${ctx.processed.title}\n`)
      if (ctx.processed.tags.length > 0) {
        process.stdout.write(`标签: ${ctx.processed.tags.join(', ')}\n`)
      }
    }

    if (ctx.written) {
      process.stdout.write(`文件: ${ctx.written.filePath}\n`)
    }

    process.stdout.write(`耗时: ${duration}ms\n`)
    process.stdout.write('----------------\n\n')
  }

  async onError(ctx: PipelineContext, error: Error): Promise<void> {
    process.stderr.write(`\n[错误] 阶段: ${ctx.stage}, 消息: ${error.message}\n\n`)
  }
}
