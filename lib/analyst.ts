import { and, eq, gte, lt, asc, desc } from 'drizzle-orm';
import { db } from '../db/client.js';
import { logs, weights, reports, chatMessages, facts, type User } from '../db/schema.js';
import { callStructured, MODEL_ANALYST, LlmJsonError } from './openrouter.js';
import { ANALYST_PROMPT, CHAT_PROMPT } from './prompts.js';
import { analysisSchema, chatSchema } from './schemas.js';
import { periodBounds, periodLabel, formatInTz, nowUnix } from './time.js';
import { escapeHtml } from './profile.js';

/**
 * Агент-Аналитик: собирает логи и вес за период, отправляет профиль + данные
 * в LLM, формирует HTML-отчёт. Вызывается ПО КОМАНДЕ из бота (крона нет).
 *
 * @param days количество последних календарных суток (1 = сегодня).
 */
export async function buildReport(user: User, days: number): Promise<string> {
  const tz = user.tz ?? 'Europe/Moscow';
  const { startUnix, endUnix } = periodBounds(tz, days);

  // Параллелим все DB-запросы для скорости.
  const [periodLogs, periodWeights, userFacts] = await Promise.all([
    db
      .select()
      .from(logs)
      .where(and(eq(logs.userId, user.id), gte(logs.loggedAt, startUnix), lt(logs.loggedAt, endUnix)))
      .orderBy(asc(logs.loggedAt)),
    db
      .select()
      .from(weights)
      .where(and(eq(weights.userId, user.id), gte(weights.measuredAt, startUnix), lt(weights.measuredAt, endUnix)))
      .orderBy(asc(weights.measuredAt)),
    db
      .select()
      .from(facts)
      .where(eq(facts.userId, user.id))
      .orderBy(desc(facts.createdAt))
      .limit(30),
  ]);

  if (periodLogs.length === 0 && periodWeights.length === 0) {
    return days <= 1
      ? '📭 За сегодня пока нет записей. Напиши, что ел, как спал или как самочувствие — и я всё запишу.'
      : `📭 За последние ${days} дн. нет записей для анализа.`;
  }

  // Готовим компактный контекст для LLM.
  const profileBlock = renderProfileForLlm(user);
  const logsBlock = periodLogs
    .map((l) => `- [${formatInTz(l.loggedAt, tz)}] ${l.rawText}`)
    .join('\n');
  const weightsBlock = periodWeights
    .map((w) => `- [${formatInTz(w.measuredAt, tz)}] ${w.weightKg} кг`)
    .join('\n');

  const nowStr = formatInTz(nowUnix(), tz, 'dd.MM.yyyy HH:mm (EEEE)');

  const userContent = [
    `ТЕКУЩЕЕ ВРЕМЯ ПОЛЬЗОВАТЕЛЯ: ${nowStr} (TZ: ${tz})`,
    '',
    'ПРОФИЛЬ ПОЛЬЗОВАТЕЛЯ:',
    profileBlock,
    '',
    'ИЗВЕСТНЫЕ ФАКТЫ О ПОЛЬЗОВАТЕЛЕ:',
    userFacts.length ? userFacts.map((f) => `- ${f.fact}`).join('\n') : '(нет)',
    '',
    `ЛОГИ ЗА ПЕРИОД (${days === 1 ? 'сегодня' : `${days} дн.`}):`,
    logsBlock || '(нет)',
    '',
    'ЗАМЕРЫ ВЕСА ЗА ПЕРИОД:',
    weightsBlock || '(нет)',
  ].join('\n');

  let html: string;
  try {
    const analysis = await callStructured(
      ANALYST_PROMPT,
      userContent,
      analysisSchema,
      MODEL_ANALYST,
    );
    html = renderReportHtml(analysis, days);
  } catch (err) {
    console.error('Analyst LLM error:', err);
    if (err instanceof LlmJsonError) {
      // LLM вернул текст без JSON — используем как отчёт.
      html = err.rawText;
    } else {
      html =
        '⚠️ Не удалось построить аналитический отчёт (ошибка LLM). Данные записаны, попробуй позже.';
    }
    return html;
  }

  // Сохраняем отчёт (best-effort).
  try {
    await db.insert(reports).values({
      userId: user.id,
      periodLabel: periodLabel(days),
      content: html,
    });
  } catch (err) {
    console.error('Failed to save report:', err);
  }

  return html;
}

function renderProfileForLlm(u: User): string {
  const parts: string[] = [];
  if (u.name) parts.push(`имя: ${u.name}`);
  if (u.age != null) parts.push(`возраст: ${u.age}`);
  if (u.sex) parts.push(`пол: ${u.sex === 'male' ? 'мужской' : 'женский'}`);
  if (u.heightCm != null) parts.push(`рост: ${u.heightCm} см`);
  if (u.currentWeightKg != null) parts.push(`вес: ${u.currentWeightKg} кг`);
  if (u.activityLevel) parts.push(`активность: ${u.activityLevel}`);
  if (u.workType) parts.push(`работа: ${u.workType}`);
  if (u.sleepSchedule) parts.push(`режим сна: ${u.sleepSchedule}`);
  if (u.dietRestrictions) parts.push(`ограничения питания: ${u.dietRestrictions}`);
  if (u.chronicConditions) parts.push(`хронические состояния: ${u.chronicConditions}`);
  if (u.goal) parts.push(`цель: ${u.goal}`);
  return parts.length ? parts.join('; ') : '(профиль не заполнен)';
}

/**
 * Ответ на свободный вопрос пользователя с учётом профиля, логов,
 * последних 40 сообщений диалога и известных фактов.
 */
export async function answerQuestion(user: User, question: string): Promise<string> {
  const tz = user.tz ?? 'Europe/Moscow';
  const { startUnix } = periodBounds(tz, 1);

  // Параллелим все DB-запросы для скорости.
  const [recentLogs, recentChat, userFacts] = await Promise.all([
    db
      .select()
      .from(logs)
      .where(and(eq(logs.userId, user.id), gte(logs.loggedAt, startUnix)))
      .orderBy(asc(logs.loggedAt))
      .limit(20),
    db
      .select()
      .from(chatMessages)
      .where(eq(chatMessages.userId, user.id))
      .orderBy(desc(chatMessages.createdAt))
      .limit(40),
    db
      .select()
      .from(facts)
      .where(eq(facts.userId, user.id))
      .orderBy(desc(facts.createdAt))
      .limit(30),
  ]);

  const profileBlock = renderProfileForLlm(user);
  const logsBlock = recentLogs
    .map((l) => `- ${l.rawText}`)
    .join('\n');

  // Чат-история в хронологическом порядке (от старых к новым).
  const chatBlock = recentChat
    .slice()
    .reverse()
    .map((m) => m.role === 'user' ? `Пользователь: ${m.content}` : `Аналитик: ${m.content}`)
    .join('\n');

  const factsBlock = userFacts.length
    ? userFacts.map((f) => `- ${f.fact}`).join('\n')
    : '(нет)';

  const nowStr = formatInTz(nowUnix(), tz, 'dd.MM.yyyy HH:mm (EEEE)');

  const userContent = [
    `ТЕКУЩЕЕ ВРЕМЯ ПОЛЬЗОВАТЕЛЯ: ${nowStr} (TZ: ${tz})`,
    '',
    'ПРОФИЛЬ ПОЛЬЗОВАТЕЛЯ:',
    profileBlock,
    '',
    'ИЗВЕСТНЫЕ ФАКТЫ О ПОЛЬЗОВАТЕЛЕ:',
    factsBlock,
    '',
    'ЛОГИ ЗА СЕГОДНЯ:',
    logsBlock || '(пока ничего не записано)',
    '',
    'ИСТОРИЯ ДИАЛОГА (последние сообщения):',
    chatBlock || '(это первое сообщение)',
    '',
    'НОВОЕ СООБЩЕНИЕ ПОЛЬЗОВАТЕЛЯ:',
    question,
  ].join('\n');

  let reply: string;
  try {
    const result = await callStructured(CHAT_PROMPT, userContent, chatSchema, MODEL_ANALYST);
    reply = result.reply;
  } catch (err) {
    if (err instanceof LlmJsonError) {
      // LLM вернул текст без JSON — используем как есть.
      reply = err.rawText;
    } else {
      throw err;
    }
  }

  // Сохраняем вопрос и ответ в историю чата.
  const now = nowUnix();
  try {
    await db.insert(chatMessages).values([
      { userId: user.id, role: 'user', content: question, createdAt: now },
      { userId: user.id, role: 'assistant', content: reply, createdAt: now + 1 },
    ]);
  } catch (err) {
    console.error('Failed to save chat history:', err);
  }

  return reply;
}

function renderReportHtml(
  a: import('./schemas.js').AnalysisParsed,
  days: number,
): string {
  const title = days <= 1 ? 'Отчёт за сегодня' : `Отчёт за ${days} дн.`;
  const recs =
    a.recommendations.length > 0
      ? a.recommendations.map((r) => `• ${escapeHtml(r)}`).join('\n')
      : '—';

  const score = a.score_1_10 != null ? `${a.score_1_10}/10` : '—';

  return [
    `<b>📊 ${title}</b>`,
    '',
    `<b>${escapeHtml(a.headline)}</b>`,
    `Оценка: <b>${score}</b>`,
    '',
    `🍞 <b>Инсулиновые качели:</b> ${escapeHtml(a.insulin_swings)}`,
    `😰 <b>Гормоны стресса:</b> ${escapeHtml(a.stress_hormones)}`,
    `🥦 <b>Буфер клетчатки:</b> ${escapeHtml(a.fiber_buffer)}`,
    `⚖️ <b>Динамика веса:</b> ${escapeHtml(a.weight_trend)}`,
    '',
    `💡 <b>Рекомендации:</b>\n${recs}`,
    '',
    '<i>⚕️ Это образовательные эвристики, а не медицинский диагноз. При проблемах со здоровьем обратись к врачу.</i>',
  ].join('\n');
}
