import { describe, it, expect } from 'vitest'
import { buildSystemPrompt } from '../../../src/agent/system-prompt.js'
import type { ToolDefinition } from '../../../src/tools/base.js'

describe('buildSystemPrompt', () => {
  it('包含身份描述', () => {
    const prompt = buildSystemPrompt([])
    expect(prompt).toContain('Webot')
    expect(prompt).toContain('知识管理')
  })

  it('包含工具摘要', () => {
    const tools: ToolDefinition[] = [
      { name: 'save', description: '保存网页', input_schema: {} },
    ]
    const prompt = buildSystemPrompt(tools)
    expect(prompt).toContain('save')
    expect(prompt).toContain('保存网页')
  })

  it('无工具时仍可构建', () => {
    const prompt = buildSystemPrompt([])
    expect(prompt.length).toBeGreaterThan(50)
    expect(prompt).toContain('暂无工具')
  })
})
