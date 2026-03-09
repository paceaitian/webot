// WebFetchTool 单元测试
import { describe, it, expect, vi } from 'vitest'
import { WebFetchTool } from '../../../src/tools/web-fetch.js'
import type { ToolContext } from '../../../src/tools/base.js'
import type { ExtractedContent } from '../../../src/types/index.js'

/** 构造 mock ContentExtractor */
function createMockExtractor(result?: ExtractedContent, error?: Error) {
  return {
    extract: error ? vi.fn().mockRejectedValue(error) : vi.fn().mockResolvedValue(result),
    close: vi.fn(),
  }
}

/** 构造 mock ToolContext */
function createMockContext(): ToolContext {
  return {
    sessionId: 'test-session',
    chatId: 'test-chat',
    responder: { send: vi.fn(), sendCard: vi.fn() } as never,
  }
}

describe('WebFetchTool', () => {
  it('name 为 web_fetch', () => {
    const tool = new WebFetchTool(null as never)
    expect(tool.name).toBe('web_fetch')
  })

  it('description 包含关键词', () => {
    const tool = new WebFetchTool(null as never)
    expect(tool.description).toContain('抓取')
    expect(tool.description).toContain('不保存')
  })

  it('parameters 包含 url 必填字段', () => {
    const tool = new WebFetchTool(null as never)
    const params = tool.parameters as { properties: Record<string, unknown>; required: string[] }
    expect(params.properties).toHaveProperty('url')
    expect(params.required).toContain('url')
  })

  it('正常抓取返回结构化内容', async () => {
    const extracted: ExtractedContent = {
      title: '测试文章',
      content: '这是正文内容。',
      url: 'https://example.com/article',
      author: '张三',
      siteName: '示例站',
      publishedAt: '2026-03-08',
      contentType: 'article',
    }
    const extractor = createMockExtractor(extracted)
    const tool = new WebFetchTool(extractor as never)
    const result = await tool.execute(
      { url: 'https://example.com/article' },
      createMockContext(),
    )

    expect(result.content).toContain('测试文章')
    expect(result.content).toContain('这是正文内容。')
    expect(result.content).toContain('https://example.com/article')
    expect(result.content).toContain('张三')
    expect(result.content).toContain('示例站')
    expect(result.content).toContain('2026-03-08')
    // 确认 extractor.extract 被正确调用
    expect(extractor.extract).toHaveBeenCalledOnce()
    const parsed = extractor.extract.mock.calls[0][0]
    expect(parsed.content).toEqual({ type: 'url', url: 'https://example.com/article' })
  })

  it('长文截断到 8000 字符并附加提示', async () => {
    const longContent = 'A'.repeat(10000)
    const extracted: ExtractedContent = {
      title: '长文测试',
      content: longContent,
      contentType: 'article',
    }
    const extractor = createMockExtractor(extracted)
    const tool = new WebFetchTool(extractor as never)
    const result = await tool.execute(
      { url: 'https://example.com/long' },
      createMockContext(),
    )

    expect(result.content).toContain('长文测试')
    // 截断提示
    expect(result.content).toContain('正文已截断，原文 10000 字符')
    // 正文不应包含完整 10000 个 A
    expect(result.content).not.toContain('A'.repeat(10000))
    // 正文应包含截断后的 8000 个 A
    expect(result.content).toContain('A'.repeat(8000))
  })

  it('8000 字符以内不截断', async () => {
    const content = 'B'.repeat(8000)
    const extracted: ExtractedContent = {
      title: '刚好不截断',
      content,
      contentType: 'article',
    }
    const extractor = createMockExtractor(extracted)
    const tool = new WebFetchTool(extractor as never)
    const result = await tool.execute(
      { url: 'https://example.com/exact' },
      createMockContext(),
    )

    expect(result.content).not.toContain('正文已截断')
    expect(result.content).toContain(content)
  })

  it('抓取失败返回友好错误信息', async () => {
    const extractor = createMockExtractor(undefined, new Error('网络超时'))
    const tool = new WebFetchTool(extractor as never)
    const result = await tool.execute(
      { url: 'https://example.com/fail' },
      createMockContext(),
    )

    expect(result.content).toContain('网页抓取失败')
    expect(result.content).toContain('网络超时')
  })
})
