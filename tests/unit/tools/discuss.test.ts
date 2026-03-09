import { describe, it, expect, vi } from 'vitest'
import { DiscussTool } from '../../../src/tools/discuss.js'
import type { ToolContext } from '../../../src/tools/base.js'

/** 构造 mock PipelineEngine */
function createMockPipeline() {
  return {
    execute: vi.fn(),
    reprocess: vi.fn(),
  }
}

/** 构造 mock ToolContext */
function createMockContext(): ToolContext {
  return {
    sessionId: 'test-session',
    chatId: 'test-chat',
    responder: {
      onProgress: vi.fn(),
      onResult: vi.fn(),
      onError: vi.fn(),
    } as never,
  }
}

describe('DiscussTool', () => {
  it('name 为 discuss', () => {
    const tool = new DiscussTool(null as never)
    expect(tool.name).toBe('discuss')
  })

  it('description 包含关键词', () => {
    const tool = new DiscussTool(null as never)
    expect(tool.description).toContain('深度分析')
    expect(tool.description).toContain('Opus')
  })

  it('parameters 中 url/jobId/instruction 均为可选', () => {
    const tool = new DiscussTool(null as never)
    const params = tool.parameters as {
      properties: Record<string, unknown>
      required: string[]
    }
    expect(params.properties).toHaveProperty('url')
    expect(params.properties).toHaveProperty('jobId')
    expect(params.properties).toHaveProperty('instruction')
    expect(params.required).toEqual([])
  })

  it('url 模式：调用 pipeline.execute 并返回结果', async () => {
    const pipeline = createMockPipeline()
    pipeline.execute.mockResolvedValue({
      status: 'completed',
      written: { title: '测试文章', filePath: '/notes/test.md' },
    })
    const tool = new DiscussTool(pipeline as never)
    const ctx = createMockContext()

    const result = await tool.execute({ url: 'https://example.com' }, ctx)

    expect(pipeline.execute).toHaveBeenCalledTimes(1)
    // 验证传入的 RawMessage 包含 #discuss
    const rawArg = pipeline.execute.mock.calls[0][0] as { rawText: string }
    expect(rawArg.rawText).toBe('#discuss https://example.com')
    expect(result.content).toContain('测试文章')
    expect(result.upgradeModel).toBe('claude-opus-4-6')
    expect(result.artifacts).toEqual([{ type: 'file', value: '/notes/test.md' }])
  })

  it('url 模式带 instruction：rawText 包含用户指示', async () => {
    const pipeline = createMockPipeline()
    pipeline.execute.mockResolvedValue({
      status: 'completed',
      written: { title: '深度分析', filePath: '/notes/deep.md' },
    })
    const tool = new DiscussTool(pipeline as never)
    const ctx = createMockContext()

    await tool.execute({ url: 'https://example.com', instruction: '关注架构设计' }, ctx)

    const rawArg = pipeline.execute.mock.calls[0][0] as { rawText: string }
    expect(rawArg.rawText).toBe('#discuss 关注架构设计 https://example.com')
  })

  it('jobId 模式：调用 pipeline.reprocess', async () => {
    const pipeline = createMockPipeline()
    pipeline.reprocess.mockResolvedValue({
      status: 'completed',
      written: { title: '重处理文章', filePath: '/notes/reprocess.md' },
    })
    const tool = new DiscussTool(pipeline as never)
    const ctx = createMockContext()

    const result = await tool.execute(
      { jobId: 'job-123', instruction: '分析技术细节' },
      ctx,
    )

    expect(pipeline.reprocess).toHaveBeenCalledWith(
      'job-123',
      'discuss',
      ctx.responder,
      { userInput: '分析技术细节' },
    )
    expect(result.content).toContain('重处理文章')
    expect(result.upgradeModel).toBe('claude-opus-4-6')
  })

  it('jobId 优先级高于 url（同时提供时使用 jobId）', async () => {
    const pipeline = createMockPipeline()
    pipeline.reprocess.mockResolvedValue({
      status: 'completed',
      written: { title: 'Job 优先', filePath: '/notes/job.md' },
    })
    const tool = new DiscussTool(pipeline as never)
    const ctx = createMockContext()

    await tool.execute(
      { jobId: 'job-456', url: 'https://example.com' },
      ctx,
    )

    expect(pipeline.reprocess).toHaveBeenCalledTimes(1)
    expect(pipeline.execute).not.toHaveBeenCalled()
  })

  it('无参数时返回错误提示', async () => {
    const tool = new DiscussTool(null as never)
    const ctx = createMockContext()

    const result = await tool.execute({}, ctx)

    expect(result.content).toContain('请提供 url 或 jobId 参数')
    // 无参数错误不需要 upgradeModel
    expect(result.upgradeModel).toBeUndefined()
  })

  it('pipeline 执行失败时返回错误并保留 upgradeModel', async () => {
    const pipeline = createMockPipeline()
    pipeline.execute.mockRejectedValue(new Error('网络超时'))
    const tool = new DiscussTool(pipeline as never)
    const ctx = createMockContext()

    const result = await tool.execute({ url: 'https://example.com' }, ctx)

    expect(result.content).toContain('深度分析失败')
    expect(result.content).toContain('网络超时')
    expect(result.upgradeModel).toBe('claude-opus-4-6')
  })

  it('reprocess 失败时返回错误并保留 upgradeModel', async () => {
    const pipeline = createMockPipeline()
    pipeline.reprocess.mockRejectedValue(new Error('Job not found'))
    const tool = new DiscussTool(pipeline as never)
    const ctx = createMockContext()

    const result = await tool.execute({ jobId: 'bad-job' }, ctx)

    expect(result.content).toContain('深度分析失败')
    expect(result.content).toContain('Job not found')
    expect(result.upgradeModel).toBe('claude-opus-4-6')
  })

  it('draft 状态时返回草稿信息和 upgradeModel', async () => {
    const pipeline = createMockPipeline()
    pipeline.execute.mockResolvedValue({
      status: 'draft',
      written: { title: '草稿文章', filePath: '/notes/draft.md' },
    })
    const tool = new DiscussTool(pipeline as never)
    const ctx = createMockContext()

    const result = await tool.execute({ url: 'https://example.com' }, ctx)

    expect(result.content).toContain('草稿')
    expect(result.content).toContain('草稿文章')
    expect(result.upgradeModel).toBe('claude-opus-4-6')
  })
})
