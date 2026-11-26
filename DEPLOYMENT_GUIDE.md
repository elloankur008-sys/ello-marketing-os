# Ellocent Marketing OS v2.0 — Single-Shot Deployment Guide (Phase 1 + 2 + 3)

## Folder Structure Included in This Archive
```text
marketing-os/
├── index.html                              # Zero-inline-script app shell (CSP compliant)
├── netlify.toml                            # Security headers (CSP, HSTS, X-Frame-Options) & Functions config
├── package.json                            # ESM & @supabase/supabase-js dependency
├── .env.example                            # Environment variable template
├── DEPLOYMENT_GUIDE.md                     # This guide
├── assets/
│   ├── styles.css                          # Enterprise UI layout & design system
│   ├── data.js                             # Zero-demo baseline & 9-role RBAC permission matrix
│   └── app.js                              # Hybrid Local/Cloud engine, Realtime, Gemini AI, CSV & Composio UI
├── supabase/
│   └── schema.sql                          # PostgreSQL tables, append-only audit trigger & RLS policies
└── netlify/
    └── functions/
        ├── config.mjs                      # GET /api/config
        ├── ai-draft.mjs                    # POST /api/ai-draft (Server-side Gemini + policy & budget checks)
        ├── composio-link.mjs               # GET & POST /api/composio-link (Per-workspace OAuth Connect Links)
        ├── composio-hook.mjs               # POST /api/composio-hook (HMAC-verified real-time triggers & leads)
        └── sync-metrics-cron.mjs           # @hourly Scheduled Function (GSC / GA4 / Paid Ads sync)
```

---

## Step 1: Set Up Supabase Cloud Database & Security (3 Minutes)
1. Create a free project at **supabase.com**.
2. Open **SQL Editor → New Query**, paste the entire contents of `supabase/schema.sql`, and click **Run**.
3. Go to **Project Settings → API** and copy:
   - `Project URL` (`SUPABASE_URL`)
   - `anon public` key (`SUPABASE_ANON_KEY`)
   - `service_role` secret key (`SUPABASE_SERVICE_ROLE_KEY`)

---

## Step 2: Set Up Composio Real-Time Integrations (3 Minutes)
1. Sign in at **app.composio.dev** and copy your Project API Key (`COMPOSIO_API_KEY`).
2. Under **Auth Configs**, enable the toolkits you want (`hubspot`, `googlesearchconsole`, `googleanalytics`, `googleads`, `metaads`, `slack`) and note each Auth Config ID (`ac_...`).
3. Under **Triggers / Webhooks**, set your webhook destination URL to:
   `https://ello-marketing-os.netlify.app/api/composio-hook`
   and copy the signing secret (`COMPOSIO_WEBHOOK_SECRET`).

---

## Step 3: Add Environment Variables in Netlify
In **Netlify Dashboard → Project Configuration → Environment Variables**, add:
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `COMPOSIO_API_KEY`
- `COMPOSIO_WEBHOOK_SECRET`
- `COMPOSIO_AUTH_CONFIGS` (format: `hubspot:ac_xxx,googlesearchconsole:ac_xxx,googleanalytics:ac_xxx,googleads:ac_xxx`)
- `GEMINI_API_KEY`
- `PAGESPEED_API_KEY` (optional, increases Google Lighthouse quota)
- `WEBHOOK_SIGNING_SECRET` (any random 64-character hex string for direct website forms)

---

## Step 4: Deploy Everything Live Together
- **Recommended (GitHub / Netlify CLI):** Push the extracted `marketing-os/` folder to GitHub connected to `ello-marketing-os` (or run `npx netlify-cli deploy --prod`) so Netlify installs `@supabase/supabase-js` and deploys all 5 `netlify/functions/*.mjs` endpoints alongside your frontend.
- **Note on Drag-and-Drop:** Netlify's drag-and-drop uploader deploys static files (`index.html`, `assets/*`, `netlify.toml`) immediately for Phase 1, whereas Git-connected deploys or `netlify deploy --prod` bundle `netlify/functions/*` for Phase 2 & 3 serverless endpoints.
