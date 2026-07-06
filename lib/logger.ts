import { db } from '../db/client.ts';
import { logs, type User } from '../db/schema.ts';
import { callStructured } from './openrouter.ts';
import { LOGGER_PROMPT } from './prompts.ts';
import { logSchema } from './schemas.ts';
import { nowUnix, hintToUnix } from './time.ts';
import { recordWeight } from './profile.ts';

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
): Promise<string> {
  const parsed = await callStructured(LOGGER_PROMPT, text, logSchema);

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

  return parsed.summary;
}
