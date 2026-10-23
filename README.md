# Solace

A private journal that remembers. You write the way you would in a notebook; Solace keeps track of the people, places and patterns in your entries. Later you can ask your past a question and get an answer drawn only from what you wrote, with links back to the entries it used.

## What it does

- **Today**: a quiet editor that saves as you type. Drafts live on your device first, so nothing is lost offline, on reload, or when your session expires. Comes with a daily question, a mood you can set or accept from Solace, tags and photos.
- **Journal**: a timeline and calendar of everything you've written. Search by meaning ("when did I feel settled?") or by exact words.
- **Reflect**: ask questions about your own life. Answers stream in, cite the entries they come from, and say plainly when your journal doesn't cover something.
- **Insights**: a year heatmap, writing streaks, mood over time, a weekly letter that sums up your week, and a constellation of the people and places that recur.
- **What Solace remembers**: every long-term memory Solace has formed is listed, and you can edit, archive or delete any of them.
- **Your data**: export everything as Markdown or JSON, or delete your account and all of its data.

## How it's built

```
apps/web         React 19 · Vite · React Router · TanStack Query · Tailwind v4   → Vercel
apps/api         Node 24 · Express 5 · Drizzle ORM · Postgres + pgvector · Gemini → Render
packages/shared  zod schemas: the one API contract both apps compile against
```

- **Auth and storage**: Supabase Auth (email/password, magic link, Google) and a private Supabase Storage bucket. The API verifies Supabase access tokens and serves photos only through short-lived signed URLs.
- **Database**: Postgres with pgvector, schema and migrations in `apps/api/drizzle`. Every table has row-level security enabled with no policies, so Supabase's public Data API can't read anything. Only the API, connecting as the owner, touches data, and every query is scoped to the signed-in user.
- **AI off the request path**: saving an entry is a plain database write. A durable job queue in Postgres then analyses mood and tags, splits the entry into passages, embeds them, and updates memories and the constellation. Jobs retry with backoff and never invent results when the model is unavailable.
- **Search** fuses vector similarity (HNSW) with Postgres full-text ranking using reciprocal rank fusion. When AI is unavailable it falls back to exact-word results.
- **Reflect** retrieves relevant passages and memories, passes them to Gemini as clearly delimited data (instructions inside journal text are ignored), and streams the answer over Server-Sent Events.

## Running it locally

Requirements: Node 22+ (24 recommended), Docker.

```bash
npm install

# 1. Supabase locally: auth, storage and a Postgres with pgvector.
npm run supabase:start          # prints the API URL, anon key and service-role key

# 2. Environment
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env
#   apps/api/.env  DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55322/postgres
#                  SUPABASE_SERVICE_ROLE_KEY=<service_role key>
#                  SUPABASE_JWT_SECRET=<JWT secret>   (the local stack signs with HS256)
#                  GEMINI_API_KEY=<your key>          (https://aistudio.google.com/apikey)
#   apps/web/.env  VITE_SUPABASE_ANON_KEY=<anon key>

# 3. Database schema
npm run db:migrate

# 4. API on :8787 and web on :5173
npm run dev
```

Local Supabase uses ports 553xx (see `supabase/config.toml`) because Windows often reserves the default 543xx range. Sign-up emails are caught by the local mail viewer that `supabase:start` prints.

## Tests

```bash
npm run db:up        # throwaway pgvector Postgres on :55432 for API integration tests
npm run db:migrate   # with DATABASE_URL=postgres://solace:solace@localhost:55432/solace
npm test             # shared + API (real Postgres, Gemini faked) + web unit tests
npm run e2e          # Playwright smoke tests with axe accessibility checks
npm run typecheck && npm run lint
```

## Deploying

**API on Render.** `render.yaml` is a blueprint. Create a Blueprint instance from this repo and fill in the secrets:

| Variable                    | Value                                                                            |
| --------------------------- | -------------------------------------------------------------------------------- |
| `DATABASE_URL`              | Supabase → Connect → _Session pooler_ URI (IPv4-compatible)                      |
| `SUPABASE_URL`              | `https://<project>.supabase.co`                                                  |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Project Settings → API keys                                           |
| `WEB_ORIGIN`                | your Vercel URL, e.g. `https://solace.vercel.app` (comma-separate extra origins) |
| `GEMINI_API_KEY`            | server Gemini key from a **paid** (billing-enabled) project; see Privacy below   |
| `AI_TIER`                   | `free` (default) or `paid`; set to match the key, and set `VITE_AI_TIER` the same |

Migrations run at the start of every deploy, before the server boots. Health check: `GET /api/healthz`.

**Web on Vercel.** Import the repo with **Root Directory** set to `apps/web`, then set:

| Variable                 | Value                                                  |
| ------------------------ | ------------------------------------------------------ |
| `VITE_API_URL`           | the Render URL, e.g. `https://solace-api.onrender.com` |
| `VITE_SUPABASE_URL`      | `https://<project>.supabase.co`                        |
| `VITE_SUPABASE_ANON_KEY` | the project's anon (publishable) key                   |
| `VITE_AI_TIER`           | `free` (default) or `paid`; must match the API's `AI_TIER` (the public pages read this one) |

`apps/web/vercel.json` sets a strict Content-Security-Policy. Its `connect-src` must list your API's real origin (currently `https://solace-api-vsac.onrender.com`).

**Supabase project.**

- Enable the Email and Google providers.
- Set the Site URL to your Vercel domain and add `https://<domain>/auth/callback` as a redirect URL.
- Configure custom SMTP, because the built-in mailer is heavily rate-limited.
- Create a **private** bucket named `attachments`.

## Privacy

Entries, photos and memories are stored in your Supabase project's Postgres and Storage, which are encrypted at rest. Photos are re-encoded on upload, which strips location and camera metadata, and they are only reachable through links that expire after an hour. Text sent to Google Gemini for analysis, search and Reflect is processed under Google's API terms. **Run production on a paid Gemini API key**, because Google's free tier may use submitted content to improve its products and the paid tier does not. Solace itself never trains on your entries and never sells data. Users who bring their own key in Settings are covered by that key's terms. Export or delete everything from Settings at any time.

---

Built with care for people who write things down.
