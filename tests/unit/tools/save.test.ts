import { describe, it, expect } from 'vitest'
import { SaveTool } from '../../../src/tools/save.js'

describe('SaveTool', () => {
  it('name 为 save', () => {
    const tool = new SaveTool(null as never)
    expect(tool.name).toBe('save')
  })

  it('parameters 包含 url 必填字段', () => {
    const tool = new SaveTool(null as never)
    const params = tool.parameters as { properties: Record<string, unknown>; required: string[] }
    expect(params.properties).toHaveProperty('url')
    expect(params.required).toContain('url')
  })

  it('description 包含关键词', () => {
    const tool = new SaveTool(null as never)
    expect(tool.description).toContain('网页')
    expect(tool.description).toContain('Obsidian')
  })
})
