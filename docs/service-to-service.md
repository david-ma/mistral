# Service-to-service: calling SmugMug Thalia from another app

How another Thalia app (or any HTTP client) can call this project’s endpoints so they can use SmugMug uploads without duplicating code.

---

## 1. Routing by host: use `X-Host` when calling by IP/port

Thalia chooses which **website** (which config/controllers) to run using the request **host**. It derives host from, in order:

1. **`X-Host`** header (if present)
2. **`Host`** header
3. Fallback `'unknown-host'`

The **domain** used for routing is the host with the port stripped (e.g. `smugmug.david-ma.net`).

So you can call Thalia on a single port and still hit the SmugMug site by setting **`X-Host`** to one of that site’s configured domains (e.g. `smugmug.david-ma.net` or `localhost` if that’s in the site’s `domains` in config).

**Example (same machine, different process):**

```bash
# Thalia is listening on 127.0.0.1:1337 with multiple sites. Route to the SmugMug site:
curl -X POST http://127.0.0.1:1337/uploadPhoto \
  -H "X-Host: smugmug.david-ma.net" \
  -H "Content-Type: application/json" \
  -d '{"uploadThingUrl":"https://...","albumKey":"jHhcL7","filename":"photo.jpg"}'
```

**Example (from another Node/Bun service):**

```ts
const base = process.env.SMUGMUG_SERVICE_URL ?? 'http://127.0.0.1:1337'
await fetch(`${base}/uploadPhoto`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-Host': 'smugmug.david-ma.net',  // or whatever domain the smugmug config lists
  },
  body: JSON.stringify({
    uploadThingUrl: fileUrl,
    albumKey: targetAlbumKey,
    filename: 'photo.jpg',
    fileKey: fileKey,
    size: size,
  }),
})
```

**Important:** The value of `X-Host` must match a **domain** in the target site’s `config.domains` (e.g. in smugmug’s config, `domains: ['localhost']` or `['smugmug.david-ma.net']`). Use that same string so the router selects the right website.

---

## 2. Port: not in `config.ts`

The **port** Thalia listens on is set when the **server** is started (e.g. by the CLI or your start script), not by the website’s `config/config.ts`. So:

- **Same process:** The other “service” is just another controller or route in the same Thalia process; no HTTP, no port.
- **Same machine, different process:** The calling app needs the **base URL** of the Thalia server (host + port). Options:
  - **Env:** e.g. `PORT=1337` when you start Thalia, and `SMUGMUG_SERVICE_URL=http://127.0.0.1:1337` (or `http://127.0.0.1:${process.env.PORT}`) in the caller.
  - **Convention:** e.g. “SmugMug Thalia always runs on 1337” and the caller hardcodes or configures that.
- **Different server:** The caller uses the full public URL (e.g. `https://smugmug.david-ma.net`) and no `X-Host` spoofing is needed.

So: **config doesn’t expose the port**; the caller gets the Thalia base URL from env or deployment config.

---

## 3. How much communication is needed?

For “other app uploads a file to SmugMug via this service”:

| Flow | Calls from caller to this service |
|------|-----------------------------------|
| **Caller has a URL** (e.g. from UploadThing) | **1 request:** `POST /uploadPhoto` with JSON `{ uploadThingUrl, albumKey, filename?, fileKey?, size? }`. This service fetches the file, uploads to SmugMug, returns `{ thumbnailUrl, url }`. |
| **Caller has a file and wants UploadThing + SmugMug** | **2 requests:** (1) `POST /api/uploadthing?actionType=upload&slug=smugmugImage` (with body as the UploadThing client does) to get presigned URL; caller uploads file to that URL; (2) `POST /uploadPhoto` with the resulting file URL and `albumKey` (and optional `fileKey`, `size`). |

So: **one HTTP request** per “send this (by URL) to SmugMug”; or **two** if the caller also gets the upload URL from this service. No long-lived or chatty protocol.

---

## 4. Auth / security

- **`/uploadPhoto`** and **`/api/uploadthing`** are protected by Thalia’s route guard. For **browser** requests, the session cookie identifies the user. For **service-to-service** calls there is no browser cookie.
- Options:
  - **Allow guest for `/api/uploadthing`** (already done for UploadThing callbacks). That does **not** by itself allow arbitrary callers to hit `/uploadPhoto`.
  - **Service secret:** Add a shared secret (e.g. `Authorization: Bearer <secret>` or a custom header). In the smugmug config, a middleware or the `uploadPhoto` controller checks the header and skips or bypasses the login requirement when the secret matches. (Not implemented here; you’d add it.)
  - **Internal only:** Run Thalia and the caller on the same host and only bind to 127.0.0.1 so only local processes can call it; rely on network isolation instead of auth.
  - **Dedicated service user:** Give the caller a real Thalia user/session (e.g. cookie or token) and use existing route permissions.

So: **minimal communication** (1–2 requests), but you still need to decide how the caller is **authorised** (secret header, internal network, or user auth).

---

## 5. Summary

- **Exposing endpoints:** They’re normal HTTP; other services call the same Thalia base URL and paths (`/uploadPhoto`, `/api/uploadthing`, etc.).
- **Routing to this site when multiple sites share one port:** Set **`X-Host`** to a domain in this project’s `config.domains` (e.g. `smugmug.david-ma.net` or `localhost`) and call `http://127.0.0.1:<PORT>` (or the correct host).
- **Port:** Not in `config.ts`; it’s set at server start. Caller gets base URL from env or deployment (e.g. `SMUGMUG_SERVICE_URL` or `PORT`).
- **Code change:** Thalia’s `handleRequest` now uses `requestInfo.domain` (which respects `X-Host`) when choosing the website, so `X-Host` spoofing works for routing.
