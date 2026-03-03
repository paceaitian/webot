// AI 处理结果 JSON Schema（Structured Output，L0/L1/L2 信息分层）
export const noteSchema = {
  type: 'object' as const,
  properties: {
    title: {
      type: 'string' as const,
      description: '笔记标题，简洁概括主题',
    },
    summary: {
      type: 'string' as const,
      description: 'L0 摘要，≤80 字，用于仪表盘和 frontmatter',
    },
    key_points: {
      type: 'string' as const,
      description: 'L1 要点，300-500 字 Markdown，核心结论和要点列表',
    },
    tags: {
      type: 'array' as const,
      items: { type: 'string' as const },
      description: '3-7 个标签，使用中文',
    },
    content: {
      type: 'string' as const,
      description: 'L2 详情，完整 Markdown 正文',
    },
  },
  required: ['title', 'summary', 'key_points', 'tags', 'content'] as const,
}

/** Schema 对应的类型 */
export interface NoteSchemaOutput {
  title: string
  /** L0 摘要（≤80 字） */
  summary: string
  /** L1 要点（300-500 字 Markdown） */
  key_points: string
  tags: string[]
  /** L2 详情（完整正文） */
  content: string
}
