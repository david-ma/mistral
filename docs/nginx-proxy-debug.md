# Bingo / app fails behind nginx at mistral.david-ma.net

## Symptom

- **Works:** `http://localhost:1337/bingo/14` and `http://100.116.54.46:1337/bingo/14`
- **Fails:** `https://mistral.david-ma.net/bingo/14` (routed through nginx to the same app)

Websocket test works at `https://mistral.david-ma.net/websocket-test.html`, so the problem is not HTTPS or WebSockets in general.

**Debug visibility:** When the request fails via nginx, there is no clear debug message in the app to know which step is failing (e.g. route guard vs controller). If the route guard rejects the request (wrong host), the app’s controllers never run, so you only see framework/guard behaviour (e.g. 401) and must infer the cause from the doc below and from running the tests.

## Likely cause: Host header

Thalia’s **route guard** decides permissions by matching **host + pathname** to configured routes. The host comes from the HTTP request (see below). When nginx proxies to the backend, it often sends the **upstream** host (e.g. `127.0.0.1:1337` or `localhost:1337`) in the `Host` header instead of the original host the user used (`mistral.david-ma.net`). Then:

- Route keys look like `mistral.david-ma.net/bingo`, `localhost/bingo`, etc. (from `config.domains` + route path).
- Incoming request is treated as `127.0.0.1:1337/bingo/14` (or similar).
- No route matches → no permissions → **401** and the login page is sent.

So the app “doesn’t work” because the server thinks the request is for a host that isn’t in the route table.

## Other possibilities (ideas)

1. **Host header (most likely)**  
   Nginx forwards the request to the backend with `Host: 127.0.0.1:1337` (or similar). The route guard compares `requestInfo.host` to `config.domains`; no match → no permissions → 401. Fix: nginx sends `Host $host` or `X-Forwarded-Host $host` and Thalia uses that for the effective host.

2. **Mixed content**  
   If the HTML or JS requested something over `http://` while the page is `https://`, the browser could block it. Less likely if all links/fetches are relative (`/api/...`).

3. **Cookies (Secure / SameSite)**  
   If the app sets cookies without `Secure` or with wrong domain/path, they might not be sent on HTTPS. That could break session/auth, but the main issue above (no route match) would already cause 401 before auth.

4. **Line 146 in config.ts**  
   `nodeRequestToFetch` builds a `Request` with `url = http://${host}${req.url}`. That is only used for the **UploadThing** route handler (so the server can call itself). It does not affect the route guard or the host used for permission checks. Toggling `http` vs `https` there typically doesn’t change the bingo failure.

5. **Port in domain list**  
   `config.domains` includes `mistral.david-ma.net` (no port). When the browser requests `https://mistral.david-ma.net/bingo/14`, the `Host` header is usually `mistral.david-ma.net` (no port). If nginx or the app ever saw `mistral.david-ma.net:443`, that would not match. Ensure the effective host the app sees is exactly one of the configured domains (e.g. `mistral.david-ma.net`).

## What to do

### 1. Confirm what host the server sees

- Use the **diagnostic endpoint**:  
  `GET https://mistral.david-ma.net/api/diagnose`  
  If you get **401**, the request never reaches the API (route guard rejects it); that strongly suggests the server is seeing the wrong host (e.g. `127.0.0.1:1337`).
- Check **server logs**: we log each request as `host` + URL. Look for the host value when you open `https://mistral.david-ma.net/bingo/14`.

### 2. Fix nginx: send the original host

In the `location` block that proxies to Thalia, set the host to the original request host:

```nginx
proxy_set_header Host $host;
# Optional but recommended for apps that care about proto or host:
proxy_set_header X-Forwarded-Proto $scheme;
proxy_set_header X-Forwarded-Host $host;
```

Then **restart or reload nginx**. After this, the backend should see `Host: mistral.david-ma.net` and the route guard should match.

### 3. Fix in Thalia: trust X-Forwarded-Host when present

Thalia’s server (in `server/server.ts`) now resolves the request host in this order:

1. **`X-Forwarded-Host`** (set by nginx when using `proxy_set_header X-Forwarded-Host $host`)
2. **`X-Host`** (for service-to-service)
3. **`Host`**

So if nginx sends `X-Forwarded-Host: mistral.david-ma.net`, the route guard will see that host and match the route even when `Host` is the upstream address.

## Debug and tests

### Diagnostic endpoint: `GET /api/diagnose`

Returns JSON with the host and pathname the server saw, the configured domains, whether the current host is in the list, and **raw request headers** (Host, X-Forwarded-Host, X-Forwarded-Proto) so you can see exactly what the app received.

- If you get **401** when opening `https://mistral.david-ma.net/api/diagnose` in the browser, the request never reached the API; the server is seeing a host that doesn’t match any domain (e.g. `127.0.0.1:1337`). Fix nginx (send `Host` or `X-Forwarded-Host`) or ensure the server uses `X-Forwarded-Host` (already implemented).
- From the **server** you can test with:  
  `curl -s -H "Host: mistral.david-ma.net" http://127.0.0.1:1337/api/diagnose`  
  to see the diagnostic without going through nginx.

### App debug logs

When a request **reaches** the app controllers, you will see:

- `[api] request host=... pathname=...` for any `/api/*` request (including `/api/diagnose`).
- `[bingo] request host=... pathname=...` when the bingo page controller runs.

If you hit `https://mistral.david-ma.net/bingo/14` and get 401 with **no** `[api]` or `[bingo]` log line, the request was rejected by the route guard (wrong host) before any controller ran.

### Route guard debug (Thalia)

When no route matches, a line is logged:  
`[route-guard] No matching route: host=... pathname=... fullpath=...`  
When a route matches:  
`[route-guard] Matched route: fullpath=... -> path=...`  
When a guest is sent 401:  
`[route-guard] 401 guest: host=... pathname=... action=... permissions=...`

Check the server log when you load `https://mistral.david-ma.net/bingo/14` for the `host=` value in these lines.

### Copy-paste tests

Run these from the **machine where the app runs** (so the app is on port 1337). Replace `1337` if your app uses another port.

```bash
# 1. Wrong host (simulates nginx not forwarding Host) – expect 401 or wrong host in response
curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:1337/api/diagnose
# If 200, inspect body: curl -s http://127.0.0.1:1337/api/diagnose

# 2. Correct host (what we want nginx to send) – expect 200 and hostInDomains: true
curl -s -H "Host: mistral.david-ma.net" http://127.0.0.1:1337/api/diagnose

# 3. With X-Forwarded-Host (if Thalia trusts it)
curl -s -H "Host: 127.0.0.1:1337" -H "X-Forwarded-Host: mistral.david-ma.net" http://127.0.0.1:1337/api/diagnose

# 4. Bingo page with correct host – expect 200 HTML
curl -s -o /dev/null -w "%{http_code}" -H "Host: mistral.david-ma.net" http://127.0.0.1:1337/bingo/14
```

A script that runs these is in `scripts/test-nginx-debug.sh`.
