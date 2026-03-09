// CreateNoteTool — 直接创建 Obsidian 笔记（不经过网页抓取）
import { writeFile, rename, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import matter from 'gray-matter'
import type { Tool, ToolResult, ToolContext } from './base.js'
import { shortId } from '../utils/id.js'
import { withRetry } from '../utils/retry.js'
import { createLogger } from '../utils/logger.js'

const log = createLogger('tool-create-note')

/** 文件名最大长度 */
const MAX_FILENAME_LENGTH = 80

/**
 * 文件名安全化：移除非法字符，截断到合理长度
 */
function sanitizeFilename(title: string): string {
  return (
    title
      .replace(/[<>:"/\\|?*\x00-\x1f]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, MAX_FILENAME_LENGTH) || 'untitled'
  )
}

/**
 * CreateNoteTool — 直接创建 Obsidian 笔记
 *
 * 适用于记录想法、整理讨论要点、创建备忘录等场景（不需要网页抓取）。
 * 写入 {vaultPath}/inbox/ 目录，使用原子写入 + EBUSY 重试。
 */
export class CreateNoteTool implements Tool {
  name = 'create_note'
  description =
    '直接创建 Obsidian 笔记。适用于记录想法、整理讨论要点、创建备忘录等场景（不需要网页抓取）。'
  parameters = {
    type: 'object' as const,
    properties: {
      title: {
        type: 'string',
        description: '笔记标题',
      },
      content: {
        type: 'string',
        description: '笔记正文（markdown 格式）',
      },
      tags: {
        type: 'array',
        items: { type: 'string' },
        description: '标签列表（可选）',
      },
      summary: {
        type: 'string',
        description: '一句话摘要（可选，写入 frontmatter）',
      },
    },
    required: ['title', 'content'],
  }

  private inboxDir: string

  constructor(vaultPath: string) {
    this.inboxDir = join(vaultPath, 'inbox')
  }

  async execute(params: Record<string, unknown>, _context: ToolContext): Promise<ToolResult> {
    const title = params.title as string | undefined
    const content = params.content as string | undefined
    const tags = params.tags as string[] | undefined
    const summary = params.summary as string | undefined

    // 参数校验
    if (!title || typeof title !== 'string' || !title.trim()) {
      return { content: '参数错误: title 为必填项，不能为空。' }
    }
    if (!content || typeof content !== 'string') {
      return { content: '参数错误: content 为必填项，不能为空。' }
    }

    try {
      // 确保 inbox 目录存在
      await mkdir(this.inboxDir, { recursive: true })

      // 构建 frontmatter（过滤 undefined 值）
      const frontmatter = Object.fromEntries(
        Object.entries({
          status: 'inbox',
          source: 'agent',
          tags: tags && tags.length > 0 ? tags : undefined,
          summary: summary || undefined,
          created: new Date().toISOString(),
          command: 'create',
        }).filter(([, v]) => v !== undefined),
      )

      // 用 gray-matter 序列化
      const markdown = matter.stringify(content, frontmatter)

      // 安全文件名
      const safeTitle = sanitizeFilename(title)
      let filePath = join(this.inboxDir, `${safeTitle}.md`)

      // 同名冲突时追加 nanoid 后缀
      if (existsSync(filePath)) {
        filePath = join(this.inboxDir, `${safeTitle}-${shortId()}.md`)
      }

      // 原子写入：.tmp → rename，EBUSY 重试
      const tmpPath = `${filePath}.tmp`
      await withRetry(
        async () => {
          await writeFile(tmpPath, markdown, 'utf-8')
          await rename(tmpPath, filePath)
        },
        {
          maxRetries: 3,
          baseDelay: 500,
          retryable: (error) => {
            const err = error as NodeJS.ErrnoException
            return err.code === 'EBUSY' || err.code === 'EPERM'
          },
        },
      )

      log.info({ filePath, title: safeTitle }, '笔记创建成功')

      return {
        content: `笔记已创建:\n- 标题: ${safeTitle}\n- 路径: ${filePath}`,
        artifacts: [{ type: 'file', value: filePath }],
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      log.error({ title, error: msg }, 'CreateNoteTool 执行失败')
      return { content: `创建笔记失败: ${msg}` }
    }
  }
}
