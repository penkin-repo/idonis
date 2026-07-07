# 🤖 HealthBot — Lifestyle Tracker

Двухагентный Telegram-бот для трекинга образа жизни (еда, сон, самочувствие, вес) с контекстным AI-анализом.

## Архитектура

### Два агента

**Агент-Логер** (дешёвая модель — `OPENROUTER_MODEL`, по умолчанию `openai/gpt-4o-mini`):
- Видит **все** сообщения пользователя
- Ведёт **дневник** — записывает события короткими заметками в прошедшем времени («съел курицу с рисом», «спал 6 часов, плохо»), без разбора на структурированные поля (углеводы/клетчатка/настроение)
- **Дедупликация** — видит историю за сегодня, определяет повтор (`is_duplicate`), не записывает дубль
- **Извлекает факты** о пользователе (`spotted_facts` с `add`/`remove`) — устойчивые сведения («работает из дома», «сын в деревне», «аллергия на лактозу»). Добавляет новые, удаляет устаревшие
- **Маршрутизация** — определяет `is_question`: если вопрос/размышление/план → не записывает в дневник, передаёт аналитику
- Вес (`weight_kg`) фиксирует отдельно в таблицу `weights`

**Агент-Аналитик** (продвинутая модель — `OPENROUTER_MODEL_ANALYST`):
- Вызывается **только** для ответов на вопросы и построения отчётов
- **Не пишет в БД** — только читает и отвечает
- **Не извлекает факты** — это работа логера
- Видит: профиль, дневник за сегодня, известные факты, историю диалога (40 сообщений), текущее время в TZ пользователя
- **Чат** (`answerQuestion`) — отвечает на свободные вопросы с контекстом
- **Отчёты** (`buildReport`) — `/report`, `/week` — анализирует дневник за период, сам определяет где углеводы/сон/стресс

### Поток данных

```
Пользователь пишет сообщение
        │
  api/bot.ts
        │
  user.onboarded? ── нет ──→ updateProfileFromText (LLM парсит профиль)
        │
  да → logEvent (Логер)
        │
  is_question? ── да ──→ answerQuestion (Аналитик) → ответ в чат
        │                    │
  нет → записать в дневник    сохранить вопрос+ответ в chat_messages
        │
  is_duplicate? ── да ──→ "Уже записано"
        │
  нет → сохранить в logs
        │
  spotted_facts → add/remove в facts
        │
  weight_kg? ── да ──→ recordWeight в weights
        │
  ✅ подтверждение пользователю
```

## Стек

| Слой | Технология |
|---|---|
| Хостинг | Vercel Serverless Functions (Node.js runtime, Hobby план — 30s лимит) |
| Бот | [Telegraf.js](https://telegraf.js.org/) (webhook-режим) |
| БД | [Turso](https://turso.tech/) (libSQL) + [Drizzle ORM](https://orm.drizzle.team/) |
| LLM | [OpenRouter](https://openrouter.ai/) через OpenAI SDK (JSON-режим) |
| Валидация | [zod](https://zod.dev/) |
| Пакетный менеджер | pnpm |

## Структура проекта

```
api/bot.ts           — единственный эндпоинт (webhook): логер + онбординг + команды
db/schema.ts         — схема Drizzle (users, logs, weights, reports, chat_messages, facts)
db/client.ts         — клиент Turso + Drizzle
lib/openrouter.ts    — LLM-клиент: callStructured + tryParseJson + LlmJsonError fallback
lib/prompts.ts       — системные промпты (PROFILE_PROMPT, LOGGER_PROMPT, ANALYST_PROMPT, CHAT_PROMPT)
lib/schemas.ts       — zod-схемы ответов LLM (profileSchema, logSchema, analysisSchema, chatSchema)
lib/profile.ts       — логика профиля, веса, онбординга
lib/logger.ts        — Агент-Логер: дневник + дедупликация + факты
lib/analyst.ts       — Агент-Аналитик: buildReport + answerQuestion
lib/time.ts          — таймзоны и границы периодов (periodBounds, formatInTz, nowUnix)
vercel.json          — maxDuration: 30
drizzle/             — SQL-миграции
.env.example         — шаблон переменных окружения
```

## Схема БД

| Таблица | Назначение |
|---|---|
| `users` | Профиль: имя, возраст, пол, рост, вес, активность, цель, TZ, onboarded |
| `logs` | Дневник: `raw_text` (короткая запись), `type` (всегда `entry`), `logged_at`, `payload` (JSON от логера) |
| `weights` | История веса: `weight_kg`, `measured_at` |
| `reports` | Сохранённые отчёты аналитика: `period_label`, `content` (HTML) |
| `chat_messages` | История чата: `role` (`user`/`assistant`), `content`, `created_at` |
| `facts` | Факты о пользователе: `fact`, `created_at` (логер добавляет/удаляет) |

Все таблицы изолированы по `user_id`. Каждый Telegram-пользователь — отдельная запись в `users` (по `telegram_chat_id`).

## Промпты

### LOGGER_PROMPT (`lib/prompts.ts`)
- Дневник: короткая запись в прошедшем времени, без структурированных полей
- `is_question`: true для вопросов, сослагательного наклонения, планов/намерений
- `is_duplicate`: true если дублирует запись из истории за сегодня
- `diary_entry`: короткая запись для дневника или null
- `spotted_facts`: массив `{fact, action: "add"|"remove"}`
- `weight_kg`: число или null
- Префикс `+` в сообщении = явный сигнал логирования (всегда `is_question=false`)

### ANALYST_PROMPT (`lib/prompts.ts`)
- Живой, ироничный приятель, но **естественный**
- Запрет на застревание в одной метафоре/шутке (никаких "агентов", "шпионов", "бэтменов")
- Метафоры не чаще 1-2 раз за весь ответ
- **Жёсткое разделение стилей**: сухие цифры на прямые вопросы → развёрнутый анализ на советы и `/report`
- HTML-теги `<b>` для выделения (не markdown `**`)
- Эвристики: инсулиновые качели, гормоны стресса, буфер клетчатки, динамика веса

### CHAT_PROMPT (`lib/prompts.ts`)
- Тот же стиль что у аналитика
- Видит: текущее время, профиль, факты, логи за сегодня, историю диалога (40 сообщений)
- **Жёсткое разделение стилей**: сухие факты на прямые вопросы → развёрнутый ответ на советы/анализ

## Команды Telegram

| Команда | Описание |
|---|---|
| `/start` | Онбординг + сброс старой клавиатуры |
| `/help` | Справка |
| `/profile` | Показать профиль (или обновить текстом: `/profile я вешу 82`) |
| `/weight 80` | Быстрый ввод веса |
| `/report` | Отчёт аналитика за сегодня |
| `/report 3` | Отчёт за 3 дня |
| `/week` | Отчёт за 7 дней |
| `/logs` | Записи дневника за сегодня (отладка) |

Свободный текст (не `/`): логер определяет — факт или вопрос. Факт → в дневник. Вопрос → аналитик отвечает.

## Настройка

### 1. Создать бота
Напиши [@BotFather](https://t.me/BotFather) → `/newbot` → сохрани токен.

### 2. Создать БД Turso
```bash
turso auth login
turso db create idonis-bot
turso db show idonis-bot --url        # -> TURSO_DATABASE_URL
turso db tokens create idonis-bot     # -> TURSO_AUTH_TOKEN
```

### 3. Получить ключ OpenRouter
[openrouter.ai/keys](https://openrouter.ai/keys) → `OPENROUTER_API_KEY`.

### 4. Переменные окружения
Скопируй `.env.example` → `.env` для локальной работы и добавь все в Vercel: `Project Settings → Environment Variables`.

| Переменная | Описание |
|---|---|
| `TELEGRAM_BOT_TOKEN` | Токен от @BotFather |
| `TELEGRAM_SECRET_TOKEN` | Любая случайная строка (проверяется на вебхуке) |
| `OPENROUTER_API_KEY` | Ключ OpenRouter |
| `OPENROUTER_MODEL` | Модель логера (быстрая, дешёвая). Напр. `openai/gpt-4o-mini` |
| `OPENROUTER_MODEL_ANALYST` | Модель аналитика/чата (продвинутая). Если пусто — берётся `OPENROUTER_MODEL` |
| `TURSO_DATABASE_URL` | `libsql://...turso.io` |
| `TURSO_AUTH_TOKEN` | Токен Turso |
| `APP_URL` | `https://<project>.vercel.app` |
| `USER_TZ` | Дефолтная таймзона, напр. `Europe/Moscow` |

> ⚠️ **Не используйте Google-модели** (gemini) на Vercel — они дают 403 Blocked by Google AI Studio. Используйте `openai/gpt-4o-mini` или `anthropic/claude-3.5-sonnet`.

### 5. Деплой
```bash
pnpm install
pnpm run db:push    # применить схему к БД
vercel --prod
```

### 6. Установить webhook
```bash
curl "https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/setWebhook?url=https://<project>.vercel.app/api/bot&secret_token=<TELEGRAM_SECRET_TOKEN>"
```
Проверка:
```bash
curl "https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/getWebhookInfo"
```

### 7. Команды в меню Telegram
Бот автоматически регистрирует команды через `bot.telegram.setMyCommands` при первом запросе.

## Локальная разработка

```bash
pnpm install
pnpm run typecheck    # проверка типов
pnpm run db:push      # применить схему
pnpm run db:generate  # сгенерировать миграции
pnpm run db:studio    # GUI для БД
```

## Заметки по production

- **Идемпотентность:** логи дедуплицируются по `(user_id, telegram_message_id)` — ретраи вебхука не создают дублей. Плюс логер проверяет `is_duplicate` по содержанию.
- **Таймзоны:** границы суток считаются в TZ пользователя (`users.tz`, дефолт `Europe/Moscow`).
- **Лимиты Vercel Hobby:** функции до 30 сек. DB-запросы параллелятся через `Promise.all`. Retry LLM убран — один вызов. Если LLM не вернул JSON, используется raw текст как fallback.
- **Смена LLM:** поменяй `OPENROUTER_MODEL` / `OPENROUTER_MODEL_ANALYST` в Vercel — передеплой не требуется (переменные читаются на рантайме).
- **Дисклеймер:** отчёты — образовательные эвристики, не медицинский диагноз.
- **Git:** `https://github.com/penkin-repo/idonis.git`, ветка `main`.

## Известные проблемы и решения

- **`ERR_MODULE_NOT_FOUND` на Vercel:** импорты должны использовать `.js` расширения (не `.ts`), `tsconfig.json` → `moduleResolution: "NodeNext"`.
- **`403 Blocked by Google AI Studio`:** не используйте Google-модели на Vercel. Переключите на `openai/gpt-4o-mini` или `anthropic/claude-3.5-sonnet`.
- **`Unexpected token '<' is not valid JSON`:** LLM вернул HTML вместо JSON. `callStructured` пытается извлечь JSON из текста (3 стратегии парсинга). Если не получилось — `LlmJsonError` с raw текстом, `answerQuestion` использует его как ответ.
- **`FUNCTION_INVOCATION_TIMEOUT` (504):** Vercel Hobby = 30s. Параллельные DB-запросы + один LLM-вызов обычно укладываются. Если нет — уменьшить историю чата или использовать более быструю модель.
- **Старая клавиатура Telegram (кнопки "ПЛАН ЗДОРОВЬЯ" и т.д.):** сбрасывается через `reply_markup: { remove_keyboard: true }` при `/start`.

