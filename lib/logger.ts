import { db } from '../db/client.js';
import { logs, type User } from '../db/schema.js';
import { callStructured } from './openrouter.js';
import { LOGGER_PROMPT } from './prompts.js';
import { logSchema } from './schemas.js';
import { nowUnix, hintToUnix } from './time.js';
import { recordWeight } from './profile.js';

/**
 * Агент-Логер: парсит свободный текст события в структурированный JSON
 * и записывает его в БД. Возвращает summary-подтверждение.
 *
 * telegramMessageId используется для дедупликации (Telegram может ретраить вебхук).
 */
export async function logEvent(
  user: User,
  text: string,
  telegramMessageId: number | null,
): Promise<{ summary: string; isQuestion: boolean }> {
  const parsed = await callStructured(LOGGER_PROMPT, text, logSchema);

  // Если это вопрос или реплика без факта лога — не записываем в БД.
  if (parsed.is_question) {
    return { summary: parsed.summary, isQuestion: true };
  }

  const loggedAt = hintToUnix(parsed.logged_at_hint, nowUnix());

  try {
    await db.insert(logs).values({
      userId: user.id,
      telegramMessageId,
      type: parsed.type,
      rawText: text,
      payload: JSON.stringify(parsed),
      loggedAt,
    });
  } catch (err) {
    // Уникальный индекс (user_id, telegram_message_id) — дубликат ретрая.
    // Молча игнорируем, чтобы не плодить записи.
    const msg = err instanceof Error ? err.message : String(err);
    if (!/UNIQUE|constraint/i.test(msg)) throw err;
  }

  // Если сообщение содержит вес — фиксируем в истории веса.
  if (parsed.weight_kg != null) {
    await recordWeight(user.id, parsed.weight_kg);
  }

  return { summary: parsed.summary, isQuestion: false };
}
