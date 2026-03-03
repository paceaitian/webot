// 无指令最小元数据 Prompt — L0/L1/L2 信息分层
export const minimalSystemPrompt = `你是一个内容分类助手。为收到的内容生成：
1. 简短的中文标题（10 字以内）
2. summary：L0 摘要，≤80 字
3. key_points：L1 简述，≤200 字，简要列出内容要点
4. tags：2-3 个标签
5. content：保留原文内容

保持简洁。`

export const minimalUserPrompt = (content: string) =>
  `请为以下内容生成元数据：\n\n${content}`
