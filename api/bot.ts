import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Telegraf } from 'telegraf';
import { message } from 'telegraf/filters';
import { getOrCreateUser, updateProfileFromText, renderProfile, recordWeight } from '../lib/profile.js';
import { logEvent } from '../lib/logger.js';
import { buildReport } from '../lib/analyst.js';

/**
 * ЕДИНСТВЕННЫЙ эндпоинт проекта (webhook-режим).
 * Совмещает Агента-Логера, онбординг профиля и команды анализа.
 * Крона нет — аналитик дёргается командами (/report, /report N, /week).
 */

export const config = {
  runtime: 'nodejs',
  maxDuration: 30,
};

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
if (!BOT_TOKEN) throw new Error('Missing TELEGRAM_BOT_TOKEN');

const bot = new Telegraf(BOT_TOKEN);

bot.telegram.setMyCommands([
  { command: 'start', description: 'Онбординг — рассказать о себе' },
  { command: 'profile', description: 'Профиль (или обновить текстом)' },
  { command: 'weight', description: 'Вес: /weight 80' },
  { command: 'report', description: 'Отчёт за сегодня' },
  { command: 'week', description: 'Отчёт за неделю' },
  { command: 'logs', description: 'Записи за сегодня (отладка)' },
  { command: 'help', description: 'Справка' },
]).catch(() => {});

const HELP_TEXT = [
  '<b>🤖 Трекер образа жизни</b>',
  '',
  'Просто пиши свободным текстом — я распознаю и запишу:',
  '• «на завтрак овсянка с ягодами»',
  '• «спал 6 часов, качество плохое»',
  '• «настроение 4/5, немного стресса»',
  '• «пробежка 30 минут»',
  '• «вешу 81.5»',
  '',
  '<b>Команды:</b>',
  '/start — начало и рассказ о себе',
  '/profile — показать профиль (или напиши текст, чтобы обновить)',
  '/weight 80 — быстро внести вес',
  '/report — отчёт за сегодня',
  '/report 3 — отчёт за последние 3 дня',
  '/week — отчёт за 7 дней',
  '/logs — записи за сегодня (отладка)',
  '/help — эта справка',
].join('\n');

// ---------- Команды ----------

bot.start(async (ctx) => {
  const user = await getOrCreateUser(
    String(ctx.chat.id),
    ctx.from?.username ?? undefined,
  );
  if (user.onboarded) {
    await ctx.reply(
      'С возвращением! 👋 Пиши, что ел/как спал/как самочувствие — я всё запишу. /help для команд.',
    );
    return;
  }
  await ctx.reply(
    [
      '👋 Привет! Я помогу отслеживать еду, сон, самочувствие и вес.',
      '',
      'Для начала расскажи о себе <b>одним сообщением</b> свободным текстом, например:',
      '',
      '<i>«Меня зовут Иван, 34 года, мужчина, рост 180, вес 82, работа сидячая, ложусь в 00:00 встаю в 7:00, цель — похудеть, аллергия на орехи».</i>',
      '',
      'Можно указать не всё — потом дополнишь.',
    ].join('\n'),
    { parse_mode: 'HTML' },
  );
});

bot.help(async (ctx) => {
  await ctx.reply(HELP_TEXT, { parse_mode: 'HTML' });
});

bot.command('profile', async (ctx) => {
  const user = await getOrCreateUser(String(ctx.chat.id), ctx.from?.username ?? undefined);
  const arg = ctx.message.text.replace(/^\/profile(@\w+)?\s*/i, '').trim();
  if (arg) {
    // Обновление профиля свободным текстом.
    try {
      await ctx.sendChatAction('typing');
      const summary = await updateProfileFromText(user, arg);
      await ctx.reply(`✅ ${summary}`);
    } catch (err) {
      console.error('profile update error:', err);
      await ctx.reply('⚠️ Не удалось разобрать данные профиля. Попробуй переформулировать.');
    }
  } else {
    await ctx.reply(renderProfile(user), { parse_mode: 'HTML' });
  }
});

bot.command('weight', async (ctx) => {
  const user = await getOrCreateUser(String(ctx.chat.id), ctx.from?.username ?? undefined);
  const arg = ctx.message.text.replace(/^\/weight(@\w+)?\s*/i, '').trim().replace(',', '.');
  const kg = Number(arg);
  if (!Number.isFinite(kg) || kg <= 0 || kg > 500) {
    await ctx.reply('Укажи вес в кг, например: /weight 80');
    return;
  }
  await recordWeight(user.id, kg);
  await ctx.reply(`⚖️ Записал вес: ${kg} кг`);
});

bot.command('report', async (ctx) => {
  const user = await getOrCreateUser(String(ctx.chat.id), ctx.from?.username ?? undefined);
  const arg = ctx.message.text.replace(/^\/report(@\w+)?\s*/i, '').trim();
  let days = 1;
  if (arg) {
    const n = parseInt(arg, 10);
    if (Number.isFinite(n) && n >= 1 && n <= 90) days = n;
  }
  await ctx.reply('⏳ Анализирую...');
  await ctx.sendChatAction('typing');
  try {
    const report = await buildReport(user, days);
    await ctx.reply(report, { parse_mode: 'HTML' });
  } catch (err) {
    console.error('report error:', err);
    await ctx.reply('⚠️ Ошибка при построении отчёта. Попробуй позже.');
  }
});

bot.command('week', async (ctx) => {
  const user = await getOrCreateUser(String(ctx.chat.id), ctx.from?.username ?? undefined);
  await ctx.reply('⏳ Анализирую неделю...');
  await ctx.sendChatAction('typing');
  try {
    const report = await buildReport(user, 7);
    await ctx.reply(report, { parse_mode: 'HTML' });
  } catch (err) {
    console.error('week report error:', err);
    await ctx.reply('⚠️ Ошибка при построении отчёта. Попробуй позже.');
  }
});

bot.command('logs', async (ctx) => {
  // Лёгкая отладочная команда: показать сырые записи за сегодня.
  const user = await getOrCreateUser(String(ctx.chat.id), ctx.from?.username ?? undefined);
  try {
    const { db } = await import('../db/client.js');
    const { logs } = await import('../db/schema.js');
    const { periodBounds, formatInTz } = await import('../lib/time.js');
    const { and, eq, gte, lt, asc } = await import('drizzle-orm');
    const tz = user.tz ?? 'Europe/Moscow';
    const { startUnix, endUnix } = periodBounds(tz, 1);
    const rows = await db
      .select()
      .from(logs)
      .where(and(eq(logs.userId, user.id), gte(logs.loggedAt, startUnix), lt(logs.loggedAt, endUnix)))
      .orderBy(asc(logs.loggedAt));
    if (rows.length === 0) {
      await ctx.reply('За сегодня записей нет.');
      return;
    }
    const text = rows
      .map((r) => `[${formatInTz(r.loggedAt, tz)}] (${r.type}) ${r.rawText}`)
      .join('\n');
    await ctx.reply(`📋 Записи за сегодня:\n\n${text}`);
  } catch (err) {
    console.error('logs error:', err);
    await ctx.reply('⚠️ Не удалось получить записи.');
  }
});

// ---------- Свободный текст ----------

bot.on(message('text'), async (ctx) => {
  const text = ctx.message.text.trim();
  if (!text || text.startsWith('/')) return;

  const user = await getOrCreateUser(
    String(ctx.chat.id),
    ctx.from?.username ?? undefined,
  );

  try {
    await ctx.sendChatAction('typing');

    if (!user.onboarded) {
      // Пока профиль не заполнен — трактуем сообщение как рассказ о себе.
      const summary = await updateProfileFromText(user, text);
      const refreshed = await getOrCreateUser(String(ctx.chat.id));
      const tail = refreshed.onboarded
        ? '\n\nОтлично, профиль готов! Теперь пиши, что ел/как спал/как самочувствие. /help для команд.'
        : '\n\nМожешь дополнить: чего пока не хватает — имя, возраст или вес.';
      await ctx.reply(`✅ ${summary}${tail}`);
      return;
    }

    // Обычный лог образа жизни.
    const summary = await logEvent(user, text, ctx.message.message_id);
    await ctx.reply(`✅ ${summary}`);
  } catch (err) {
    console.error('text handler error:', err);
    const errMsg = err instanceof Error ? err.message : String(err);
    await ctx.reply(`⚠️ Не удалось обработать сообщение: ${errMsg}. Попробуй переформулировать.`);
  }
});

// ---------- HTTP-хендлер (Vercel) ----------

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Telegram шлёт только POST. Для GET отдаём health-check.
  if (req.method !== 'POST') {
    res.status(200).json({ ok: true, service: 'lifestyle-tracker-bot' });
    return;
  }

  // Проверка секретного токена вебхука (устанавливается при setWebhook).
  const secret = req.headers['x-telegram-bot-api-secret-token'];
  if (
    process.env.TELEGRAM_SECRET_TOKEN &&
    secret !== process.env.TELEGRAM_SECRET_TOKEN
  ) {
    res.status(401).json({ ok: false, error: 'unauthorized' });
    return;
  }

  try {
    // Telegraf обрабатывает update. Отвечаем 200 в любом случае, чтобы
    // Telegram не ретраил бесконечно.
    await bot.handleUpdate(req.body);
    res.status(200).json({ ok: true });
  } catch (err) {
    console.error('handleUpdate error:', err);
    res.status(200).json({ ok: true }); // всё равно 200, чтобы избежать ретраев-штормов
  }
}
