import { eq, and, gte, lt, desc } from 'drizzle-orm';
import { db } from '../db/client.js';
import { logs, facts, type User } from '../db/schema.js';
import { callStructured } from './openrouter.js';
import { LOGGER_PROMPT } from './prompts.js';
import { logSchema } from './schemas.js';
import { nowUnix, hintToUnix, periodBounds, formatInTz } from './time.js';
import { recordWeight } from './profile.js';

const REPEAT_WORDS = /\b(опять|повтор|снова|ещё раз|еще раз)\b/i;

type FactAction = {
  fact: string;
  action: 'add' | 'remove' | 'replace';
  fact_id: number | null;
  new_fact: string | null;
};

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
  const nowStr = formatInTz(nowUnix(), tz, "yyyy-MM-dd'T'HH:mm:ss (EEEE, dd.MM.yyyy)");

  // Загружаем текущие факты с ID для контекста LLM.
  const currentFacts = await db
    .select()
    .from(facts)
    .where(eq(facts.userId, user.id))
    .orderBy(desc(facts.createdAt))
    .limit(30);
  const factsBlock = currentFacts.length
    ? currentFacts.map((f) => `[#${f.id}] ${f.fact}`).join('\n')
    : '(нет фактов)';

  const userContent = [
    `ТЕКУЩЕЕ ВРЕМЯ ПОЛЬЗОВАТЕЛЯ: ${nowStr} (TZ: ${tz})`,
    'Используй эту дату для event_time_hint, если пользователь не указал другую.',
    '',
    'ТЕКУЩИЕ ФАКТЫ ПОЛЬЗОВАТЕЛЯ (используй ID для remove/replace):',
    factsBlock,
    '',
    'СООБЩЕНИЕ ПОЛЬЗОВАТЕЛЯ:',
    text,
  ].join('\n');
  const parsed = await callStructured(LOGGER_PROMPT, userContent, logSchema);

  // Обрабатываем факты (add/remove/replace по ID) в любом случае.
  await processFacts(user.id, parsed.spotted_facts as FactAction[]);

  // Если это вопрос — не записываем в дневник.
  if (parsed.is_question) {
    return { summary: parsed.summary, isQuestion: true };
  }

  const now = nowUnix();
  const eventTime = hintToUnix(parsed.event_time_hint, now, tz);
  // Защита: если LLM поставил будущее время — используем текущее.
  const safeEventTime = eventTime > now + 300 ? now : eventTime;
  const loggedAt = nowUnix();
  const diaryText = parsed.diary_entry ?? text;
  const entryType = parsed.type || 'note';

  // Дедупликация в коде: тот же type + event_time ± 10 мин + похожий текст
  // и нет слов-повторов (опять, снова, ещё раз) → дубль.
  if (!REPEAT_WORDS.test(text)) {
    const { startUnix, endUnix } = periodBounds(tz, 1);
    const windowStart = safeEventTime - 600; // ±10 минут
    const windowEnd = safeEventTime + 600;

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
      eventTime: safeEventTime,
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
 * Обрабатывает факты: add/remove/replace по ID.
 */
async function processFacts(
  userId: number,
  spottedFacts: FactAction[],
): Promise<void> {
  if (spottedFacts.length === 0) return;

  for (const f of spottedFacts) {
    try {
      if (f.action === 'remove' && f.fact_id != null) {
        await db
          .delete(facts)
          .where(and(eq(facts.id, f.fact_id), eq(facts.userId, userId)));
      } else if (f.action === 'replace' && f.fact_id != null && f.new_fact) {
        await db
          .update(facts)
          .set({ fact: f.new_fact })
          .where(and(eq(facts.id, f.fact_id), eq(facts.userId, userId)));
      } else if (f.action === 'add' && f.fact) {
        // Проверяем, нет ли уже похожего факта.
        const existing = await db
          .select()
          .from(facts)
          .where(eq(facts.userId, userId))
          .limit(50);
        const dupe = existing.some((e) => isSimilarText(f.fact, e.fact));
        if (!dupe) {
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

/**
 * Обработка явного утверждения факта (intent=fact_assert).
 * Передаёт текущие факты с ID в LLM, получает add/remove/replace по ID.
 */
export async function processExplicitFacts(user: User, text: string): Promise<string> {
  const currentFacts = await db
    .select()
    .from(facts)
    .where(eq(facts.userId, user.id))
    .orderBy(desc(facts.createdAt))
    .limit(30);

  const factsBlock = currentFacts.length
    ? currentFacts.map((f) => `[#${f.id}] ${f.fact}`).join('\n')
    : '(нет фактов)';

  const userContent = [
    'ТЕКУЩИЕ ФАКТЫ ПОЛЬЗОВАТЕЛЯ (используй ID для remove/replace):',
    factsBlock,
    '',
    'СООБЩЕНИЕ ПОЛЬЗОВАТЕЛЯ:',
    text,
  ].join('\n');

  const parsed = await callStructured(LOGGER_PROMPT, userContent, logSchema);
  await processFacts(user.id, parsed.spotted_facts as FactAction[]);

  return parsed.summary;
}
