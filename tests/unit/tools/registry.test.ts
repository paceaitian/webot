import { describe, it, expect } from 'vitest'
import { ToolRegistry } from '../../../src/tools/registry.js'
import type { Tool } from '../../../src/tools/base.js'

/** 创建测试用 mock tool */
function mockTool(name: string): Tool {
  return {
    name,
    description: `${name} 工具`,
    parameters: { type: 'object', properties: {} },
    execute: async () => ({ content: `${name} executed` }),
  }
}

describe('ToolRegistry', () => {
  it('注册和获取工具', () => {
    const registry = new ToolRegistry()
    const tool = mockTool('save')
    registry.register(tool)
    expect(registry.get('save')).toBe(tool)
  })

  it('注销工具', () => {
    const registry = new ToolRegistry()
    registry.register(mockTool('save'))
    registry.unregister('save')
    expect(registry.get('save')).toBeUndefined()
  })

  it('getAll 返回所有工具', () => {
    const registry = new ToolRegistry()
    registry.register(mockTool('save'))
    registry.register(mockTool('digest'))
    expect(registry.getAll()).toHaveLength(2)
  })

  it('getDefinitions 转为 LLM schema 格式', () => {
    const registry = new ToolRegistry()
    registry.register(mockTool('save'))
    const defs = registry.getDefinitions()
    expect(defs).toHaveLength(1)
    expect(defs[0]).toEqual({
      name: 'save',
      description: 'save 工具',
      input_schema: { type: 'object', properties: {} },
    })
  })

  it('重复注册覆盖旧工具', () => {
    const registry = new ToolRegistry()
    registry.register(mockTool('save'))
    const newTool = mockTool('save')
    newTool.description = '新版 save'
    registry.register(newTool)
    expect(registry.get('save')?.description).toBe('新版 save')
  })

  it('注销不存在的工具不报错', () => {
    const registry = new ToolRegistry()
    expect(() => registry.unregister('nonexist')).not.toThrow()
  })
})
