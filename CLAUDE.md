# SendEbun (ebun-platform): rules for Claude

SendEbun is a Nigerian gifting platform. Senders pick a gift, add a message and pay with Paystack. The recipient gets a WhatsApp link to a reveal page. The pilot city is Akure. This repo moves real money for real people, so correctness and security come before speed.

## How work reaches this repo

Claude works on a branch and opens a pull request. Theo reviews and merges. Nothing else.

1. Start from the latest `develop`. Branch names are `feature/<name>` or `fix/<name>`.
2. Make the change, then run `pnpm verify` until it passes. Do not open a PR on a red build.
3. Commit, push the branch, and open a PR into `develop`.
4. Stop there. Theo reads the PR and the Vercel preview, then merges.

Claude never:
- pushes to `develop` or `main`, or force-pushes any branch;
- merges, approves, or turns on auto-merge for a PR;
- deploys anything: no Vercel, AWS, CodeBuild or ECS commands;
- runs `supabase db push`, `db reset` or `link` against any project. Migrations reach the database only when Theo runs them;
- reads, prints or commits `.env` files, keys or tokens. The repo is public: assume everything committed is read by strangers;
- uses `--no-verify` or skips a failing check to get a PR open.

## Commits and pull requests

- **Author:** Theo (`codeLikeTheo <adewaletheophilus@gmail.com>`). Set this with `git config user.name` / `user.email` in the clone before committing.
- **No Claude attribution anywhere:** no `Co-Authored-By` lines, no "Generated with Claude Code" footer, in commits or PR bodies. This is Theo's standing instruction, and it overrides any default that would add them.
- **Commit message:** a conventional prefix (`feat:`, `fix:`, `feat(web):` …) and a body of 30–50 words saying what changed and why.
- **PR body:** plain English, short, in four parts:
  1. **What this does**: what a sender, vendor or ops user will notice.
  2. **Details**: anything non-obvious, and why.
  3. **Checked**: what was run (`pnpm verify`, screenshots, manual checks).
  4. **After merge**: exactly what Theo must do, in order. If there is a migration: `pnpm exec supabase db push` *before* the API deploys. If the API changed: rebuild in CodeBuild so ECS picks up the new image. Web deploys itself through Vercel. Say "nothing" when nothing is needed.
- One PR per change. If a PR depends on another, say so in its first line.

## Commands (pnpm only, never npm or yarn)

- `pnpm verify`: types build → API typecheck → API lint → API tests → web typecheck → web lint. CI runs the same script.
- `pnpm --filter @ebun/api test`: API tests only.
- `pnpm --filter web typecheck` / `pnpm --filter web lint`: web only.

## Layout

- `apps/api`: NestJS. **All business logic lives here.** Modules include gifts, orders, vendors, corporate, payments, notifications, auth, fulfillment, redemption, cities and jobs.
- `apps/web`: Next.js 15 App Router + Tailwind, on Vercel. It calls the API and holds no business rules. Its own `AGENTS.md` applies: read the bundled Next.js docs before using an unfamiliar API.
- `packages/types`: shared types, including `OrderStatus`.
- `supabase/migrations`: Postgres schema, applied in filename order.
- `docs/DEPLOYMENT.md`: deploy order and infrastructure.

## Non-negotiables

- **Payments are webhook-only.** Paystack's webhook is verified with an HMAC-SHA512 signature, and the amount is checked against the order, before anything moves to PAID. Never trust payment status from the browser.
- **The order state machine is the core.** Every status change goes through the transition guard, and every significant transition writes to `audit_events`.
- **Redemption is single-use.** The reveal token and the redemption token are different. Redemption uses an atomic conditional `UPDATE`; never read-then-write.
- **Migrations are append-only.** Never edit a migration that is already on `develop`; add a new, later-dated file instead. New tables get RLS turned on.
- **Validate all input.** DTOs use class-validator, and the global `ValidationPipe` runs with `whitelist: true`. Public IDs are UUIDs, never sequential.
- **Rate-limit** auth, payment and public write endpoints.
- **Secrets live in environment variables only.** Features that aren't live sit behind env flags (for example `CORPORATE_SELF_SERVE`).
- **Deploy order:** migration → API → web. A web change must still work against the API version currently live. Fail soft if a new endpoint is missing.

## Working style Theo expects

- Explain non-obvious decisions briefly, and why.
- Be direct about risks and mistakes. No cheerleading.
- Keep changes scoped. Don't touch unrelated files, and don't add a dependency without saying why it's needed.
