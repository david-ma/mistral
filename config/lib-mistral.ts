/**
 * Mistral vision API: load API key from secrets and describe an image by URL.
 * See https://docs.mistral.ai/capabilities/vision
 */
import path from 'path'
import fs from 'fs'
import { pathToFileURL } from 'url'

const MISTRAL_CHAT_URL = 'https://api.mistral.ai/v1/chat/completions'
const VISION_MODEL = 'mistral-small-latest'

export type MistralDescribeResult = {
  description: string
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number }
  raw?: unknown
}

/** Load MISTRAL_API_KEY from config/secrets.js (gitignored). */
export function loadMistralApiKey(): Promise<string | null> {
  const secretsPath = path.join(import.meta.dirname, 'secrets.js')
  console.debug('[mistral] secrets path:', secretsPath, 'exists:', fs.existsSync(secretsPath))
  if (!fs.existsSync(secretsPath)) {
    console.debug('[mistral] No secrets.js, skipping load')
    return Promise.resolve(null)
  }
  const url = pathToFileURL(secretsPath).href
  return import(url)
    .then((m: { MISTRAL_API_KEY?: string }) => {
      const key = typeof m.MISTRAL_API_KEY === 'string' ? m.MISTRAL_API_KEY : null
      console.debug('[mistral] MISTRAL_API_KEY loaded:', key ? `present (length ${key.length})` : 'missing or not a string')
      return key
    })
    .catch((err) => {
      console.debug('[mistral] Failed to load secrets:', err?.message ?? err)
      return null
    })
}

/** Delays (ms) between retries when Mistral cannot fetch the image (e.g. SmugMug still processing). */
const FETCH_RETRY_DELAYS_MS = [100, 500, 1000, 3000]

function isImageFetchError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err)
  return msg.includes('could not be fetched') || msg.includes('"code":3310')
}

/**
 * Call Mistral chat completions with vision: send image URL and prompt for description.
 * Image URL must be publicly accessible (e.g. UploadThing URL).
 */
export function describeImage(apiKey: string, imageUrl: string): Promise<MistralDescribeResult> {
  console.log('[mistral] describeImage: model=', VISION_MODEL, 'imageUrl length=', imageUrl?.length, 'imageUrl start=', imageUrl?.slice(0, 60) + (imageUrl?.length > 60 ? '...' : ''))
  const body = {
    model: VISION_MODEL,
    messages: [
      {
        role: 'user' as const,
        content: [
          { type: 'text' as const, text: "Describe this image in a few sentences. What's in it?" },
          { type: 'image_url' as const, image_url: imageUrl },
        ],
      },
    ],
    max_tokens: 300,
  }
  console.log('[mistral] POST', MISTRAL_CHAT_URL)
  return fetch(MISTRAL_CHAT_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  })
    .then((res) => {
      console.log('[mistral] response status:', res.status, res.statusText)
      if (!res.ok) {
        return res.text().then((t) => {
          console.log('[mistral] error body:', t)
          throw new Error(`Mistral API ${res.status}: ${t}`)
        })
      }
      return res.json()
    })
    .then((data: { choices?: Array<{ message?: { content?: string } }>; usage?: MistralDescribeResult['usage'] }) => {
      const content = data.choices?.[0]?.message?.content ?? ''
      console.log('[mistral] success, description length:', content.length)
      return {
        description: content,
        usage: data.usage,
        raw: data,
      }
    })
}

/**
 * Score a photo against its bingo prompt and check for inappropriate content.
 * Uses Mistral chat completions (text-only) with the existing image description.
 * See https://docs.mistral.ai/api/ — response_format json_object.
 *
 * Returns: { score: 1–10 (relevance to prompt), safe: boolean (no nudity/explicit), reason?: string }
 */
export type ScoreAndSafetyResult = {
  score: number
  safe: boolean
  reason?: string
}

export function scoreAndCheckSafety(
  apiKey: string,
  prompt: string,
  description: string
): Promise<ScoreAndSafetyResult> {
  const systemPrompt = `You are a judge for a photo bingo game. Given a bingo prompt and an AI-generated description of a photo, you must:
1. Score how well the photo matches the prompt from 1 (irrelevant) to 10 (perfect match). Use the description only; do not assume anything not stated.
2. Decide if the content is SAFE for a family-friendly event: safe=true means no nudity, no sexually explicit content, no graphic violence, no illegal content. safe=false if the description suggests inappropriate content (e.g. adult content, "dick pic", etc.).
Respond with a single JSON object only, no other text: { "score": <number 1-10>, "safe": <boolean>, "reason": "<optional one sentence>" }`

  const userPrompt = `Bingo prompt: "${prompt}"\n\nImage description: "${description}"\n\nRespond with JSON: { "score": <1-10>, "safe": <true|false>, "reason": "<optional>" }`

  const body = {
    model: VISION_MODEL,
    messages: [
      { role: 'system' as const, content: systemPrompt },
      { role: 'user' as const, content: userPrompt },
    ],
    max_tokens: 150,
    temperature: 0.2,
    response_format: { type: 'json_object' as const },
  }

  return fetch(MISTRAL_CHAT_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  })
    .then((res) => {
      if (!res.ok) {
        return res.text().then((t) => {
          throw new Error(`Mistral scoring API ${res.status}: ${t}`)
        })
      }
      return res.json()
    })
    .then((data: { choices?: Array<{ message?: { content?: string } }> }) => {
      const raw = data.choices?.[0]?.message?.content ?? ''
      const parsed = JSON.parse(raw || '{}') as { score?: number; safe?: boolean; reason?: string }
      let score = typeof parsed.score === 'number' ? Math.round(parsed.score) : 5
      if (score < 1) score = 1
      if (score > 10) score = 10
      const safe = typeof parsed.safe === 'boolean' ? parsed.safe : true
      return {
        score,
        safe,
        reason: typeof parsed.reason === 'string' ? parsed.reason : undefined,
      }
    })
}

/**
 * Like describeImage but retries when Mistral returns "file could not be fetched" (e.g. image URL
 * not yet available from SmugMug). Waits 100 ms, 500 ms, 1 s, 3 s between retries then fails.
 */
export function describeImageWithRetry(apiKey: string, imageUrl: string): Promise<MistralDescribeResult> {
  let attempt = 0
  function run(): Promise<MistralDescribeResult> {
    attempt += 1
    return describeImage(apiKey, imageUrl).catch((err) => {
      if (!isImageFetchError(err) || attempt > FETCH_RETRY_DELAYS_MS.length) {
        throw err
      }
      const delayMs = FETCH_RETRY_DELAYS_MS[attempt - 1]
      console.log('[mistral] image fetch error, retry after', delayMs, 'ms (attempt', attempt, ')')
      return new Promise<MistralDescribeResult>((resolve, reject) => {
        setTimeout(() => {
          run().then(resolve).catch(reject)
        }, delayMs)
      })
    })
  }
  return run()
}
