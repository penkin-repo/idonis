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
 * Бросает ошибку, если JSON невалиден — вызывающий код обрабатывает fallback.
 */
export async function callStructured<S extends z.ZodTypeAny>(
  systemPrompt: string,
  userContent: string,
  schema: S,
  model?: string,
): Promise<z.infer<S>> {
  const completion = await client.chat.completions.create({
    model: model ?? MODEL_LOGGER,
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

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Иногда модель оборачивает JSON в ```json ... ``` — попробуем вычистить.
    const cleaned = raw
      .replace(/^```(?:json)?/i, '')
      .replace(/```$/i, '')
      .trim();
    parsed = JSON.parse(cleaned);
  }

  return schema.parse(parsed);
}
