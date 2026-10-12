# Deploying Ebun

The API runs on **Railway**, the web app on **Vercel**, the database on **Supabase**.
Order matters: database → API → web → connect them → Paystack.

Both platforms must build with **pnpm 11** — pnpm 10 can't read this lockfile.

- **Vercel** handles this itself: it reads `devEngines` in the root `package.json`, picks pnpm 11,
  and detects Turborepo, which builds `@ebun/types` before the web app. Leave its default install
  and build commands alone; there is deliberately no `vercel.json`.
- **Railway** uses `apps/api/railway.json`. Its commands start pnpm from inside `apps/api` and point
  it at the repo root with `--dir ../..`. That's deliberate: npm 11 (which runs `npx`) refuses to
  run anything from a folder whose `package.json` declares a different package manager
  (`EBADDEVENGINES`), and only the root declares one.

---

## 0. Decide which database production uses (5 minutes to decide)

Today your laptop and everything else share `ebun-development`. Launching on it means test
orders sit next to real ones, and anything run locally acts on real customers' orders.

- **Recommended:** create a new Supabase project, `ebun-production`, then from the repo root:
  ```
  pnpm exec supabase link --project-ref <production-project-ref>
  pnpm exec supabase db push
  ```
  Create your staff login there the same way you did for development, and re-add vendors and
  gifts in /ops. Afterwards, `pnpm exec supabase link --project-ref <development-ref>` to point
  your machine back at development.
- **Fastest:** launch on `ebun-development`. If you do, set `ENABLE_BACKGROUND_JOBS=false` in
  your local `apps/api/.env`, so your laptop never expires or sweeps real orders.

---

## 1. API on Railway

1. Railway → **New project → Deploy from GitHub repo** → `Tadec-Labs/ebun-platform`, branch
   `develop` (or whichever you release from).
2. Service **Settings**:
   - **Root directory:** leave empty (the repo root). The build needs the whole workspace.
   - **Config-as-code path:** `/apps/api/railway.json`. That file sets the build, start
     command and health check.
3. **Variables:**

   | Name | Value |
   | --- | --- |
   | `SUPABASE_URL` | Production project URL |
   | `SUPABASE_SERVICE_ROLE_KEY` | Production service role key (secret — never in the web app) |
   | `PAYSTACK_SECRET_KEY` | `sk_test_…` first; swap to `sk_live_…` after activation |
   | `WEB_APP_BASE_URL` | The web app's address, e.g. `https://app.ebun.com.ng` (step 3) |

   Optional — the service fee. Leave unset for the default (5%, min ₦200, max ₦1,500).
   All in kobo or basis points; a malformed value stops the API booting:

   | Name | Default | Means |
   | --- | --- | --- |
   | `SERVICE_FEE_BPS` | `500` | Fee rate in basis points (500 = 5%). `0` turns the fee off |
   | `SERVICE_FEE_MIN_KOBO` | `20000` | Floor (₦200) |
   | `SERVICE_FEE_MAX_KOBO` | `150000` | Ceiling (₦1,500) |

   Don't set `PORT` (Railway does). Don't set `TRUST_PROXY_HOPS` (Railway is detected).
   Leave the `TERMII_*` variables unset until WhatsApp automation is live.
4. **Networking → Custom domain:** `api.ebun.com.ng`, then add the CNAME record Railway shows
   at your domain registrar. (Or use the generated `*.up.railway.app` address to start.)
5. Check: `https://api.ebun.com.ng/health` returns `{"status":"ok"}`.

## 2. Web app on Vercel

1. Vercel → **Add New → Project** → import `Tadec-Labs/ebun-platform`.
2. **Root directory:** `apps/web`. Framework: Next.js. Leave install and build commands on their
   defaults (see the note at the top).
3. **Environment variables:**

   | Name | Value |
   | --- | --- |
   | `NEXT_PUBLIC_API_BASE_URL` | `https://api.ebun.com.ng` — no trailing slash |
   | `SUPABASE_URL` | Production project URL (for /ops sign-in) |
   | `SUPABASE_ANON_KEY` | Production anon key |

   Leave `WHATSAPP_AUTO_DELIVERY` unset: senders send the gift link themselves.
   `NEXT_PUBLIC_API_BASE_URL` is baked in at build time, so **redeploy after changing it**.
4. **Domains:** `app.ebun.com.ng` (the landing page keeps `ebun.com.ng`). Add the DNS record
   Vercel shows.

## 3. Connect them

1. Set Railway's `WEB_APP_BASE_URL` to the final web address (`https://app.ebun.com.ng`) and
   redeploy the API. This one value controls CORS, the reveal links, the vendor counter links
   and Paystack's return page, so they all have to match.
2. Open `https://app.ebun.com.ng/send`. Gifts should load. If they don't, the API's deploy logs
   and the web app's function logs both name the reason.

## 4. Paystack

1. Paystack dashboard → **Settings → API Keys & Webhooks**, **Test** mode:
   webhook URL `https://api.ebun.com.ng/webhooks/paystack`.
2. Place a test order on your phone: pay with a Paystack test card, tap "Send on WhatsApp",
   send it to yourself, open it, claim it, and collect it on a vendor counter.
3. Submit the business for **activation**. Paystack will look at the website; link
   `/terms`, `/privacy` and `/refunds` from the landing page too.
4. Once live: put `sk_live_…` in Railway's `PAYSTACK_SECRET_KEY`, set the **Live** webhook URL
   to the same address, and redeploy the API.

## After launch

- **Vendors:** send each vendor their counter link from their /ops page *after* the web app is
  live. Links show the address of whichever site you're on, so links sent from localhost don't
  work on a vendor's phone.
- **One API instance** until rate limiting has shared storage. Two instances would each count
  separately and double every limit.
