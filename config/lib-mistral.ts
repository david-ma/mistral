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
