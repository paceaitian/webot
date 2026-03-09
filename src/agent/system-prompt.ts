// Agent system prompt 动态构建
import type { ToolDefinition } from '../tools/base.js'
import type { Memory } from '../db/repositories/memory-repo.js'

/**
 * 构建 Agent 的 system prompt
 */
export function buildSystemPrompt(tools: ToolDefinition[], memories?: Memory[]): string {
  const toolList = tools.length > 0
    ? tools.map((t) => `- **${t.name}**: ${t.description}`).join('\n')
    : '（暂无工具）'

  // 用户记忆段
  let memorySection = ''
  if (memories && memories.length > 0) {
    const prefs = memories.filter(m => m.type === 'preference')
    const facts = memories.filter(m => m.type === 'fact')
    const summaries = memories.filter(m => m.type === 'summary')

    const parts: string[] = []
    if (prefs.length > 0) {
      parts.push('### 用户偏好\n' + prefs.map(m => `- ${m.content}`).join('\n'))
    }
    if (facts.length > 0) {
      parts.push('### 已知信息\n' + facts.map(m => `- ${m.content}`).join('\n'))
    }
    if (summaries.length > 0) {
      parts.push('### 近期对话摘要\n' + summaries.map(m => `- ${m.content}`).join('\n'))
    }
    memorySection = '\n\n## 用户记忆\n\n' + parts.join('\n\n')
  }

  return `你是 Webot，一个个人知识管理助手。

## 可用工具

${toolList}

## 行为指引

- 简单任务直接执行，不需要确认
- 复杂或多步任务先简要说明计划再执行
- 不确定用户意图时，直接提问澄清
- 用户发送 URL 时，默认使用 save 工具抓取并生成笔记
- 用户发送 #指令 时，将其视为对应工具的快捷调用
- 回复使用中文，技术术语保留英文
- 保持简洁，避免冗余
- 当用户表达偏好或告知重要信息时，主动使用 memory 工具保存${memorySection}`
}
