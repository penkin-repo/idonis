# 🎯 Промпт для AI-ассистента (vibe-coding)

## Контекст проекта

Создай личного Telegram-бота на Firebase Functions (Python). Бот использует OpenRouter API с function calling для управления задачами, тратами, питанием и напоминалками. Вся логика на Firebase: Cloud Functions (HTTP + scheduled), Firestore для данных.

---

## Архитектура

```
Telegram → Webhook (Cloud Function) → OpenRouter AI → Firestore
                                    ↓
                        Cloud Scheduler → Напоминалки/Отчёты
```

---

## Стек

- **Runtime**: Firebase Functions, Python 3.11
- **База**: Firestore
- **AI**: OpenRouter API (модель передаётся через переменную окружения)
- **Бот**: Webhook mode через requests
- **Секреты**: Firebase Secrets (TELEGRAM_BOT_TOKEN, OPENROUTER_API_KEY, OPENROUTER_MODEL)
- **Регион**: europe-west1

---

## Структура Firestore

```
users/{telegram_id}/
  profile: {name, timezone}
  tasks/{date}/items: [{id, title, time, done, category}]
  expenses/{date}/items: [{amount, category, note}]
  meals/{date}/items: [{description, calories, time}]
  shopping_list/items: [{name, bought}]
  kids_activities/{id}: {name, schedule, cost_per_month}
  reminders/{id}: {message, trigger_at, status}
```

---

## AI Function Calling Tools

**Запись:**
- `add_task(title, date, time, category)`
- `complete_task(task_id)`
- `add_expense(amount, category, note)`
- `add_meal(description, estimated_calories)`
- `add_to_shopping_list(items)`
- `mark_as_bought(item_name)`
- `set_reminder(message, datetime)`

**Чтение:**
- `get_today_tasks()`
- `get_expenses_summary(date_range)`
- `get_shopping_list()`

**Категории трат**: продукты, кружки, транспорт, кафе, здоровье, одежда, дом, развлечения, прочее

---

## Системный промпт (шаблон)

```
Ты — личный ассистент {name}.
Сегодня: {date}, {time}. Часовой пояс: {timezone}.

КОНТЕКСТ:
Задачи на сегодня: {tasks_today}
Траты сегодня: {expenses_today}₽
Траты за месяц: {expenses_month}₽
Список покупок: {shopping_list}
Кружки детей: {kids_activities}

ПРАВИЛА:
- Отвечай кратко, по-дружески
- При упоминании траты → add_expense
- При добавлении дела → add_task (автоматически set_reminder за 15 мин)
- При описании еды → add_meal (оцени калории)
- Используй эмодзи
- Если нужна доп. информация → вызывай функции чтения

Доступные категории трат: {CATEGORIES}
```

---

## Cloud Functions

### 1. HTTP trigger: `telegram_webhook`
- Принимает POST от Telegram
- Извлекает chat_id, text
- Загружает контекст из Firestore (задачи/траты/списки)
- Формирует промпт с контекстом
- Вызывает OpenRouter с function calling
- Выполняет вызванные функции (записи в Firestore)
- Отправляет ответ в Telegram API
- Возвращает 200 OK

### 2. Scheduled trigger: `check_reminders` (every 1 minute)
- Запрос к Firestore: `collectionGroup('reminders')` где `status='pending'` и `trigger_at <= now`
- Для каждого: отправить в Telegram, обновить `status='fired'`

### 3. Scheduled trigger: `morning_report` (cron: "0 7 * * *")
- Для всех юзеров: собрать задачи на день, список покупок, кружки
- Сгенерировать через AI красивое сообщение
- Отправить

### 4. Scheduled trigger: `evening_report` (cron: "0 21 * * *")
- Собрать статистику дня: выполненные задачи, траты, калории
- AI формирует итоги
- Отправить

### 5. Scheduled trigger: `keep_alive` (every 10 minutes)
- Простая функция возвращающая "OK"
- Устраняет холодный старт основного webhook

---

## Настройка деплоя

**firebase.json:**
```json
{
  "functions": {
    "source": "functions",
    "runtime": "python311",
    "region": "europe-west1",
    "timeoutSeconds": 60
  }
}
```

**requirements.txt:**
```
firebase-functions
firebase-admin
requests
python-dateutil
pytz
```

**Секреты:**
```bash
firebase functions:secrets:set TELEGRAM_BOT_TOKEN
firebase functions:secrets:set OPENROUTER_API_KEY
firebase functions:secrets:set OPENROUTER_MODEL
# Например: "openai/gpt-4o-mini" или "anthropic/claude-3.5-sonnet"
```

---

## Логика обработки сообщения

1. Получить сообщение → извлечь `chat_id`, `text`
2. Загрузить из Firestore:
   - `users/{chat_id}/tasks/{today}`
   - `users/{chat_id}/expenses/{today}` и `{current_month}`
   - `users/{chat_id}/shopping_list`
   - `users/{chat_id}/kids_activities`
3. Сформировать системный промпт с этим контекстом
4. Отправить в OpenRouter API:
   - Endpoint: `https://openrouter.ai/api/v1/chat/completions`
   - Headers: `Authorization: Bearer {OPENROUTER_API_KEY}`
   - Body: `{model: OPENROUTER_MODEL, messages: [...], tools: [...]}`
5. Если AI вернул `tool_calls`:
   - Выполнить каждый (записать в Firestore)
   - Если `add_task` с временем → автоматически создать reminder за 15 мин
6. Получить финальный ответ AI
7. Отправить через Telegram API: `POST https://api.telegram.org/bot{TOKEN}/sendMessage`

---

## OpenRouter интеграция

**Формат запроса (OpenAI-совместимый):**
```
POST https://openrouter.ai/api/v1/chat/completions
Headers:
  Authorization: Bearer {API_KEY}
  HTTP-Referer: {optional}
  X-Title: {optional}

Body:
{
  "model": "{model_from_env}",
  "messages": [
    {"role": "system", "content": "{system_prompt}"},
    {"role": "user", "content": "{user_message}"}
  ],
  "tools": [{tool_definitions}],
  "tool_choice": "auto"
}
```

**Обработка ответа:**
- Если `response.choices[0].message.tool_calls` существует → выполнить функции
- Иначе → взять `response.choices[0].message.content` как текстовый ответ

---

## Примеры диалогов (для тестирования)

```
"Завтра в 10 стоматолог"
→ add_task + set_reminder

"Потратил 3500 на продукты"
→ add_expense(3500, "продукты")

"Купить молоко и хлеб"
→ add_to_shopping_list(["молоко", "хлеб"])

"Съел омлет из двух яиц"
→ add_meal("омлет из 2 яиц", 320)

"Сколько потратил на кружки?"
→ get_expenses_summary → AI анализирует
```

---

## Чеклист MVP

```
□ Firebase Functions деплоятся
□ Telegram webhook установлен
□ Бот отвечает на текст
□ Firestore читается/пишется
□ OpenRouter возвращает ответ с tools
□ add_task работает через function calling
□ Напоминалки приходят вовремя
□ Утренний отчёт генерируется
□ Keep-alive пинг работает
```

---

## Первый запуск

1. `firebase init functions` → Python, europe-west1
2. Создай структуру файлов
3. Реализуй `telegram_webhook` (сначала эхо версия)
4. Деплой: `firebase deploy --only functions`
5. Установи webhook в Telegram
6. Добавь Firestore
7. Интегрируй OpenRouter
8. Реализуй scheduled функции
9. Тестируй

---

**Скармливай этот промпт частями в IDE по мере разработки. Модель OpenRouter меняй через переменную окружения.**