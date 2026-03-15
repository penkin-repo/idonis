"""
reminders.py — Check and fire pending reminders.
"""
import logging
from bot.firestore_ops import get_pending_reminders, mark_reminder_fired
from bot.telegram_api import send_message

logger = logging.getLogger(__name__)

def check_reminders():
    """Job that runs every 1 minute to check for reminders."""
    logger.info("Checking for pending reminders...")
    try:
        pending = get_pending_reminders()
        for r in pending:
            chat_id = r.get("_telegram_id")
            message = r.get("message", "Напоминание!")
            doc_path = r.get("_doc_path")
            
            success = send_message(chat_id, f"🔔 **НАПОМИНАНИЕ**\n\n{message}")
            if success:
                mark_reminder_fired(doc_path)
                logger.info(f"Reminder fired for user {chat_id}")
    except Exception:
        logger.error("Error in check_reminders job", exc_info=True)
