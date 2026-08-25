/**
 * Prints the chat ids a bot can currently see — `npm run telegram:chat-id`.
 *
 * A channel invite link says nothing about the numeric id `sendMessage` needs,
 * and there is no API that turns one into the other. What does work: add the
 * bot to the channel as an admin, post any message there, then run this. The
 * channel shows up in the bot's update queue and its id is printed below.
 */
import 'dotenv/config';
import { logger } from './logger';

interface Chat {
  id: number;
  type: string;
  title?: string;
  username?: string;
  first_name?: string;
}

interface Update {
  [key: string]: unknown;
}

/** Every chat mentioned anywhere in an update, whatever kind of update it is. */
function chatsIn(update: Update): Chat[] {
  return Object.values(update)
    .filter((value): value is { chat?: Chat } => typeof value === 'object' && value !== null)
    .map(value => value.chat)
    .filter((chat): chat is Chat => typeof chat?.id === 'number');
}

void (async (): Promise<void> => {
  const token = process.env.TELEGRAM_BOT_TOKEN ?? process.env.BOT_TOKEN;

  if (!token) {
    logger.error('Missing BOT_TOKEN in .env');
    process.exit(1);
  }

  // A negative offset asks for the *last* n updates. Without it the queue is
  // served oldest-first, and a busy bot's newest chats — the one just added,
  // which is the whole point of this script — sit past the end of the page.
  const response = await fetch(`https://api.telegram.org/bot${token}/getUpdates?offset=-100`);
  const body = (await response.json()) as { ok: boolean; description?: string; result?: Update[] };

  if (!body.ok) {
    logger.error(`Telegram refused the request: ${body.description ?? 'unknown error'}`);
    process.exit(1);
  }

  const chats = new Map<number, Chat>();
  for (const update of body.result ?? []) {
    for (const chat of chatsIn(update)) chats.set(chat.id, chat);
  }

  if (chats.size === 0) {
    logger.warn(
      'No chats in the queue. Add the bot to the channel as an admin, post a message there, then run this again.',
    );

    return;
  }

  logger.log('Chats this bot can see — copy the id of the one you want:');
  for (const chat of chats.values()) {
    const name = chat.title ?? chat.username ?? chat.first_name ?? '(no title)';
    logger.log(`  ${chat.id}  ${chat.type}  ${name}`);
  }
})().catch((e: unknown) => {
  logger.error(`[telegram-chat-id]: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
