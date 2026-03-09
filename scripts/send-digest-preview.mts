import { readFileSync } from 'node:fs'
import * as lark from '@larksuiteoapi/node-sdk'
import { config as dotenvConfig } from 'dotenv'

dotenvConfig({ override: true })

console.log('启动...')

const client = new lark.Client({
  appId: process.env.FEISHU_APP_ID!,
  appSecret: process.env.FEISHU_APP_SECRET!,
})
const chatId = process.env.DIGEST_CHAT_ID!

async function sendCard(cardPath: string, label: string) {
  const cardJson = readFileSync(cardPath, 'utf-8')
  console.log(`${label}: 读取 ${cardJson.length} 字节`)

  const createResp = await client.cardkit.v1.card.create({
    data: { type: 'card_json', data: cardJson },
  })
  console.log(`${label}: create code=${createResp.code} msg=${createResp.msg}`)
  const cardId = createResp.data?.card_id
  if (!cardId) {
    console.error(`${label}: 无 card_id`, JSON.stringify(createResp.data))
    return
  }
  console.log(`${label}: card_id=${cardId}`)

  const msgResp = await client.im.v1.message.create({
    params: { receive_id_type: 'chat_id' },
    data: {
      receive_id: chatId,
      msg_type: 'interactive',
      content: JSON.stringify({ type: 'card', data: { card_id: cardId } }),
    },
  })
  console.log(`${label}: send code=${msgResp.code}`)
}

async function main() {
  await sendCard('card-templates/digest-layout-A-flat.card', 'Layout-A')
  await new Promise(r => setTimeout(r, 1500))
  await sendCard('card-templates/digest-layout-B-grouped.card', 'Layout-B')
  console.log('两张卡片发送完毕')
}

main().catch(err => {
  console.error('失败:', err)
  process.exit(1)
})
