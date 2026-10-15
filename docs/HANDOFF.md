# KindCollect — Handoff for Claude Code

Everything decided in planning, in one file. Read this, then `CLAUDE.md`, then open `docs/mockups/*.html`
in a browser.

## 1. The event

Inter-Uni Sym AI Hackathon, Macquarie University, 17–18 Oct 2026. Brief: pick a well-known app (Xero,
Jira…) and build the strongest alternative. Teams of 2–4, Sym cloud workspace with AI agents, pitch an MVP
to judges, A$2,000 prize pool. Every team member registers individually.

## 2. Positioning

- **Name:** KindCollect. **Tagline:** Get paid, without the awkward conversation.
- **Alternative to:** the invoicing + receivables workflow of Xero. Standalone for small suppliers
  (invoices, payments, customer ledger), with a journal CSV export for the accountant.
- **Core claim:** "Overdue" does not tell you what to do. Five overdue invoices can have five different
  causes; a generic reminder tool emails all five, KindCollect sends one and fixes the other four.
- **Opening hook (kreng jai):** "In Thai we have a word, *kreng jai* — not wanting to impose, even when
  you're right. It's why millions of small business owners don't chase money they're owed."
- **Stats (verified in planning, cite on slide):** avg AU small business lost A$15,257/yr to late payments
  (Xero, Mar 2026); 37% of B2B invoices paid on time (Atradius 2025); 23% of SMEs would write off 6%+ of
  turnover rather than have the conversation (GoCardless); 2.74M small businesses, 37,231 accounting
  firms (ABS/IBISWorld).

## 3. The story — Tony and Sarah

**Tony** runs **Fresh Harvest Produce**, Flemington Markets, Sydney. Pays farmers cash at 4 am, delivers
to ~40 cafés and restaurants by 7 am, gives 14-day terms. Customers pay in 30–60 days. He is too kreng jai
to chase. **Sarah** is his bookkeeper (looks after ~40 small businesses). She is the primary user; Tony
approves money decisions and anything that touches a customer relationship.

Fresh produce is **GST-free** in Australia — no GST line on invoices or journals.

### The five customers (A$16,000 owed; only 3 should be chased, only 1 gets an email today)

| Customer | Invoice | Balance | Overdue | Cause | Evidence | Fix | Who acts |
|---|---|---|---|---|---|---|---|
| City Catering Co. | INV-1031 | 3,000.00 | 9 d | **Paid, not matched** — EFT 12 Oct, ref "INV-1013" (a paid invoice; digits transposed) | bank line | Match to INV-1031, cancel held reminder, optional thank-you | Sarah |
| Sweet Bakery | INV-1028 | 3,100.00 | 18 d | **Invoice issue — ours** — 8 boxes strawberries returned bruised 15 Sep, no credit note | reply 8 Oct + returns log RET-0211 | Credit note 8 × A$45 = A$360 → corrected invoice A$2,740, new due date | Sarah |
| Bella's Café | INV-1030 | 3,200.00 | 12 d | **Probably forgot** — 24/24 on time over 2 years, no reply, no dispute | history | Warm nudge from Tony + pay link | Sarah → customer |
| Golden Noodle House | INV-1026 | 3,400.00 | 21 d | **Cash-flow trouble** — reply: "roadworks out front, half our customers are gone" | reply 12 Oct | Payment plan 2 × A$1,700 (20 Oct, 3 Nov), routine reminders stop | Tony approves |
| Harbourside Hotel | INV-1019 | 3,300.00 | 45 d | **Habitual late payer** — median 45 d over 8 invoices, 3 emails ignored, requires PO | history | AI voice call to AP → reveals PO closed before invoice arrived, pay run Thu 23 Oct → re-diagnosed as **blocked on customer PO**; then Tony chooses pay-before-delivery / lower credit limit / final notice | Tony decides |

Other seed: Harbourside INV-1033 (A$3,150, not due, PO HH-PO-2288); Create Invoice demo INV-1034 to
Harbourside with PO HH-PO-2291 and a 24-vs-22 box quantity mismatch on tomatoes.

### Journal entries (seller side, GST-free)

- Sale on credit: Dr AR / Cr Sales Revenue
- Bella pays via link: Dr Bank 3,200 / Cr AR 3,200 (if fee borne by Tony: Dr Bank Fees, Dr Bank net)
- Noodle House instalments: Dr Bank 1,700 / Cr AR 1,700 ×2 (no entry on agreeing the plan)
- Sweet Bakery: Dr Sales Returns 360 / Cr AR 360, then Dr Bank 2,740 / Cr AR 2,740
- Harbourside: Dr Bank 3,300 / Cr AR 3,300, or if written off Dr Bad Debts 3,300 / Cr AR 3,300
- City Catering: receipt sits Dr Bank 3,000 / Cr Suspense; on match Dr Suspense 3,000 / Cr AR 3,000.
  Trap: trusting the reference would credit INV-1013 and leave INV-1031 open and chased.

## 4. Screens (mockups in `docs/mockups/`, 1280×900, desktop-first)

Overview · Action Queue · Case Detail (Sweet Bakery) · Payment Matching (City Catering) · Email Approval
(Bella's) · Create Invoice (Harbourside, PO + 3-way check) · Customer Account (Harbourside, change of
terms) · Voice Call (Harbourside, live transcript + outcome). Shell: teal `#0F766E`, Inter, cards radius 12.

## 5. What is real vs mocked

**Real:** rules engine, money math, Claude classify/draft/extract, Postgres writes, audit trail, every
Approve/Confirm button, Vapi call (to a teammate's phone playing "Priya from AP").
**Mocked at the edges:** bank feed (seed + "Sync bank feed" button), inbound email (seed + "Simulate
reply"), outbound email (`DEMO_MODE` logs "would send"), pay link (in-app `/pay/[token]`), returns log and
documents (seed). Not built: Xero/MYOB sync (CSV journal export only), Stripe, real auth.

Judges' question "is this real?" → answer per layer, honestly. Labels on screen: "Demo data",
"Demo mode — message will not be sent", "Recorded" on the fallback call.

## 6. Voice agent (Vapi)

- Introduces itself as an automated assistant calling on behalf of Tony; says the call is recorded.
- Asks exactly three things: invoice received? what's blocking it? when will it be paid?
- No negotiation, no pressure, no amounts beyond the invoice. Ends the call if asked or if a dispute is
  raised, and hands to Sarah.
- Code-enforced: business hours 7:30–21:00 Mon–Fri, max 1 call per customer per week, Tony approves each
  call, recording + transcript to audit trail. Standard TTS voice, not a clone.
- Webhook `call.ended` → `extract_call_outcome` → shown to Sarah → she confirms → case re-diagnosed.
- Demo fallback: rehearsal recording with pre-filled outcome panel.

## 7. Deploy plan

**Before Saturday (one person, ~2 h):** GitHub repo → `create-next-app` → Vercel (auto-deploy) →
Supabase (Sydney) → `prisma db push` + seed → env vars in Vercel + shared vault → `README` with 5-minute
setup. Accounts: Vercel, Supabase, Anthropic, Vapi (+ AU number), Resend (optional).

**During:** branch per person, merge straight to `main`, preview URLs for review. One shared Supabase DB;
"Reset demo data" button re-runs seed. Vapi webhook points at the Vercel URL from day one.
`export const maxDuration = 60` on AI routes.

**Sunday:** 12:00 feature freeze. Rehearse the demo 3× on the prod URL (once on mobile hotspot).
Switch Vercel production branch to `release` so nobody can break it. Reset demo data. Pre-open every tab.
Record a 90-second screen capture as the last-resort fallback.

**Fallbacks:** venue Wi-Fi → hotspot · Claude slow → `AiResult` cache · Vapi fails → play recording ·
Vercel down → `pnpm dev` against same Supabase · everything → the video.

## 8. Demo script (~90 s, Sarah's Monday)

1. **Overview** (15 s): "A$16,000 owed. Five overdue. But only A$9,900 actually needs chasing — and only
   one customer gets an email today."
2. **Payment Matching** (25 s): City Catering paid yesterday with the wrong reference. Open bank line →
   possible match → Confirm → balance A$0, held reminder cancelled. "A reminder tool would have chased
   someone who already paid."
3. **Case Detail** (25 s): Sweet Bakery is holding payment over 8 returned boxes. Evidence → credit note
   A$360 → Approve → corrected invoice A$2,740. "The problem was ours. Fix it, don't chase."
4. **Email Approval** (15 s): Bella's just forgot. Warm tone, pay link, Approve (demo mode).
5. **Voice Call** (10 s, if live) or closing line: "Xero tells you who owes you. KindCollect finds out
   why — and has the awkward conversation for you."

## 9. Pitch deck (10 slides, update from the CollectFlow draft)

1 Title + kreng jai hook · 2 Problem (overdue ≠ action; the stats) · 3 Tony & Sarah · 4 Five invoices,
five causes (table) · 5 Live demo · 6 Why not just reminders (generic tool vs KindCollect table) ·
7 Trust by design (rules validate, people approve, ACCC/ASIC guardrails) · 8 Business model (per-business
subscription via accounting firms + pay-link fee; "we only grow when our users get paid faster"; 1% of
firms ≈ A$650k ARR) · 9 Why now / why us / what compounds (LLMs can now read the evidence; Payment Times
Reporting; confirmed-diagnosis dataset across businesses; accounting-domain founder) · 10 Ask.

**Still to do before Saturday (highest value first):** call 2–3 real business owners and get one quote;
add the "Why now / What compounds" slide; journal CSV export; keep `Case.diagnosisConfirmed` in the
schema; one unit-economics line (AI cost ~A$0.05–0.20 per case vs A$5/business/month).

## 10. Team roles

- Product lead / domain (you): data, rules, journal entries, pitch, call rehearsal as "Priya"
- Builder 1: UI from mockups (Overview, Queue, Case Detail, Customer)
- Builder 2: schema, seed, `lib/money.ts`, `lib/rules.ts`, Payment Matching, Create Invoice
- Builder 3: Claude tools, Email Approval, Vapi + Voice Call page
