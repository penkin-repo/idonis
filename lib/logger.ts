import { eq, and, gte, lt, like } from 'drizzle-orm';
import { db } from '../db/client.js';
import { logs, facts, type User } from '../db/schema.js';
import { callStructured } from './openrouter.js';
import { LOGGER_PROMPT } from './prompts.js';
import { logSchema } from './schemas.js';
import { nowUnix, hintToUnix, periodBounds } from './time.js';
import { recordWeight } from './profile.js';

const REPEAT_WORDS = /\b(опять|повтор|снова|ещё раз|еще раз)\b/i;

/**
 * Агент-Логер: записывает события в дневник, извлекает факты о пользователе.
 * Дедупликация — в коде, не через LLM.
 */
export async function logEvent(
  user: User,
  text: string,
  telegramMessageId: number | null,
): Promise<{ summary: string; isQuestion: boolean }> {
  const tz = user.tz ?? 'Europe/Moscow';
  const parsed = await callStructured(LOGGER_PROMPT, text, logSchema);

  // Обрабатываем факты (add/remove) в любом случае — даже для вопросов.
  await processFacts(user.id, parsed.spotted_facts);

  // Если это вопрос — не записываем в дневник.
  if (parsed.is_question) {
    return { summary: parsed.summary, isQuestion: true };
  }

  const eventTime = hintToUnix(parsed.event_time_hint, nowUnix(), tz);
  const loggedAt = nowUnix();
  const diaryText = parsed.diary_entry ?? text;
  const entryType = parsed.type || 'note';

  // Дедупликация в коде: тот же type + event_time ± 10 мин + похожий текст
  // и нет слов-повторов (опять, снова, ещё раз) → дубль.
  if (!REPEAT_WORDS.test(text)) {
    const { startUnix, endUnix } = periodBounds(tz, 1);
    const windowStart = eventTime - 600; // ±10 минут
    const windowEnd = eventTime + 600;

    const existing = await db
      .select()
      .from(logs)
      .where(
        and(
          eq(logs.userId, user.id),
          eq(logs.type, entryType),
          eq(logs.status, 'active'),
          gte(logs.eventTime, Math.max(windowStart, startUnix)),
          lt(logs.eventTime, Math.min(windowEnd, endUnix)),
        ),
      )
      .limit(1);

    if (existing.length > 0) {
      // Проверяем похожесть текста — если >70% совпадение по словам.
      if (isSimilarText(diaryText, existing[0].rawText)) {
        return { summary: 'Уже записано ранее 👌', isQuestion: false };
      }
    }
  }

  try {
    await db.insert(logs).values({
      userId: user.id,
      telegramMessageId,
      type: entryType,
      rawText: diaryText,
      payload: JSON.stringify(parsed),
      eventTime,
      loggedAt,
      status: 'active',
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!/UNIQUE|constraint/i.test(msg)) throw err;
  }

  // Если сообщение содержит вес — фиксируем.
  if (parsed.weight_kg != null) {
    await recordWeight(user.id, parsed.weight_kg);
  }

  return { summary: parsed.summary, isQuestion: false };
}

/**
 * Сравнение текстов по пересечению слов. Возвращает true если >70% совпадения.
 */
function isSimilarText(a: string, b: string): boolean {
  const wordsA = new Set(a.toLowerCase().split(/\s+/).filter((w) => w.length > 2));
  const wordsB = new Set(b.toLowerCase().split(/\s+/).filter((w) => w.length > 2));
  if (wordsA.size === 0 || wordsB.size === 0) return false;
  let common = 0;
  for (const w of wordsA) if (wordsB.has(w)) common++;
  const ratio = common / Math.min(wordsA.size, wordsB.size);
  return ratio > 0.7;
}

/**
 * Обрабатывает факты: добавляет новые, удаляет устаревшие.
 */
async function processFacts(
  userId: number,
  spottedFacts: { fact: string; action: 'add' | 'remove' }[],
): Promise<void> {
  if (spottedFacts.length === 0) return;

  for (const f of spottedFacts) {
    try {
      if (f.action === 'remove') {
        // Удаляем факты, содержащие похожий текст.
        await db
          .delete(facts)
          .where(
            and(
              eq(facts.userId, userId),
              like(facts.fact, `%${f.fact}%`),
            ),
          );
      } else {
        // Проверяем, нет ли уже такого факта.
        const existing = await db
          .select()
          .from(facts)
          .where(
            and(
              eq(facts.userId, userId),
              like(facts.fact, `%${f.fact}%`),
            ),
          )
          .limit(1);

        if (existing.length === 0) {
          await db.insert(facts).values({
            userId,
            fact: f.fact,
            createdAt: nowUnix(),
          });
        }
      }
    } catch (err) {
      console.error('Failed to process fact:', f, err);
    }
  }
}
