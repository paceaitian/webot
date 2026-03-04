// Writer 集成测试 — 原子写入 + 冲突处理
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { ObsidianWriter } from '../../src/writer/obsidian-writer.js'
import type { ProcessedResult, PipelineContext } from '../../src/types/index.js'

function makeContext(overrides?: Partial<PipelineContext>): PipelineContext {
  return {
    id: 'test-ctx-001',
    source: 'cli',
    startedAt: new Date(),
    status: 'running',
    stage: 'write',
    ...overrides,
  } as PipelineContext
}

function makeProcessed(overrides?: Partial<ProcessedResult>): ProcessedResult {
  return {
    title: '测试笔记标题',
    summary: '这是测试摘要',
    tags: ['测试', '集成测试'],
    content: '这是笔记正文内容',
    model: 'mock',
    isDraft: false,
    ...overrides,
  }
}

describe('ObsidianWriter 集成测试', () => {
  let tmpDir: string
  let vaultPath: string
  let writer: ObsidianWriter

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'webot-writer-'))
    vaultPath = join(tmpDir, 'vault')
    writer = new ObsidianWriter(vaultPath)
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('正常写入：生成 inbox 目录 + Markdown 文件', async () => {
    const ctx = makeContext()
    const processed = makeProcessed()

    const result = await writer.write(processed, ctx)

    expect(result.filePath).toContain('inbox')
    expect(result.title).toBe('测试笔记标题')
    expect(existsSync(result.filePath)).toBe(true)

    const content = readFileSync(result.filePath, 'utf-8')
    expect(content).toContain('status: inbox')
    expect(content).toContain('这是笔记正文内容')
  })

  it('Frontmatter 包含完整字段', async () => {
    const ctx = makeContext({
      extracted: {
        title: '原始标题',
        content: '原始内容',
        url: 'https://example.com/article',
        contentType: 'article',
        author: '张三',
        publishedAt: '2026-02-28',
      },
      parsed: {
        command: { type: 'save', args: undefined },
        content: { type: 'url', url: 'https://example.com/article' },
      },
    } as Partial<PipelineContext>)
    const processed = makeProcessed({ tags: ['AI', '技术'] })

    const result = await writer.write(processed, ctx)
    const content = readFileSync(result.filePath, 'utf-8')

    expect(content).toContain('source: cli')
    expect(content).toContain('source_url:')
    expect(content).toContain('example.com/article')
    expect(content).toContain('command: save')
    expect(content).toContain('author:')
  })

  it('冲突处理：同名文件追加后缀', async () => {
    const ctx = makeContext()
    const processed = makeProcessed({ title: '相同标题' })

    const result1 = await writer.write(processed, ctx)
    const result2 = await writer.write(processed, ctx)

    expect(result1.filePath).not.toBe(result2.filePath)
    expect(existsSync(result1.filePath)).toBe(true)
    expect(existsSync(result2.filePath)).toBe(true)
  })

  it('文件名 sanitize：移除非法字符', async () => {
    const ctx = makeContext()
    const processed = makeProcessed({ title: 'Test<>:"/\\|?*File' })

    const result = await writer.write(processed, ctx)

    // 仅检查文件名部分（不含目录路径）
    const basename = result.filePath.split(/[/\\]/).pop()!
    expect(basename).not.toMatch(/[<>:"|?*]/)
    expect(existsSync(result.filePath)).toBe(true)
  })

  it('长标题截断到 100 字符', async () => {
    const ctx = makeContext()
    const longTitle = '这是一个非常长的标题'.repeat(20)
    const processed = makeProcessed({ title: longTitle })

    const result = await writer.write(processed, ctx)

    // 文件名部分（不含路径和扩展名）应 <= 100 字符
    const basename = result.filePath.split(/[/\\]/).pop()!.replace('.md', '')
    expect(basename.length).toBeLessThanOrEqual(100)
  })

  it('IMG 移除：图片不再嵌入笔记', async () => {
    const ctx = makeContext({
      extracted: {
        title: '图文文章',
        content: '文章内容',
        contentType: 'article',
        images: ['img-abc.png', 'img-def.png'],
      },
    } as Partial<PipelineContext>)
    const processed = makeProcessed()

    const result = await writer.write(processed, ctx)
    const content = readFileSync(result.filePath, 'utf-8')

    // 图片嵌入已移除（公众号垃圾图片污染 vault）
    expect(content).not.toContain('![[img-abc.png]]')
    expect(content).not.toContain('![[img-def.png]]')
  })

  it('无 .tmp 残留文件', async () => {
    const ctx = makeContext()
    const processed = makeProcessed()

    await writer.write(processed, ctx)

    const inboxDir = join(vaultPath, 'inbox')
    const files = readdirSync(inboxDir)
    const tmpFiles = files.filter(f => f.endsWith('.tmp'))
    expect(tmpFiles.length).toBe(0)
  })
})
