# PROJECT_LOG_HOW.md — Свод правил и архитектура

> Обновляется автоматически ИИ при изменении стека или архитектуры.
> Последнее обновление: 2026-03-15

---

## 📌 Суть проекта

**Idonis** — персональный AI-ассистент в Telegram.
Цель: умный чат-бот, который ведёт весь твой день — задачи, питание, расходы, напоминалки, список покупок, кружки детей, бюджет и мотивация. Всё через естественный текст.

---

## 🏗️ Архитектура

```
Telegram User
     │
     ▼
Telegram Bot (webhook)
     │
     ▼
Firebase Cloud Function (Python 3.11) — HTTP trigger
     │
     ├─── Firestore (база данных, все данные пользователя)
     │
     └─── OpenRouter API (AI с function calling)
              │
              └─── Инструменты: add_task, add_expense, add_meal,
                   add_to_shopping_list, set_reminder, get_*

Firebase Cloud Scheduler (cron) ──► Напоминалки, утренний/вечерний отчёт, keep-alive
```

---

## 🛠️ Стек технологий

| Слой             | Технология                         | Примечание                                        |
|------------------|------------------------------------|---------------------------------------------------|
| Бот              | Telegram Bot API (webhook mode)    | `requests`, не pyTelegramBotAPI                   |
| Backend          | **Render.com** (бесплатно)         | Python 3.11 + Flask, webhook endpoint             |
| База данных      | **Firebase Firestore** (Spark)     | NoSQL, бесплатно без карты                        |
| AI               | OpenRouter API                     | OpenAI-совместимый, function calling              |
| Секреты          | Render Environment Variables       | Dashboard → Environment, никогда не в код         |
| Расписание       | **APScheduler** (внутри Render)    | BackgroundScheduler, cron-триггеры                |
| Keep-alive       | **UptimeRobot** (бесплатно)        | Пингует каждые 5 мин, избегаем cold start         |
| Деплой           | **GitHub** → Render auto-deploy    | Push в main → автоматический деплой               |
| Package manager  | **pnpm** (если JS появится)        | Глобальное правило проекта                        |
| Пакеты Python    | pip + requirements.txt             | В корне проекта                                   |

---

## 📁 Структура файлов проекта

```
Idonis/
├── MASTER_PROMPT.md          # Глобальные директивы
├── PROJECT_LOG_HOW.md        # Этот файл: правила, архитектура, стандарты
├── PROJECT_LOG.md            # Живой журнал
├── .github/
│   └── workflows/
│       └── deploy.yml        # (опционально) CI/CD
├── requirements.txt          # Python зависимости
├── Procfile                  # Для Render: web: gunicorn app:app
├── runtime.txt               # python-3.11.x
├── app.py                    # Точка входа: Flask + APScheduler init
└── bot/
    ├── __init__.py
    ├── webhook.py            # Flask route /webhook — обработка Telegram updates
    ├── ai_handler.py         # Логика OpenRouter + function calling
    ├── firestore_ops.py      # CRUD операции с Firestore
    ├── telegram_api.py       # Отправка сообщений в Telegram
    ├── tools.py              # Определения инструментов AI (JSON schema)
    └── schedulers/
        ├── __init__.py
        ├── reminders.py      # check_reminders (каждую минуту)
        ├── morning.py        # morning_report (07:00 MSK)
        └── evening.py        # evening_report (21:00 MSK)
```

---

## 🗄️ Структура Firestore

```
users/{telegram_id}/
  profile:               {name, timezone}
  tasks/{date}/
    items:               [{id, title, time, done, category}]
  expenses/{date}/
    items:               [{amount, category, note}]
  meals/{date}/
    items:               [{description, calories, time}]
  shopping_list/
    items:               [{name, bought}]
  kids_activities/{id}:  {name, schedule, cost_per_month}
  reminders/{id}:        {message, trigger_at, status: pending|fired}
```

**Соглашения по датам:** формат `YYYY-MM-DD` (строка), часовой пояс пользователя из profile.timezone.

---

## 🤖 AI Function Calling — инструменты

### Запись данных
| Функция | Параметры |
|---------|-----------|
| `add_task` | title, date, time, category |
| `complete_task` | task_id |
| `add_expense` | amount, category, note |
| `add_meal` | description, estimated_calories |
| `add_to_shopping_list` | items: [string] |
| `mark_as_bought` | item_name |
| `set_reminder` | message, datetime |

### Чтение данных
| Функция | Параметры |
|---------|-----------|
| `get_today_tasks` | — |
| `get_expenses_summary` | date_range |
| `get_shopping_list` | — |

### Авто-правила
- При `add_task` с указанным временем → автоматически `set_reminder` за 15 минут до

### Категории расходов
`продукты`, `кружки`, `транспорт`, `кафе`, `здоровье`, `одежда`, `дом`, `развлечения`, `прочее`

---

## ⚙️ Cloud Functions (все триггеры)

| Имя / маршрут           | Тип                | Расписание              | Назначение                          |
|-------------------------|--------------------|-------------------------|-------------------------------------|
| `POST /webhook`         | Flask route        | —                       | Основной обработчик Telegram updates|
| `GET /health`           | Flask route        | —                       | Health check для UptimeRobot        |
| `check_reminders()`     | APScheduler cron   | каждую 1 мин            | Триггер напоминалок                 |
| `morning_report()`      | APScheduler cron   | `0 4 * * *` (UTC)       | Утренний отчёт (07:00 MSK)          |
| `evening_report()`      | APScheduler cron   | `0 18 * * *` (UTC)      | Вечерний итог (21:00 MSK)           |

---

## 🔐 Секреты (Render Environment Variables)

Настраиваются в **Render Dashboard → Service → Environment**:

```
TELEGRAM_BOT_TOKEN     # токен бота от @BotFather
OPENROUTER_API_KEY     # ключ OpenRouter
OPENROUTER_MODEL       # модель, например openai/gpt-4o-mini
FIREBASE_CREDENTIALS   # JSON сервис-аккаунта Firebase (base64 или путь к файлу)
WEBHOOK_SECRET        # секрет для верификации webhook запросов
```
**Правило:** Никогда не хардкодить в код. Только через `os.environ.get()`.

---

## 📋 Стандарты кода (Python)

1. **Стиль:** PEP 8, docstrings на функциях
2. **Логирование:** `import logging` + `logger = logging.getLogger(__name__)`
3. **Ошибки:** всегда `try/except`, логировать ошибки с `logger.error(..., exc_info=True)`
4. **Firestore:** клиент инициализировать один раз в модуле, не в каждой функции
5. **Telegram API:** всегда проверять `ok` в ответе, логировать ошибки
6. **Функции:** максимум 50 строк, логика разбита по handlers/
7. **Тайм-аут:** все Cloud Functions — 60 секунд

---

## 🚀 Деплой

### Первоначальная настройка
1. Создать репозиторий на GitHub
2. Подключить репозиторий к Render.com (New → Web Service)
3. Runtime: Python 3, Build: `pip install -r requirements.txt`, Start: `gunicorn app:app`
4. Добавить Environment Variables в Render Dashboard
5. Render даст URL вида `https://idonis.onrender.com`

### Workflow деплоя
```bash
git add .
git commit -m "feat: описание изменений"
git push origin main
# Render автоматически задеплоит
```

### Установка webhook в Telegram
```bash
curl "https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://idonis.onrender.com/webhook"
```

### UptimeRobot
- Создать монитор: HTTP(s), URL: `https://idonis.onrender.com/health`, каждые 5 минут
- Это предотвращает засыпание Render и работает как keep-alive

---

## 🔄 Workflow разработки

1. Правки → тест локально с Firebase Emulator Suite
2. Деплой -> `firebase deploy --only functions`
3. Проверка в Telegram
4. Обновить `PROJECT_LOG.md`

---

## 📝 Что нужно знать перед началом работы

- Читать `PROJECT_LOG.md` чтобы понять текущий статус
- Все изменения архитектуры → сначала обновить этот файл
- pnpm — пакетный менеджер для любого JS (если появится фронтенд)
- Python зависимости — pip через requirements.txt в functions/
