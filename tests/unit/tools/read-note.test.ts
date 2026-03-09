// ReadNoteTool 单元测试
import { describe, it, expect, afterAll } from 'vitest'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { ReadNoteTool } from '../../../src/tools/read-note.js'
import type { ToolContext } from '../../../src/tools/base.js'

// 模拟 ToolContext
const mockContext: ToolContext = {
  sessionId: 'test-session',
  chatId: 'test-chat',
  responder: { reply: async () => {}, replyCard: async () => {} } as never,
}

// 带 frontmatter 的测试笔记
const NOTE_WITH_FM = `---
status: done
source: web
tags:
  - typescript
  - testing
summary: 一篇关于测试的文章
created: "2026-03-08"
command: save
ai_model: claude
---

# 测试文章标题

这是正文内容，用于验证读取功能。
`

let vaultDir: string

// 创建临时 vault 目录结构
async function setupVault(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'webot-read-note-'))
  await mkdir(join(dir, 'inbox'), { recursive: true })
  await mkdir(join(dir, 'archive'), { recursive: true })
  await mkdir(join(dir, '.obsidian'), { recursive: true })

  // inbox 下的笔记
  await writeFile(join(dir, 'inbox', '[save] TypeScript 测试指南.md'), NOTE_WITH_FM, 'utf-8')
  await writeFile(join(dir, 'inbox', '[discuss] AI 讨论记录.md'), '---\nstatus: inbox\n---\n\n讨论内容', 'utf-8')

  // archive 下的笔记
  await writeFile(join(dir, 'archive', '[save] 旧文章.md'), '---\nstatus: done\n---\n\n旧内容', 'utf-8')

  // .obsidian 下的配置文件（应被跳过）
  await writeFile(join(dir, '.obsidian', 'app.json'), '{}', 'utf-8')

  return dir
}

describe('ReadNoteTool', async () => {
  vaultDir = await setupVault()
  const tool = new ReadNoteTool(vaultDir)

  afterAll(async () => {
    await rm(vaultDir, { recursive: true, force: true })
  })

  it('name 为 read_note', () => {
    expect(tool.name).toBe('read_note')
  })

  it('description 包含关键词', () => {
    expect(tool.description).toContain('笔记')
    expect(tool.description).toContain('读取')
  })

  it('parameters 包含 path 和 title 字段', () => {
    const params = tool.parameters as { properties: Record<string, unknown> }
    expect(params.properties).toHaveProperty('path')
    expect(params.properties).toHaveProperty('title')
  })

  it('path 模式 — 直接读取文件', async () => {
    const result = await tool.execute(
      { path: 'inbox/[save] TypeScript 测试指南.md' },
      mockContext,
    )
    expect(result.content).toContain('status')
    expect(result.content).toContain('done')
    expect(result.content).toContain('测试文章标题')
    expect(result.content).toContain('typescript, testing')
    expect(result.artifacts).toBeDefined()
    expect(result.artifacts![0].type).toBe('file')
  })

  it('title 模式 — 模糊匹配文件名', async () => {
    const result = await tool.execute({ title: 'TypeScript' }, mockContext)
    expect(result.content).toContain('测试文章标题')
    expect(result.content).toContain('typescript')
  })

  it('title 模式 — 大小写不敏感', async () => {
    const result = await tool.execute({ title: 'typescript' }, mockContext)
    expect(result.content).toContain('测试文章标题')
  })

  it('title 模式 — 匹配 archive 子目录', async () => {
    const result = await tool.execute({ title: '旧文章' }, mockContext)
    expect(result.content).toContain('旧内容')
  })

  it('title 模式 — 跳过 .obsidian 隐藏目录', async () => {
    const result = await tool.execute({ title: 'app' }, mockContext)
    expect(result.content).toContain('未找到')
  })

  it('文件不存在 — 返回友好错误', async () => {
    const result = await tool.execute({ path: 'not-exist.md' }, mockContext)
    expect(result.content).toContain('文件不存在')
  })

  it('title 不匹配 — 返回未找到提示', async () => {
    const result = await tool.execute({ title: '不存在的笔记' }, mockContext)
    expect(result.content).toContain('未找到')
    expect(result.content).toContain('不存在的笔记')
  })

  it('path 和 title 都不提供 — 返回提示', async () => {
    const result = await tool.execute({}, mockContext)
    expect(result.content).toContain('请提供')
    expect(result.content).toContain('path')
    expect(result.content).toContain('title')
  })

  it('长文截断 — 超过 12000 字符时截断', async () => {
    // 创建超长笔记
    const longContent = '---\nstatus: inbox\n---\n\n' + 'A'.repeat(15000)
    await writeFile(join(vaultDir, 'inbox', '[save] 超长笔记.md'), longContent, 'utf-8')

    const result = await tool.execute({ title: '超长笔记' }, mockContext)
    expect(result.content).toContain('正文已截断')
    expect(result.content).toContain('15000')
    // 截断后正文部分不应超过 12000
    const bodyStart = result.content.indexOf('## 正文')
    const truncateNotice = result.content.indexOf('...(正文已截断')
    const bodySection = result.content.slice(bodyStart + 6, truncateNotice)
    expect(bodySection.length).toBeLessThanOrEqual(12100) // 含换行余量
  })
})
