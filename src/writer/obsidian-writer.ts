// Obsidian Writer — 原子写入 + EBUSY 重试 + 附件管理
import { writeFile, rename, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { ProcessedResult, WrittenNote, PipelineContext, NoteData, NoteFrontmatter } from '../types/index.js'
import type { Writer } from '../pipeline/engine.js'
import { stringifyNote } from './frontmatter.js'
import { shortId } from '../utils/id.js'
import { withRetry } from '../utils/retry.js'
import { createLogger } from '../utils/logger.js'

const log = createLogger('writer')

/**
 * Obsidian Writer — 将处理结果写入 Obsidian Vault
 */
export class ObsidianWriter implements Writer {
  private inboxDir: string
  private attachmentDir: string

  constructor(vaultPath: string) {
    this.inboxDir = join(vaultPath, 'inbox')
    this.attachmentDir = join(this.inboxDir, '附件')
  }

  /** 获取附件目录路径（供 Extractor 使用） */
  getAttachmentDir(): string {
    return this.attachmentDir
  }

  async write(processed: ProcessedResult, context: PipelineContext): Promise<WrittenNote> {
    const start = Date.now()
    // 确保目录存在
    await mkdir(this.inboxDir, { recursive: true })

    // 构建 Frontmatter（过滤 undefined 值避免 YAML 序列化错误）
    const frontmatter = Object.fromEntries(
      Object.entries({
        status: 'inbox',
        source: context.source,
        source_url: context.extracted?.url,
        tags: processed.tags,
        summary: processed.summary,
        created: new Date().toISOString(),
        command: context.parsed?.command.type ?? 'none',
        ai_model: processed.model,
        author: context.extracted?.author,
        published_at: context.extracted?.publishedAt,
        site_name: context.extracted?.siteName,
        word_count: processed.content ? processed.content.length : undefined,
      } satisfies NoteFrontmatter).filter(([, v]) => v !== undefined),
    ) as unknown as NoteFrontmatter

    // 构建 L0/L1/L2 分层内容
    let body = ''

    // L1 要点（key_points 非空时生成 ## 摘要 章节）
    if (processed.keyPoints) {
      body += `## 摘要\n\n${processed.keyPoints}\n\n`
    }

    // L2 详情
    body += `## 详情\n\n${processed.content}`

    const noteData: NoteData = { frontmatter, content: body }
    const markdown = stringifyNote(noteData)

    // 生成安全文件名（含指令前缀）
    const command = context.parsed?.command.type ?? 'none'
    const prefix = (command !== 'none' && command !== 'help') ? `[${command}] ` : ''
    const filename = `${prefix}${this.sanitizeFilename(processed.title)}`
    let filePath = join(this.inboxDir, `${filename}.md`)

    // 冲突处理：同名追加 nanoid 后缀
    if (existsSync(filePath)) {
      filePath = join(this.inboxDir, `${filename}-${shortId()}.md`)
    }

    // 原子写入：写 .tmp → rename
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
          // EBUSY 错误（OneDrive 锁）可重试
          const err = error as NodeJS.ErrnoException
          return err.code === 'EBUSY' || err.code === 'EPERM'
        },
      },
    )

    log.info({ filePath, title: processed.title, duration: Date.now() - start }, '笔记写入成功')

    return {
      filePath,
      title: processed.title,
    }
  }

  /**
   * 文件名 sanitize：移除 Windows 非法字符，限 100 字符
   */
  private sanitizeFilename(title: string): string {
    return title
      .replace(/[<>:"/\\|?*\x00-\x1f]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 100) || 'untitled'
  }
}
