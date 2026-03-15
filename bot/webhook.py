"""
webhook.py — Flask blueprint for Telegram webhook endpoint.
Receives updates from Telegram and routes them to AI handler.
"""
import logging
import os
from flask import Blueprint, request, jsonify

logger = logging.getLogger(__name__)

webhook_bp = Blueprint("webhook", __name__)

WEBHOOK_SECRET = os.environ.get("WEBHOOK_SECRET", "")


@webhook_bp.route("/webhook", methods=["POST"])
def telegram_webhook():
    """Main Telegram webhook handler."""
    # Verify secret token header (optional but recommended)
    if WEBHOOK_SECRET:
        token = request.headers.get("X-Telegram-Bot-Api-Secret-Token", "")
        if token != WEBHOOK_SECRET:
            logger.warning("Invalid webhook secret token")
            return jsonify({"error": "Unauthorized"}), 403

    data = request.get_json(silent=True)
    if not data:
        return jsonify({"error": "No data"}), 400

    logger.info("Incoming update: %s", data.get("update_id"))

    # Extract message
    message = data.get("message") or data.get("edited_message")
    if not message:
        return jsonify({"ok": True}), 200

    chat_id = message.get("chat", {}).get("id")
    text = message.get("text", "")

    if not chat_id or not text:
        return jsonify({"ok": True}), 200

    # ── AI HANDLER (Phase 2) ──────────────────────────────────────────────────
    from bot.ai_handler import handle_message
    
    # Run in background via simple threading to respond to Telegram 200 OK immediately
    # (Telegram has 2-5s timeout, AI might take longer)
    import threading
    threading.Thread(target=handle_message, args=(chat_id, text)).start()

    return jsonify({"ok": True}), 200
