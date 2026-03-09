// WebSearchTool 单元测试
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { WebSearchTool } from '../../../src/tools/web-search.js'
import type { ToolContext } from '../../../src/tools/base.js'

/** 构造 mock ToolContext */
function createMockContext(): ToolContext {
  return {
    sessionId: 'test-session',
    chatId: 'test-chat',
    responder: { send: vi.fn(), sendCard: vi.fn() } as never,
  }
}

/** 构造 Serper API 正常响应 */
function createMockResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: vi.fn().mockResolvedValue(body),
    text: vi.fn().mockResolvedValue(JSON.stringify(body)),
  } as unknown as Response
}

describe('WebSearchTool', () => {
  let originalFetch: typeof globalThis.fetch

  beforeEach(() => {
    originalFetch = globalThis.fetch
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    vi.restoreAllMocks()
  })

  it('name 为 web_search', () => {
    const tool = new WebSearchTool('test-key')
    expect(tool.name).toBe('web_search')
  })

  it('description 包含关键词', () => {
    const tool = new WebSearchTool('test-key')
    expect(tool.description).toContain('搜索')
  })

  it('parameters 包含 query 必填字段', () => {
    const tool = new WebSearchTool('test-key')
    const params = tool.parameters as { properties: Record<string, unknown>; required: string[] }
    expect(params.properties).toHaveProperty('query')
    expect(params.properties).toHaveProperty('num')
    expect(params.required).toContain('query')
  })

  it('无 API key 时返回功能未启用提示', async () => {
    const tool = new WebSearchTool('')
    const result = await tool.execute({ query: 'test' }, createMockContext())

    expect(result.content).toContain('未启用')
    expect(result.content).toContain('SERPER_API_KEY')
  })

  it('正常搜索返回格式化结果', async () => {
    const mockData = {
      organic: [
        { title: 'TypeScript 入门', link: 'https://ts.dev', snippet: 'TS 基础教程', position: 1 },
        { title: 'Node.js 文档', link: 'https://nodejs.org', snippet: 'Node 官方文档', position: 2 },
      ],
    }
    globalThis.fetch = vi.fn().mockResolvedValue(createMockResponse(mockData))

    const tool = new WebSearchTool('test-key')
    const result = await tool.execute({ query: 'TypeScript 教程' }, createMockContext())

    expect(result.content).toContain('TypeScript 教程')
    expect(result.content).toContain('TypeScript 入门')
    expect(result.content).toContain('https://ts.dev')
    expect(result.content).toContain('TS 基础教程')
    expect(result.content).toContain('Node.js 文档')
    expect(result.content).toContain('https://nodejs.org')

    // 验证 fetch 调用参数
    expect(globalThis.fetch).toHaveBeenCalledOnce()
    const [url, options] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(url).toBe('https://google.serper.dev/search')
    expect(options.method).toBe('POST')
    expect(options.headers['X-API-KEY']).toBe('test-key')
    const body = JSON.parse(options.body as string)
    expect(body.q).toBe('TypeScript 教程')
    expect(body.num).toBe(10)
  })

  it('knowledgeGraph 优先展示', async () => {
    const mockData = {
      knowledgeGraph: {
        title: 'TypeScript',
        description: 'TypeScript 是由微软开发的编程语言',
      },
      organic: [
        { title: '结果 1', link: 'https://example.com', snippet: '摘要', position: 1 },
      ],
    }
    globalThis.fetch = vi.fn().mockResolvedValue(createMockResponse(mockData))

    const tool = new WebSearchTool('test-key')
    const result = await tool.execute({ query: 'TypeScript' }, createMockContext())

    // 知识面板应出现在搜索结果之前
    const kgIndex = result.content.indexOf('知识面板')
    const resultIndex = result.content.indexOf('搜索结果')
    expect(kgIndex).toBeGreaterThan(-1)
    expect(resultIndex).toBeGreaterThan(-1)
    expect(kgIndex).toBeLessThan(resultIndex)
    expect(result.content).toContain('TypeScript 是由微软开发的编程语言')
  })

  it('answerBox 优先展示', async () => {
    const mockData = {
      answerBox: {
        title: '北京天气',
        snippet: '今天晴，25°C',
      },
      organic: [
        { title: '天气预报', link: 'https://weather.com', snippet: '查看天气', position: 1 },
      ],
    }
    globalThis.fetch = vi.fn().mockResolvedValue(createMockResponse(mockData))

    const tool = new WebSearchTool('test-key')
    const result = await tool.execute({ query: '北京天气' }, createMockContext())

    // 精选摘要应出现在搜索结果之前
    const abIndex = result.content.indexOf('精选摘要')
    const resultIndex = result.content.indexOf('搜索结果')
    expect(abIndex).toBeGreaterThan(-1)
    expect(resultIndex).toBeGreaterThan(-1)
    expect(abIndex).toBeLessThan(resultIndex)
    expect(result.content).toContain('今天晴，25°C')
  })

  it('num 参数超过 20 截断为 20', async () => {
    const mockData = { organic: [] }
    globalThis.fetch = vi.fn().mockResolvedValue(createMockResponse(mockData))

    const tool = new WebSearchTool('test-key')
    await tool.execute({ query: 'test', num: 50 }, createMockContext())

    const [, options] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]
    const body = JSON.parse(options.body as string)
    expect(body.num).toBe(20)
  })

  it('num 参数小于 1 修正为 1', async () => {
    const mockData = { organic: [] }
    globalThis.fetch = vi.fn().mockResolvedValue(createMockResponse(mockData))

    const tool = new WebSearchTool('test-key')
    await tool.execute({ query: 'test', num: -5 }, createMockContext())

    const [, options] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]
    const body = JSON.parse(options.body as string)
    expect(body.num).toBe(1)
  })

  it('未提供 num 时默认为 10', async () => {
    const mockData = { organic: [] }
    globalThis.fetch = vi.fn().mockResolvedValue(createMockResponse(mockData))

    const tool = new WebSearchTool('test-key')
    await tool.execute({ query: 'test' }, createMockContext())

    const [, options] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]
    const body = JSON.parse(options.body as string)
    expect(body.num).toBe(10)
  })

  it('API 错误时返回友好错误', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(createMockResponse({ error: 'Invalid API key' }, 401))

    const tool = new WebSearchTool('bad-key')
    const result = await tool.execute({ query: 'test' }, createMockContext())

    expect(result.content).toContain('搜索请求失败')
    expect(result.content).toContain('401')
  })

  it('请求超时返回友好提示', async () => {
    // 模拟 AbortError
    const abortError = new DOMException('The operation was aborted', 'AbortError')
    globalThis.fetch = vi.fn().mockRejectedValue(abortError)

    const tool = new WebSearchTool('test-key')
    const result = await tool.execute({ query: 'test' }, createMockContext())

    expect(result.content).toContain('超时')
  })

  it('网络异常返回友好错误', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('网络连接失败'))

    const tool = new WebSearchTool('test-key')
    const result = await tool.execute({ query: 'test' }, createMockContext())

    expect(result.content).toContain('搜索失败')
    expect(result.content).toContain('网络连接失败')
  })

  it('无结果时返回未找到提示', async () => {
    const mockData = {}
    globalThis.fetch = vi.fn().mockResolvedValue(createMockResponse(mockData))

    const tool = new WebSearchTool('test-key')
    const result = await tool.execute({ query: '完全不存在的内容 xyz' }, createMockContext())

    expect(result.content).toContain('未找到')
  })
})
