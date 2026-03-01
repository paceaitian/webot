// 响应器接口定义
import type { PipelineContext } from '../types/index.js'

/** 响应器接口 — 管道各阶段进度反馈 */
export interface Responder {
  /** 阶段进度通知 */
  onProgress(ctx: PipelineContext, message: string): Promise<void>
  /** 处理完成通知 */
  onComplete(ctx: PipelineContext): Promise<void>
  /** 错误通知 */
  onError(ctx: PipelineContext, error: Error): Promise<void>
}
