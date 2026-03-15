"""
telegram_api.py — Helpers for sending messages via Telegram Bot API.
"""
import logging
import requests
import json
from bot.config import TELEGRAM_BOT_TOKEN

logger = logging.getLogger(__name__)

BOT_TOKEN = TELEGRAM_BOT_TOKEN
TELEGRAM_API_BASE = f"https://api.telegram.org/bot{BOT_TOKEN}"


def send_message(chat_id: int, text: str, reply_markup: dict = None):
    """Send text message to Telegram chat."""
    if not BOT_TOKEN:
        logger.error("TELEGRAM_BOT_TOKEN is not set!")
        return None

    payload = {
        "chat_id": chat_id,
        "text": text,
        "parse_mode": "Markdown",
    }
    if reply_markup is not None:
        payload["reply_markup"] = json.dumps(reply_markup)

    try:
        resp = requests.post(f"{TELEGRAM_API_BASE}/sendMessage", json=payload, timeout=10)
        resp.raise_for_status()
        return resp.json()
    except Exception:
        logger.error("Failed to send message", exc_info=True)
        return None


def send_chat_action(chat_id: int, action: str = "typing"):
    """Send chat action (e.g. typing) to Telegram chat."""
    if not BOT_TOKEN:
        logger.error("TELEGRAM_BOT_TOKEN is not set!")
        return

    payload = {
        "chat_id": chat_id,
        "action": action
    }
    try:
        requests.post(f"{TELEGRAM_API_BASE}/sendChatAction", json=payload, timeout=5)
    except Exception:
        logger.warning(f"Failed to send chat action '{action}'")
