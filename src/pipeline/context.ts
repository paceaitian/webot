// 管道上下文工厂函数
import type { RawMessage, PipelineContext } from '../types/index.js'
import { generateId } from '../utils/id.js'

/**
 * 从原始消息创建管道上下文
 */
export function createContext(raw: RawMessage): PipelineContext {
  return {
    id: generateId(),
    raw,
    source: raw.source,
    stage: 'parse',
    status: 'pending',
    startedAt: new Date(),
  }
}
