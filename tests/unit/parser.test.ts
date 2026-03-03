// 消息解析器单元测试
import { describe, it, expect } from 'vitest'
import { parseMessage, parseCommand, extractUrls, isWechatUrl } from '../../src/parser/message-parser.js'
import type { RawMessage } from '../../src/types/index.js'

/** 创建测试用 RawMessage */
function makeRaw(text: string, extra?: Partial<RawMessage>): RawMessage {
  return {
    eventId: 'test-event-1',
    source: 'cli',
    rawText: text,
    receivedAt: new Date(),
    ...extra,
  }
}

describe('parseCommand', () => {
  it('解析 #save 指令', () => {
    expect(parseCommand('#save')).toEqual({ type: 'save' })
  })

  it('解析 #save 带参数', () => {
    expect(parseCommand('#save AI 趋势')).toEqual({ type: 'save', args: 'AI 趋势' })
  })

  it('解析 #discuss 指令', () => {
    expect(parseCommand('#discuss')).toEqual({ type: 'discuss' })
  })

  it('解析 #quote 指令带参数', () => {
    expect(parseCommand('#quote 重要段落')).toEqual({ type: 'quote', args: '重要段落' })
  })

  it('指令不区分大小写', () => {
    expect(parseCommand('#SAVE')).toEqual({ type: 'save' })
    expect(parseCommand('#Discuss')).toEqual({ type: 'discuss' })
  })

  it('无指令返回 none', () => {
    expect(parseCommand('普通文本')).toEqual({ type: 'none' })
  })

  it('中间的 # 不是指令', () => {
    expect(parseCommand('这不是 #save 指令')).toEqual({ type: 'none' })
  })
})

describe('extractUrls', () => {
  it('提取单个 URL', () => {
    expect(extractUrls('看看这个 https://example.com 不错')).toEqual(['https://example.com'])
  })

  it('提取多个 URL', () => {
    const urls = extractUrls('https://a.com 和 https://b.com')
    expect(urls).toEqual(['https://a.com', 'https://b.com'])
  })

  it('提取微信长链接', () => {
    const url = 'https://mp.weixin.qq.com/s/abcdefg123456'
    expect(extractUrls(url)).toEqual([url])
  })

  it('无 URL 返回空数组', () => {
    expect(extractUrls('纯文本没有链接')).toEqual([])
  })

  it('提取带参数的 URL', () => {
    const url = 'https://example.com/path?foo=bar&baz=1'
    expect(extractUrls(url)).toEqual([url])
  })
})

describe('isWechatUrl', () => {
  it('识别微信公众号链接', () => {
    expect(isWechatUrl('https://mp.weixin.qq.com/s/abc123')).toBe(true)
  })

  it('非微信链接返回 false', () => {
    expect(isWechatUrl('https://example.com')).toBe(false)
  })
})

describe('parseMessage', () => {
  it('解析 #save + URL', () => {
    const raw = makeRaw('#save https://example.com/article')
    const result = parseMessage(raw)
    expect(result.command.type).toBe('save')
    expect(result.content.type).toBe('url')
    if (result.content.type === 'url') {
      expect(result.content.url).toBe('https://example.com/article')
    }
  })

  it('解析 #discuss + URL + 文本', () => {
    const raw = makeRaw('#discuss AI趋势 https://example.com/ai')
    const result = parseMessage(raw)
    expect(result.command.type).toBe('discuss')
    expect(result.content.type).toBe('mixed')
    if (result.content.type === 'mixed') {
      expect(result.content.url).toBe('https://example.com/ai')
      expect(result.content.text).toContain('AI趋势')
    }
  })

  it('解析纯文本（无指令无 URL）', () => {
    const raw = makeRaw('这是一段纯文本笔记')
    const result = parseMessage(raw)
    expect(result.command.type).toBe('none')
    expect(result.content.type).toBe('text')
    if (result.content.type === 'text') {
      expect(result.content.text).toBe('这是一段纯文本笔记')
    }
  })

  it('纯 URL（无指令）默认走 save', () => {
    const raw = makeRaw('https://example.com')
    const result = parseMessage(raw)
    expect(result.command.type).toBe('save')
    expect(result.content.type).toBe('url')
  })

  it('URL + 文本（无指令）默认走 save', () => {
    const raw = makeRaw('https://example.com/article 这篇不错')
    const result = parseMessage(raw)
    expect(result.command.type).toBe('save')
    expect(result.content.type).toBe('mixed')
  })

  it('#discuss + URL 保持 discuss（不被覆盖为 save）', () => {
    const raw = makeRaw('#discuss https://example.com/deep')
    const result = parseMessage(raw)
    expect(result.command.type).toBe('discuss')
    expect(result.content.type).toBe('url')
  })

  it('纯文本无指令保持 none（不受 URL 默认影响）', () => {
    const raw = makeRaw('这是普通文本，没有链接')
    const result = parseMessage(raw)
    expect(result.command.type).toBe('none')
    expect(result.content.type).toBe('text')
  })

  it('解析图片消息', () => {
    const raw = makeRaw('图片描述', {
      imageBuffer: Buffer.from('fake-image'),
      imageMimeType: 'image/png',
    })
    const result = parseMessage(raw)
    expect(result.content.type).toBe('image')
    if (result.content.type === 'image') {
      expect(result.content.mimeType).toBe('image/png')
      expect(result.content.text).toBe('图片描述')
    }
  })

  it('图片消息无描述文本', () => {
    const raw = makeRaw('', {
      imageBuffer: Buffer.from('fake-image'),
    })
    const result = parseMessage(raw)
    expect(result.content.type).toBe('image')
    if (result.content.type === 'image') {
      expect(result.content.text).toBeUndefined()
    }
  })

  it('#quote + URL', () => {
    const raw = makeRaw('#quote https://example.com/long-article')
    const result = parseMessage(raw)
    expect(result.command.type).toBe('quote')
    expect(result.content.type).toBe('url')
  })

  it('空文本', () => {
    const raw = makeRaw('')
    const result = parseMessage(raw)
    expect(result.command.type).toBe('none')
    expect(result.content.type).toBe('text')
  })
})
