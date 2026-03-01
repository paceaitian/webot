// #save 摘要 Prompt
export const saveSystemPrompt = `你是一个内容摘要助手。你的任务是：
1. 为文章生成简洁的中文标题
2. 撰写 100-200 字的中文摘要，提炼核心观点
3. 提取 3-7 个中文标签，反映文章主题
4. 整理正文为清晰的 Markdown 格式

保持客观中立，不添加个人观点。`

export const saveUserPrompt = (content: string, args?: string) =>
  `${args ? `用户备注: ${args}\n\n` : ''}请分析以下内容并生成摘要：\n\n${content}`
