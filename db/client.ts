import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import * as schema from './schema.js';

/**
 * Единый клиент Turso + Drizzle.
 * Создаётся один раз на инстанс serverless-функции (переиспользуется при warm-старте).
 */
function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

const libsql = createClient({
  url: required('TURSO_DATABASE_URL'),
  authToken: required('TURSO_AUTH_TOKEN'),
});

export const db = drizzle(libsql, { schema });
export { schema };
