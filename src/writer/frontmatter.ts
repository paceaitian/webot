// gray-matter Frontmatter 封装
import matter from 'gray-matter'
import type { NoteFrontmatter, NoteData } from '../types/index.js'

/**
 * 将 NoteData 序列化为 Frontmatter + Markdown 字符串
 */
export function stringifyNote(data: NoteData): string {
  return matter.stringify(data.content, data.frontmatter)
}

/**
 * 从 Markdown 字符串解析 NoteData
 */
export function parseNote(markdown: string): NoteData {
  const { data, content } = matter(markdown)
  return {
    frontmatter: data as NoteFrontmatter,
    content,
  }
}
