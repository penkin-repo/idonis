"""
ai_handler.py — OpenRouter AI integration with function calling.
Processes user messages, calls tools, returns final response.
"""
import json
import logging
import os
import uuid
from datetime import datetime, timedelta

import requests
import pytz

from bot import tools as tool_defs
from bot import firestore_ops as db
from bot.telegram_api import send_message, send_chat_action
from bot.config import OPENROUTER_API_KEY, OPENROUTER_MODEL
from flask import Blueprint, request, jsonify
from bot.config import WEBHOOK_SECRET

logger = logging.getLogger(__name__)

webhook_bp = Blueprint("webhook", __name__)

OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"

CATEGORIES = "продукты, кружки, транспорт, кафе, здоровье, одежда, дом, развлечения, прочее"
USER_TZ = pytz.timezone("Europe/Moscow")


def _now_msk():
    return datetime.now(USER_TZ)


def _today_str():
    return _now_msk().strftime("%Y-%m-%d")


def _build_system_prompt(telegram_id: int) -> str:
    """Build context-rich system prompt from Firestore data."""
    profile = db.get_user_profile(telegram_id)
    name = profile.get("name", "друг")
    now = _now_msk()

    tasks_today = db.get_tasks(telegram_id, _today_str())
    tasks_text = "\n".join(
        [f"{'✅' if t.get('done') else '⬜'} {t.get('time', '')} {t['title']}" for t in tasks_today]
    ) or "нет задач"

    expenses_today = db.get_expenses(telegram_id, _today_str())
    expenses_sum = sum(e.get("amount", 0) for e in expenses_today)

    meals_today = db.get_meals(telegram_id, _today_str())
    calories_sum = sum(m.get("calories", 0) for m in meals_today)

    shopping = db.get_shopping_list(telegram_id)
    shopping_text = ", ".join(
        [i["name"] for i in shopping if not i.get("bought")]
    ) or "список пуст"

    health = db.get_health_stats(telegram_id, _today_str())
    health_text = "\n".join([f"- {k}: {v}" for k, v in health.items()]) or "Прогресса по здоровью пока нет"
 # Чтение статичного контекста (База данных имеет приоритет над локальными файлами)
    user_context = db.get_context_document(telegram_id, "user_context")
    if not user_context:
        context_path = os.path.join(os.path.dirname(__file__), "user_context.md")
        if os.path.exists(context_path):
            with open(context_path, "r", encoding="utf-8") as f:
                user_context = f.read()

    food_context = db.get_context_document(telegram_id, "food")
    if not food_context:
        food_path = os.path.join(os.path.dirname(__file__), "food.md")
        if os.path.exists(food_path):
            with open(food_path, "r", encoding="utf-8") as f:
                food_context = f.read()

    static_context = user_context + "\n\nДЛЯ СПРАВКИ: РЕКОМЕНДУЕМЫЙ ПЛАН ПИТАНИЯ И ТРЕНИРОВОК (НЕ ЯВЛЯЕТСЯ ФАКТОМ):\n" + food_context

    # Чтение выученных фактов из БД
    learned_facts = db.get_learned_context(telegram_id)
    learned_text = "\n".join([f"- {f}" for f in learned_facts]) if learned_facts else "Нет выученных фактов"

    weekdays = ["понедельник", "вторник", "среда", "четверг", "пятница", "суббота", "воскресенье"]
    weekday_str = weekdays[now.weekday()]

    return f"""Твоя ГЛОБАЛЬНАЯ МИССИЯ: Сделать {name} максимально здоровым, продуктивным и энергичным человеком.
Ты не просто пассивный чат-бот, ты — активный наставник и контролер.

Твои приоритеты:
1. Здоровье: Контроль веса, БЖУ, воды и регулярных тренировок.
2. Продуктивность: Помощь в управлении задачами и рабочим временем.
3. Питание: Простраивай питание самостоятельно, давай советы по БЖУ, пресекай вредные привычки (сахар).

Сейчас: {now.strftime('%d.%m.%Y %H:%M')} ({weekday_str}, Архангельск).

СТАТИЧНЫЙ КОНТЕКСТ:
{static_context}

ВЫУЧЕННЫЕ ФАКТЫ:
{learned_text}

РЕАЛЬНЫЕ ДАННЫЕ ЗА СЕГОДНЯ:
Задачи: {tasks_text}
Траты: {expenses_sum}₽
Калории: {calories_sum} ккал
Покупки: {shopping_text}
Здоровье (Лог): {health_text}

ПРАВИЛА ПОВЕДЕНИЯ:
- Будь проактивным: Сам предлагай план на день утром и корректируй его днем/вечером.
- Давай конкретные рекомендации по БЖУ (белки, жиры, углеводы), если пользователь пишет что съел.
- **Твой текстовый ответ НИКОГДА не должен быть пустым.**
- При описании еды → add_meal (оцени калории сам).
- При просьбе купить → add_to_shopping_list.
- **СТРОГОЕ ПРАВИЛО: Никогда не путай ПЛАН с ФАКТОМ.** 
- Если еды нет в списке 'Употреблено калорий сегодня', значит пользователь её НЕ ЕЛ. 
- Если тренировки/воды нет в 'ПРОГРЕСС ПО ЗДОРОВЬЮ', значит этого НЕ БЫЛО. 
- Никогда не выдумывай данные. Если данных нет — так и говори: "Информации о приеме пищи нет".
- ТЫ ОБЯЗАН использовать инструменты. Никогда не говори "я не могу", если есть функция.

Доступные категории трат: {CATEGORIES}"""


def _call_openrouter(messages: list) -> dict:
    """Call OpenRouter API and return response JSON."""
    headers = {
        "Authorization": f"Bearer {OPENROUTER_API_KEY}",
        "Content-Type": "application/json",
        "X-Title": "Idonis Bot",
        "HTTP-Referer": "https://idonis-bot.onrender.com",  # Required for some models
    }
    payload = {
        "model": OPENROUTER_MODEL,
        "messages": messages,
    }
    
    # OpenRouter and OpenAI require tools to be passed directly if they exist
    if getattr(tool_defs, "TOOLS", None):
        payload["tools"] = tool_defs.TOOLS
        # If we pass tools, we shouldn't pass tool_choice="auto" blindly for all models,
        # but for OpenRouter it's usually fine or we omit it to let the model decide naturally
        # payload["tool_choice"] = "auto"

    resp = requests.post(OPENROUTER_URL, json=payload, headers=headers, timeout=30)
    if not resp.ok:
        logger.error(f"OpenRouter Error: {resp.status_code} - {resp.text}")
        raise Exception(f"API Error {resp.status_code}")
    return resp.json()


def _execute_tool(telegram_id: int, tool_name: str, args: dict) -> str:
    """Execute a function call tool and return result as string."""
    today = _today_str()
    now = _now_msk()

    if tool_name == "add_task":
        task_id = str(uuid.uuid4()).split("-")[0]
        task = {
            "id": task_id,
            "title": args["title"],
            "date": args.get("date", today),
            "time": args.get("time", ""),
            "category": args.get("category", "личное"),
            "done": False,
        }
        db.add_task(telegram_id, args.get("date", today), task)

        # Auto-create reminder if time is specified
        if args.get("time"):
            try:
                task_dt = datetime.strptime(f"{args.get('date', today)} {args['time']}", "%Y-%m-%d %H:%M")
                task_dt = USER_TZ.localize(task_dt)
                reminder_dt = task_dt - timedelta(minutes=15)
                if reminder_dt > now:
                    reminder = {
                        "message": f"⏰ Через 15 мин: {args['title']}",
                        "trigger_at": reminder_dt.astimezone(pytz.utc).replace(tzinfo=None),
                        "status": "pending",
                    }
                    db.add_reminder(telegram_id, str(uuid.uuid4()), reminder)
            except Exception:
                logger.warning("Could not create auto-reminder", exc_info=True)

        return f"Задача '{args['title']}' добавлена"

    elif tool_name == "complete_task":
        db.complete_task(telegram_id, args.get("date", today), args["task_id"])
        return "Задача отмечена как выполненная"

    elif tool_name == "complete_all_tasks":
        db.complete_all_tasks(telegram_id, args.get("date", today))
        return "ВСЕ задачи на день отмечены как выполненные"

    elif tool_name == "add_expense":
        expense = {
            "amount": args["amount"],
            "category": args["category"],
            "note": args.get("note", ""),
            "time": now.strftime("%H:%M"),
        }
        db.add_expense(telegram_id, today, expense)
        return f"Расход {args['amount']}₽ ({args['category']}) записан"

    elif tool_name == "add_meal":
        meal = {
            "description": args["description"],
            "calories": args["estimated_calories"],
            "time": now.strftime("%H:%M"),
        }
        db.add_meal(telegram_id, today, meal)
        return f"Приём пищи записан: {args['description']}, ~{args['estimated_calories']} ккал"

    elif tool_name == "add_to_shopping_list":
        db.add_to_shopping_list(telegram_id, args["items"])
        return f"Добавлено в список: {', '.join(args['items'])}"

    elif tool_name == "mark_as_bought":
        db.mark_as_bought(telegram_id, args["item_name"])
        return f"'{args['item_name']}' отмечен как куплен"

    elif tool_name == "save_learned_context":
        db.add_learned_context(telegram_id, args["fact"])
        return f"Факт '{args['fact']}' сохранен в памяти"

    elif tool_name == "update_food_plan":
        db.set_context_document(telegram_id, "food", args["new_content"])
        return "План питания обновлен"

    elif tool_name == "update_user_context":
        db.set_context_document(telegram_id, "user_context", args["new_content"])
        return "Личный контекст обновлен"

    elif tool_name == "track_health_stat":
        db.update_health_stat(telegram_id, today, args["stat_key"], args["value"])
        return f"Статистика {args['stat_key']} обновлена: {args['value']}"

    elif tool_name == "set_reminder":
        try:
            dt = datetime.strptime(args["datetime"], "%Y-%m-%dT%H:%M")
            dt = USER_TZ.localize(dt).astimezone(pytz.utc).replace(tzinfo=None)
            reminder = {"message": args["message"], "trigger_at": dt, "status": "pending"}
            db.add_reminder(telegram_id, str(uuid.uuid4()), reminder)
            return f"Напоминание установлено: {args['message']}"
        except Exception:
            logger.error("set_reminder error", exc_info=True)
            return "Не удалось установить напоминание"

    elif tool_name == "get_today_tasks":
        tasks = db.get_tasks(telegram_id, today)
        if not tasks:
            return "Задач на сегодня нет"
        return "\n".join(
            [f"{'✅' if t.get('done') else '⬜'} {t.get('time', '')} {t['title']}" for t in tasks]
        )

    elif tool_name == "get_today_meals":
        meals = db.get_meals(telegram_id, today)
        if not meals:
            return "Приемов пищи за сегодня нет"
        lines = [f"{m.get('time', '')} - {m['description']} (~{m['calories']} ккал)" for m in meals]
        total = sum(m.get('calories', 0) for m in meals)
        lines.append(f"Итого за день: {total} ккал")
        return "\n".join(lines)

    elif tool_name == "get_health_stats_summary":
        days = 7 if args.get("date_range") == "week" else 30
        dates = [(now - timedelta(days=i)).strftime("%Y-%m-%d") for i in range(days)]
        summary = db.get_health_summary(telegram_id, dates)
        if not summary: return "Данных по здоровью за период нет"
        return json.dumps(summary, indent=2, ensure_ascii=False)

    elif tool_name == "get_meals_summary":
        days = 7 if args.get("date_range") == "week" else 30
        dates = [(now - timedelta(days=i)).strftime("%Y-%m-%d") for i in range(days)]
        summary = db.get_meals_summary(telegram_id, dates)
        if not summary: return "Данных по питанию за период нет"
        return json.dumps(summary, indent=2, ensure_ascii=False)

    elif tool_name == "get_expenses_summary":
        dates = [today]
        if args.get("date_range") == "week":
            dates = [(now - timedelta(days=i)).strftime("%Y-%m-%d") for i in range(7)]
        elif args.get("date_range") == "month":
            dates = [(now - timedelta(days=i)).strftime("%Y-%m-%d") for i in range(30)]

        total = 0
        by_category: dict = {}
        for d in dates:
            for e in db.get_expenses(telegram_id, d):
                total += e.get("amount", 0)
                cat = e.get("category", "прочее")
                by_category[cat] = by_category.get(cat, 0) + e.get("amount", 0)

        if not by_category:
            return "Расходов за период нет"

        breakdown = "\n".join([f"  {k}: {v}₽" for k, v in sorted(by_category.items(), key=lambda x: -x[1])])
        return f"Итого: {total}₽\n{breakdown}"

    elif tool_name == "get_shopping_list":
        items = db.get_shopping_list(telegram_id)
        if not items:
            return "Список покупок пуст"
        lines = [f"{'✅' if i.get('bought') else '⬜'} {i['name']}" for i in items]
        return "\n".join(lines)

    return f"Неизвестный инструмент: {tool_name}"


def handle_message(telegram_id: int, user_text: str):
    """Full AI pipeline: context → OpenRouter → tools → final answer → Telegram."""
    if not OPENROUTER_API_KEY:
        send_message(telegram_id, "❌ Ошибка: OPENROUTER_API_KEY не настроен")
        return

    # Отправляем статус "печатает..."
    send_chat_action(telegram_id, "typing")

    try:
        system_prompt = _build_system_prompt(telegram_id)
        
        # Load history
        history = db.get_chat_history(telegram_id, limit=10)
        
        messages = [{"role": "system", "content": system_prompt}]
        messages.extend(history)
        messages.append({"role": "user", "content": user_text})

        # Step 1: First AI call
        response = _call_openrouter(messages)
        ai_message = response["choices"][0]["message"]
        tool_calls = ai_message.get("tool_calls", [])

        # Step 2: Execute tool calls if any
        if tool_calls:
            messages.append(ai_message)
            for tc in tool_calls:
                tool_name = tc["function"]["name"]
                args = json.loads(tc["function"]["arguments"])
                logger.info("Executing tool: %s args=%s", tool_name, args)
                result = _execute_tool(telegram_id, tool_name, args)
                messages.append({
                    "role": "tool",
                    "tool_call_id": tc["id"],
                    "content": result,
                })

            # Step 3: Final AI call with tool results
            final_response = _call_openrouter(messages)
            final_text = final_response["choices"][0]["message"]["content"]
        else:
            final_text = ai_message.get("content", "")

        # Fallback if AI returned empty string after executing tools
        if not final_text and tool_calls:
            final_text = "✅ Готово"

        if final_text:
            from bot.keyboards import MAIN_MENU
            send_message(telegram_id, final_text, reply_markup=MAIN_MENU)
            
            # Save history (user msg + final ai response)
            # We don't save system/tool messages to DB to keep it lean
            # But they are in the 'messages' list for the current request
            new_history = history + [
                {"role": "user", "content": user_text},
                {"role": "assistant", "content": final_text}
            ]
            db.save_chat_history(telegram_id, new_history, limit=10)
        else:
            send_message(telegram_id, "🤔 Не смог сформулировать ответ")

    except Exception as e:
        logger.error("handle_message error", exc_info=True)
        send_message(telegram_id, f"⚠️ Ошибка: {str(e)}\nПопробуй проверить ключ OpenRouter или лимиты.")
