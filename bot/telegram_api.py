"""
telegram_api.py — Helpers for sending messages via Telegram Bot API.
"""
import logging
import os
import requests

logger = logging.getLogger(__name__)

BOT_TOKEN = os.environ.get("TELEGRAM_BOT_TOKEN", "")
TELEGRAM_API_BASE = f"https://api.telegram.org/bot{BOT_TOKEN}"


def send_message(chat_id: int, text: str, parse_mode: str = "Markdown") -> bool:
    """Send a text message to a Telegram chat.

    Args:
        chat_id: Telegram chat identifier.
        text: Message text (supports Markdown).
        parse_mode: 'Markdown' or 'HTML'.

    Returns:
        True if sent successfully, False otherwise.
    """
    if not BOT_TOKEN:
        logger.error("TELEGRAM_BOT_TOKEN is not set!")
        return False

    url = f"{TELEGRAM_API_BASE}/sendMessage"
    payload = {
        "chat_id": chat_id,
        "text": text,
        "parse_mode": parse_mode,
    }

    try:
        resp = requests.post(url, json=payload, timeout=10)
        result = resp.json()
        if not result.get("ok"):
            logger.error("Telegram API error: %s", result)
            return False
        return True
    except Exception:
        logger.error("Failed to send Telegram message", exc_info=True)
        return False
