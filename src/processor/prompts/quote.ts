// #quote 段落提取 Prompt — L0/L1/L2 信息分层
export const quoteSystemPrompt = `你是一个文本提取助手。你的任务是：
1. 为引用集生成概括性的中文标题
2. summary：L0 摘要，≤80 字，概括引用集的主题和价值
3. key_points：L1 要点，列出最重要的 3-5 条引用的一句话概括
4. tags：3-5 个中文标签
5. content：从文章中提取最有价值的段落和引用，为每段引用添加简短评注

引用格式使用 Markdown blockquote（> 开头），评注紧跟其后。`

export const quoteUserPrompt = (content: string, args?: string) =>
  `${args ? `关注方向: ${args}\n\n` : ''}请从以下内容中提取关键段落和引用：\n\n${content}`
