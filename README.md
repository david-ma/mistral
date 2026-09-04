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

## Future work: using Mistral AI to improve user safety

This section outlines ways we could use **Mistral AI** (and related tooling) to make the app safer for organisers and attendees. The current flow does a single post-upload safety check (description → score + safe flag). The ideas below would extend or replace that with a more robust, configurable safety layer.

---

### 1. **Gate content before it's stored**

Today we always save the image and description, then run scoring; flagged content is only marked in the admin UI. A next step is to **block clearly unsafe uploads before persisting**:

- Run the same (or a stricter) Mistral safety pass **before** writing to the DB or SmugMug.
- If the model returns `safe: false` with high confidence (e.g. we add a `confidence` or `severity` in the JSON), return a 4xx to the client and do **not** store the image or description.
- Optionally run a **vision-only** safety call first (image → "is this appropriate for a family event?") so we don't rely solely on the description; that would catch cases where the description understates the content.

This keeps the worst content out of storage and off the admin view entirely, while still allowing organisers to see "rejected" counts or logs if desired.

---

### 2. **Structured severity and categories**

Move from a single `safe: boolean` to a **structured safety payload** from Mistral (e.g. JSON):

- **Severity:** `none` | `low` | `medium` | `high` | `critical`
- **Categories:** e.g. `nudity`, `violence`, `harassment`, `spam`, `off-topic`, `other`
- **Reason:** Short explanation for admins and for appeals.

We could then:

- **Block** only on `high` / `critical` (or on specific categories).
- **Flag for review** on `medium` without blocking.
- Let organisers **configure per event** which categories to block vs flag (e.g. "family day" vs "adults-only meetup").
- Use categories to drive **automated actions** (e.g. hide from public gallery until reviewed, or notify a human moderator).

All of this can be implemented with the same Mistral chat + JSON pattern we use today; we'd extend the system prompt and the expected response schema.

---

### 3. **Event-level safety policies**

Allow organisers to choose a **safety profile** when creating an event:

- **Strict (family-friendly)** — Block or flag anything that isn't clearly safe; default for new events.
- **Moderate** — Allow more edge cases; flag only clear violations.
- **Relaxed** — Only block e.g. illegal or clearly harmful content; useful for closed, adults-only events.

Implementation: pass the chosen profile into the Mistral system prompt (e.g. "You are judging for a strict family-friendly event …" vs "… for an adults-only professional event …") and optionally adjust thresholds in code (e.g. block only when severity ≥ high for "Moderate"). No new APIs required—just prompt design and config.

---

### 4. **Dedicated safety-only model call**

Split the current "describe + score + safety" flow into clearer steps:

1. **Vision:** "Describe this image" (current).
2. **Relevance:** "How well does this description match the prompt?" → score 1–10 (current).
3. **Safety:** A **separate** Mistral call focused only on safety: input = description (and optionally the image again), output = structured JSON (severity, categories, reason). No relevance in this call.

Benefits: a dedicated safety prompt can be tuned for moderation (e.g. "Consider understatement, euphemisms, and context"), and we can swap or version the safety prompt without touching the relevance logic. We could also run safety with a different model or temperature (e.g. lower temperature for more consistent moderation).

---

### 5. **User reporting and AI triage**

Add a "Report this photo" action (e.g. on the admin "All prompts" view or on shared card previews). When a user reports:

- Store the report (card id, cell, reporter, optional reason).
- Optionally send the **description + prompt + reporter reason** to Mistral: "Summarise the report and suggest: abuse_type (e.g. inappropriate, off-topic, other) and priority (low / medium / high)."
- Use the AI output to **sort and prioritise** the moderation queue (e.g. show high-priority or likely violations first) and to pre-fill a "suggested category" for the human reviewer.

This doesn't replace human review but makes it faster and more consistent, and it keeps a record of why something was reported.

---

### 6. **Audit trail and appeals**

Today we store `safe` and optionally `reason` on the cell. We could:

- **Always** ask Mistral for a short `reason` when `safe: false` and store it in the blob (or in an `audit_log` table). That gives organisers and support a clear record: "Why was this flagged?"
- If we later add **blocking** (see §1), we could support **appeals**: the user asks for a re-check; we re-run the safety call (or a dedicated "appeal" prompt that considers the stored reason) and either confirm the block or allow the content. The audit trail would show "blocked → appealed → allowed/confirmed."

Mistral's JSON output fits well here: we can add fields like `reason`, `confidence`, and later `appeal_outcome` without changing the rest of the pipeline.

---

### 7. **Vision-only safety pass**

Right now we infer safety from the **text description**. We could add a **vision-only** safety step:

- Send the image to Mistral with a prompt like: "Does this image contain nudity, sexually explicit content, graphic violence, or other content inappropriate for a family-friendly event? Answer only with JSON: { \"safe\": boolean, \"reason\": \"...\" }."
- Use this either **before** the description (to reject immediately) or **in parallel** with the description, then combine results (e.g. block if either vision or description says unsafe).

That reduces reliance on the description being accurate and catches cases where the description understates or omits problematic content.

---

### 8. **Abuse and rate limiting**

Use Mistral to help detect **behavioural** abuse, not just single-image content:

- Periodically (e.g. nightly) or on-demand: for a user or card, collect recent cells (descriptions, scores, safety flags). Ask Mistral: "Do these submissions look like spam, trolling, or systematic abuse (e.g. many off-topic or inappropriate uploads)? Return JSON: { \"abuse_likely\": boolean, \"reason\": \"...\" }."
- Use the result to **throttle** (e.g. require human review for this user's next uploads) or to **flag the account** for organisers. This complements per-image safety and rate limits.

---

### 9. **Bias and false positives**

Safety models can over-flag certain types of content (e.g. medical, artistic, or cultural contexts). We can:

- **Log** all safety decisions (model, prompt version, input hash, output) for later analysis.
- **Allow organisers to override** a flag (e.g. "Mark as safe" with an optional note), and store that override so we can tune prompts or add "allowlisted" patterns.
- Optionally **A/B test** different safety prompts or severity thresholds and measure false positive rates (e.g. organisers overriding flags) to improve the system over time.

Mistral's flexibility (prompt + JSON) makes it easy to iterate on the safety prompt and to add fields like `confidence` or `suggested_review` without changing the rest of the app.

---

### 10. **Child safety and policy compliance**

For events that may include minors (e.g. school or family events):

- Define a **stricter** safety profile (see §3) and consider **blocking** more aggressively rather than only flagging.
- Use Mistral to **detect** content that might be harmful to minors (not just "adult" content); document the policy (e.g. "We block X and Y") and align the system prompt with it.
- Keep a **clear record** of what was blocked and why (audit trail, §6), and ensure organisers can export or report on safety events for compliance or incident response.

---

### Summary

- **Immediate improvements** without new infra: structured severity/categories (§2), event-level policies (§3), dedicated safety call (§4), and storing a `reason` for every flag (§6).
- **Stronger safety**: gate content before storage (§1), vision-only safety pass (§7), and optional blocking with appeals (§6).
- **Operational and policy**: user reporting + AI triage (§5), abuse detection (§8), bias/false-positive handling (§9), and child-safety considerations (§10).

All of these can be implemented with the current **Mistral vision and chat APIs** (and JSON mode); the main work is prompt design, schema design, and product decisions (when to block vs flag, who can override, and what to log).

---

## Production

Deployed at **https://mistral.david-ma.net** via nginx reverse proxy on aang → katara (Tailscale).

See `docs/nginx-proxy-debug.md` for notes on nginx + host header configuration.
