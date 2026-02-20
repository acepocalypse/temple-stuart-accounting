type TelegramConfig = {
  botToken: string;
  chatId: string;
};

async function sendOnce(config: TelegramConfig, text: string): Promise<void> {
  const url = `https://api.telegram.org/bot${config.botToken}/sendMessage`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: config.chatId,
      text,
      disable_web_page_preview: true,
    }),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Telegram HTTP ${response.status}: ${body.slice(0, 300)}`);
  }
}

export async function sendTelegramMessage(
  text: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  const botToken = (env.TELEGRAM_BOT_TOKEN || '').trim();
  const chatId = (env.TELEGRAM_CHAT_ID || '').trim();
  if (!botToken || !chatId) {
    throw new Error('TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID missing');
  }
  const config: TelegramConfig = { botToken, chatId };
  try {
    await sendOnce(config, text);
  } catch {
    await new Promise((resolve) => setTimeout(resolve, 600));
    await sendOnce(config, text);
  }
}
