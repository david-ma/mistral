# Bingo — Mistral Hackathon 2026

Built at the **Mistral AI Hackathon**, hosted at UNSW Founders, Sydney — 28 February–1 March 2026.

A huge thank you to **UNSW Founders** for providing the space, and to our sponsors **Mistral AI** for the challenge and API access.

---

## What is this app?

**Bingo** is a crowd-sourced photo collection tool for event organisers.

The idea: instead of hoping attendees will share photos after the event, give everyone a personalised **bingo card** at the start. Each cell on the card has a prompt — *"Photo with someone from Mistral"*, *"Photo of your team's project board"*, *"Photo of lunch"* — and attendees fill their card by taking photos throughout the day.

When a photo is uploaded, **Mistral's vision API** analyses it and writes a description, which is saved alongside the image. Organisers can then browse all submitted photos grouped by prompt, making it easy to find the best shots of each moment.

---

## How Bingo works

1. **Organiser creates an event** — they give it a name, choose a grid size (3×3 or 5×5), and write a list of photo prompts.
2. **Attendees join** — visiting the event page generates a personal bingo card with a randomised selection of prompts. The centre cell is always a free space.
3. **Fill the card** — tapping a cell opens the camera or file picker. The photo is uploaded, then the server fetches it and sends it to Mistral for a description.
4. **Organisers review** — the admin view shows every card submitted and a prompt-by-prompt breakdown of all photos, so nothing gets lost.

---

## Tech stack

- **[Thalia](https://github.com/david-ma/Thalia)** — Node.js/Bun framework (TypeScript, Handlebars, Drizzle ORM, Socket.IO)
- **Mistral AI** — vision model for describing uploaded photos
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
export const BINGO_ALBUM_KEY = '...'   // optional SmugMug album
export const smugmug = { consumer_key, consumer_secret, oauth_token, oauth_token_secret }
```

---

## Production

Deployed at **https://mistral.david-ma.net** via nginx reverse proxy on aang → katara (Tailscale).

See `docs/nginx-proxy-debug.md` for notes on nginx + host header configuration.
