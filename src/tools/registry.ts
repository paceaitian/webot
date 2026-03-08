// 工具注册表 — 运行时注册/注销/查询
import type { Tool, ToolDefinition } from './base.js'
import { createLogger } from '../utils/logger.js'

const log = createLogger('tool-registry')

/**
 * 工具注册表 — 管理所有可用工具，支持运行时热插拔
 */
export class ToolRegistry {
  private tools = new Map<string, Tool>()

  /** 注册工具（已存在则覆盖） */
  register(tool: Tool): void {
    this.tools.set(tool.name, tool)
    log.info({ tool: tool.name }, '工具已注册')
  }

  /** 注销工具 */
  unregister(name: string): void {
    this.tools.delete(name)
  }

  /** 按名获取工具 */
  get(name: string): Tool | undefined {
    return this.tools.get(name)
  }

  /** 获取所有已注册工具 */
  getAll(): Tool[] {
    return [...this.tools.values()]
  }

  /** 转为 LLM tool_use schema 格式 */
  getDefinitions(): ToolDefinition[] {
    return this.getAll().map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.parameters,
    }))
  }
}
