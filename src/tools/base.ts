// 工具系统基础类型定义
import type { Responder } from '../responder/base.js'

/** 工具执行结果 */
export interface ToolResult {
  /** 返回给 LLM 的结果文本 */
  content: string
  /** 副产物（文件路径、卡片 ID 等） */
  artifacts?: Array<{ type: string; value: string }>
  /** 建议后续轮次升级模型（如 'opus'） */
  upgradeModel?: string
}

/** 工具执行上下文 */
export interface ToolContext {
  /** 当前会话 ID（群聊为 chatId:userId） */
  sessionId: string
  /** 飞书 chat ID（或 CLI 标识） */
  chatId: string
  /** 用户标识（飞书 open_id / CLI 固定值） */
  userId: string
  /** 进度反馈 */
  responder: Responder
}

/** 工具接口 — 所有工具必须实现 */
export interface Tool {
  /** 工具唯一标识（如 'save'、'digest'） */
  name: string
  /** 给 LLM 看的功能描述 */
  description: string
  /** 参数 JSON Schema */
  parameters: Record<string, unknown>
  /** 执行工具 */
  execute(params: Record<string, unknown>, context: ToolContext): Promise<ToolResult>
}

/** LLM tool_use schema 格式（传给 Vercel AI SDK） */
export interface ToolDefinition {
  name: string
  description: string
  input_schema: Record<string, unknown>
}
