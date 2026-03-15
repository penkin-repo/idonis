"""
tools.py — AI function calling tool definitions (OpenAI/OpenRouter JSON schema).
"""

TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "add_task",
            "description": "Добавить задачу или дело в список на определённый день",
            "parameters": {
                "type": "object",
                "properties": {
                    "title":    {"type": "string", "description": "Название задачи"},
                    "date":     {"type": "string", "description": "Дата в формате YYYY-MM-DD"},
                    "time":     {"type": "string", "description": "Время в формате HH:MM (опционально)"},
                    "category": {"type": "string", "description": "Категория (работа, личное, здоровье, дети и др.)"},
                },
                "required": ["title", "date"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "complete_task",
            "description": "Отметить задачу как выполненную",
            "parameters": {
                "type": "object",
                "properties": {
                    "task_id": {"type": "string", "description": "ID задачи"},
                    "date":    {"type": "string", "description": "Дата задачи YYYY-MM-DD"},
                },
                "required": ["task_id", "date"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "add_expense",
            "description": "Записать трату или расход",
            "parameters": {
                "type": "object",
                "properties": {
                    "amount":   {"type": "number", "description": "Сумма в рублях"},
                    "category": {
                        "type": "string",
                        "enum": ["продукты", "кружки", "транспорт", "кафе", "здоровье", "одежда", "дом", "развлечения", "прочее"],
                        "description": "Категория расхода",
                    },
                    "note": {"type": "string", "description": "Комментарий (опционально)"},
                },
                "required": ["amount", "category"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "add_meal",
            "description": "Записать приём пищи и калории",
            "parameters": {
                "type": "object",
                "properties": {
                    "description":         {"type": "string", "description": "Что съел"},
                    "estimated_calories":  {"type": "integer", "description": "Примерные калории"},
                },
                "required": ["description", "estimated_calories"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "add_to_shopping_list",
            "description": "Добавить товары в список покупок",
            "parameters": {
                "type": "object",
                "properties": {
                    "items": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "Список товаров для покупки",
                    }
                },
                "required": ["items"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "mark_as_bought",
            "description": "Отметить товар в списке покупок как купленный",
            "parameters": {
                "type": "object",
                "properties": {
                    "item_name": {"type": "string", "description": "Название товара"}
                },
                "required": ["item_name"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "set_reminder",
            "description": "Установить напоминание на определённое время",
            "parameters": {
                "type": "object",
                "properties": {
                    "message":  {"type": "string", "description": "Текст напоминания"},
                    "datetime": {"type": "string", "description": "Дата и время в формате YYYY-MM-DDTHH:MM"},
                },
                "required": ["message", "datetime"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_today_tasks",
            "description": "Получить список задач на сегодня",
            "parameters": {"type": "object"},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_expenses_summary",
            "description": "Получить сводку по расходам за период",
            "parameters": {
                "type": "object",
                "properties": {
                    "date_range": {
                        "type": "string",
                        "enum": ["today", "week", "month"],
                        "description": "Период: today, week, month",
                    }
                },
                "required": ["date_range"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_shopping_list",
            "description": "Получить текущий список покупок",
            "parameters": {"type": "object"},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "save_learned_context",
            "description": "Запомнить важный факт о пользователе (например: как зовут ребенка, любимая еда, расписание)",
            "parameters": {
                "type": "object",
                "properties": {
                    "fact": {"type": "string", "description": "Факт для запоминания"}
                },
                "required": ["fact"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_today_meals",
            "description": "Получить список приемов пищи за сегодня (с калориями)",
            "parameters": {"type": "object"},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "update_food_plan",
            "description": "Обновить или дополнить план питания (food.md). Используй для изменения меню, граммовок или списка покупок в плане.",
            "parameters": {
                "type": "object",
                "properties": {
                    "new_content": {"type": "string", "description": "Полный новый текст плана питания в формате Markdown"}
                },
                "required": ["new_content"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "update_user_context",
            "description": "Обновить личную информацию о пользователе (user_context.md). Используй для изменения данных о семье, целях или расписании.",
            "parameters": {
                "type": "object",
                "properties": {
                    "new_content": {"type": "string", "description": "Полный новый текст контекста в формате Markdown"}
                },
                "required": ["new_content"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "complete_all_tasks",
            "description": "Отметить ВСЕ задачи на определённый день как выполненные. Полезно, когда пользователь говорит 'все готово' или 'обнули задачи'.",
            "parameters": {
                "type": "object",
                "properties": {
                    "date": {"type": "string", "description": "Дата в формате YYYY-MM-DD"},
                },
                "required": ["date"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "track_health_stat",
            "description": "Записать прогресс по здоровью (отжимания, вода, растяжка и др.)",
            "parameters": {
                "type": "object",
                "properties": {
                    "stat_key": {
                        "type": "string", 
                        "enum": ["pushups_done", "water_liters", "stretching_done"],
                        "description": "Ключ прогресса"
                    },
                    "value": {"type": "string", "description": "Значение (например 'true' или '1.5')"},
                },
                "required": ["stat_key", "value"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_health_stats_summary",
            "description": "Получить сводку по здоровью за период (неделя/месяц).",
            "parameters": {
                "type": "object",
                "properties": {
                    "date_range": {"type": "string", "enum": ["week", "month"], "description": "Период"}
                },
                "required": ["date_range"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_meals_summary",
            "description": "Получить сводку по питанию за период (неделя/месяц).",
            "parameters": {
                "type": "object",
                "properties": {
                    "date_range": {"type": "string", "enum": ["week", "month"], "description": "Период"}
                },
                "required": ["date_range"],
            },
        },
    },
]

