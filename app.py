"""
Idonis — Personal AI Assistant Bot
Entry point: Flask app + APScheduler for cron jobs
"""
import os
import logging
from flask import Flask
from apscheduler.schedulers.background import BackgroundScheduler

from bot.webhook import webhook_bp

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)

# ── Flask app ──────────────────────────────────────────────────────────────────
app = Flask(__name__)
app.register_blueprint(webhook_bp)


@app.route("/health")
def health():
    """Health check endpoint — used by UptimeRobot to keep Render alive."""
    return "OK", 200


# ── APScheduler (runs inside the same process as gunicorn --workers 1) ─────────
def _start_scheduler():
    from bot.schedulers.reminders import check_reminders
    from bot.schedulers.morning import morning_report
    from bot.schedulers.evening import evening_report

    scheduler = BackgroundScheduler(timezone="Europe/Moscow")

    # Check reminders every 30 minutes
    scheduler.add_job(check_reminders, "interval", minutes=30, id="reminders")

    # Morning briefing at 07:00 MSK
    scheduler.add_job(morning_report, "cron", hour=7, minute=0, id="morning")

    # Evening summary at 21:00 MSK
    scheduler.add_job(evening_report, "cron", hour=21, minute=0, id="evening")

    scheduler.start()
    logger.info("✅ APScheduler started (reminders, morning, evening)")


# Start scheduler when module loads (compatible with gunicorn --workers 1)
_start_scheduler()


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port, debug=False)
