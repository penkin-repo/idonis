import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Telegraf } from 'telegraf';
import { message } from 'telegraf/filters';
import { getOrCreateUser, updateProfileFromText, renderProfile, recordWeight } from '../lib/profile.js';
import { logEvent, processExplicitFacts } from '../lib/logger.js';
import { buildReport, answerQuestion } from '../lib/analyst.js';

/**
 * ЕДИНСТВЕННЫЙ эндпоинт проекта (webhook-режим).
 * Совмещает Агента-Логера, онбординг профиля и команды анализа.
 * Крона нет — аналитик дёргается командами (/report, /report N, /week).
 */

export const config = {
  runtime: 'nodejs',
  maxDuration: 60,
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
  '💡 Можно задать вопрос: «что съесть на ночь?» — отвечу с контекстом.',
  '💡 Перед фактом можно поставить + : «+ съел 2 яйца» — точно запишется.',
  '',
  '<b>Команды:</b>',
  '/start — начало и рассказ о себе',
  '/profile — показать профиль (или напиши текст, чтобы обновить)',
  '/weight 80 — быстро внести вес',
  '/report — отчёт за сегодня',
  '/report 3 — отчёт за последние 3 дня',
  '/week — отчёт за 7 дней',
  '/logs — записи за сегодня (отладка)',
  '/facts — известные факты обо мне',
  '/del — показать последние записи (или /del #ID для удаления)',
  '/help — эта справка',
].join('\n');

// ---------- Команды ----------

bot.start(async (ctx) => {
  const user = await getOrCreateUser(
    String(ctx.chat.id),
    ctx.from?.username ?? undefined,
  );
  // Сбрасываем старую клавиатуру от предыдущей версии бота.
  await ctx.reply(' ', { reply_markup: { remove_keyboard: true } });
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

const TYPE_ICONS: Record<string, string> = {
  food: '🍽',
  sleep: '😴',
  med: '💊',
  drink: '☕',
  mood: '🧠',
  activity: '🏃',
  note: '📝',
};

bot.command('logs', async (ctx) => {
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
      .where(and(
        eq(logs.userId, user.id),
        eq(logs.status, 'active'),
        gte(logs.eventTime, startUnix),
        lt(logs.eventTime, endUnix),
      ))
      .orderBy(asc(logs.eventTime));
    if (rows.length === 0) {
      await ctx.reply('За сегодня записей нет.');
      return;
    }
    const text = rows
      .map((r) => {
        const icon = TYPE_ICONS[r.type] ?? '📝';
        return `[#${r.id}] ${icon} [${formatInTz(r.eventTime, tz)}] ${r.rawText}`;
      })
      .join('\n');
    await ctx.reply(`📋 Записи за сегодня:\n\n${text}\n\n💡 /del #ID — удалить запись`);
  } catch (err) {
    console.error('logs error:', err);
    await ctx.reply('⚠️ Не удалось получить записи.');
  }
});

bot.command('facts', async (ctx) => {
  const user = await getOrCreateUser(String(ctx.chat.id), ctx.from?.username ?? undefined);
  try {
    const { db } = await import('../db/client.js');
    const { facts } = await import('../db/schema.js');
    const { eq, desc } = await import('drizzle-orm');
    const rows = await db
      .select()
      .from(facts)
      .where(eq(facts.userId, user.id))
      .orderBy(desc(facts.createdAt));
    if (rows.length === 0) {
      await ctx.reply('Пока нет известных фактов о тебе. Они появятся автоматически из твоих сообщений.');
      return;
    }
    const list = rows.map((f, i) => `${i + 1}. ${f.fact}`).join('\n');
    await ctx.reply(`🧠 Известные факты обо мне:\n\n${list}`);
  } catch (err) {
    console.error('facts error:', err);
    await ctx.reply('⚠️ Не удалось получить факты.');
  }
});

// ---------- Свободный текст ----------

bot.command('del', async (ctx) => {
  const user = await getOrCreateUser(String(ctx.chat.id), ctx.from?.username ?? undefined);
  const arg = ctx.message.text.replace(/^\/del(@\w+)?\s*/i, '').trim();
  try {
    const { db } = await import('../db/client.js');
    const { logs } = await import('../db/schema.js');
    const { eq, desc, and } = await import('drizzle-orm');

    // Если указан ID (#42 или 42) — удаляем по ID.
    const idMatch = arg.match(/^#?(\d+)$/);
    if (idMatch) {
      const targetId = parseInt(idMatch[1], 10);
      const row = await db
        .select()
        .from(logs)
        .where(and(eq(logs.id, targetId), eq(logs.userId, user.id)))
        .limit(1);
      if (row.length === 0) {
        await ctx.reply(`Запись #${targetId} не найдена.`);
        return;
      }
      await db.update(logs).set({ status: 'deleted' }).where(eq(logs.id, targetId));
      await ctx.reply(`🗑️ Удалил: "${row[0].rawText}"`);
      return;
    }

    // Без аргумента — показать последние 5 записей для выбора.
    const recent = await db
      .select()
      .from(logs)
      .where(and(eq(logs.userId, user.id), eq(logs.status, 'active')))
      .orderBy(desc(logs.eventTime))
      .limit(5);
    if (recent.length === 0) {
      await ctx.reply('Записей нет, удалять нечего.');
      return;
    }
    const list = recent
      .map((r) => {
        const icon = TYPE_ICONS[r.type] ?? '📝';
        return `#${r.id} ${icon} ${r.rawText}`;
      })
      .join('\n');
    await ctx.reply(`Последние записи:\n\n${list}\n\n💡 /del #ID — удалить нужную`);
  } catch (err) {
    console.error('del error:', err);
    await ctx.reply('⚠️ Не удалось удалить запись.');
  }
});

// ---------- Intent Router ----------

const FACT_ASSERT_RE = /^(добавь\s+в\s+факты|запомни|факт[:\s]|запиши\s+факт)/i;
const FACT_ASSERT_TRIGGERS = /\b(вернул(?:ся|ась)?|приехал|уехал|переехал|вышел\s+на\s+работу|на\s+работе|в\s+архангельск|в\s+москв|домой\s+от)\b/i;
const QUESTION_RE = /^(\?\s|а\s+ты|ты\s+видишь|ты\s+знаешь|ты\s+помнишь|как\s+мне|что\s+мне|сколько|почему|зачем|можешь|стоит\s+ли|нужно\s+ли|ли\s+\w)/i;
const QUESTION_MARK_RE = /\?/;

type Intent = 'fact_assert' | 'question' | 'log';

function classifyIntent(text: string): Intent {
  if (FACT_ASSERT_RE.test(text) || FACT_ASSERT_TRIGGERS.test(text)) return 'fact_assert';
  if (QUESTION_RE.test(text) || QUESTION_MARK_RE.test(text)) return 'question';
  return 'log';
}

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
      const summary = await updateProfileFromText(user, text);
      const refreshed = await getOrCreateUser(String(ctx.chat.id));
      const tail = refreshed.onboarded
        ? '\n\nОтлично, профиль готов! Теперь пиши, что ел/как спал/как самочувствие. /help для команд.'
        : '\n\nМожешь дополнить: чего пока не хватает — имя, возраст или вес.';
      await ctx.reply(`✅ ${summary}${tail}`);
      return;
    }

    const intent = classifyIntent(text);

    if (intent === 'question') {
      const reply = await answerQuestion(user, text);
      await ctx.reply(reply, { parse_mode: 'HTML' });
      return;
    }

    if (intent === 'fact_assert') {
      const summary = await processExplicitFacts(user, text);
      await ctx.reply(`✅ ${summary}`);
      return;
    }

    // Дефолт — логер.
    const result = await logEvent(user, text, ctx.message.message_id);

    if (result.isQuestion) {
      const reply = await answerQuestion(user, text);
      await ctx.reply(reply, { parse_mode: 'HTML' });
      return;
    }

    await ctx.reply(`✅ ${result.summary}`);
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
