// 适配器抽象基类
import type { PipelineEngine } from '../pipeline/engine.js'

/** 输入适配器抽象基类 */
export abstract class BaseAdapter {
  constructor(protected pipeline: PipelineEngine) {}

  /** 启动适配器 */
  abstract start(): Promise<void>

  /** 停止适配器 */
  abstract stop(): Promise<void>
}
