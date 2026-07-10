import { z } from 'zod';

/**
 * Хелпер: LLM часто отдаёт строку "null" или пустую строку вместо настоящего null.
 * Нормализуем такие значения.
 */
const nullableString = z
  .any()
  .transform((v): string | null =>
    v == null || v === '' || v === 'null' ? null : String(v),
  );

const nullableNumber = z.any().transform((v): number | null => {
  if (v == null || v === '' || v === 'null') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
});

const sexEnum = z
  .any()
  .transform((v): 'male' | 'female' | null =>
    v === 'male' || v === 'female' ? v : null,
  );

const levelEnum = z.any().transform((v): 'low' | 'medium' | 'high' | null => {
  const allowed = ['low', 'medium', 'high'];
  return typeof v === 'string' && allowed.includes(v)
    ? (v as 'low' | 'medium' | 'high')
    : null;
});

// ---------- 1) Профиль / онбординг ----------
export const profileSchema = z.object({
  name: nullableString,
  age: nullableNumber,
  sex: sexEnum,
  height_cm: nullableNumber,
  weight_kg: nullableNumber,
  activity_level: z
    .any()
    .transform((v): string | null => {
      const allowed = ['sedentary', 'light', 'moderate', 'active'];
      return typeof v === 'string' && allowed.includes(v) ? v : null;
    }),
  work_type: nullableString,
  sleep_schedule: nullableString,
  diet_restrictions: nullableString,
  chronic_conditions: nullableString,
  goal: nullableString,
  summary: z.string().default('Профиль обновлён.'),
});
export type ProfileParsed = z.infer<typeof profileSchema>;

// ---------- 2) Логер (дневник) ----------
const factActionSchema = z.object({
  fact: z.string().default(''),
  action: z.enum(['add', 'remove', 'replace']).default('add'),
  fact_id: nullableNumber, // ID факта для remove/replace
  new_fact: nullableString, // новый текст для replace
});

export const logSchema = z.object({
  is_question: z.any().transform((v): boolean => v === true).default(false),
  type: z.string().default('note'), // food|sleep|med|drink|mood|activity|note
  diary_entry: nullableString,
  event_time_hint: nullableString, // ISO время когда СЛУЧИЛОСЬ событие
  weight_kg: nullableNumber,
  summary: z.string().default('Записал.'),
  spotted_facts: z.array(factActionSchema).default([]),
});
export type LogParsed = z.infer<typeof logSchema>;

// ---------- 3) Аналитик ----------
export const analysisSchema = z.object({
  headline: z.string().default('Итог периода'),
  insulin_swings: z.string().default('—'),
  stress_hormones: z.string().default('—'),
  fiber_buffer: z.string().default('—'),
  weight_trend: z.string().default('—'),
  recommendations: z.array(z.string()).default([]),
  score_1_10: nullableNumber,
});
export type AnalysisParsed = z.infer<typeof analysisSchema>;

// ---------- 4) Чат (вопрос-ответ) ----------
export const chatSchema = z.object({
  reply: z.string().default('Не совсем понял вопрос, но я тут 👀'),
});
export type ChatParsed = z.infer<typeof chatSchema>;
