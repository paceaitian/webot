// SearchVaultTool — 在 Obsidian Vault 中搜索笔记（按关键词、标签过滤）
import { readdir, readFile } from 'fs/promises'
import { join, relative, basename } from 'path'
import matter from 'gray-matter'
import type { Tool, ToolResult, ToolContext } from './base.js'
import { createLogger } from '../utils/logger.js'

const log = createLogger('tool-search-vault')

/** 排除的目录名 */
const EXCLUDED_DIRS = new Set(['.obsidian', 'node_modules', '.trash', '.git'])

/** 匹配来源权重：标题 > 摘要 > 正文 */
const enum MatchSource {
  Title = 3,
  Summary = 2,
  Content = 1,
}

/** 单条搜索结果 */
interface SearchHit {
  /** 相对于 vaultPath 的路径 */
  relativePath: string
  /** 文件名（去掉 .md 后缀） */
  title: string
  /** frontmatter 摘要 */
  summary: string
  /** frontmatter 标签 */
  tags: string[]
  /** 相关度分数 */
score: number
}

/**
 * SearchVaultTool — 搜索 Obsidian 笔记库中的已保存笔记
 *
 * 支持按关键词匹配标题、摘要、正文，可选按标签过滤，
 * 结果按相关度排序返回。
 */
export class SearchVaultTool implements Tool {
  name = 'search_vault'
  description =
    '搜索 Obsidian 笔记库中的已保存笔记。当用户想查找之前保存的内容、按关键词搜索笔记、按标签筛选笔记时使用。'
  parameters = {
    type: 'object' as const,
    properties: {
      query: {
        type: 'string',
        description: '搜索关键词（匹配标题、摘要、正文）',
      },
      tags: {
        type: 'array',
        items: { type: 'string' },
        description: '按标签过滤（可选）',
      },
      limit: {
        type: 'number',
        description: '最大返回条数（默认 10）',
      },
    },
    required: ['query'],
  }

  constructor(private vaultPath: string) {}

  async execute(params: Record<string, unknown>, _context: ToolContext): Promise<ToolResult> {
    const query = (params.query as string).toLowerCase()
    const filterTags = (params.tags as string[] | undefined) ?? []
    const limit = (params.limit as number | undefined) ?? 10

    log.info({ query, tags: filterTags, limit }, '搜索 Vault 笔记')

    try {
      const mdFiles = await this.collectMarkdownFiles(this.vaultPath)
      const hits: SearchHit[] = []

      for (const filePath of mdFiles) {
        const hit = await this.matchFile(filePath, query, filterTags)
        if (hit) {
          hits.push(hit)
        }
      }

      // 按相关度降序排序
      hits.sort((a, b) => b.score - a.score)
      const results = hits.slice(0, limit)

      if (results.length === 0) {
        return { content: `未找到与「${params.query as string}」相关的笔记。` }
      }

      const lines = results.map((h, i) => {
        const tagStr = h.tags.length > 0 ? `  标签: ${h.tags.join(', ')}` : ''
        return `${i + 1}. **${h.title}**\n   路径: ${h.relativePath}\n   摘要: ${h.summary || '（无摘要）'}${tagStr}`
      })

      return {
        content: `找到 ${hits.length} 条结果（显示前 ${results.length} 条）:\n\n${lines.join('\n\n')}`,
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      log.error({ error: msg }, '搜索 Vault 失败')
      return { content: `搜索失败: ${msg}` }
    }
  }

  /**
   * 递归收集 vaultPath 下所有 .md 文件，排除特定目录
   */
  private async collectMarkdownFiles(dir: string): Promise<string[]> {
    const entries = await readdir(dir, { withFileTypes: true })
    const files: string[] = []

    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (EXCLUDED_DIRS.has(entry.name)) continue
        const subFiles = await this.collectMarkdownFiles(join(dir, entry.name))
        files.push(...subFiles)
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        files.push(join(dir, entry.name))
      }
    }

    return files
  }

  /**
   * 匹配单个文件，返回 SearchHit 或 null
   */
  private async matchFile(
    filePath: string,
    query: string,
    filterTags: string[],
  ): Promise<SearchHit | null> {
    try {
      const raw = await readFile(filePath, 'utf-8')
      const { data, content } = matter(raw)

      const title = basename(filePath, '.md')
      const summary = typeof data.summary === 'string' ? data.summary : ''
      const tags: string[] = Array.isArray(data.tags) ? data.tags : []

      // 标签过滤：要求所有 filterTags 都存在于文件 tags 中
      if (filterTags.length > 0) {
        const lowerTags = tags.map((t) => t.toLowerCase())
        const allMatch = filterTags.every((ft) => lowerTags.includes(ft.toLowerCase()))
        if (!allMatch) return null
      }

      // 关键词匹配（case-insensitive）— 标题 > 摘要 > 标签/正文
      let score = 0
      if (title.toLowerCase().includes(query)) {
        score += MatchSource.Title
      }
      if (summary.toLowerCase().includes(query)) {
        score += MatchSource.Summary
      }
      const tagsStr = tags.join(' ').toLowerCase()
      if (tagsStr.includes(query) || content.toLowerCase().includes(query)) {
        score += MatchSource.Content
      }

      if (score === 0) return null

      return {
        relativePath: relative(this.vaultPath, filePath).replace(/\\/g, '/'),
        title,
        summary,
        tags,
        score,
      }
    } catch (error) {
      // 单文件解析失败不影响整体搜索
      log.warn({ filePath, error: String(error) }, '解析文件失败，跳过')
      return null
    }
  }
}
