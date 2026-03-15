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

    shopping = db.get_shopping_list(telegram_id)
    shopping_text = ", ".join(
        [i["name"] for i in shopping if not i.get("bought")]
    ) or "список пуст"

    # Чтение статичного локального контекста
    static_context = ""
    context_path = os.path.join(os.path.dirname(__file__), "user_context.md")
    if os.path.exists(context_path):
        with open(context_path, "r", encoding="utf-8") as f:
            static_context = f.read()
            
    # Чтение файла питания
    food_path = os.path.join(os.path.dirname(__file__), "food.md")
    if os.path.exists(food_path):
        with open(food_path, "r", encoding="utf-8") as f:
            static_context += "\n\nПЛАН ПИТАНИЯ (food.md):\n" + f.read()

    # Чтение выученных фактов из БД
    learned_facts = db.get_learned_context(telegram_id)
    learned_text = "\n".join([f"- {f}" for f in learned_facts]) if learned_facts else "Нет выученных фактов"

    return f"""Ты — личный ассистент {name}. Твоё имя — Idonis.
Сейчас: {now.strftime('%d.%m.%Y %H:%M')} (Москва).

СТАТИЧНЫЙ КОНТЕКСТ ПОЛЬЗОВАТЕЛЯ:
{static_context}

ВЫУЧЕННЫЕ ФАКТЫ О ПОЛЬЗОВАТЕЛЕ:
{learned_text}

ТЕКУЩАЯ СВОДКА ПРЯМО СЕЙЧАС:
Задачи на сегодня:
{tasks_text}

Траты сегодня: {expenses_sum}₽
Список покупок: {shopping_text}

ПРАВИЛА:
- Отвечай кратко, по-дружески, по-русски
- Используй эмодзи уместно
- При упоминании траты → add_expense
- При добавлении дела → add_task (если указано время → автоматически set_reminder за 15 мин)
- При описании еды → add_meal (оцени калории сам)
- При просьбе купить → add_to_shopping_list
- Если нужна доп. информация → вызывай функции чтения
- Никогда не выдумывай данные, которых нет в контексте

Доступные категории трат: {CATEGORIES}"""


def _call_openrouter(messages: list) -> dict:
    """Call OpenRouter API and return response JSON."""
    headers = {
        "Authorization": f"Bearer {OPENROUTER_API_KEY}",
        "Content-Type": "application/json",
        "X-Title": "Idonis Bot",
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
    resp.raise_for_status()
    return resp.json()


def _execute_tool(telegram_id: int, tool_name: str, args: dict) -> str:
    """Execute a function call tool and return result as string."""
    today = _today_str()
    now = _now_msk()

    if tool_name == "add_task":
        task_id = str(uuid.uuid4())[:8]
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
        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_text},
        ]

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

        if final_text:
            from bot.keyboards import MAIN_MENU
            send_message(telegram_id, final_text, reply_markup=MAIN_MENU)
        else:
            send_message(telegram_id, "🤔 Не смог сформулировать ответ")

    except Exception:
        logger.error("handle_message error", exc_info=True)
        send_message(telegram_id, "⚠️ Произошла ошибка, попробуй ещё раз")
