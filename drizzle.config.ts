import type { Config } from 'drizzle-kit';

/**
 * Конфиг Drizzle Kit для Turso (libSQL / SQLite-совместимая БД).
 * Использует переменные окружения TURSO_DATABASE_URL и TURSO_AUTH_TOKEN.
 */
export default {
  schema: './db/schema.ts',
  out: './drizzle',
  dialect: 'turso',
  dbCredentials: {
    url: process.env.TURSO_DATABASE_URL!,
    authToken: process.env.TURSO_AUTH_TOKEN!,
  },
} satisfies Config;
