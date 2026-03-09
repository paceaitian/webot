// ReadNoteTool — 读取指定 Obsidian 笔记的完整内容（frontmatter + 正文）
import { readFile, readdir, stat } from 'node:fs/promises'
import { join, extname } from 'node:path'
import matter from 'gray-matter'
import type { Tool, ToolResult, ToolContext } from './base.js'
import { createLogger } from '../utils/logger.js'

const log = createLogger('tool-read-note')

/** 正文最大字符数，超过截断 */
const MAX_CONTENT_LENGTH = 12000

/**
 * ReadNoteTool — 读取 Obsidian vault 中的笔记
 *
 * 支持两种查找方式：
 * - path：相对于 vault 根目录的路径，直接读取
 * - title：模糊匹配文件名，递归搜索 vault
 */
export class ReadNoteTool implements Tool {
  name = 'read_note'
  description =
    '读取 Obsidian 笔记的完整内容，包括 frontmatter 元信息和正文。当需要查看之前保存的文章详情、阅读笔记内容时使用。'
  parameters = {
    type: 'object' as const,
    properties: {
      path: {
        type: 'string',
        description: '笔记的相对路径（相对于 vault 根目录）',
      },
      title: {
        type: 'string',
        description: '笔记标题（模糊匹配文件名）',
      },
    },
  }

  constructor(private vaultPath: string) {}

  async execute(params: Record<string, unknown>, _context: ToolContext): Promise<ToolResult> {
    const path = params.path as string | undefined
    const title = params.title as string | undefined

    if (!path && !title) {
      return { content: '请提供 path 或 title 参数之一来指定要读取的笔记。' }
    }

    try {
      let filePath: string

      if (path) {
        filePath = join(this.vaultPath, path)
      } else {
        // title 模糊匹配
        const found = await this.findByTitle(this.vaultPath, title!)
        if (!found) {
          return { content: `未找到标题包含「${title}」的笔记。` }
        }
        filePath = found
      }

      // 检查文件是否存在
      try {
        await stat(filePath)
      } catch {
        return { content: `文件不存在: ${path ?? title}` }
      }

      const raw = await readFile(filePath, 'utf-8')
      const { data: frontmatter, content } = matter(raw)

      log.info({ filePath }, '读取笔记成功')

      // 格式化输出
      const metaLines = this.formatFrontmatter(frontmatter)
      let body = content.trim()
      let truncated = false

      if (body.length > MAX_CONTENT_LENGTH) {
        body = body.slice(0, MAX_CONTENT_LENGTH)
        truncated = true
      }

      const parts = ['## 元信息', metaLines, '', '## 正文', body]
      if (truncated) {
        parts.push('', `...(正文已截断，原文共 ${content.trim().length} 字符)`)
      }

      return {
        content: parts.join('\n'),
        artifacts: [{ type: 'file', value: filePath }],
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      log.error({ path, title, error: msg }, '读取笔记失败')
      return { content: `读取笔记失败: ${msg}` }
    }
  }

  /**
   * 递归扫描 vault 目录，找到文件名包含 title 的第一个 .md 文件
   */
  private async findByTitle(dir: string, title: string): Promise<string | null> {
    const lowerTitle = title.toLowerCase()
    const entries = await readdir(dir, { withFileTypes: true })

    for (const entry of entries) {
      // 跳过隐藏目录（如 .obsidian）
      if (entry.name.startsWith('.')) continue

      const fullPath = join(dir, entry.name)

      if (entry.isDirectory()) {
        const found = await this.findByTitle(fullPath, title)
        if (found) return found
      } else if (
        extname(entry.name).toLowerCase() === '.md' &&
        entry.name.toLowerCase().includes(lowerTitle)
      ) {
        return fullPath
      }
    }

    return null
  }

  /**
   * 将 frontmatter 对象格式化为可读文本
   */
  private formatFrontmatter(fm: Record<string, unknown>): string {
    if (!fm || Object.keys(fm).length === 0) return '（无 frontmatter）'

    return Object.entries(fm)
      .map(([key, value]) => {
        if (Array.isArray(value)) {
          return `- **${key}**: ${value.join(', ')}`
        }
        return `- **${key}**: ${String(value)}`
      })
      .join('\n')
  }
}
