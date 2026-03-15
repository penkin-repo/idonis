"""
evening.py — Generate and send evening summary.
"""
import logging
import requests
import os
import pytz
from datetime import datetime
from bot.firestore_ops import get_db, get_tasks, get_expenses, get_meals
from bot.telegram_api import send_message
from bot.config import OPENROUTER_API_KEY, OPENROUTER_MODEL

logger = logging.getLogger(__name__)

OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"

def evening_report():
    """Every day at 21:00 MSK."""
    logger.info("Generating evening reports...")
    db = get_db()
    today = datetime.now(pytz.timezone("Europe/Moscow")).strftime("%Y-%m-%d")
    
    try:
        users = db.collection("users").stream()
        for user_doc in users:
            telegram_id = int(user_doc.id)
            profile = user_doc.to_dict()
            name = profile.get("name", "друг")
            
            tasks = get_tasks(telegram_id, today)
            expenses = get_expenses(telegram_id, today)
            meals = get_meals(telegram_id, today)
            
            total_spent = sum(e.get("amount", 0) for e in expenses)
            total_calories = sum(m.get("calories", 0) for m in meals)
            
            # AI formatting
            prompt = f"""Подведи итоги дня для {name}.
Сегодня: {today}.
Выполнено задач: {len([t for t in tasks if t.get('done')])} из {len(tasks)}
Потрачено за день: {total_spent} руб.
Употреблено килокалорий (Ккал): {total_calories}

ПРАВИЛА:
- Будь поддерживающим.
- Если день был продуктивным (много задач выполнено) — похвали.
- Если много потрачено — мягко напомни о бюджете.
- Если съедено много/мало калорий — дай короткий фидбек по питанию (для мужчины 84 кг норма ~2200).
- Пожелай хорошего отдыха."""

            headers = {"Authorization": f"Bearer {OPENROUTER_API_KEY}"}
            payload = {
                "model": OPENROUTER_MODEL,
                "messages": [{"role": "user", "content": prompt}]
            }
            
            try:
                resp = requests.post(OPENROUTER_URL, json=payload, headers=headers, timeout=30)
                final_text = resp.json()["choices"][0]["message"]["content"]
                send_message(telegram_id, f"🌙 **ИТОГИ ДНЯ**\n\n{final_text}")
            except Exception:
                logger.error(f"Failed to generate evening report for {telegram_id}")
                
    except Exception:
        logger.error("Error in evening_report job", exc_info=True)
