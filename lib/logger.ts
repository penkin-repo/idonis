import { and, eq, gte, asc, like } from 'drizzle-orm';
import { db } from '../db/client.js';
import { logs, facts, type User } from '../db/schema.js';
import { callStructured } from './openrouter.js';
import { LOGGER_PROMPT } from './prompts.js';
import { logSchema } from './schemas.js';
import { nowUnix, hintToUnix, periodBounds, formatInTz } from './time.js';
import { recordWeight } from './profile.js';

/**
 * Агент-Логер: записывает события в дневник, извлекает факты о пользователе.
 * Передаёт в LLM историю за сегодня — для дедупликации.
 */
export async function logEvent(
  user: User,
  text: string,
  telegramMessageId: number | null,
): Promise<{ summary: string; isQuestion: boolean }> {
  const tz = user.tz ?? 'Europe/Moscow';
  const { startUnix } = periodBounds(tz, 1);

  // Последние записи за сегодня — для дедупликации.
  const todayLogs = await db
    .select()
    .from(logs)
    .where(
      and(
        eq(logs.userId, user.id),
        gte(logs.loggedAt, startUnix),
      ),
    )
    .orderBy(asc(logs.loggedAt))
    .limit(20);

  const historyBlock = todayLogs
    .map((l) => `- [${formatInTz(l.loggedAt, tz)}] ${l.rawText}`)
    .join('\n');

  const userContent = [
    'ИСТОРИЯ ЗА СЕГОДНЯ (для дедупликации):',
    historyBlock || '(пока пусто)',
    '',
    'НОВОЕ СООБЩЕНИЕ ПОЛЬЗОВАТЕЛЯ:',
    text,
  ].join('\n');

  const parsed = await callStructured(LOGGER_PROMPT, userContent, logSchema);

  // Обрабатываем факты (add/remove) в любом случае — даже для вопросов.
  await processFacts(user.id, parsed.spotted_facts);

  // Если это вопрос — не записываем в дневник.
  if (parsed.is_question) {
    return { summary: parsed.summary, isQuestion: true };
  }

  // Если дубликат — не записываем.
  if (parsed.is_duplicate) {
    return { summary: 'Уже записано ранее 👌', isQuestion: false };
  }

  // Записываем в дневник.
  const loggedAt = hintToUnix(parsed.logged_at_hint, nowUnix());
  const diaryText = parsed.diary_entry ?? text;

  try {
    await db.insert(logs).values({
      userId: user.id,
      telegramMessageId,
      type: 'entry',
      rawText: diaryText,
      payload: JSON.stringify(parsed),
      loggedAt,
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
