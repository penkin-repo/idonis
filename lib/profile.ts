import { eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { users, weights, type User } from '../db/schema.js';
import { callStructured } from './openrouter.js';
import { PROFILE_PROMPT } from './prompts.js';
import { profileSchema } from './schemas.js';
import { nowUnix } from './time.js';

/**
 * Находит пользователя по chatId или создаёт нового.
 */
export async function getOrCreateUser(
  chatId: string,
  tgUsername?: string,
): Promise<User> {
  const existing = await db
    .select()
    .from(users)
    .where(eq(users.telegramChatId, chatId))
    .limit(1);

  if (existing[0]) return existing[0];

  const defaultTz = process.env.USER_TZ ?? 'Europe/Moscow';
  const inserted = await db
    .insert(users)
    .values({
      telegramChatId: chatId,
      tgUsername: tgUsername ?? null,
      tz: defaultTz,
      onboarded: 0,
    })
    .returning();

  return inserted[0]!;
}

/**
 * Парсит свободный текст о себе через LLM и частично обновляет профиль.
 * Возвращает summary-подтверждение для пользователя.
 */
export async function updateProfileFromText(
  user: User,
  text: string,
): Promise<string> {
  const parsed = await callStructured(PROFILE_PROMPT, text, profileSchema);

  // Собираем только непустые поля (частичное обновление, не затираем старое).
  const patch: Partial<typeof users.$inferInsert> = { updatedAt: nowUnix() };

  if (parsed.name != null) patch.name = parsed.name;
  if (parsed.age != null) patch.age = parsed.age;
  if (parsed.sex != null) patch.sex = parsed.sex;
  if (parsed.height_cm != null) patch.heightCm = parsed.height_cm;
  if (parsed.weight_kg != null) patch.currentWeightKg = parsed.weight_kg;
  if (parsed.activity_level != null) patch.activityLevel = parsed.activity_level;
  if (parsed.work_type != null) patch.workType = parsed.work_type;
  if (parsed.sleep_schedule != null) patch.sleepSchedule = parsed.sleep_schedule;
  if (parsed.diet_restrictions != null)
    patch.dietRestrictions = parsed.diet_restrictions;
  if (parsed.chronic_conditions != null)
    patch.chronicConditions = parsed.chronic_conditions;
  if (parsed.goal != null) patch.goal = parsed.goal;

  await db.update(users).set(patch).where(eq(users.id, user.id));

  // Если пришёл вес — фиксируем в истории веса.
  if (parsed.weight_kg != null) {
    await recordWeight(user.id, parsed.weight_kg);
  }

  // Проверяем минимальную заполненность (имя + возраст + вес).
  const merged = { ...user, ...patch };
  const minimallyFilled =
    !!merged.name && merged.age != null && merged.currentWeightKg != null;
  if (minimallyFilled && !user.onboarded) {
    await db.update(users).set({ onboarded: 1 }).where(eq(users.id, user.id));
  }

  return parsed.summary;
}

/** Записывает замер веса в историю и обновляет текущий вес в профиле. */
export async function recordWeight(userId: number, weightKg: number): Promise<void> {
  await db.insert(weights).values({
    userId,
    weightKg,
    measuredAt: nowUnix(),
  });
  await db
    .update(users)
    .set({ currentWeightKg: weightKg, updatedAt: nowUnix() })
    .where(eq(users.id, userId));
}

/** Человекочитаемое представление профиля для команды /profile. */
export function renderProfile(u: User): string {
  const line = (label: string, val: unknown) =>
    val != null && val !== '' ? `<b>${label}:</b> ${escapeHtml(String(val))}\n` : '';

  let out = '<b>👤 Твой профиль</b>\n\n';
  out += line('Имя', u.name);
  out += line('Возраст', u.age);
  out += line('Пол', u.sex === 'male' ? 'мужской' : u.sex === 'female' ? 'женский' : null);
  out += line('Рост (см)', u.heightCm);
  out += line('Текущий вес (кг)', u.currentWeightKg);
  out += line('Уровень активности', u.activityLevel);
  out += line('Тип работы', u.workType);
  out += line('Режим сна', u.sleepSchedule);
  out += line('Питание/ограничения', u.dietRestrictions);
  out += line('Хронические состояния', u.chronicConditions);
  out += line('Цель', u.goal);
  out += line('Таймзона', u.tz);

  if (out.trim().endsWith('профиль</b>')) {
    out += '\nПрофиль пока пустой. Расскажи о себе свободным текстом 🙂';
  }
  out +=
    '\n\n<i>Чтобы обновить — просто напиши, например: «мне 34, рост 180, цель — похудеть».</i>';
  return out;
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
