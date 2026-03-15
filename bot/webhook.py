"""
webhook.py — Flask blueprint for Telegram webhook endpoint.
Receives updates from Telegram and routes them to AI handler or processes inline buttons.
"""
import logging
import os
import threading
from datetime import datetime
import pytz
from flask import Blueprint, request, jsonify

from bot import firestore_ops as db
from bot.keyboards import MAIN_MENU, build_tasks_keyboard
from bot.telegram_api import send_message, edit_message_reply_markup, answer_callback_query

logger = logging.getLogger(__name__)

webhook_bp = Blueprint("webhook", __name__)

WEBHOOK_SECRET = os.environ.get("WEBHOOK_SECRET", "")
USER_TZ = pytz.timezone("Europe/Moscow")

def _today_str():
    return datetime.now(USER_TZ).strftime("%Y-%m-%d")

@webhook_bp.route("/webhook", methods=["POST"])
def telegram_webhook():
    """Main Telegram webhook handler."""
    if WEBHOOK_SECRET:
        token = request.headers.get("X-Telegram-Bot-Api-Secret-Token", "")
        if token != WEBHOOK_SECRET:
            logger.warning("Invalid webhook secret token")
            return jsonify({"error": "Unauthorized"}), 403

    data = request.get_json(silent=True)
    if not data:
        return jsonify({"error": "No data"}), 400

    logger.info("Incoming update: %s", data.get("update_id"))

    # 1. Handle Callback Queries (Inline buttons)
    if "callback_query" in data:
        cq = data["callback_query"]
        cq_id = cq.get("id")
        chat_id = cq.get("message", {}).get("chat", {}).get("id")
        msg_id = cq.get("message", {}).get("message_id")
        cb_data = cq.get("data", "")
        
        if cb_data.startswith("task_"):
            # Format: task_check_xyz or task_uncheck_xyz
            parts = cb_data.split("_")
            if len(parts) >= 3:
                task_id = parts[2]
                db.toggle_task(chat_id, _today_str(), task_id)
                # Update inline keyboard
                tasks = db.get_tasks(chat_id, _today_str())
                kb = build_tasks_keyboard(tasks)
                edit_message_reply_markup(chat_id, msg_id, kb)
                answer_callback_query(cq_id, "Статус обновлен")
                return jsonify({"ok": True}), 200

        answer_callback_query(cq_id)
        return jsonify({"ok": True}), 200

    # 2. Extract Message
    message = data.get("message") or data.get("edited_message")
    if not message:
        return jsonify({"ok": True}), 200

    chat_id = message.get("chat", {}).get("id")
    text = message.get("text", "")

    if not chat_id or not text:
        return jsonify({"ok": True}), 200

    # 3. Handle Static Menu Buttons instantly (no AI)
    if text == "/start":
        send_message(chat_id, "Привет! Я твой личный ИИ-ассистент Idonis. Чем могу помочь?", reply_markup=MAIN_MENU)
        return jsonify({"ok": True}), 200

    if text == "📝 Задачи на сегодня":
        tasks = db.get_tasks(chat_id, _today_str())
        if not tasks:
            send_message(chat_id, "На сегодня задач нет! Можешь отдыхать 🌴", reply_markup=MAIN_MENU)
        else:
            send_message(chat_id, "Вот твои задачи на сегодня:\nНажми на задачу, чтобы отметить её.", 
                         reply_markup=build_tasks_keyboard(tasks))
        return jsonify({"ok": True}), 200

    if text == "🛒 Список покупок":
        shopping = db.get_shopping_list(chat_id)
        if not shopping:
            send_message(chat_id, "Список покупок пуст 🛒", reply_markup=MAIN_MENU)
        else:
            lines = [f"{'✅' if i.get('bought') else '⬜'} {i['name']}" for i in shopping]
            send_message(chat_id, "Твой список покупок:\n\n" + "\n".join(lines), reply_markup=MAIN_MENU)
        return jsonify({"ok": True}), 200
        
    if text == "💳 Траты сегодня":
        expenses = db.get_expenses(chat_id, _today_str())
        total = sum(e.get("amount", 0) for e in expenses)
        lines = [f"• {e.get('amount')}₽ — {e.get('category')} ({e.get('note', '')})" for e in expenses]
        msg = f"Траты за сегодня: **{total}₽**\n" + "\n".join(lines) if expenses else "Сегодня трат не было 💸"
        send_message(chat_id, msg, reply_markup=MAIN_MENU)
        return jsonify({"ok": True}), 200

    if text == "📊 Мой контекст":
        # Temporary stub for context visualizer
        send_message(chat_id, "Здесь будет отображаться информация, которую я запомнил про тебя.", reply_markup=MAIN_MENU)
        return jsonify({"ok": True}), 200

    # 4. Fallback to AI for everything else
    from bot.ai_handler import handle_message
    threading.Thread(target=handle_message, args=(chat_id, text)).start()

    return jsonify({"ok": True}), 200
