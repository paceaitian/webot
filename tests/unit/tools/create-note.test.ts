// CreateNoteTool 单元测试
import { describe, it, expect, afterAll } from 'vitest'
import { mkdtemp, mkdir, readFile, readdir, rm } from 'node:fs/promises'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import matter from 'gray-matter'
import { CreateNoteTool } from '../../../src/tools/create-note.js'
import type { ToolContext } from '../../../src/tools/base.js'

// 模拟 ToolContext
const mockContext: ToolContext = {
  sessionId: 'test-session',
  chatId: 'test-chat',
  responder: { reply: async () => {}, replyCard: async () => {} } as never,
}

let vaultDir: string

describe('CreateNoteTool', async () => {
  vaultDir = await mkdtemp(join(tmpdir(), 'webot-create-note-'))
  const tool = new CreateNoteTool(vaultDir)

  afterAll(async () => {
    await rm(vaultDir, { recursive: true, force: true })
  })

  it('name 为 create_note', () => {
    expect(tool.name).toBe('create_note')
  })

  it('description 包含关键词', () => {
    expect(tool.description).toContain('笔记')
    expect(tool.description).toContain('创建')
  })

  it('parameters 包含 title/content 必填 + tags/summary 可选', () => {
    const params = tool.parameters as {
      properties: Record<string, unknown>
      required: string[]
    }
    expect(params.properties).toHaveProperty('title')
    expect(params.properties).toHaveProperty('content')
    expect(params.properties).toHaveProperty('tags')
    expect(params.properties).toHaveProperty('summary')
    expect(params.required).toEqual(['title', 'content'])
  })

  it('基本创建 — 写入 inbox 目录', async () => {
    const result = await tool.execute(
      { title: '测试笔记', content: '这是测试内容' },
      mockContext,
    )
    expect(result.content).toContain('笔记已创建')
    expect(result.content).toContain('测试笔记')
    expect(result.artifacts).toBeDefined()
    expect(result.artifacts![0].type).toBe('file')
    expect(result.artifacts![0].value).toContain('inbox')

    // 验证文件确实存在且内容正确
    const filePath = result.artifacts![0].value
    const raw = await readFile(filePath, 'utf-8')
    expect(raw).toContain('这是测试内容')
  })

  it('frontmatter 正确 — status/source/command/created', async () => {
    const result = await tool.execute(
      { title: 'FM测试', content: '正文' },
      mockContext,
    )
    const filePath = result.artifacts![0].value
    const raw = await readFile(filePath, 'utf-8')
    const { data } = matter(raw)

    expect(data.status).toBe('inbox')
    expect(data.source).toBe('agent')
    expect(data.command).toBe('create')
    expect(data.created).toBeDefined()
    // created 应为 ISO 格式
    expect(() => new Date(data.created as string)).not.toThrow()
  })

  it('tags 和 summary 可选参数 — 写入 frontmatter', async () => {
    const result = await tool.execute(
      {
        title: '带标签笔记',
        content: '有标签和摘要',
        tags: ['想法', 'webot'],
        summary: '一条测试摘要',
      },
      mockContext,
    )
    const filePath = result.artifacts![0].value
    const raw = await readFile(filePath, 'utf-8')
    const { data } = matter(raw)

    expect(data.tags).toEqual(['想法', 'webot'])
    expect(data.summary).toBe('一条测试摘要')
  })

  it('无 tags/summary 时 frontmatter 不含这两个字段', async () => {
    const result = await tool.execute(
      { title: '无可选参数', content: '纯内容' },
      mockContext,
    )
    const filePath = result.artifacts![0].value
    const raw = await readFile(filePath, 'utf-8')
    const { data } = matter(raw)

    expect(data).not.toHaveProperty('tags')
    expect(data).not.toHaveProperty('summary')
  })

  it('文件名安全化 — 特殊字符被移除', async () => {
    const result = await tool.execute(
      { title: 'test<>:"/\\|?*file', content: '安全化测试' },
      mockContext,
    )
    const filePath = result.artifacts![0].value
    // 提取文件名部分检查（路径本身含 \ 和 :）
    const filename = filePath.split(/[/\\]/).pop()!
    expect(filename).not.toMatch(/[<>:"/|?*]/)
    expect(filename).toContain('testfile')
  })

  it('文件名安全化 — 过长标题被截断到 80 字符', async () => {
    const longTitle = 'A'.repeat(120)
    const result = await tool.execute(
      { title: longTitle, content: '截断测试' },
      mockContext,
    )
    const filePath = result.artifacts![0].value
    // 提取文件名（不含路径和 .md 后缀）
    const filename = filePath.split(/[/\\]/).pop()!.replace(/\.md$/, '')
    expect(filename.length).toBeLessThanOrEqual(80)
  })

  it('同名冲突 — 追加 nanoid 后缀', async () => {
    // 第一次创建
    const result1 = await tool.execute(
      { title: '冲突测试', content: '第一次' },
      mockContext,
    )
    // 第二次同名创建
    const result2 = await tool.execute(
      { title: '冲突测试', content: '第二次' },
      mockContext,
    )

    const path1 = result1.artifacts![0].value
    const path2 = result2.artifacts![0].value

    // 两个路径应不同
    expect(path1).not.toBe(path2)
    // 第二个文件名应含后缀
    expect(path2).toMatch(/冲突测试-.+\.md$/)

    // 两个文件内容不同
    const raw1 = await readFile(path1, 'utf-8')
    const raw2 = await readFile(path2, 'utf-8')
    expect(raw1).toContain('第一次')
    expect(raw2).toContain('第二次')
  })

  it('缺少 title — 返回错误', async () => {
    const result = await tool.execute({ content: '无标题' }, mockContext)
    expect(result.content).toContain('参数错误')
    expect(result.content).toContain('title')
    expect(result.artifacts).toBeUndefined()
  })

  it('缺少 content — 返回错误', async () => {
    const result = await tool.execute({ title: '无内容' }, mockContext)
    expect(result.content).toContain('参数错误')
    expect(result.content).toContain('content')
    expect(result.artifacts).toBeUndefined()
  })

  it('title 为空字符串 — 返回错误', async () => {
    const result = await tool.execute({ title: '  ', content: '空标题' }, mockContext)
    expect(result.content).toContain('参数错误')
  })

  it('目录自动创建 — inbox 不存在时自动建立', async () => {
    // 使用全新的 vault 路径
    const freshVault = await mkdtemp(join(tmpdir(), 'webot-create-note-fresh-'))
    const freshTool = new CreateNoteTool(freshVault)

    // inbox 目录不存在
    const entries = await readdir(freshVault)
    expect(entries).not.toContain('inbox')

    // 创建笔记应自动建立 inbox
    const result = await freshTool.execute(
      { title: '自动建目录', content: '测试' },
      mockContext,
    )
    expect(result.content).toContain('笔记已创建')

    // 验证 inbox 目录已创建
    const entriesAfter = await readdir(freshVault)
    expect(entriesAfter).toContain('inbox')

    await rm(freshVault, { recursive: true, force: true })
  })

  it('空 tags 数组 — frontmatter 不含 tags 字段', async () => {
    const result = await tool.execute(
      { title: '空标签', content: '内容', tags: [] },
      mockContext,
    )
    const filePath = result.artifacts![0].value
    const raw = await readFile(filePath, 'utf-8')
    const { data } = matter(raw)
    expect(data).not.toHaveProperty('tags')
  })
})
