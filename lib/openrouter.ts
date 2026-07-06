import OpenAI from 'openai';
import { z } from 'zod';

/**
 * LLM-клиент через OpenRouter (OpenAI-совместимый API).
 * Модели берутся из ENV и могут меняться без правок кода:
 *   OPENROUTER_MODEL       — для логера (быстрая, дешёвая)
 *   OPENROUTER_MODEL_ANALYST — для аналитика и чата (продвинутая)
 */
const client = new OpenAI({
  apiKey: process.env.OPENROUTER_API_KEY,
  baseURL: 'https://openrouter.ai/api/v1',
  defaultHeaders: {
    'HTTP-Referer': process.env.APP_URL ?? '',
    'X-Title': 'Lifestyle Tracker Bot',
  },
});

export const MODEL_LOGGER = process.env.OPENROUTER_MODEL?.trim() || 'openai/gpt-4o-mini';
export const MODEL_ANALYST = process.env.OPENROUTER_MODEL_ANALYST?.trim() || MODEL_LOGGER;

/**
 * Вызывает LLM с требованием вернуть JSON, парсит и валидирует через zod.
 * Бросает ошибку с rawText, если JSON невалиден — вызывающий код может fallback.
 */
export class LlmJsonError extends Error {
  rawText: string;
  constructor(rawText: string) {
    super('LLM не вернул валидный JSON');
    this.rawText = rawText;
  }
}

export async function callStructured<S extends z.ZodTypeAny>(
  systemPrompt: string,
  userContent: string,
  schema: S,
  model?: string,
): Promise<z.infer<S>> {
  const useModel = model ?? MODEL_LOGGER;

  const completion = await client.chat.completions.create({
    model: useModel,
    temperature: 0.2,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userContent },
    ],
  });

  const raw = completion.choices[0]?.message?.content?.trim();
  if (!raw) {
    throw new Error('LLM вернул пустой ответ');
  }

  const parsed = tryParseJson(raw);
  if (parsed !== null) {
    return schema.parse(parsed);
  }

  console.error('JSON parse failed. Raw:', raw.slice(0, 300));
  throw new LlmJsonError(raw);
}

function tryParseJson(raw: string): unknown | null {
  // 1. Прямой парсинг.
  try {
    return JSON.parse(raw);
  } catch { /* continue */ }

  // 2. Очистка markdown-обёртки ```json ... ```.
  try {
    const cleaned = raw
      .replace(/^```(?:json)?/i, '')
      .replace(/```$/i, '')
      .trim();
    return JSON.parse(cleaned);
  } catch { /* continue */ }

  // 3. Поиск первого { ... } блока в тексте.
  const match = raw.match(/\{[\s\S]*\}/);
  if (match) {
    try {
      return JSON.parse(match[0]);
    } catch { /* continue */ }
  }

  return null;
}
