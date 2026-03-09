// DigestTool 单元测试 — 验证属性、正常流程、CLI 降级、错误处理
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { DigestTool } from '../../../src/tools/digest.js'
import type { ToolContext } from '../../../src/tools/base.js'
import type { DailyDigestV2 } from '../../../src/digest/collectors/types.js'

/** 构造最小有效 DailyDigestV2 */
function makeFakeDigest(): DailyDigestV2 {
  return {
    date: '2026-03-08',
    groups: [
      {
        config: { id: 'tech', label: '技术精选', channels: [] },
        channels: [
          {
            channel: { id: 'rss', name: 'RSS 精选', group: 'tech', displayCount: 10, scored: true },
            items: [
              {
                title: 'Test Article',
                url: 'https://example.com/1',
                source: 'rss',
                aiTitle: 'AI 测试标题',
                aiSummary: '这是一篇测试文章摘要',
                relevance: 8,
                quality: 7,
                timeliness: 9,
                totalScore: 24,
                category: 'AI' as const,
              },
            ],
          },
        ],
      },
    ],
    analysis: {
      quickRead: '今日 AI 领域有重要进展',
      top5: [
        {
          item: {
            title: 'Test Article',
            url: 'https://example.com/1',
            source: 'rss',
            aiTitle: 'AI 测试标题',
            aiSummary: '这是一篇测试文章摘要',
            relevance: 8,
            quality: 7,
            timeliness: 9,
            totalScore: 24,
            category: 'AI' as const,
          },
          reason: '重要进展',
        },
      ],
      correlations: '多个来源均报道了 AI 进展',
      actionItems: '关注后续发展',
    },
    collections: [{ name: 'rss-ai', items: [], duration: 1000 }],
    totalDuration: 60_000,
  }
}

/** 构造 mock DigestEngine */
function makeMockEngine(digest?: DailyDigestV2) {
  return {
    setOnProgress: vi.fn(),
    run: vi.fn().mockResolvedValue(digest ?? makeFakeDigest()),
  }
}

/** 构造 mock ToolContext */
function makeMockContext(): ToolContext {
  return {
    sessionId: 'test-session',
    chatId: 'test-chat',
    responder: {
      onProgress: vi.fn().mockResolvedValue(undefined),
      onComplete: vi.fn().mockResolvedValue(undefined),
      onError: vi.fn().mockResolvedValue(undefined),
    },
  }
}

/** 构造 mock feishuClient */
function makeMockFeishuClient(cardId = 'card-123') {
  return {
    cardkit: {
      v1: {
        card: {
          create: vi.fn().mockResolvedValue({ data: { card_id: cardId } }),
        },
      },
    },
    im: {
      v1: {
        message: {
          create: vi.fn().mockResolvedValue({}),
        },
      },
    },
  }
}

// mock writeDigestToObsidian，避免真实文件 IO
vi.mock('../../../src/digest/reporter.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../../src/digest/reporter.js')>()
  return {
    ...original,
    writeDigestToObsidian: vi.fn().mockResolvedValue('/vault/digest/2026-03-08.md'),
  }
})

describe('DigestTool', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('基本属性', () => {
    it('name 为 digest', () => {
      const tool = new DigestTool(makeMockEngine() as never, '/vault')
      expect(tool.name).toBe('digest')
    })

    it('description 包含简报和科技相关关键词', () => {
      const tool = new DigestTool(makeMockEngine() as never, '/vault')
      expect(tool.description).toContain('简报')
      expect(tool.description).toContain('科技')
    })

    it('parameters 为空对象（无必填参数）', () => {
      const tool = new DigestTool(makeMockEngine() as never, '/vault')
      const params = tool.parameters as { properties: Record<string, unknown>; required: string[] }
      expect(Object.keys(params.properties)).toHaveLength(0)
      expect(params.required).toHaveLength(0)
    })
  })

  describe('正常执行流程', () => {
    it('调用 DigestEngine.run() 并返回摘要文本', async () => {
      const engine = makeMockEngine()
      const tool = new DigestTool(engine as never, '/vault')
      const context = makeMockContext()

      const result = await tool.execute({}, context)

      expect(engine.setOnProgress).toHaveBeenCalled()
      expect(engine.run).toHaveBeenCalledOnce()
      expect(result.content).toContain('每日简报已生成')
      expect(result.content).toContain('2026-03-08')
      expect(result.content).toContain('30 秒速读')
      expect(result.content).toContain('AI 测试标题')
    })

    it('返回 Obsidian 文件路径 artifact', async () => {
      const engine = makeMockEngine()
      const tool = new DigestTool(engine as never, '/vault')
      const context = makeMockContext()

      const result = await tool.execute({}, context)

      expect(result.artifacts).toBeDefined()
      const fileArtifact = result.artifacts!.find((a) => a.type === 'file')
      expect(fileArtifact).toBeDefined()
      expect(fileArtifact!.value).toContain('2026-03-08.md')
    })

    it('通过 responder 推送进度消息', async () => {
      const engine = makeMockEngine()
      // 捕获 setOnProgress 传入的回调并调用
      engine.setOnProgress.mockImplementation((cb: (msg: string) => void) => {
        cb('采集完成: 50 条')
      })
      const tool = new DigestTool(engine as never, '/vault')
      const context = makeMockContext()

      await tool.execute({}, context)

      expect(context.responder.onProgress).toHaveBeenCalled()
    })
  })

  describe('飞书卡片推送', () => {
    it('有 feishuClient + digestChatId 时发送飞书卡片', async () => {
      const engine = makeMockEngine()
      const feishu = makeMockFeishuClient()
      const tool = new DigestTool(engine as never, '/vault', feishu, 'chat-001')
      const context = makeMockContext()

      const result = await tool.execute({}, context)

      expect(feishu.cardkit.v1.card.create).toHaveBeenCalledOnce()
      expect(feishu.im.v1.message.create).toHaveBeenCalledOnce()
      const cardArtifact = result.artifacts!.find((a) => a.type === 'card')
      expect(cardArtifact).toBeDefined()
      expect(cardArtifact!.value).toBe('card-123')
    })

    it('飞书卡片发送失败时仍继续写入 Obsidian', async () => {
      const engine = makeMockEngine()
      const feishu = makeMockFeishuClient()
      feishu.cardkit.v1.card.create.mockRejectedValue(new Error('飞书 API 故障'))
      const tool = new DigestTool(engine as never, '/vault', feishu, 'chat-001')
      const context = makeMockContext()

      const result = await tool.execute({}, context)

      // 卡片发送失败，但不应影响最终结果
      expect(result.content).toContain('每日简报已生成')
      const fileArtifact = result.artifacts!.find((a) => a.type === 'file')
      expect(fileArtifact).toBeDefined()
      // 不应有 card artifact
      const cardArtifact = result.artifacts!.find((a) => a.type === 'card')
      expect(cardArtifact).toBeUndefined()
    })
  })

  describe('CLI 降级行为（无 feishuClient）', () => {
    it('无 feishuClient 时跳过飞书推送，只写 Obsidian', async () => {
      const engine = makeMockEngine()
      const tool = new DigestTool(engine as never, '/vault')
      const context = makeMockContext()

      const result = await tool.execute({}, context)

      expect(result.content).toContain('每日简报已生成')
      expect(result.artifacts).toBeDefined()
      const fileArtifact = result.artifacts!.find((a) => a.type === 'file')
      expect(fileArtifact).toBeDefined()
      // 不应有 card artifact
      const cardArtifact = result.artifacts!.find((a) => a.type === 'card')
      expect(cardArtifact).toBeUndefined()
    })

    it('有 feishuClient 但无 digestChatId 时也跳过推送', async () => {
      const engine = makeMockEngine()
      const feishu = makeMockFeishuClient()
      const tool = new DigestTool(engine as never, '/vault', feishu)
      const context = makeMockContext()

      const result = await tool.execute({}, context)

      expect(feishu.cardkit.v1.card.create).not.toHaveBeenCalled()
      const cardArtifact = result.artifacts!.find((a) => a.type === 'card')
      expect(cardArtifact).toBeUndefined()
    })
  })

  describe('错误处理', () => {
    it('DigestEngine.run() 失败时返回错误信息', async () => {
      const engine = makeMockEngine()
      engine.run.mockRejectedValue(new Error('采集超时'))
      const tool = new DigestTool(engine as never, '/vault')
      const context = makeMockContext()

      const result = await tool.execute({}, context)

      expect(result.content).toContain('每日简报生成失败')
      expect(result.content).toContain('采集超时')
      expect(result.artifacts).toBeUndefined()
    })

    it('非 Error 类型异常也能正常处理', async () => {
      const engine = makeMockEngine()
      engine.run.mockRejectedValue('字符串异常')
      const tool = new DigestTool(engine as never, '/vault')
      const context = makeMockContext()

      const result = await tool.execute({}, context)

      expect(result.content).toContain('每日简报生成失败')
      expect(result.content).toContain('字符串异常')
    })
  })
})
