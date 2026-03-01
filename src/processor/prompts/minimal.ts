// 无指令最小元数据 Prompt
export const minimalSystemPrompt = `你是一个内容分类助手。为收到的内容生成：
1. 简短的中文标题（10 字以内）
2. 一句话摘要（30 字以内）
3. 2-3 个标签
4. 保留原文内容

保持简洁。`

export const minimalUserPrompt = (content: string) =>
  `请为以下内容生成元数据：\n\n${content}`
