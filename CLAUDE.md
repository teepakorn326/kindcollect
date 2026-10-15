# KindCollect — CLAUDE.md

> Hackathon build (Inter-Uni Sym AI Hackathon, 17–18 Oct 2026). Read `docs/HANDOFF.md` first for the
> product story, the 5 demo cases and all decisions. Mockups of every screen are in `docs/mockups/`.

**One line:** An AI receivables workflow for small suppliers that diagnoses *why* an invoice is unpaid and
fixes the cause — instead of sending the same reminder to everyone.
**Tagline:** *Get paid, without the awkward conversation.*
**Alternative to:** the invoicing + receivables side of Xero.

---

## 0. Non-negotiable product rules

- **AI suggests. Rules validate. People approve.** No allocation, credit note, status change, email or
  phone call happens without a human clicking Confirm/Approve.
- **Mock input, real logic, real state.** Bank feed, inbound email and documents are seeded. Rules,
  money math, AI classification, DB writes and the audit trail are real.
- Every AI suggestion renders its **source evidence** beside it (excerpt + link). Never "AI verified".
  Use: `Suggested`, `Possible match — confirmation required`, `Needs review`.
- **Money is integer cents** in `lib/money.ts`. The LLM never produces a number that is written to the DB.
- Status = **label + colour**, never colour alone.
- Every outbound action is blocked when the customer has an unmatched payment or an open dispute
  (`SendGuard`). Status is re-checked at send time.
- `DEMO_MODE=true`: emails are logged as "would send", pay links go to `/pay/[token]` in-app, bank sync
  inserts seed rows. Show the "Demo mode" badge; never toast "Email sent" when nothing was sent.
- Every AI call has a **cached fallback** (`AiResult` table, keyed by input hash). Timeout 8 s → use cache,
  show a small "cached" badge.
- Customer screens show **descriptive** payment history only (on-time count, median days late). No
  scores, no "bad customer" badges.

---

## 1. Stack (do not add to it)

| Layer | Choice |
|---|---|
| App | Next.js 15 App Router, TypeScript strict, pnpm |
| UI | Tailwind v4 + CSS variable tokens (§2), shadcn/ui (Radix), lucide-react, Inter via `next/font` |
| Forms | react-hook-form + zod (schemas shared with server actions) |
| Server state | TanStack Query v5 (stale banner from `dataUpdatedAt`) |
| DB | Supabase Postgres (Sydney) + Prisma, `prisma db push`, seed in `prisma/seed.ts` |
| AI | `@anthropic-ai/sdk`, Claude Sonnet, **tool use only** (`classify_case`, `draft_message`, `extract_call_outcome`) |
| Voice | Vapi (AU number) → webhook `/api/vapi/webhook` → `extract_call_outcome` |
| Email | Resend behind `DEMO_MODE` flag (default: log only) |
| Tests | Vitest for `lib/money.ts` + `lib/rules.ts`; one Playwright spec = the 90-second demo |
| Deploy | Vercel (`syd1`), auto-deploy from `main`; Sunday noon switch production branch to `release` |
| Auth | Hard-coded user Sarah + Basic Auth middleware |

Not in scope: Python services, Docker, Redis/queues, vector DB, tRPC/GraphQL, Storybook, real bank/Xero
integrations, real Stripe.

---

## 2. Design tokens — `src/styles/tokens.css`

```css
:root {
  --kc-color-primary:       #0F766E; /* teal — primary action */
  --kc-color-primary-hover: #115E59;
  --kc-color-primary-soft:  #CCFBF1; /* active nav, avatar */
  --kc-color-primary-tint:  #F0FDFA; /* suggestion panels */
  --kc-color-primary-line:  #99F6E4;
  --kc-color-bg:            #F8FAFC;
  --kc-color-surface:       #FFFFFF;
  --kc-color-border:        #E2E8F0;
  --kc-color-text:          #0F172A;
  --kc-color-text-muted:    #64748B;

  --kc-status-success:    #15803D; --kc-status-success-bg: #DCFCE7; /* paid, matched, probably forgot */
  --kc-status-review:     #B45309; --kc-status-review-bg:  #FEF3C7; /* needs review, cash-flow trouble */
  --kc-status-error:      #B91C1C; --kc-status-error-bg:   #FEE2E2; /* disputed, blocked, habitual late */
  --kc-status-info:       #1D4ED8; --kc-status-info-bg:    #DBEAFE; /* unpaid, invoice issue (ours) */

  --kc-font-sans: "Inter", ui-sans-serif, system-ui, sans-serif;
  --kc-radius-card: 12px; --kc-radius-input: 8px; --kc-radius-badge: 999px;
  --kc-shadow-card: 0 1px 2px rgba(15, 23, 42, 0.06);
}
```

Tailwind aliases: `bg-kc-primary`, `bg-kc-surface`, `text-kc-muted`, `border-kc-border`,
`bg-kc-status-review-bg`, etc. Money text always `tabular-nums`. Never hard-code hex in components.

Layout shell: TopBar 56 px (logo · Business selector · search · Demo badge · avatar) · Sidebar 240 px
(Overview, Action Queue, Invoices, Payments, Customers, Settings) · Main `max-w-[1280px] px-8 py-6`.
Two-column pages use `grid gap-5 lg:grid-cols-2` (Case Detail, Payment Matching) or
`lg:grid-cols-[2fr_3fr]` (Email Approval) / `[3fr_2fr]` (Create Invoice).

---

## 3. Domain components — `src/components/domain/`

| Component | Props | Notes |
|---|---|---|
| `StatusBadge` | `kind: "payment" \| "cause" \| "followup"`, `value` | labels from `lib/status.ts` only |
| `MoneyValue` | `cents: number`, `currency?: "AUD"` | `Intl.NumberFormat("en-AU")`, tabular nums |
| `SuggestionPanel` | `title`, `body`, `confidence`, `evidenceIds[]`, children (actions) | teal tint panel, "Suggested" chip |
| `EvidenceCard` | `evidence: Evidence` (email / returns / bank / document / call) | left colour bar by type, excerpt with `<mark>` |
| `AllocationRow` | `invoice`, `proposedCents`, `onChange` | validates ≤ outstanding and ≤ unallocated |
| `SendGuard` | `reason?: "unmatched_payment" \| "dispute"`, `href` | replaces Approve button with "Sending paused" |
| `AuditTimeline` | `events: AuditEvent[]` | dot colour by type, newest last |
| `DemoBadge` | — | amber pill, every page |
| `CallTranscript` | `turns[]`, `live?` | agent turns teal, customer grey |

Figma / mockup frame names match these and the page names below.

---

## 4. Pages (route → mockup)

| Route | Mockup | Demo case |
|---|---|---|
| `/overview` | `docs/mockups/Overview.html` | Sarah's Monday: A$16,000 owed, only A$9,900 needs chasing |
| `/queue` | `ActionQueue.html` | 5 rows, ordered by rule |
| `/queue/[caseId]` | `Main.html` (Case Detail) | Sweet Bakery — credit note A$360 |
| `/payments/[paymentId]/review` | `PaymentMatchingReview.html` | City Catering — A$3,000 ref "INV-1013" → INV-1031 |
| `/communications/[draftId]` | `EmailApproval.html` | Bella's Café — warm nudge + pay link |
| `/invoices/new` | `CreateInvoice.html` | Harbourside — PO + 3-way check |
| `/customers/[id]` | `CustomerAccount.html` | Harbourside — change of terms |
| `/calls/[callId]` | `VoiceCall.html` | Harbourside — AI call to AP |

---

## 5. Rules — `lib/rules.ts` (pure, unit-tested)

```
queueOrder(cases):   paid-not-matched → invoice-issue-ours → commitment due → probably-forgot → cash-flow → habitual
matchPayment(p, invoices): payer matches customer AND amount == exactly one open invoice → "possible match"
                           (reference ignored when it names a paid/unknown invoice; never auto-allocate)
sendGuard(customer): blocked if customer has an unallocated receipt or an open dispute
pauseReminders(case): on customer reply classified as dispute / document request / cash-flow
creditNote(returns): qty × unit price, GST-free for fresh produce (business flag `gstFree`)
threeWayCheck(invoice, po?, deliveryNote): PO qty/price vs invoice, delivery qty vs invoice; missing PO = blocker for customers with `requiresPo`
```

`lib/money.ts`: `addCents`, `allocate(paymentCents, allocations[])` (throws on over-allocation or
currency mismatch), `formatAud(cents)`.

---

## 6. AI — `lib/ai/`

All calls use **tool use** with a JSON schema; every result includes `confidence` and `evidence_ids`.

- `classify_case({ invoice, messages[], documents[], bankLines[], history })` →
  `{ cause: "paid_not_matched"|"invoice_issue_ours"|"probably_forgot"|"cash_flow"|"habitual_late"|"blocked_on_customer_po"|"unknown", summary, suggested_action, confidence, evidence_ids[] }`
- `draft_message({ customer, invoice, cause, tone: "warm"|"neutral"|"firm", facts[] })` → `{ subject, body, facts_used[] }`
- `extract_call_outcome({ transcript })` → `{ invoice_received, blocker, commitment_date, dispute_raised, confidence, quotes[] }`

Prompts live in `lib/ai/prompts/*.md`. Voice agent system prompt: `lib/ai/prompts/voice-agent.md`
(introduces itself as an assistant for Tony, asks only: received? blocker? when?; no negotiation; ends
the call on request or on a dispute; business hours and 1 call/customer/week enforced in code, not prompt).

---

## 7. Data model — `prisma/schema.prisma`

`Business` (gstFree) · `Customer` (requiresPo, terms) · `Invoice` · `InvoiceLine` · `Payment` (bank
receipt) · `Allocation` · `CreditNote` · `Return` · `Case` (cause, diagnosisConfirmed, remindersPaused) ·
`Evidence` (type, excerpt, sourceRef) · `Message` (inbound/outbound, tone, demoOnly) · `PaymentPlan` ·
`Call` (transcript, outcome) · `AuditEvent` · `AiResult` (inputHash, output)

Keep `Case.diagnosisConfirmed` — confirmed diagnoses are the dataset that compounds (see HANDOFF §Why us).

---

## 8. Project structure

```
app/(shell)/{overview,queue,queue/[caseId],payments/[id]/review,communications/[id],invoices/new,customers/[id],calls/[id]}
app/api/{ai/classify,ai/draft,vapi/webhook,demo/reset,demo/sync-bank}
components/ui/   components/domain/
lib/{money.ts,rules.ts,status.ts,db.ts}  lib/ai/{client.ts,tools.ts,prompts/}
prisma/{schema.prisma,seed.ts}
tests/{money.test.ts,rules.test.ts}  e2e/demo.spec.ts
docs/{HANDOFF.md,mockups/}
```

## 9. Build order

1. Scaffold + tokens + shell + seed (Fri night)
2. `lib/money.ts`, `lib/rules.ts` + tests
3. Action Queue → Case Detail (Sweet Bakery) → Payment Matching (City Catering)
4. AI classify + draft → Email Approval (Bella's)
5. Overview
6. Voice Call (Vapi) — only after 1–5 are on the deployed URL
7. Create Invoice, Customer Account
8. Sun 12:00 feature freeze → rehearse ×3 on prod URL → pin release

## 10. Decisions log (keep 1–2 lines each)

- 2026-10-16 · Code lives under `src/` (`src/app`, `src/lib`, `src/components`, `src/styles`); §8 paths are relative to `src/`. `prisma/`, `tests/`, `e2e/` stay at repo root.
- 2026-10-16 · Next pinned to 15.5.x (create-next-app@15); shadcn CLI 4.21 with the `radix-nova` style (Radix base, per §1).
- 2026-10-16 · shadcn's radix registry no longer ships `toast` (only sonner). Toast is hand-written from the legacy shadcn source on `radix-ui` Toast (`components/ui/toast.tsx`, `toaster.tsx`, `hooks/use-toast.ts`) — no new dependency.
- 2026-10-16 · shadcn semantic vars (`--primary`, `--border`, …) are mapped onto kc tokens in `globals.css`; components use `kc-*` classes. Light theme only.
- 2026-10-16 · DemoBadge copy is "Demo data" (matches every mockup). Outbound-email screens additionally say "Demo mode — message will not be sent".
- 2026-10-16 · Basic Auth middleware is skipped when `BASIC_AUTH_USER`/`PASS` are unset (local dev); `/api/vapi/webhook` and `/demo/*` assets bypass it.
- 2026-10-16 · Business selector lists the mockup's 3 businesses; only Fresh Harvest Produce is selectable (others disabled, no data).
- 2026-10-16 · `pnpm test` runs Vitest with `passWithNoTests` until Phase 3 adds tests; Playwright reads `BASE_URL` and Basic Auth creds from env.
- 2026-10-16 · Prisma pinned to 6.19 (7.x changes the client/config model). `prisma db push`, no migrations. Build runs `prisma generate`.
- 2026-10-16 · Demo clock (`lib/clock.ts`): in DEMO_MODE "today" is pinned to Mon 13 Oct 2026 (Sydney) with the real time of day, so overdue days match the script. Date-only fields are stored at Sydney noon.
- 2026-10-16 · Seed lives in `src/lib/demo/seed.ts` (shared by `pnpm db:seed` and `POST /api/demo/reset`). It truncates `Business` CASCADE; `AiResult` is never truncated (it is the AI fallback cache). `db:seed` uses Node's native TS type stripping (Node ≥ 22.18) — no tsx.
- 2026-10-16 · Stable seed ids (`DEMO_IDS`: `kc-0043`, `pay-city-1210`, `msg-bella-nudge`, `call-harbourside-1019`, …) so pre-opened tabs survive a reset.
- 2026-10-16 · Schema additions beyond §7: `User` (Tony, Sarah), `PaymentPlanInstalment` (money stays in Int columns, not JSON), `Payment.status` (unallocated/allocated/ignored/outgoing), `Case.status`/`whoActs`/`confidence`, `Invoice.balanceCents` kept in sync inside each write transaction.
- 2026-10-16 · `Case.diagnosisConfirmed` is nullable: null = not reviewed, true = confirmed, false = rejected/re-opened.
- 2026-10-16 · INV-1028 keeps the mockup dates (issued 12 Sep, due 26 Sep), which computes to **17** days overdue on 13 Oct; the mockups' "18 days" is inconsistent with their own due date.
- 2026-10-16 · Invoice lines invented so each total is exact (catalogue: greens 47.00, tomatoes 52.00, strawberries 45.00 — the CreateInvoice prices). Harbourside history: days late 38/41/43/44/46/48/52/55 → median 45; INV-0978 and INV-1004 rejected for missing PO.
- 2026-10-16 · Golden Noodle reminders are not paused at seed; Phase 6 plan approval pauses them. `PENDING_BANK_LINES` (Bella pays A$3,200) is the next line "Sync bank feed" inserts.
- 2026-10-16 · Supabase project is in ap-southeast-1 (Singapore), not Sydney. `DATABASE_URL` = transaction pooler :6543 `?pgbouncer=true`, `DIRECT_URL` = session pooler :5432 (the `db.<ref>.supabase.co` host is IPv6-only). Full reset takes ~18 s.
- 2026-10-16 · Rules take `today` as a parameter (pure); callers pass `today()` from `lib/clock.ts`. `queueOrder(cases, today)`: a commitment already due ranks 3rd; a future commitment ranks last (waiting); `blocked_on_customer_po` without a commitment sits between cash-flow and habitual.
- 2026-10-16 · "Open dispute" for `sendGuard` = an unresolved case with cause `invoice_issue_ours`. Zero-value/ignored bank lines never block.
- 2026-10-16 · `matchPayment` returns its own `checks[]` (shown verbatim on Payment Matching). A reference naming a paid/unknown/other-customer invoice is a warning, never trusted; a tie on amount = no match.
- 2026-10-16 · `threeWayCheck`: missing PO (requiresPo) and qty ≠ delivery note are blockers; a line note ("Keep 24 and explain") downgrades a mismatch to a warning; billing the delivered qty is fine even if the PO ordered more.
- 2026-10-16 · `lib/status.ts`: `blocked_on_customer_po` uses the error tone (tokens: "blocked"); "Already in the bank" bucket is neutral grey as in the Overview mockup.
- 2026-10-16 · Performance: Prisma `relationJoins` preview + `relationLoadStrategy: "join"` on case queries; `DATABASE_URL` uses the Supavisor **session** pooler (:5432, `connection_limit=5`) — measured ~1 s/query on the transaction pooler vs ~0.2 s. Case Detail 8 s → 0.5 s locally. On Vercel, pick the function region next to the DB (sin1 while the DB is in Singapore).
- 2026-10-16 · Queue "Status" default "Needs approval" = `needs_approval` + `needs_review` (both need a person); sidebar count uses the same set. Filters live in URL params, filtering is server-side.
- 2026-10-16 · Suggested-action labels with money ("Approve A$360 credit note", "Offer 2 × A$1,700 plan") are computed in `lib/cases.ts#caseAction` from rules (`creditNote`, `proposePaymentPlan`), not stored text.
- 2026-10-16 · Approving a credit note: writes CreditNote(s) `CN-0001…`, reduces `Invoice.balanceCents`, moves `dueDate` to the chosen new due date (default today + terms = 27 Oct; the mockup's 14 Oct contradicts its own "14 days" label), sets case `waiting_on_customer` + `diagnosisConfirmed=true`, keeps reminders paused, appends `credit_note_approved` + `invoice_corrected`. Server re-checks balance + `updatedAt` (stale → error with Reload).
- 2026-10-16 · "Not a valid return": `diagnosisConfirmed=false`, status `needs_review`, audit `diagnosis_rejected`; diagnosis shown struck-through with a "Needs review" chip.
- 2026-10-16 · "Weekly summary for Tony" and "Re-diagnose all" render disabled until Phase 6 (AI) — no fake behaviour.
- 2026-10-16 · Evidence cards newest first; documents listed under "Related documents"; source links open dialogs (original email, thread, returns record, invoice lines).
- 2026-10-16 · Payment Matching: proposal = `matchPayment()` on the receipt's remaining amount; rows = target invoice (pre-filled), the referenced invoice (dashed, nothing owed), and — after "Edit allocation" — the customer's other open invoices. `allocate()` validates live in the browser and again inside the server transaction.
- 2026-10-16 · Confirm match: Allocation rows, invoice balance → 0 ⇒ `paid` (paidAt = receipt date), payment `allocated` when fully used, held reminders → `cancelled`, paid invoices' cases → `resolved`, audit `payment_matched` (journal Dr Suspense / Cr AR) + `reminder_cancelled` + `case_resolved`. Summary after confirm is rendered from DB rows. "Thank-you note" is mentioned only as optional (no fake button).
- 2026-10-16 · "Not a match": receipt stays unallocated, `paid_not_matched` case → `needs_review`, audit `match_rejected`; page then shows a notice and stops pre-filling the suggestion.
- 2026-10-16 · Stale banner: TanStack Query polls `GET /api/payments/[id]/state` every 5 s and compares receipt/invoice `updatedAt` + balance with the page's fingerprint; Confirm is disabled while stale; own writes are suppressed via `OwnWriteProvider`. Server re-checks the same fingerprint. Added `Payment.updatedAt`.
- 2026-10-16 · Confirm dialogs stay on "Saving…" until the refreshed page arrives (no flash of stale UI).
- 2026-10-16 · `/payments` = bank statement list (sidebar link + "Open full statement"). "Digits are transposed" is computed by `isDigitTransposition()`.
- 2026-10-16 · Demo clock never reads earlier than 06:10 on 13 Oct (after the seeded 06:05 bank sync).
- 2026-10-16 · AI: `claude-sonnet-5-5` (CLAUDE.md names Sonnet; `ANTHROPIC_MODEL` overrides), adaptive thinking at effort `low`, strict tools with `tool_choice: auto` (forced tool choice 400s on this model), server-side refusal fallback `fallbacks: "default"` (beta `server-side-fallback-2026-07-01`). Measured ~3 s per call, 6–7 s on a cold connection.
- 2026-10-16 · `runTool()` order: cache hit → return it (badge "cached"); `fresh` (Redraft / Re-diagnose) → live call with 8 s timeout → on timeout/error fall back to the cached row; no row → error shown, current draft kept. Cache key = sha256(tool + prompt text + stable JSON input). Inputs contain no wall-clock or `updatedAt`, so the cache survives demo resets.
- 2026-10-16 · The LLM writes no numbers to the DB: `classify_case` returns an enum + ids (filtered to ids we supplied); `draft_message` returns text + fact ids — "Facts used" renders our fact text; `draftAmountIssues()` blocks Approve if the body contains any amount that isn't the invoice balance/total. Plan amounts/dates come from `proposePaymentPlan()`.
- 2026-10-16 · Applying a classification updates the case diagnosis as unconfirmed (`diagnosisConfirmed=null`), attaches cited messages as evidence, pauses reminders per `pauseReminders()`, and for `cash_flow` drafts a `proposed` PaymentPlan (audit `plan_proposed`). Tony's approval (`decidePlan`) → `approved`, reminders paused, case `waiting_on_customer`.
- 2026-10-16 · Email: tone toggle re-runs `draft_message` without writing; "Save draft" and "Approve & send" are explicit writes with audit. Send re-checks `sendGuard` server-side. DEMO_MODE (or no `RESEND_API_KEY`) → `Message{status: sent, demoOnly: true}`, audit "logged — not sent (demo mode)", never an "Email sent" toast. `[PAY LINK]` → `/pay/[messageId]` (public, no Basic Auth, takes no payment).
- 2026-10-16 · "What City Catering would see instead" is live: shown only while another customer's held reminder is blocked by `sendGuard`. "Ask Tony to review" disabled until Tasks (Phase 9).
- 2026-10-16 · `POST /api/demo/simulate-reply {customer: "noodle"|"bella"}` inserts a seeded reply (fixed timestamp) then classify + apply; also a "Demo: simulate a reply" link on those case pages. `POST /api/ai/classify {caseId, fresh}` = "Re-diagnose with AI".
- 2026-10-16 · Calendar: 13 Oct 2026 is a **Tuesday**; mockups use 2025 weekdays ("Mon 13 Oct", "Thursday 16 Oct", "Thu 23 Oct"). Facts compute real weekdays (next Thursday delivery = 15 Oct). Open question for the team.
- 2026-10-16 · Overview KPIs: "Owed to Tony" = unpaid balance of **overdue** invoices with an unresolved case (A$16,000 at reset; INV-1033, not due, is excluded — tooltip says so). "Actually needs chasing" = owed − cases caused `paid_not_matched`/`invoice_issue_ours`. "Already paid, not matched" = unallocated receipts in suspense. "Expected in 14 days" = approved plan instalments + case commitments + corrected (credit-noted) invoices due within 14 days — **A$0 at reset** (the mockup's A$7,640 counted Bella and unapproved items; it appears as the demo progresses).
- 2026-10-16 · Overview action wording follows the mockup ("Issue credit note · don't chase", "Final notice + change terms" → /customers/[id]); activity feed = latest 5 audit events of reader-relevant types, newest first.
- 2026-10-16 · Sync bank feed (`POST /api/demo/sync-bank`): inserts the next `PENDING_BANK_LINES` row (Bella A$3,200 ref INV1030, then Golden Noodle A$1,700 instalment), runs `matchPayment`; a possible match re-diagnoses the case to `paid_not_matched` by rule (unconfirmed), holds that customer's drafts and pauses reminders; then `sendGuard` blocks sending. Never allocates.
- 2026-10-16 · Overview header has "Reset demo data" (confirm dialog) for stage prep.
- 2026-10-16 · Phase 8 built before a Vercel deploy existed — the user waived the "only after 1–7 are deployed" gate ("go for the rest"). Live Vapi calls + webhook delivery need the deployed URL and Vapi env vars; everything else is tested locally (signed webhook payloads, rehearsal fallback).
- 2026-10-16 · Calls: `callGuard()` (pure, tested) enforces Tony's approval, Mon–Fri 7:30–21:00 Australia/Sydney and ≤ 1 call/customer/7 days on the server in `/api/calls/start`; the voice prompt (`lib/ai/prompts/voice-agent.md`) carries conduct only. Rehearsal loads don't count as calls.
- 2026-10-16 · Vapi: `VAPI_ASSISTANT_ID` (assistant created in the dashboard from voice-agent.md) is the recommended path; without it an inline assistant is sent (model/voice shapes per Vapi docs, `VAPI_MODEL` overrides). Transient server URLs get no stored credential, so our secret goes in `server.headers["x-vapi-secret"]`; the webhook accepts `x-vapi-secret` or `Authorization: Bearer`, compared in constant time. Final `transcript` events append atomically (`jsonb ||`); `end-of-call-report` stores transcript + recording URL (read from several candidate fields) and runs `extract_call_outcome`.
- 2026-10-16 · Voice Call page polls `/api/calls/[id]/state` every 2 s only while `in_progress` (TanStack Query; refreshed server snapshots are pushed into the cache). "Take over / Whisper / End call" from the mockup are not built (Vapi live control unverified) — no fake buttons.
- 2026-10-16 · Rehearsal fallback: transcript in `lib/demo/call-rehearsal.ts`; audio rendered by `scripts/render-rehearsal.mjs` (macOS `say`, AAC `.m4a` — no MP3 encoder on this machine). Drop the real team recording at `public/demo/harbourside-call.mp3` and it is used instead. If extraction is unavailable for the rehearsal, a pre-filled outcome is used (marked cached). Dates follow 2026: "next Thursday" from Tue 13 Oct = **Thu 22 Oct** (mockup: 23 Oct).
- 2026-10-16 · Confirm outcome (Sarah, date editable in the dialog): re-runs `classify_case` with ended calls as evidence (measured: `blocked_on_customer_po`, high), then sets `commitmentDate`, `remindersPausedUntil` = day after, case `waiting_on_customer` + confirmed, call evidence row, a `Task` for Tony, audit `call_outcome_confirmed`. Added `Task` model and `Call.source`.
- 2026-10-16 · Never run a second `next dev` in the same folder — it shares `.next` and corrupts the running server.
- 2026-10-16 · Create Invoice: react-hook-form + the shared zod schema (`lib/invoice-schema.ts`) through a ten-line local resolver (no `@hookform/resolvers`). Line totals via `multiplyCents`/`addCents`; `threeWayCheck()` runs live and again on the server; "Review & send" is disabled while blockers exist ("Use it" fills the PO, "Change to 22" fixes the qty, "Keep 24 and explain" adds a line note → warning). GST line hidden when `gstFree`. Lines pre-filled from the customer's open PO; "Fill from delivery note" uses delivered quantities. Send in DEMO_MODE = invoice `sent` + audit "logged, not emailed", journal Dr AR / Cr Sales in audit data.
- 2026-10-16 · Added `Document` model (seeded PO HH-PO-2291 and delivery note DN-0931; lines JSON with integer cents).
- 2026-10-16 · Customer Account: descriptive history only. Terms options appear only when the history shows a pattern (≥ 4 completed invoices, median days late > terms); amounts computed (credit limit halved, next delivery weekday). "Send to Tony for decision" creates a `Task` (terms never change in the app); "Draft the final notice" creates a firm draft that opens in Email Approval. "Edit customer" disabled. "Ask Tony to review" on Email Approval now creates a Task.
- 2026-10-16 · `GET /api/export/journal.csv` derives HANDOFF §3 journals from DB rows: sales Dr AR/Cr Sales; credit notes Dr Sales Returns/Cr AR; receipts that went through suspense Dr Bank/Cr Suspense then Dr Suspense/Cr AR on match; seeded history receipts Dr Bank/Cr AR. Plans post nothing. Link on /payments.
- 2026-10-16 · Phase 10: `e2e/demo.spec.ts` = HANDOFF §8 (reset → Overview A$16,000/A$9,900/A$3,000 → City match, INV-1031 paid → Sweet credit note, A$2,740 → Bella approve in demo mode (page rendered from `Message.demoOnly`) → Voice Call recording fallback → reset). Passed twice (~42 s) against a local production build (`pnpm start`); **not yet run against the deployed URL** (none existed). Run: `BASE_URL=https://<vercel-url> BASIC_AUTH_USER=… BASIC_AUTH_PASS=… pnpm test:e2e`.
- 2026-10-16 · `release` branch created from main at the end of Phase 10 (local until pushed).
- 2026-10-16 · `vercel.json` pins `framework: "nextjs"` (the project was created with preset "Other" → "No Output Directory named public") and `regions: ["sin1"]` next to the Supabase DB. Move both to `syd1` if the DB moves to Sydney.
