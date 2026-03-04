// 笔记相关类型定义

/** 笔记 Frontmatter */
export interface NoteFrontmatter {
  /** 状态（默认 inbox） */
  status: 'inbox' | 'processing' | 'done'
  /** 来源标识 */
  source: string
  /** 来源 URL */
  source_url?: string
  /** 标签列表 */
  tags: string[]
  /** 摘要 */
  summary: string
  /** 创建时间 */
  created: string
  /** 使用的指令 */
  command: string
  /** 使用的 AI 模型 */
  ai_model: string
  /** 作者 */
  author?: string
  /** 发布时间 */
  published_at?: string
  /** 站点名称 */
  site_name?: string
  /** 正文字数 */
  word_count?: number
}

/** 完整笔记数据（Frontmatter + 正文） */
export interface NoteData {
  /** Frontmatter 数据 */
  frontmatter: NoteFrontmatter
  /** Markdown 正文 */
  content: string
}
