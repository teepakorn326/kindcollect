# KindCollect

*Get paid, without the awkward conversation.* An AI receivables workflow for small suppliers that
diagnoses **why** an invoice is unpaid and fixes the cause. Hackathon build — read `CLAUDE.md` and
`docs/HANDOFF.md` first.

## 5-minute setup

1. **Tools:** Node 22.18+ (runs `prisma/seed.ts` natively) and pnpm 9 (`npm i -g pnpm@9`).
2. **Install:** `pnpm install`
3. **Env:** `cp .env.example .env` and fill in `DATABASE_URL` / `DIRECT_URL` (Supabase, Sydney) and
   `ANTHROPIC_API_KEY`. Keep `DEMO_MODE=true`. Vapi and Resend keys are optional until those phases.
4. **Database:** `pnpm db:push && pnpm db:seed` (prints row counts). Re-run `pnpm db:seed` or `POST /api/demo/reset` any time to reset the demo.
5. **Run:** `pnpm dev` → http://localhost:3000/overview

## Scripts

| Command | What it does |
|---|---|
| `pnpm dev` | Next.js dev server |
| `pnpm build` | Production build |
| `pnpm test` | Vitest unit tests (`tests/`) |
| `pnpm test:e2e` | Playwright demo spec (`e2e/`) against `BASE_URL` (default `http://localhost:3000`) |

## AI

Claude (tool use only) via `ANTHROPIC_API_KEY`. Every result is cached in `AiResult` by input hash and the cache
survives `Reset demo data`, so click through the demo once before going on stage to warm it. If Claude is slow
(> 8 s) or down, the cached result is used and marked "cached".

Demo helpers: `POST /api/demo/simulate-reply` (`{"customer":"noodle"}` or `"bella"`), `POST /api/ai/classify`
(`{"caseId":"kc-0041","fresh":true}`).

## Auth

Set `BASIC_AUTH_USER` / `BASIC_AUTH_PASS` to gate the whole app with HTTP Basic Auth. Everyone acts as
the hard-coded user Sarah (bookkeeper).

## Demo mode

`DEMO_MODE=true` (default) logs outbound email instead of sending it and shows the "Demo data" badge.
Bank feed, inbound email, documents and returns are seeded; rules, AI classification, DB writes and
the audit trail are real.
