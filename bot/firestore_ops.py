"""
firestore_ops.py — CRUD operations with Firebase Firestore.
Client is initialized once at module level.
"""
import json
import logging
import os
import base64
from datetime import datetime

import firebase_admin
from firebase_admin import credentials, firestore

logger = logging.getLogger(__name__)

# ── Firestore initialization ───────────────────────────────────────────────────
_db = None


def get_db():
    """Return Firestore client, initializing Firebase app if needed."""
    global _db
    if _db is not None:
        return _db

    if not firebase_admin._apps:
        creds_env = os.environ.get("FIREBASE_CREDENTIALS", "")
        if not creds_env:
            raise RuntimeError("FIREBASE_CREDENTIALS env var is not set!")

        # Support base64-encoded JSON or raw JSON string
        try:
            creds_json = json.loads(base64.b64decode(creds_env).decode())
        except Exception:
            creds_json = json.loads(creds_env)

        cred = credentials.Certificate(creds_json)
        firebase_admin.initialize_app(cred)
        logger.info("Firebase app initialized")

    _db = firestore.client()
    return _db


# ── User helpers ───────────────────────────────────────────────────────────────
def get_user_ref(telegram_id: int):
    return get_db().collection("users").document(str(telegram_id))


def get_user_profile(telegram_id: int) -> dict:
    """Return user profile dict or empty dict if not found."""
    doc = get_user_ref(telegram_id).get()
    return doc.to_dict() if doc.exists else {}


def set_user_profile(telegram_id: int, data: dict):
    get_user_ref(telegram_id).set(data, merge=True)


def get_learned_context(telegram_id: int) -> list:
    doc = get_user_ref(telegram_id).collection("context").document("learned").get()
    return doc.to_dict().get("facts", []) if doc.exists else []


def add_learned_context(telegram_id: int, fact: str):
    ref = get_user_ref(telegram_id).collection("context").document("learned")
    ref.set({"facts": firestore.ArrayUnion([fact])}, merge=True)


def get_context_document(telegram_id: int, doc_id: str) -> str:
    """Retrieve Markdown context from Firestore (e.g. 'food', 'user_context')."""
    doc = get_user_ref(telegram_id).collection("context").document(doc_id).get()
    return doc.to_dict().get("content", "") if doc.exists else ""


def set_context_document(telegram_id: int, doc_id: str, content: str):
    """Save Markdown context to Firestore."""
    ref = get_user_ref(telegram_id).collection("context").document(doc_id)
    ref.set({"content": content, "updated_at": datetime.utcnow()}, merge=True)


# ── Tasks ──────────────────────────────────────────────────────────────────────
def get_tasks(telegram_id: int, date: str) -> list:
    """date format: YYYY-MM-DD"""
    doc = get_user_ref(telegram_id).collection("tasks").document(date).get()
    return doc.to_dict().get("items", []) if doc.exists else []


def add_task(telegram_id: int, date: str, task: dict):
    ref = get_user_ref(telegram_id).collection("tasks").document(date)
    ref.set({"items": firestore.ArrayUnion([task])}, merge=True)


@firestore.transactional
def _complete_txn(transaction, ref, task_id):
    doc = ref.get(transaction=transaction)
    if not doc.exists: return
    items = doc.to_dict().get("items", [])
    updated = False
    for t in items:
        if t.get("id") == task_id:
            t["done"] = True
            updated = True
    if updated:
        transaction.update(ref, {"items": items})

def complete_task(telegram_id: int, date: str, task_id: str):
    db = get_db()
    ref = get_user_ref(telegram_id).collection("tasks").document(date)
    _complete_txn(db.transaction(), ref, task_id)


@firestore.transactional
def _toggle_txn(transaction, ref, task_id):
    doc = ref.get(transaction=transaction)
    if not doc.exists: return
    items = doc.to_dict().get("items", [])
    updated = False
    for t in items:
        if t.get("id") == task_id:
            t["done"] = not t.get("done", False)
            updated = True
    if updated:
        transaction.update(ref, {"items": items})

def toggle_task(telegram_id: int, date: str, task_id: str):
    db = get_db()
    ref = get_user_ref(telegram_id).collection("tasks").document(date)
    _toggle_txn(db.transaction(), ref, task_id)


def complete_all_tasks(telegram_id: int, date: str):
    """Mark all tasks for a specific date as done."""
    ref = get_user_ref(telegram_id).collection("tasks").document(date)
    doc = ref.get()
    if doc.exists:
        items = doc.to_dict().get("items", [])
        for t in items:
            t["done"] = True
        ref.set({"items": items}, merge=True)




# ── Expenses ───────────────────────────────────────────────────────────────────
def add_expense(telegram_id: int, date: str, expense: dict):
    ref = get_user_ref(telegram_id).collection("expenses").document(date)
    ref.set({"items": firestore.ArrayUnion([expense])}, merge=True)


def get_expenses(telegram_id: int, date: str) -> list:
    doc = get_user_ref(telegram_id).collection("expenses").document(date).get()
    return doc.to_dict().get("items", []) if doc.exists else []


# ── Meals ──────────────────────────────────────────────────────────────────────
def add_meal(telegram_id: int, date: str, meal: dict):
    ref = get_user_ref(telegram_id).collection("meals").document(date)
    ref.set({"items": firestore.ArrayUnion([meal])}, merge=True)

def get_meals(telegram_id: int, date: str) -> list:
    doc = get_user_ref(telegram_id).collection("meals").document(date).get()
    return doc.to_dict().get("items", []) if doc.exists else []


# ── Health Tracking ────────────────────────────────────────────────────────────
def get_health_stats(telegram_id: int, date: str) -> dict:
    """Return health stats for a date (workouts, water, etc.)."""
    doc = get_user_ref(telegram_id).collection("health").document(date).get()
    return doc.to_dict() if doc.exists else {}


def update_health_stat(telegram_id: int, date: str, key: str, value: any):
    """Update a specific health stat (e.g., 'pushups_done': True)."""
    ref = get_user_ref(telegram_id).collection("health").document(date)
    ref.set({key: value, "updated_at": datetime.utcnow()}, merge=True)


def get_health_summary(telegram_id: int, dates: list) -> dict:
    """Return health stats for multiple dates."""
    results = {}
    for d in dates:
        doc = get_user_ref(telegram_id).collection("health").document(d).get()
        if doc.exists:
            results[d] = doc.to_dict()
    return results


def get_meals_summary(telegram_id: int, dates: list) -> dict:
    """Return meals for multiple dates."""
    results = {}
    for d in dates:
        doc = get_user_ref(telegram_id).collection("meals").document(d).get()
        if doc.exists:
            results[d] = doc.to_dict().get("items", [])
    return results



# ── Shopping list ──────────────────────────────────────────────────────────────
def get_shopping_list(telegram_id: int) -> list:
    doc = get_user_ref(telegram_id).collection("shopping_list").document("default").get()
    return doc.to_dict().get("items", []) if doc.exists else []


def add_to_shopping_list(telegram_id: int, items: list):
    ref = get_user_ref(telegram_id).collection("shopping_list").document("default")
    new_items = [{"name": i, "bought": False} for i in items]
    ref.set({"items": firestore.ArrayUnion(new_items)}, merge=True)


@firestore.transactional
def _mark_bought_txn(transaction, ref, item_name):
    doc = ref.get(transaction=transaction)
    if not doc.exists: return
    items = doc.to_dict().get("items", [])
    updated = False
    for i in items:
        if i.get("name", "").lower() == item_name.lower():
            i["bought"] = True
            updated = True
    if updated:
        transaction.update(ref, {"items": items})

def mark_as_bought(telegram_id: int, item_name: str):
    db = get_db()
    ref = get_user_ref(telegram_id).collection("shopping_list").document("default")
    _mark_bought_txn(db.transaction(), ref, item_name)



# ── Reminders ─────────────────────────────────────────────────────────────────
def add_reminder(telegram_id: int, reminder_id: str, reminder: dict):
    get_user_ref(telegram_id).collection("reminders").document(reminder_id).set(reminder)


def get_pending_reminders() -> list:
    """Return all pending reminders across all users that should fire now."""
    db = get_db()
    now = datetime.utcnow()
    results = []

    try:
        docs = (
            db.collection_group("reminders")
            .where("status", "==", "pending")
            .where("trigger_at", "<=", now)
            .stream()
        )
        for doc in docs:
            data = doc.to_dict()
            data["_doc_path"] = doc.reference.path
            data["_telegram_id"] = doc.reference.parent.parent.id
            results.append(data)
    except Exception:
        logger.error("Failed to query pending reminders", exc_info=True)

    return results


def mark_reminder_fired(doc_path: str):
    get_db().document(doc_path).update({"status": "fired"})


# ── Chat History ──────────────────────────────────────────────────────────────
def get_chat_history(telegram_id: int, limit: int = 10) -> list:
    """Return the last messages from chat history."""
    doc = get_user_ref(telegram_id).collection("history").document("messages").get()
    return doc.to_dict().get("items", [])[-limit:] if doc.exists else []


def save_chat_history(telegram_id: int, history: list, limit: int = 20):
    """Save the chat history, keeping only the last N items."""
    ref = get_user_ref(telegram_id).collection("history").document("messages")
    ref.set({"items": history[-limit:]}, merge=True)

