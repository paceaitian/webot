import { describe, it, expect } from 'vitest'
import type { Tool } from '../../../src/tools/base.js'

describe('Tool 接口类型检查', () => {
  it('满足 Tool 接口的对象应可赋值', () => {
    const mockTool: Tool = {
      name: 'test',
      description: '测试工具',
      parameters: {
        type: 'object',
        properties: { input: { type: 'string' } },
        required: ['input'],
      },
      execute: async () => ({ content: 'ok' }),
    }
    expect(mockTool.name).toBe('test')
    expect(mockTool.parameters).toBeDefined()
  })
})
