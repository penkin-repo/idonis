import OpenAI from 'openai';
import { z } from 'zod';

/**
 * Единый LLM-клиент через OpenRouter (OpenAI-совместимый API).
 * Модель берётся из ENV OPENROUTER_MODEL и может меняться без правок кода.
 */
const client = new OpenAI({
  apiKey: process.env.OPENROUTER_API_KEY,
  baseURL: 'https://openrouter.ai/api/v1',
  defaultHeaders: {
    'HTTP-Referer': process.env.APP_URL ?? '',
    'X-Title': 'Lifestyle Tracker Bot',
  },
});

export const MODEL = process.env.OPENROUTER_MODEL?.trim() || 'openai/gpt-4o-mini';

/**
 * Вызывает LLM с требованием вернуть JSON, парсит и валидирует через zod.
 * Бросает ошибку, если JSON невалиден — вызывающий код обрабатывает fallback.
 */
export async function callStructured<S extends z.ZodTypeAny>(
  systemPrompt: string,
  userContent: string,
  schema: S,
): Promise<z.infer<S>> {
  const completion = await client.chat.completions.create({
    model: MODEL,
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
