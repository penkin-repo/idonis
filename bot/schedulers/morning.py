"""
morning.py — Generate and send morning briefing.
"""
import logging
import requests
import os
import pytz
from datetime import datetime
from bot.firestore_ops import get_db, get_tasks, get_shopping_list
from bot.telegram_api import send_message
from bot.config import OPENROUTER_API_KEY, OPENROUTER_MODEL

logger = logging.getLogger(__name__)

OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"

def morning_report():
    """Every day at 07:00 MSK."""
    logger.info("Generating morning reports...")
    db = get_db()
    today = datetime.now(pytz.timezone("Europe/Moscow")).strftime("%Y-%m-%d")
    
    try:
        users = db.collection("users").stream()
        for user_doc in users:
            telegram_id = int(user_doc.id)
            profile = user_doc.to_dict()
            name = profile.get("name", "друг")
            
            tasks = get_tasks(telegram_id, today)
            shopping = get_shopping_list(telegram_id)
            
            # Read context from DB
            context = get_context_document(telegram_id, "user_context")
            if not context:
                # Fallback to file if DB empty
                context_path = os.path.join(os.path.dirname(__file__), "..", "user_context.md")
                if os.path.exists(context_path):
                    with open(context_path, "r", encoding="utf-8") as f:
                        context = f.read()
            
            # AI formatting
            prompt = f"""Сгенерируй доброе утреннее сообщение для {name}.
Сегодня: {today}.
Задачи на сегодня: {tasks}
Список покупок: {[i['name'] for i in shopping if not i.get('bought')]}

ПЕРСОНАЛЬНЫЙ КОНТЕКСТ:
{context}

ПРАВИЛА:
- Будь бодрым и позитивным.
- Используй эмодзи.
- Кратко перечисли основные дела.
- Если в контексте есть важные события (ДР, кружки), упомяни их.
- Пожелай удачного дня."""

            headers = {"Authorization": f"Bearer {OPENROUTER_API_KEY}"}
            payload = {
                "model": OPENROUTER_MODEL,
                "messages": [{"role": "user", "content": prompt}]
            }
            
            try:
                resp = requests.post(OPENROUTER_URL, json=payload, headers=headers, timeout=30)
                final_text = resp.json()["choices"][0]["message"]["content"]
                send_message(telegram_id, f"☀️ **ДОБРОЕ УТРО!**\n\n{final_text}")
            except Exception:
                logger.error(f"Failed to generate morning report for {telegram_id}")
                
    except Exception:
        logger.error("Error in morning_report job", exc_info=True)
