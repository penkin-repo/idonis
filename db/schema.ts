import { sql } from 'drizzle-orm';
import {
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
  index,
} from 'drizzle-orm/sqlite-core';
import type { InferSelectModel, InferInsertModel } from 'drizzle-orm';

/**
 * Профиль пользователя (расширенный).
 * Заполняется свободным текстом через LLM (частичное обновление).
 */
export const users = sqliteTable('users', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  telegramChatId: text('telegram_chat_id').notNull().unique(),
  tgUsername: text('tg_username'),
  name: text('name'),
  age: integer('age'),
  sex: text('sex'), // 'male' | 'female' | null
  heightCm: integer('height_cm'),
  currentWeightKg: real('current_weight_kg'),
  activityLevel: text('activity_level'), // 'sedentary' | 'light' | 'moderate' | 'active'
  workType: text('work_type'),
  sleepSchedule: text('sleep_schedule'),
  dietRestrictions: text('diet_restrictions'),
  chronicConditions: text('chronic_conditions'),
  goal: text('goal'),
  tz: text('tz').default('Europe/Moscow'),
  onboarded: integer('onboarded').notNull().default(0),
  createdAt: integer('created_at')
    .notNull()
    .default(sql`(unixepoch())`),
  updatedAt: integer('updated_at')
    .notNull()
    .default(sql`(unixepoch())`),
});

/** История веса (вносить можно всегда). */
export const weights = sqliteTable(
  'weights',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id),
    weightKg: real('weight_kg').notNull(),
    measuredAt: integer('measured_at').notNull(),
    createdAt: integer('created_at')
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => ({
    userTimeIdx: index('idx_weights_user_time').on(t.userId, t.measuredAt),
  }),
);

/** Логи образа жизни (еда, сон, настроение, активность, вес). */
export const logs = sqliteTable(
  'logs',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id),
    telegramMessageId: integer('telegram_message_id'),
    type: text('type').notNull(), // 'food' | 'sleep' | 'mood' | 'activity' | 'weight' | 'other'
    rawText: text('raw_text').notNull(),
    payload: text('payload').notNull(), // JSON-строка
    loggedAt: integer('logged_at').notNull(),
    createdAt: integer('created_at')
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => ({
    dedupIdx: uniqueIndex('idx_logs_dedup').on(t.userId, t.telegramMessageId),
    userTimeIdx: index('idx_logs_user_time').on(t.userId, t.loggedAt),
  }),
);

/** Сохранённые отчёты аналитика (по запросу). */
export const reports = sqliteTable(
  'reports',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id),
    periodLabel: text('period_label').notNull(),
    content: text('content').notNull(),
    createdAt: integer('created_at')
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => ({
    userIdx: index('idx_reports_user').on(t.userId, t.createdAt),
  }),
);

/** История чата (вопросы пользователя и ответы аналитика). */
export const chatMessages = sqliteTable(
  'chat_messages',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id),
    role: text('role').notNull(), // 'user' | 'assistant'
    content: text('content').notNull(),
    createdAt: integer('created_at')
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => ({
    userIdx: index('idx_chat_user_time').on(t.userId, t.createdAt),
  }),
);

/** Факты, которые логер подметил в сообщениях пользователя. */
export const facts = sqliteTable(
  'facts',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id),
    fact: text('fact').notNull(),
    createdAt: integer('created_at')
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => ({
    userIdx: index('idx_facts_user').on(t.userId, t.createdAt),
  }),
);

// Выведенные типы для типобезопасности во всём проекте.
export type User = InferSelectModel<typeof users>;
export type NewUser = InferInsertModel<typeof users>;
export type Weight = InferSelectModel<typeof weights>;
export type NewWeight = InferInsertModel<typeof weights>;
export type Log = InferSelectModel<typeof logs>;
export type NewLog = InferInsertModel<typeof logs>;
export type Report = InferSelectModel<typeof reports>;
export type NewReport = InferInsertModel<typeof reports>;
export type ChatMessage = InferSelectModel<typeof chatMessages>;
export type NewChatMessage = InferInsertModel<typeof chatMessages>;
export type Fact = InferSelectModel<typeof facts>;
export type NewFact = InferInsertModel<typeof facts>;
