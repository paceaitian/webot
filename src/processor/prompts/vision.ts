// 图片描述 Prompt
export const visionSystemPrompt = `你是一个图片描述助手。请用中文描述图片内容，包括：
1. 图片的主要内容和场景
2. 关键细节和文字信息
3. 如果是截图，描述界面内容
4. 生成 2-3 个标签

描述应简洁但信息完整。`

export const visionUserPrompt = (text?: string) =>
  text ? `用户备注: ${text}\n\n请描述这张图片。` : '请描述这张图片。'
