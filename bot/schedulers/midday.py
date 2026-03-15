"""
midday.py — Generate and send midday analysis and recommendations.
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

def midday_report():
    """Every day at 14:00 MSK."""
    logger.info("Generating midday reports...")
    db = get_db()
    today = datetime.now(pytz.timezone("Europe/Moscow")).strftime("%Y-%m-%d")
    
    # Read user context for goals
    static_context = ""
    context_path = os.path.join(os.path.dirname(__file__), "..", "user_context.md")
    if os.path.exists(context_path):
        with open(context_path, "r", encoding="utf-8") as f:
            static_context = f.read()

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
            prompt = f"""Сделай дневной анализ и дай рекомендации для {name}.
Сегодня: {today}.

СТАТИЧНЫЙ КОНТЕКСТ И ЦЕЛИ:
{static_context}

ТЕКУЩИЕ ДАННЫЕ ЗА ПОЛДНЯ:
Задач выполнено: {len([t for t in tasks if t.get('done')])} из {len(tasks)}
Осталось задач: {[t['title'] for t in tasks if not t.get('done')]}
Потрачено денег: {total_spent} руб.
Употреблено калорий: {total_calories} ккал.

ПРАВИЛА:
- Дай короткую, бодрую сводку.
- Оцени прогресс по целям (особенно здоровье и спорт).
- Посоветуй, на что обратить внимание во второй половине дня (например: "не забудь выпить воды", "осталось X калорий до ужина", "пора сделать фокус на задачи").
- Сообщение должно быть поддерживающим и мотивирующим."""

            headers = {"Authorization": f"Bearer {OPENROUTER_API_KEY}"}
            payload = {
                "model": OPENROUTER_MODEL,
                "messages": [{"role": "user", "content": prompt}]
            }
            
            try:
                resp = requests.post(OPENROUTER_URL, json=payload, headers=headers, timeout=30)
                final_text = resp.json()["choices"][0]["message"]["content"]
                send_message(telegram_id, f"⚡ **ДНЕВНОЙ АНАЛИЗ**\n\n{final_text}")
            except Exception:
                logger.error(f"Failed to generate midday report for {telegram_id}")
                
    except Exception:
        logger.error("Error in midday_report job", exc_info=True)
