"""
keyboards.py — UI elements (keyboards) for Telegram bot.
"""

# Главное меню (кнопки внизу экрана)
MAIN_MENU = {
    "keyboard": [
        [
            {"text": "📊 Общая сводка"},
        ],
        [
            {"text": "📝 Задачи на сегодня"},
            {"text": "🛒 Список покупок"},
        ],
        [
            {"text": "🍎 План по еде"},
            {"text": "💪 План здоровья"},
        ],
        [
            {"text": "💳 Траты сегодня"},
            {"text": "👤 Мой профиль"},
        ]
    ],
    "resize_keyboard": True,
    "is_persistent": True
}

def build_tasks_keyboard(tasks: list) -> dict:
    """Создает inline-клавиатуру для списка задач (для чекбоксов)."""
    inline_keyboard = []
    
    for t in tasks:
        task_id = t.get("id")
        title = t.get("title", "Задача")
        time_str = t.get("time", "")
        time_prefix = f"{time_str} " if time_str else ""
        is_done = t.get("done", False)
        
        # Эмодзи и текст на кнопке
        emoji = "✅" if is_done else "⬜"
        callback_data = f"task_{'uncheck' if is_done else 'check'}_{task_id}"
        
        inline_keyboard.append([{
            "text": f"{emoji} {time_prefix}{title}",
            "callback_data": callback_data
        }])
        
    return {"inline_keyboard": inline_keyboard}
