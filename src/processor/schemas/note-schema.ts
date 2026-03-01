// AI 处理结果 JSON Schema（Structured Output）
export const noteSchema = {
  type: 'object' as const,
  properties: {
    title: {
      type: 'string' as const,
      description: '笔记标题，简洁概括主题',
    },
    summary: {
      type: 'string' as const,
      description: '内容摘要，100-200 字',
    },
    tags: {
      type: 'array' as const,
      items: { type: 'string' as const },
      description: '3-7 个标签，使用中文',
    },
    content: {
      type: 'string' as const,
      description: '处理后的 Markdown 正文',
    },
  },
  required: ['title', 'summary', 'tags', 'content'] as const,
}

/** Schema 对应的类型 */
export interface NoteSchemaOutput {
  title: string
  summary: string
  tags: string[]
  content: string
}
