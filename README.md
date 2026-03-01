# Bingo — Mistral Hackathon 2026

Built at the **Mistral AI Hackathon**, hosted at UNSW Founders, Sydney — 28 February–1 March 2026.

A huge thank you to **UNSW Founders** for providing the space, and to our sponsors **Mistral AI** for the challenge and API access.

---

## What is this app?

**Bingo** is a crowd-sourced photo collection tool for event organisers.

The idea: instead of hoping attendees will share photos after the event, give everyone a personalised **bingo card** at the start. Each cell on the card has a prompt — *"Photo with someone from Mistral"*, *"Photo of your team's project board"*, *"Photo of lunch"* — and attendees fill their card by taking photos throughout the day.

When a photo is uploaded, **Mistral's vision API** analyses it and writes a description, which is saved alongside the image. A second **Mistral** call then scores the photo against the bingo prompt and checks for inappropriate content. Organisers see real scores and safety flags in the admin view.

---

## Scoring and safety

Photos are scored and checked for inappropriate content using the **Mistral API** (chat completions, text-only, after the vision description is generated).

1. **Vision step** — The uploaded image is sent to Mistral vision; we get a short text description of what’s in the photo.
2. **Scoring step** — We send the **bingo prompt** and the **description** to Mistral chat with a system prompt that asks for:
   - **Score (1–10)** — How well the photo matches the prompt (based only on the description).
   - **Safe (true/false)** — Whether the content is appropriate for a family-friendly event (no nudity, no sexually explicit content, no graphic violence). If the description suggests inappropriate content (e.g. adult content), the model returns `safe: false`.

We use [Mistral’s JSON mode](https://docs.mistral.ai/api/) (`response_format: { type: "json_object" }`) so the model returns a single JSON object `{ "score": number, "safe": boolean, "reason": "..." }`. That result is stored on the bingo cell.

- **Admin “View all cards”** — Each card’s **total score** is the sum of its cell scores; **note** is “Flagged” if any cell has `safe: false`.
- **Admin “All prompts”** — For each prompt, we show the **average score** of all submissions for that prompt, and each photo can show **Score: N** and a **Flagged** badge when `safe: false`.

If the scoring API call fails (e.g. no key, rate limit), we still save the description and set `safe: true` so the upload isn’t blocked.

---

## How Bingo works

1. **Organiser creates an event** — they give it a name, choose a grid size (3×3 or 5×5), and write a list of photo prompts.
2. **Attendees join** — visiting the event page generates a personal bingo card with a randomised selection of prompts. The centre cell is always a free space.
3. **Fill the card** — Tapping a cell opens the camera or file picker. The photo is uploaded; the server fetches it, sends it to Mistral for a description, then runs the scoring/safety check and stores score and `safe` on the cell.
4. **Organisers review** — The admin view shows every card (with total score and “Flagged” if any cell is unsafe) and a prompt-by-prompt breakdown with per-photo scores and safety flags.

---

## Tech stack

- **[Thalia](https://github.com/david-ma/Thalia)** — Node.js/Bun framework (TypeScript, Handlebars, Drizzle ORM, Socket.IO)
- **Mistral AI** — vision for describing photos; chat (JSON mode) for scoring relevance and safety
- **UploadThing** — client-side file upload with temporary storage
- **SmugMug API** — long-term photo storage (optional path)
- **D3.js** — client-side bingo card rendering
- **MySQL** — events, bingo cards, users, sessions

---

## Running locally

```bash
bun install
bun run dev
```

The app runs at `http://localhost:3535` by default. You'll need a `config/secrets.js` file with your credentials:

```js
export const UPLOADTHING_TOKEN = '...'
export const MISTRAL_API_KEY = '...'  // for vision + scoring/safety
export const BINGO_ALBUM_KEY = '...'  // optional SmugMug album
export const smugmug = { consumer_key, consumer_secret, oauth_token, oauth_token_secret }
```

---

## Production

Deployed at **https://mistral.david-ma.net** via nginx reverse proxy on aang → katara (Tailscale).

See `docs/nginx-proxy-debug.md` for notes on nginx + host header configuration.
