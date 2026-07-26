# Email Outreach Tool

A single-user tool that scrapes local business leads from Google Maps, enriches each lead by
reading their website, drafts a 3-email AI-personalized outreach sequence the moment a lead
qualifies, and lets you review/confirm a batch before it sends automatically — within US
business hours, rotating across your Gmail and Apify accounts, with daily caps, randomized
pacing, automatic follow-ups, reply/bounce detection, duplicate prevention, and spam/
deliverability protection built in.

Runs locally (SQLite-free — it uses Postgres via Supabase even for local dev) or deployed to
Vercel with a Supabase-backed Postgres database and a login gate. There's no public sign-up —
it's built for one person running their own outreach, with a single account you provision
yourself.

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Set up a Supabase project (the database)

1. Create a project at [supabase.com](https://supabase.com).
2. Open **SQL Editor** and run the contents of `prisma/migrations/20260726210000_baseline/migration.sql`
   (or any current migration file, if you're setting this up fresh — see `prisma/migrations/`
   for the full history) to create all tables.
3. Copy the **Transaction pooler** connection string (Project Settings → Database → Connection
   string → URI, port 6543) into `.env` as `DATABASE_URL` (see `.env.example`). Append
   `?pgbouncer=true`.
4. Run `npx prisma generate` once so the Prisma client matches the schema.

If you ever need to run a migration (`prisma migrate resolve`, etc.) rather than just querying,
temporarily swap the connection to the **Session pooler** (same host, port 5432) — the
transaction-mode pooler on 6543 doesn't support the session-level operations migrations need.

### 3. Configure `.env.local`

Copy the template and fill it in:

```bash
cp .env.local.example .env.local
```

- **`ENCRYPTION_KEY`** — a 64-char hex string used to encrypt API keys/tokens at rest in the
  database. Generate one with:
  ```bash
  node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
  ```
- **`GOOGLE_OAUTH_CLIENT_ID`** / **`GOOGLE_OAUTH_CLIENT_SECRET`** — needed to connect Gmail
  sender accounts. See step 6 below.
- **`APP_BASE_URL`** — `http://localhost:3000` locally, your real domain once deployed. The
  Gmail OAuth redirect URI is built from this.
- **`CRON_SECRET`** — required once deployed (see Deployment below); any random hex string.
- **`NEXT_PUBLIC_SUPABASE_URL`** / **`NEXT_PUBLIC_SUPABASE_ANON_KEY`** — for the login gate.
  Find both in Supabase: Project Settings → API.

### 4. Create your login account

In Supabase: **Authentication → Users → Add user**. Enter your email + a password, and check
"Auto Confirm User." This is the only account that can log in — there's no public sign-up form.

### 5. Apify (Google Maps scraping)

1. Create one or more accounts at [apify.com](https://apify.com) and grab an API token from
   each (multiple accounts let scraping rotate to the next one once one is used up).
2. Add each token in **Settings → Apify → Add an Apify account**, with an optional label and a
   lead-count limit per account (default 1000).

The app uses the `compass/crawler-google-places` (Google Maps Scraper) actor, captures each
result's Google Place ID for cross-run duplicate detection, and can automatically split a large
search into a grid of non-overlapping map tiles to get past Google Maps' ~120-results-per-query
cap (see **Reliability** below).

### 6. Gmail sender accounts (OAuth)

1. In [Google Cloud Console](https://console.cloud.google.com), create a project (or reuse
   one) and enable the **Gmail API**.
2. Configure an OAuth consent screen (External is fine for personal use; add your own Gmail
   accounts as test users if it stays in "Testing" mode).
3. Create an **OAuth 2.0 Client ID** (type: Web application) with an authorized redirect URI
   of `{APP_BASE_URL}/api/gmail/oauth/callback`.
4. Put the client ID/secret into `.env.local`.
5. In the app, go to **Settings → Gmail Accounts → Connect Gmail Account** for each sending
   account (2–3 lets the app spread sending campaigns across them and stay well under Gmail's
   own limits).

Required scopes (`gmail.send`, `gmail.modify`, `userinfo.email`) are requested automatically.

### 7. Google Sheets export

1. In Google Cloud Console, create a **Service Account** and download its JSON key.
2. Create a Google Sheet and share it (Editor access) with the service account's email address.
3. Paste the full JSON key contents and the Sheet's ID (from its URL) into
   **Settings → Google Sheets**.

The app writes into whichever tab is actually first in your spreadsheet, and keeps every
lead's row in sync in real time as it moves through enrichment, drafting, and sending.

### 8. LLM provider

Add either an Anthropic or an OpenAI API key in **Settings → LLM**, and pick which one is
active. It's used to score/summarize each lead's website and to draft the 3-email sequence.

### 9. Your profile

Fill in **Settings → Profile** (name, role, company, bio, tone, and optional default
email-writing instructions). This is what the AI uses to write emails "as you."

### 10. Limits

**Settings → Limits** controls: scrape/global send limits, **per-account daily send caps split
by sequence stage** (cold / follow-up-2 / follow-up-3, independently — an account can send up to
each cap on the same day), the **business-hours window** (default 9am–5pm Eastern) that
automatically-scheduled sends are bumped into, follow-up spacing in days, randomized pause
ranges, and the spam-score threshold/action.

## Running it locally

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). The background scheduler (send dispatch,
follow-up scheduling, reply/bounce detection) only runs while this process is up — anything
that became due while it was down fires on the next startup instead of being skipped.

## Deployment (Vercel)

1. Push this repo to GitHub and import it into a new Vercel project.
2. Add every variable from `.env` and `.env.local` as Vercel environment variables (Production).
   Set `APP_BASE_URL` to your real Vercel domain once you know it, and update the Google Cloud
   Console OAuth redirect URI to match.
3. Vercel's free (Hobby) plan only supports daily-granularity cron, which isn't enough for this
   app's pacing — instead, set up a free account at [cron-job.org](https://cron-job.org) (or
   similar) to hit `GET https://your-app.vercel.app/api/cron/tick?secret=<CRON_SECRET>` every
   minute. This replaces the local in-process scheduler in production.
4. The headless-browser fallback used for Cloudflare-protected sites during enrichment runs on
   `@sparticuz/chromium` automatically when `process.env.VERCEL` is set — no extra config needed.

## How a campaign flows

1. **Dashboard → New Scrape** — business type, location, lead limit, and how to cover the area:
   **Auto-split** (recommended — automatically divides the area into a non-overlapping search
   grid sized to your limit, digging deeper into dense clusters), **Manual** (you list specific
   zip codes/areas yourself), or **Off** (a single search). Apify accounts rotate automatically
   if one runs out of capacity or hits a real quota error mid-scrape. Results already in your
   pipeline (matched by Google Place ID) are skipped; new leads sync to your Sheet as found.
2. **Run detail page → Enrich All Pending** — crawls each lead's website (falling back to a
   real headless browser if the site blocks plain requests, e.g. a Cloudflare challenge) for a
   LinkedIn URL, a published founder/CEO or general contact email (never guessed — checked
   against JSON-LD structured data too, not just visible links), an AI business summary, a
   0–100 fit score, and a free deliverability check (syntax + MX record).
3. **Automatic drafting** — the moment a lead's enrichment finishes and it qualifies (email
   found + fit score ≥ 50, not bounced/invalid), all 3 emails (cold + 2 follow-ups) draft
   automatically and sync to your Sheet. No manual "write emails" step.
4. **Sending Campaigns tab → Create Campaign** — pull N leads from the global pool of fresh,
   qualified, never-yet-used leads (hottest fit score first), automatically assigned round-robin
   across your active Gmail accounts (that same account handles all 3 emails for each lead —
   never a different sender mid-thread).
5. **Preview & edit** — review every lead's email (all 3 in the sequence), summary, and
   recipient address before anything is scheduled. Nothing sends until you click **Confirm &
   Schedule**.
6. **Confirm & Schedule** — creates the actual scheduled sends, automatically spread across
   business-hours days per account so no account exceeds its daily cold-email cap; the
   background scheduler then dispatches them one at a time with randomized pacing.
7. Follow-ups schedule themselves automatically after each send (spaced by your configured days,
   also bumped into business hours), pinned to the same sender — unless a reply or bounce comes
   in first, which cancels anything still pending for that lead.
8. **Summary tab** shows totals across every run: leads scraped, sends, follow-ups by sequence,
   replies, and a per-sender table. **Stats page** shows the day-by-day send history chart.

## Reliability — how the system protects your sender reputation and coverage

- **Duplicate lead prevention (scrape time)** — every scraped business's Google Place ID is
  checked before a new lead row is created, including across grid-search tiles and re-runs of
  the same search.
- **Full-area coverage without duplicate scraping** — a single Google Maps search caps at
  ~120 results no matter how many businesses actually exist; auto-grid search fragments a large
  area into non-overlapping map tiles (subdividing further into any tile that looks saturated)
  to reach a real lead-count target, with cross-tile duplicates caught automatically.
- **Multi-account Apify rotation** — scraping drains one Apify account before moving to the
  next; a real quota error durably deactivates that account and the same tile/location retries
  on the next one, rather than failing the whole run.
- **Duplicate send prevention (send time)** — checked at actual dispatch time (not just in the
  UI) whether a given email address already received a successful send under a different lead.
- **Email deliverability check (free, local)** — syntax + MX record, right after enrichment.
- **Bounce detection (background job)** — a confirmed bounce stops all further follow-ups to
  that lead, same as a reply.
- **Local spam-content check** — scored immediately before every send; blocks or warns per your
  Limits settings.
- **Per-sequence-stage daily caps + business-hours scheduling** — each account has independent
  daily budgets for cold/follow-up-2/follow-up-3 emails, enforced both when a sending campaign
  is scheduled and again (authoritatively) at actual dispatch time; automatically-scheduled
  sends only land on weekdays within your configured business-hours window.
- **Randomized pacing** — sends never fire back-to-back.
- **Reply detection** — halts that lead's remaining follow-ups automatically.

None of this is a substitute for good list quality and a real sender warm-up — it's the
free/local layer of protection. A paid mailbox-verification API would catch more (a domain
that's alive but a specific address is dead), but isn't wired in by default.

## Notes

- Founder/CEO email discovery only uses addresses actually published on a business's own site
  (including structured data, not just visible links) — it never pattern-guesses.
- Any field the pipeline couldn't find is stored and exported as the literal string `null`.
- Emails are always plain text — no HTML, no tracking pixels, no tracking links.
- Leads with no website found are routed to a separate pitch offering to build them one.
- Manual "Send Now" and per-lead follow-up-date overrides are always exempt from business-hours
  bumping — those are explicit human decisions.
