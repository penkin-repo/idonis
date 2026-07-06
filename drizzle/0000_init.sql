-- Инициализация схемы БД для Turso (libSQL / SQLite).
-- Применить: turso db shell <db-name> < drizzle/0000_init.sql
-- Либо использовать npm run db:push (drizzle-kit).

-- Профиль пользователя (расширенный)
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  telegram_chat_id TEXT NOT NULL UNIQUE,
  tg_username TEXT,
  name TEXT,
  age INTEGER,
  sex TEXT,
  height_cm INTEGER,
  current_weight_kg REAL,
  activity_level TEXT,
  work_type TEXT,
  sleep_schedule TEXT,
  diet_restrictions TEXT,
  chronic_conditions TEXT,
  goal TEXT,
  tz TEXT DEFAULT 'Europe/Moscow',
  onboarded INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- История веса (вносить можно всегда)
CREATE TABLE IF NOT EXISTS weights (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  weight_kg REAL NOT NULL,
  measured_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_weights_user_time ON weights(user_id, measured_at);

-- Логи образа жизни
CREATE TABLE IF NOT EXISTS logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  telegram_message_id INTEGER,
  type TEXT NOT NULL,
  raw_text TEXT NOT NULL,
  payload TEXT NOT NULL,
  logged_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_logs_dedup ON logs(user_id, telegram_message_id);
CREATE INDEX IF NOT EXISTS idx_logs_user_time ON logs(user_id, logged_at);

-- Сохранённые отчёты
CREATE TABLE IF NOT EXISTS reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  period_label TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_reports_user ON reports(user_id, created_at);
