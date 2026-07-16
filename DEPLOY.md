# Deploy

**Status: not deployed.** No deploy CLI (`railway`/`flyctl`/`render`/`vercel`), no deploy
tokens, and no Docker daemon are available in the build environment, so this could not be
executed here. Everything below is prepared so it is one command for you.

Pick ONE platform. Railway is the least work for a containerized Node service.

---

## 0. Prerequisite — the env vars

Every variable is documented in `.env.example`. Five are required:

| Variable | Value |
|---|---|
| `OPENAI_API_KEY` | your key |
| `SUPABASE_URL` | `https://fcaabusbifitsovlpjdy.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | the service_role key (NOT the anon key) |
| `ALLOWED_ORIGINS` | `https://preacademy.app.clientclub.net` |
| `PORT` | platform-injected; the app reads `process.env.PORT` |

`EMBEDDING_MODEL` must stay `text-embedding-3-small` or the app refuses to boot
(`assertRuntimeConfig`) — the `documents` table was embedded with it.

> The OpenAI key was exposed in chat earlier in this project. Rotate it before deploying.

---

## Option A — Railway (recommended)

```bash
npm i -g @railway/cli
railway login
railway init                      # from the repo root; pick "Empty Project"
railway up                        # builds the Dockerfile and deploys

# set env vars (or paste them in the Railway dashboard -> Variables)
railway variables --set OPENAI_API_KEY=sk-...
railway variables --set SUPABASE_URL=https://fcaabusbifitsovlpjdy.supabase.co
railway variables --set SUPABASE_SERVICE_ROLE_KEY=eyJ...
railway variables --set ALLOWED_ORIGINS=https://preacademy.app.clientclub.net

railway domain                    # generates the public URL
```

`railway.json` in this repo pins the Dockerfile build and the health check.

## Option B — Fly.io

```bash
brew install flyctl
fly auth login
fly launch --no-deploy            # fly.toml is already committed; keep it
fly secrets set OPENAI_API_KEY=sk-... \
  SUPABASE_URL=https://fcaabusbifitsovlpjdy.supabase.co \
  SUPABASE_SERVICE_ROLE_KEY=eyJ... \
  ALLOWED_ORIGINS=https://preacademy.app.clientclub.net
fly deploy
```

## Option C — Render

Push the repo to GitHub, then in Render: **New > Blueprint**, point it at this repo.
`render.yaml` declares the service; fill the four secrets marked `sync: false` in the
dashboard.

---

## 1. Verify the deployment (required — do not skip)

Substitute your real URL. **These are the checks that the previous build failed.**

```bash
# health
curl -i https://<your-deploy-url>/health
# expect: HTTP/1.1 200  {"status":"ok"}

# CORS preflight — THE one that broke the old widget (it returned 500)
curl -i -X OPTIONS https://<your-deploy-url>/chat \
  -H "Origin: https://preacademy.app.clientclub.net" \
  -H "Access-Control-Request-Method: POST" \
  -H "Access-Control-Request-Headers: content-type"
# expect: HTTP/1.1 204
#         access-control-allow-origin: https://preacademy.app.clientclub.net
#         access-control-allow-methods: POST, OPTIONS
#         access-control-allow-headers: content-type

# a disallowed origin must get NO allow-origin header (never "*")
curl -i -X OPTIONS https://<your-deploy-url>/chat -H "Origin: https://evil.example.com"
# expect: 204 with NO access-control-allow-origin

# a real deal, end to end
curl -s -X POST https://<your-deploy-url>/chat \
  -H "Origin: https://preacademy.app.clientclub.net" \
  -H "content-type: application/json" \
  -d '{"message":"Flip: 350k purchase, 75k rehab, 600k ARV, 4 months","session_id":"smoke-1"}'
# expect: {"output":"...$101,916...","tool_calls":["flip_calculator"]}
```

If the last one returns `101,916`, the whole chain works: CORS, agent, typed tool schema,
calculator, memory, logging.

## 2. Run the live suite against the deployment

```bash
npm run test:live     # RUN_LIVE_TESTS=1; 17 tests, real model, ~3 min, costs API credits
```

These currently run against a locally-built server using the same code and credentials.
Point them at the deployment by running from a machine with the same `.env`.

## 3. Wire up the widget in GHL

Put this in **Settings > Business Profile > Header Tracking Code** (NOT the lesson body —
GHL strips `<script>` there):

```html
<script src="https://<your-deploy-url>/widget.js"></script>
<script>
  (function () {
    var email = 'unknown';
    try { email = (JSON.parse(localStorage.getItem('common') || '{}').email) || 'unknown'; } catch (e) {}
    window.createJamesBot({
      apiUrl: 'https://<your-deploy-url>',
      target: '#james-bot',
      memberEmail: email
    });
  })();
</script>
```

Then drop `<div id="james-bot" style="height:600px"></div>` into any lesson body.

`{{contact.email}}` does not interpolate in the header, which is why the email is read from
`localStorage.getItem('common')`.

## 4. After deploy — update ALLOWED_ORIGINS

If the widget is embedded on any domain besides `preacademy.app.clientclub.net`, add it to
`ALLOWED_ORIGINS` (comma-separated). A missing origin = preflight with no ACAO header =
the widget silently fails to send. Never use `*`.
