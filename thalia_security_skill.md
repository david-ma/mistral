# Thalia Security (role-based) — skill reference for SmugMug

This doc describes how Thalia’s role-based security works so the SmugMug project can use it correctly and stay DRY.

## Overview

- **Auth:** Email + password logon; session stored in a cookie; logout clears the cookie.
- **Roles:** `admin`, `user`, `guest` (from `models/security-models.ts`).
- **Route protection:** `RoleRouteGuard` (in `server/route-guard.ts`) uses a list of **route rules** and the current user’s role to decide if a request is allowed. Unauthorized requests get 401 and the login view (`userLogin`).

## Where things live

| What | Where |
|------|--------|
| Security setup, logon/logout, default route rules | `server/security.ts` |
| Route rules type, `ThaliaSecurity`, `SecurityConfig` | `server/security.ts` |
| Route guard (session → user → permissions) | `server/route-guard.ts` |
| User/session/audit schemas | `models/security-models.ts` (Thalia); SmugMug re-exports via `master-schema` |
| Login template | `src/views/scaffold/userLogin.hbs` (Thalia); loaded as partial `userLogin` for 401 responses |

## Route rules (`RoleRouteRule`)

- **Type:** `path: string` + `permissions: Partial<Record<Role, Permission[]>>`.
- **Roles:** `admin`, `user`, `guest`.
- **Permissions:** `read`, `create`, `update`, `delete`, `manage`.
- **Matching:** Longest path prefix wins (e.g. `/album` before `/`). Key used in the guard is `host + pathname` (e.g. `localhost/album`).
- **Action → permission:** The guard maps the request “action” (e.g. `''`, `list`, `create`) to a permission (e.g. list → `read`, create → `create`). Default is `read`.

## Default security routes (from Thalia)

Thalia’s `security.securityConfig()` includes a `routes` array that:

- **`/`** — guest: all permissions (catch-all for login, home, etc.).
- **`/admin`** — admin only.
- **`/user`** — admin: all; user: read.
- **`/sessions`**, **`/audits`** — admin only.

Auth endpoints (`/logon`, `/logout`, `/newUser`, `/forgotPassword`, `/setup`) are handled by ThaliaSecurity controllers; they are not listed as separate route rules, so they fall under `/` and are allowed for guest so users can log in.

## SmugMug-specific routes

The SmugMug config merges with `security.securityConfig()` using `recursiveObjectMerge`. **Arrays (including `routes`) are concatenated**, so SmugMug adds extra rules without removing Thalia’s defaults. More specific paths (e.g. `/galleries`, `/album`) are matched before `/`, so:

- **Guest:** Can access `/`, `/logon`, `/logout`, `/newUser`, `/forgotPassword`, `/setup` (via `/` or direct handling).
- **User and admin:** Can access SmugMug paths such as `/galleries`, `/album`, `/create-album`, `/album-create`, `/album-edit`, `/list-smugmug-albums`, `/album-json`, `/uploadPhoto` when those paths have rules that grant the required permission to `user` and `admin`.
- **Admin only:** `/admin`, `/sessions`, `/audits` (from default routes).

Define these extra rules in SmugMug’s config as a `routes` array of `RoleRouteRule` objects (same shape as Thalia); import the type from `thalia/security` to stay DRY and type-safe.

## Config merge order

1. `security.securityConfig()` (machines: users, sessions, audits; controllers: logon, logout, …; **routes**: default_routes).
2. `recursiveObjectMerge(…, smugmugConfig)` → SmugMug’s `routes` are **appended** to the default routes.

No need to re-export or duplicate Thalia’s default route list; merging is enough.

## userLogin template

The 401 response body is rendered with `website.getContentHtml('userLogin')(…)`. Partials are loaded from Thalia’s `src/views` (including `scaffold/userLogin.hbs` → `userLogin`) and the website’s `src` (e.g. SmugMug’s). So SmugMug gets the login view from Thalia unless the project overrides it with its own `userLogin` partial.

## Known issues / caveats

- **UserAuth vs schema:** `getUserAuth` in the route guard may map to `isActive`, `isVerified`, `phone`; the Thalia schema uses `locked`, `verified` and has no `phone`. Any mapping or naming should be aligned with `models/security-models.ts` to avoid confusion.
- **Redirect after login:** There is no “redirect back to originally requested URL” after login; the user is sent to a fixed location.
- **Audits:** Login success/failure may not write into the audits table in all code paths; worth verifying if audit logging is required.

## Summary

- Use **ThaliaSecurity** and **recursiveObjectMerge(security.securityConfig(), smugmugConfig)** so Thalia provides auth and default routes.
- Add a **routes** array in SmugMug config with **RoleRouteRule** entries for `/galleries`, `/album`, `/create-album`, `/album-create`, `/album-edit`, `/list-smugmug-albums`, `/album-json`, `/uploadPhoto` (and any other SmugMug controllers), granting `user` and `admin` the needed permissions, and leave guest access only via `/` and auth endpoints.
- Import types (e.g. **RoleRouteRule**) from **thalia/security**; do not redefine Thalia’s default route list.

Analysis:

Auth system review

What’s in place

1. Models (`models/security-models.ts`)
• users: name, email, password, role (default 'user'), locked, verified, photo.
• sessions: sid (PK), userId, expires, data, loggedOut, timestamps.
• audits: userId, ip, sessionId, action, blob, timestamp.

So you have users, roles, and sessions; no phone, isActive, or isVerified on the user table (see bugs below).
2. Security service (`server/security.ts`)
• ThaliaSecurity wires users, sessions, audits, mail into the website config and exposes:
  • logon – GET shows login form, POST: email + password → lookup user → bcrypt.compare → create session → Set-Cookie: sessionId=... → redirect /.
  • logout – clear cookie, redirect /.
  • setup – “first run” if no admin exists (setup flow not fully implemented).
  • forgotPassword – stub (sends mail, no reset link).
  • newUser – shows “create account” view (no controller logic in security.ts).
• Roles: admin, user, guest (hardcoded in ALL_ROLES).
• Default routes: default_routes define path + permissions per role (Permission[]: create, read, update, delete). Longest-path match is used.

3. Route guard (`server/route-guard.ts`)
• RouteGuard – no-op (no auth).
• BasicRouteGuard – single password per route (salted cookie), optional proxy; uses partial `login` (password-only form).
• RoleRouteGuard – uses users + sessions and role-based permissions:
  • Loads routes from website.config.routes (same as BasicRouteGuard).
  • getUserAuth: reads sessionId cookie → join sessions + users → returns UserAuth (role, userId, name, email, …).
  • For the matched route, gets permissions = routeRule.permissions[userAuth.role] ?? routeRule.permissions.guest ?? [].
  • Action: CrudFactory.getAction(requestInfo) maps requestInfo.action (e.g. '', list, create, edit) to a Permission (read, create, update, delete).
  • If permissions.includes(action) → allow; else if guest → 401 + userLogin template; else “Access denied”.

So you do have a reusable flow: login (email + password, session cookie), role on user, and per-route, per-role permissions (path prefix + list of allowed actions).
4. Login UI
• userLogin (src/views/scaffold/userLogin.hbs): form POST to /logon, Email + Password, links to /newUser and /forgotPassword. Used by RoleRouteGuard and ThaliaSecurity logon.
• login partial (e.g. src/views/partials/login.hbs): single password, used by BasicRouteGuard for password-only routes.

5. When role guard is used
• In website.ts, RoleRouteGuard is chosen when the merged config has machines.users, machines.sessions, and machines.audits. So any site that merges ThaliaSecurity.securityConfig() and has those machines gets role-based auth.


────────────────────────────────────────



Gaps and bugs

1. UserAuth vs schema (route-guard.ts)
getUserAuth resolves result.users from the join but then assigns:
• isActive, isVerified, phone

Security-models only have:
• locked, verified, and no phone.

So either:
• Align code with schema: set isActive: !result.users.locked, isVerified: result.users.verified, and drop phone (or add it to the schema if you want it), or
• Align schema with code: add isActive, isVerified, phone to the users table.

Otherwise you risk runtime errors or wrong behaviour if anything reads those fields.
2. Logon redirect
• On success, logon always redirects to /. There’s no “redirect back to the page they tried to visit” (e.g. from a redirect query or form field). userLogin has a hidden Redirect and JS to set it from query params, but the server never reads it.
    So the reusable “login then return to requested URL” flow is only half there.

3. Route rule shape
• RoleRouteRule extends RouteRule and adds path and permissions: Partial<Record<Role, Permission[]>>.
• RouteRule in types has optional path, password, proxyTarget, domains. So path + permissions are there.
• Default routes only define /, /admin, /user, /sessions, /audits. For a site like smugmug you must add your own routes (e.g. path: '/galleries', path: '/album', …) and give user/admin the right permissions; otherwise the guard falls back to
  the catch-all / rule (guest has full permissions in default_routes, so everything would be open).

4. Action mapping for custom controllers
• getAction is CRUD-oriented: action values like list, new, create, edit, update, delete, columns map to read/create/update/delete; default is `read`.
• For paths like /galleries or /galleries/, requestInfo.action is often '', so it becomes 'list' → read.
• So “who can read this path?” is determined by whether the matched route grants that role ['read'] (or more). That’s enough for “require login for /galleries and /album” by giving those paths user: ['read'] (and optionally admin: 
  ['read','create','update','delete']).
• There’s no built-in way to say “this path requires permission X” for custom permission names; you’re limited to the CRUD actions. For most “require login / require admin” cases, that’s sufficient.

5. Templates and website root
• userLogin is loaded with website.getContentHtml('userLogin'). That usually resolves from the website’s views (e.g. websites/smugmug/src/), not only from Thalia’s scaffold. So the site can override the login page. If a site doesn’t have
  userLogin, it may fall back to a shared one if the loader supports that; worth confirming where the fallback lives so smugmug (or any site) can rely on a consistent login UI.

6. Audits
• Audits table exists and is registered, but the logon controller doesn’t write to it. So you don’t yet have “who logged in when” or “who attempted and failed” in the same reusable system.


────────────────────────────────────────



Summary

• Reusable pieces: Login (email + password, session cookie), roles (admin / user / guest), and “which role can do which action on which path” via config.routes and RoleRouteGuard are in place and reusable.
• Declaring access: You declare route access by adding RoleRouteRule-style entries to config.routes (path prefix + permissions per role). Longest path wins.
• What still needs work:
  • Fix UserAuth vs security-models (locked/verified vs isActive/isVerified/phone).
  • Implement redirect after login (use query or body redirect and send user back to the requested URL).
  • Per-site route definitions for protected paths (e.g. smugmug: /galleries, /album, /create-album, etc.) and ensuring /logon, /logout, /newUser, /forgotPassword stay allowed for guest.
  • Optionally: use audits in the logon flow and clarify userLogin template resolution so every site has a predictable login page.

If you want, next step can be: (1) patch UserAuth/join to match the current schema and (2) add a minimal routes set for smugmug so galleries/album/create-album require a logged-in user (and logon/logout stay public).
