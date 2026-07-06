import { toZonedTime, fromZonedTime, format } from 'date-fns-tz';

/**
 * Хелперы работы со временем в таймзоне пользователя.
 * В БД всё хранится в unix-секундах (UTC). Границы "дня" считаем в TZ пользователя.
 */

export function nowUnix(): number {
  return Math.floor(Date.now() / 1000);
}

/**
 * Возвращает [startUnix, endUnix) — границы последних N календарных суток
 * в таймзоне пользователя, включая сегодняшний день.
 * days=1 -> только сегодня.
 */
export function periodBounds(
  tz: string,
  days: number,
): { startUnix: number; endUnix: number } {
  const now = new Date();
  const zonedNow = toZonedTime(now, tz);

  // Начало сегодняшнего дня в TZ пользователя
  const startOfToday = new Date(zonedNow);
  startOfToday.setHours(0, 0, 0, 0);

  // Отматываем на (days - 1) дней назад
  const startZoned = new Date(startOfToday);
  startZoned.setDate(startZoned.getDate() - (days - 1));

  // Конец = начало завтрашнего дня
  const endZoned = new Date(startOfToday);
  endZoned.setDate(endZoned.getDate() + 1);

  const startUtc = fromZonedTime(startZoned, tz);
  const endUtc = fromZonedTime(endZoned, tz);

  return {
    startUnix: Math.floor(startUtc.getTime() / 1000),
    endUnix: Math.floor(endUtc.getTime() / 1000),
  };
}

/** Форматирует unix-время в читаемую строку в TZ пользователя. */
export function formatInTz(unix: number, tz: string, pattern = 'dd.MM HH:mm'): string {
  const zoned = toZonedTime(new Date(unix * 1000), tz);
  return format(zoned, pattern, { timeZone: tz });
}

/** Метка периода для сохранения отчёта. */
export function periodLabel(days: number): string {
  if (days <= 1) return 'today';
  if (days === 7) return 'last_7d';
  return `last_${days}d`;
}

/**
 * Парсит подсказку времени от LLM (ISO строка) в unix-секунды.
 * Если не получилось — возвращает fallback.
 */
export function hintToUnix(hint: string | null, fallbackUnix: number): number {
  if (!hint) return fallbackUnix;
  const t = Date.parse(hint);
  return Number.isFinite(t) ? Math.floor(t / 1000) : fallbackUnix;
}
