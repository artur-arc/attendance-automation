/**
 * Telegram delivery for run reports.
 *
 * Every part of this is optional on purpose. A fork with no bot token or no
 * chat id still fills attendance and simply says nothing, and a Telegram
 * outage is a warning in the log — never a failed run. The report exists to
 * tell you what happened; it must not become another thing that can break.
 */
import { logger } from './logger';

const API_BASE = 'https://api.telegram.org';

/** Telegram rejects anything longer than this many characters. */
const MAX_MESSAGE = 4096;

/** A slow or hanging API must not hold the run open. */
const TIMEOUT_MS = 15_000;

interface TelegramConfig {
  token: string;
  chatId: string;
}

/**
 * Bot token and target chat, or `null` when either half is missing.
 *
 * `BOT_TOKEN` is the name already used in `.env`; `TELEGRAM_BOT_TOKEN` is
 * accepted too, for CI setups that keep every Telegram name together.
 */
function readConfig(): TelegramConfig | null {
  const token = process.env.TELEGRAM_BOT_TOKEN ?? process.env.BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID ?? process.env.CHAT_ID;

  if (!token || !chatId) return null;

  return { token, chatId };
}

/** Escapes the three characters Telegram's HTML parse mode reads as markup. */
export function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Trims to Telegram's limit on a line boundary.
 *
 * Cutting mid-line could split an HTML tag, and Telegram answers a broken tag
 * with "can't parse entities" — losing the whole report over its tail. Every
 * line the report builder emits closes its own tags, so a line boundary is
 * always a safe place to stop.
 */
function fitToLimit(html: string): string {
  if (html.length <= MAX_MESSAGE) return html;

  const notice = '\n…';
  const head = html.slice(0, MAX_MESSAGE - notice.length);
  const lastBreak = head.lastIndexOf('\n');

  return (lastBreak > 0 ? head.slice(0, lastBreak) : head) + notice;
}

/**
 * Removes the bot token from text about to be logged.
 *
 * Failure messages quote the request URL, and the token sits in that URL — so
 * an unredacted error message is a leaked secret in a public CI log.
 */
function redact(text: string, token: string): string {
  return text.split(token).join('***');
}

/** Telegram's own explanation of a rejected request, if the body carries one. */
async function describeFailure(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { description?: unknown };

    return typeof body.description === 'string' ? body.description : '';
  } catch {
    return '';
  }
}

/**
 * Sends one HTML-formatted message. Returns whether it was delivered, so a
 * caller can fall back to another channel instead of assuming it landed.
 */
export async function sendTelegramMessage(html: string): Promise<boolean> {
  const config = readConfig();

  if (!config) {
    logger.log('--- [telegram] no bot token or chat id — no report sent.');

    return false;
  }

  try {
    const response = await fetch(`${API_BASE}/bot${config.token}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        chat_id: config.chatId,
        text: fitToLimit(html),
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (!response.ok) {
      const description = await describeFailure(response);
      logger.warn(
        `--- [telegram] report not delivered: HTTP ${response.status} ${redact(description, config.token)}`,
      );

      return false;
    }

    logger.log('--- [telegram] report sent.');

    return true;
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    logger.warn(`--- [telegram] report not delivered: ${redact(message, config.token)}`);

    return false;
  }
}
