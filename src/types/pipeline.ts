// 管道相关类型定义
import type { MessageContent, MessageSource, RawMessage } from './message.js'

/** 指令类型 */
export type CommandType = 'save' | 'discuss' | 'quote' | 'help' | 'none'

/** 解析后的指令 */
export interface Command {
  type: CommandType
  /** 指令附加参数（如 #quote 后的关键词） */
  args?: string
}

/** 解析后的消息 */
export interface ParsedMessage {
  /** 原始消息引用 */
  raw: RawMessage
  /** 解析出的指令 */
  command: Command
  /** 解析出的内容 */
  content: MessageContent
}

/** 管道阶段 */
export type PipelineStage = 'parse' | 'dedup' | 'extract' | 'process' | 'write' | 'respond'

/** 管道状态 */
export type PipelineStatus = 'pending' | 'running' | 'completed' | 'failed' | 'draft'

/** 抓取到的内容 */
export interface ExtractedContent {
  /** 文章标题 */
  title: string
  /** 正文（Markdown 格式） */
  content: string
  /** 来源 URL */
  url?: string
  /** 作者 */
  author?: string
  /** 发布时间 */
  publishedAt?: string
  /** 来源站点名（如公众号名称） */
  siteName?: string
  /** 内容类型标识 */
  contentType: 'article' | 'text' | 'image'
}

/** AI 处理结果 */
export interface ProcessedResult {
  /** 笔记标题 */
  title: string
  /** L0 摘要（≤80 字） */
  summary: string
  /** L1 要点（300-500 字 Markdown） */
  keyPoints: string
  /** 标签列表 */
  tags: string[]
  /** L2 详情（完整 Markdown 正文） */
  content: string
  /** 使用的 AI 模型 */
  model: string
  /** 是否为草稿（AI 处理失败时） */
  isDraft: boolean
}

/** 写入完成的笔记信息 */
export interface WrittenNote {
  /** 笔记文件路径 */
  filePath: string
  /** 笔记标题 */
  title: string
}

/** 管道上下文（贯穿整个处理流程） */
export interface PipelineContext {
  /** 处理 ID */
  id: string
  /** 原始消息 */
  raw: RawMessage
  /** 消息来源 */
  source: MessageSource
  /** 当前阶段 */
  stage: PipelineStage
  /** 当前状态 */
  status: PipelineStatus
  /** 数据库 Job ID（用于二次处理） */
  jobId?: string
  /** 是否为二次处理（reprocess 不显示交互按钮） */
  isReprocess?: boolean
  /** 解析结果 */
  parsed?: ParsedMessage
  /** 抓取结果 */
  extracted?: ExtractedContent
  /** AI 处理结果 */
  processed?: ProcessedResult
  /** 写入结果 */
  written?: WrittenNote
  /** 错误信息 */
  error?: string
  /** 开始时间 */
  startedAt: Date
  /** 完成时间 */
  completedAt?: Date
}
