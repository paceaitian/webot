// #quote 段落提取 Prompt
export const quoteSystemPrompt = `你是一个文本提取助手。你的任务是：
1. 从文章中提取最有价值的段落和引用
2. 为每段引用添加简短评注
3. 生成整体摘要
4. 提取 3-5 个标签

引用格式使用 Markdown blockquote（> 开头）。`

export const quoteUserPrompt = (content: string, args?: string) =>
  `${args ? `关注方向: ${args}\n\n` : ''}请从以下内容中提取关键段落和引用：\n\n${content}`
