# 🤖 Lifestyle Tracker Bot

Двухагентный Telegram-бот для трекинга образа жизни (еда, сон, самочувствие, вес).

- **Агент-Логер** — парсит свободный текст пользователя через LLM в структурированный JSON и пишет в БД.
- **Агент-Аналитик** — по команде строит отчёт с эвристиками по биохимии (инсулиновые качели, гормоны стресса, буфер клетчатки) и учитывает профиль пользователя.

## Стек

| Слой | Технология |
|---|---|
| Хостинг | Vercel Serverless Functions (Node.js runtime) |
| Бот | [Telegraf.js](https://telegraf.js.org/) (webhook-режим) |
| БД | [Turso](https://turso.tech/) (libSQL) + [Drizzle ORM](https://orm.drizzle.team/) |
| LLM | [OpenRouter](https://openrouter.ai/) через OpenAI SDK (JSON-режим) |
| Валидация | [zod](https://zod.dev/) |

> ⚠️ **Крона нет.** Аналитик вызывается вручную командами `/report`, `/report N`, `/week`. Это полностью бесплатно и без ограничений плана Vercel Hobby.

## Структура

```
api/bot.ts          — единственный эндпоинт (webhook): логер + онбординг + команды
db/schema.ts        — схема Drizzle
db/client.ts        — клиент Turso + Drizzle
lib/openrouter.ts   — LLM-клиент (OpenRouter) + структурированный вызов
lib/prompts.ts      — системные промпты (профиль, логер, аналитик)
lib/schemas.ts      — zod-схемы ответов LLM
lib/profile.ts      — логика профиля и веса
lib/logger.ts       — Агент-Логер
lib/analyst.ts      — Агент-Аналитик
lib/time.ts         — таймзоны и границы периодов
drizzle/0000_init.sql — SQL-миграция
```

## Настройка

### 1. Создать бота
Напиши [@BotFather](https://t.me/BotFather) → `/newbot` → сохрани токен.

### 2. Создать БД Turso
```bash
# установка CLI: https://docs.turso.tech/cli/installation
turso auth login
turso db create lifestyle-tracker
turso db show lifestyle-tracker --url        # -> TURSO_DATABASE_URL
turso db tokens create lifestyle-tracker     # -> TURSO_AUTH_TOKEN

# применить схему
turso db shell lifestyle-tracker < drizzle/0000_init.sql
```
Либо через Drizzle: заполни `.env`, затем `npm install && npm run db:push`.

### 3. Получить ключ OpenRouter
[openrouter.ai/keys](https://openrouter.ai/keys) → создай ключ → `OPENROUTER_API_KEY`.
Модель задаётся в `OPENROUTER_MODEL` (по умолчанию `openai/gpt-4o-mini`) и меняется без правок кода.

### 4. Переменные окружения
Скопируй `.env.example` → `.env` для локальной работы и **обязательно** добавь все переменные в Vercel:
`Project Settings → Environment Variables`.

| Переменная | Описание |
|---|---|
| `TELEGRAM_BOT_TOKEN` | Токен от @BotFather |
| `TELEGRAM_SECRET_TOKEN` | Любая случайная строка (проверяется на вебхуке) |
| `OPENROUTER_API_KEY` | Ключ OpenRouter |
| `OPENROUTER_MODEL` | Напр. `openai/gpt-4o-mini` |
| `TURSO_DATABASE_URL` | `libsql://...turso.io` |
| `TURSO_AUTH_TOKEN` | Токен Turso |
| `APP_URL` | `https://<project>.vercel.app` |
| `USER_TZ` | Дефолтная таймзона, напр. `Europe/Moscow` |

### 5. Деплой
```bash
npm i -g vercel
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

## Как пользоваться

1. `/start` → расскажи о себе одним сообщением:
   > Меня зовут Иван, 34 года, мужчина, рост 180, вес 82, работа сидячая, цель — похудеть, аллергия на орехи.
2. Логируй свободным текстом:
   - «на завтрак овсянка с ягодами»
   - «спал 6 часов, плохо»
   - «настроение 4/5, стресс средний»
   - «пробежка 30 минут»
   - «вешу 81.5»
3. Получай отчёты:
   - `/report` — за сегодня
   - `/report 3` — за 3 дня
   - `/week` — за неделю
   - `/profile` — показать/обновить профиль
   - `/weight 80` — быстрый ввод веса
   - `/logs` — записи за сегодня (отладка)

## Как узнать свой Chat ID
Не нужно вручную — бот сам сохраняет `chat.id` при `/start`. Для отладки id виден в логах Vercel.

## Заметки по production
- **Идемпотентность:** логи дедуплицируются по `(user_id, telegram_message_id)`, ретраи вебхука не создают дублей.
- **Таймзоны:** границы суток считаются в TZ пользователя (`users.tz`).
- **Лимиты Vercel Hobby:** функции до 30 сек — LLM-вызовы укладываются. Крона нет, поэтому ограничение «1 запуск/день» не касается.
- **Дисклеймер:** отчёты — образовательные эвристики, не медицинский диагноз.
- **Смена LLM:** поменяй `OPENROUTER_MODEL` в Vercel и передеплой не требуется (переменная читается на рантайме).

## Локальная разработка / typecheck
```bash
npm install
npm run typecheck
```
