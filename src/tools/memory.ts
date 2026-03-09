// 记忆管理工具 — Agent 主动存取长期记忆
import type { Tool, ToolResult, ToolContext } from './base.js'
import type { MemoryRepo } from '../db/repositories/memory-repo.js'
import { createLogger } from '../utils/logger.js'

const log = createLogger('memory-tool')

/**
 * 记忆管理工具 — Agent 主动存取长期记忆
 */
export class MemoryTool implements Tool {
  name = 'memory'
  description = '管理长期记忆。可以保存用户偏好、重要事实，或检索历史记忆。'
  parameters = {
    type: 'object' as const,
    properties: {
      action: {
        type: 'string',
        enum: ['save', 'recall', 'delete'],
        description: '操作类型：save 保存记忆、recall 检索记忆、delete 删除记忆',
      },
      content: {
        type: 'string',
        description: 'save 时为记忆内容，recall 时为搜索关键词（可选），delete 时为记忆 ID',
      },
      type: {
        type: 'string',
        enum: ['preference', 'fact'],
        description: '记忆类型（仅 save 时有效，默认 fact）',
      },
    },
    required: ['action'],
  }

  constructor(private memoryRepo: MemoryRepo) {}

  async execute(params: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
    const action = params.action as string
    const content = params.content as string | undefined
    const type = (params.type as string) || 'fact'

    switch (action) {
      case 'save': {
        if (!content) {
          return { content: '保存记忆需要提供 content 参数。' }
        }
        const memory = this.memoryRepo.save({
          userId: context.userId,
          chatId: null,
          type: type as 'preference' | 'fact',
          content,
        })
        log.info({ memoryId: memory.id, type, userId: context.userId }, '记忆已保存')
        return { content: `已保存${type === 'preference' ? '偏好' : '事实'}记忆：${content}` }
      }

      case 'recall': {
        let memories
        if (content) {
          memories = this.memoryRepo.search(context.userId, content, 10)
        } else {
          memories = this.memoryRepo.getUserMemories(context.userId)
        }

        if (memories.length === 0) {
          return { content: content ? `没有找到关于「${content}」的记忆。` : '当前没有保存任何记忆。' }
        }

        const list = memories.map((m, i) =>
          `${i + 1}. [${m.type}] ${m.content} (ID: ${m.id})`,
        ).join('\n')
        return { content: `找到 ${memories.length} 条记忆：\n${list}` }
      }

      case 'delete': {
        if (!content) {
          return { content: '删除记忆需要提供记忆 ID（通过 content 参数）。' }
        }
        const deleted = this.memoryRepo.delete(content)
        return { content: deleted ? `已删除记忆 ${content}。` : `未找到 ID 为 ${content} 的记忆。` }
      }

      default:
        return { content: `不支持的操作：${action}。支持 save、recall、delete。` }
    }
  }
}
