// SearchVaultTool 单元测试 — 验证 Vault 笔记搜索功能
import { describe, it, expect, afterAll, beforeAll } from 'vitest'
import { mkdir, writeFile, rm } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { SearchVaultTool } from '../../../src/tools/search-vault.js'
import type { ToolContext } from '../../../src/tools/base.js'

/** 构造测试用 ToolContext */
const mockContext: ToolContext = {
  sessionId: 'test-session',
  chatId: 'test-chat',
  responder: { send: async () => {} } as never,
}

/** 临时 vault 目录 */
const vaultDir = join(tmpdir(), `webot-test-vault-${Date.now()}`)

/** 创建带 frontmatter 的测试 .md 文件 */
async function createNote(dir: string, filename: string, frontmatter: Record<string, unknown>, content: string) {
  const fmLines = Object.entries(frontmatter)
    .map(([k, v]) => {
      if (Array.isArray(v)) return `${k}:\n${v.map((i) => `  - ${i}`).join('\n')}`
      return `${k}: ${JSON.stringify(v)}`
    })
    .join('\n')
  const md = `---\n${fmLines}\n---\n${content}\n`
  await writeFile(join(dir, filename), md, 'utf-8')
}

describe('SearchVaultTool', () => {
  let tool: SearchVaultTool

  beforeAll(async () => {
    // 构建临时 vault 结构
    const inboxDir = join(vaultDir, 'inbox')
    const digestDir = join(vaultDir, 'digest')
    const obsidianDir = join(vaultDir, '.obsidian')
    const trashDir = join(vaultDir, '.trash')

    await mkdir(inboxDir, { recursive: true })
    await mkdir(digestDir, { recursive: true })
    await mkdir(obsidianDir, { recursive: true })
    await mkdir(trashDir, { recursive: true })

    // 笔记 1：标题包含 TypeScript
    await createNote(inboxDir, '[save] TypeScript 入门指南.md', {
      status: 'done',
      source: 'web',
      tags: ['typescript', 'programming'],
      summary: '一篇关于 TypeScript 基础语法的教程',
    }, '本文介绍 TypeScript 的类型系统和常用特性。')

    // 笔记 2：摘要包含 Rust
    await createNote(inboxDir, '[save] 系统编程语言对比.md', {
      status: 'done',
      source: 'web',
      tags: ['rust', 'programming', 'performance'],
      summary: 'Rust 与 C++ 在系统编程领域的对比分析',
    }, '从内存安全、并发模型和生态系统三个维度进行比较。')

    // 笔记 3：正文包含 AI
    await createNote(inboxDir, '[save] 2024 年技术趋势.md', {
      status: 'done',
      source: 'web',
      tags: ['trends', 'tech'],
      summary: '年度技术趋势总结',
    }, '2024 年最值得关注的技术趋势包括 AI 大模型、WebAssembly 和边缘计算。')

    // 笔记 4：digest 目录下的简报
    await createNote(digestDir, '2024-12-01.md', {
      status: 'done',
      source: 'digest',
      tags: ['daily-digest'],
      summary: '每日技术简报',
    }, '今日热点：TypeScript 5.4 发布，新增 NoInfer 类型工具。')

    // .obsidian 目录下的文件（应被排除）
    await writeFile(join(obsidianDir, 'config.md'), '# Config\nTypeScript settings', 'utf-8')

    // .trash 目录下的文件（应被排除）
    await createNote(trashDir, 'deleted-note.md', {
      status: 'inbox',
      source: 'web',
      tags: ['typescript'],
      summary: '已删除的 TypeScript 笔记',
    }, 'This should not appear in search results.')

    tool = new SearchVaultTool(vaultDir)
  })

  afterAll(async () => {
    await rm(vaultDir, { recursive: true, force: true })
  })

  // --- 基本属性 ---

  it('name 为 search_vault', () => {
    expect(tool.name).toBe('search_vault')
  })

  it('description 包含搜索和笔记关键词', () => {
    expect(tool.description).toContain('搜索')
    expect(tool.description).toContain('笔记')
  })

  it('parameters 包含 query 必填字段', () => {
    const params = tool.parameters as { properties: Record<string, unknown>; required: string[] }
    expect(params.properties).toHaveProperty('query')
    expect(params.properties).toHaveProperty('tags')
    expect(params.properties).toHaveProperty('limit')
    expect(params.required).toContain('query')
  })

  // --- 关键词搜索 ---

  it('按标题关键词搜索', async () => {
    const result = await tool.execute({ query: 'TypeScript 入门' }, mockContext)
    expect(result.content).toContain('TypeScript 入门指南')
  })

  it('按摘要关键词搜索', async () => {
    const result = await tool.execute({ query: 'Rust' }, mockContext)
    expect(result.content).toContain('系统编程语言对比')
  })

  it('按正文关键词搜索', async () => {
    const result = await tool.execute({ query: 'WebAssembly' }, mockContext)
    expect(result.content).toContain('2024 年技术趋势')
  })

  it('搜索不区分大小写', async () => {
    const result = await tool.execute({ query: 'typescript' }, mockContext)
    expect(result.content).toContain('TypeScript 入门指南')
  })

  it('跨目录搜索（inbox + digest）', async () => {
    const result = await tool.execute({ query: 'TypeScript' }, mockContext)
    // 应同时找到 inbox 和 digest 目录下的笔记
    expect(result.content).toContain('TypeScript 入门指南')
    expect(result.content).toContain('2024-12-01')
  })

  // --- 相关度排序 ---

  it('标题匹配排在摘要/正文匹配前面', async () => {
    const result = await tool.execute({ query: 'TypeScript' }, mockContext)
    // 标题匹配（TypeScript 入门指南）应排在正文匹配（2024-12-01 简报）前面
    const titleIdx = result.content.indexOf('TypeScript 入门指南')
    const digestIdx = result.content.indexOf('2024-12-01')
    expect(titleIdx).toBeLessThan(digestIdx)
  })

  // --- 标签过滤 ---

  it('按标签过滤结果', async () => {
    const result = await tool.execute({ query: 'programming', tags: ['rust'] }, mockContext)
    expect(result.content).toContain('系统编程语言对比')
    expect(result.content).not.toContain('TypeScript 入门指南')
  })

  it('多标签交集过滤', async () => {
    const result = await tool.execute({ query: 'programming', tags: ['rust', 'performance'] }, mockContext)
    expect(result.content).toContain('系统编程语言对比')
  })

  it('标签不匹配时返回空', async () => {
    const result = await tool.execute({ query: 'TypeScript', tags: ['nonexistent-tag'] }, mockContext)
    expect(result.content).toContain('未找到')
  })

  // --- 空结果 ---

  it('无匹配时返回友好提示', async () => {
    const result = await tool.execute({ query: 'zzz_no_match_zzz' }, mockContext)
    expect(result.content).toContain('未找到')
    expect(result.content).toContain('zzz_no_match_zzz')
  })

  // --- limit 参数 ---

  it('limit 限制返回条数', async () => {
    const result = await tool.execute({ query: 'TypeScript', limit: 1 }, mockContext)
    // 应只显示 1 条结果
    expect(result.content).toContain('显示前 1 条')
  })

  // --- 排除目录 ---

  it('排除 .obsidian 和 .trash 目录', async () => {
    const result = await tool.execute({ query: 'TypeScript' }, mockContext)
    expect(result.content).not.toContain('config')
    expect(result.content).not.toContain('deleted-note')
    expect(result.content).not.toContain('已删除')
  })
})
