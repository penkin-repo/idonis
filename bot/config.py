"""
config.py — Централизованная настройка приложения.
Все ключи автоматически берутся из .env локально или из Render Environment Variables.
"""
import os
from dotenv import load_dotenv

# Загружаем переменные из .env файла (если он есть)
load_dotenv()

# ==========================================
# ОСНОВНЫЕ НАСТРОЙКИ (МОЖНО РЕДАКТИРОВАТЬ И ПУШИТЬ В GIT)
# ==========================================

# Модель ИИ (по желанию можно переопределить через .env, но проще менять прямо здесь)
# Примеры: 
#   - openai/gpt-4o-mini
#   - anthropic/claude-3.5-sonnet
#   - google/gemini-2.5-flash
#   - meta-llama/llama-3-70b-instruct
OPENROUTER_MODEL = os.environ.get("OPENROUTER_MODEL", "minimax/minimax-m2.5:free")

# ==========================================
# СЕКРЕТЫ (БЕРУТСЯ ИЗ .env ИЛИ RENDER ENV)
# ==========================================

TELEGRAM_BOT_TOKEN = os.environ.get("TELEGRAM_BOT_TOKEN", "")
OPENROUTER_API_KEY = os.environ.get("OPENROUTER_API_KEY", "")
FIREBASE_CREDENTIALS = os.environ.get("FIREBASE_CREDENTIALS", "")
WEBHOOK_SECRET = os.environ.get("WEBHOOK_SECRET", "super_secret_idonis_pword")
