# Teen mode (13-17): legal-review checklist

Written for the owner to take to a lawyer. It describes what Solace does today, in plain language. Every item below is marked **needs legal review**: nothing here is legal advice, and teen sign-up should stay switched off in production (it is, until a mail provider key is set) until a lawyer has signed off.

Policy version recorded with every consent: `2026-10` (`CONSENT_POLICY_VERSION` in `apps/api/src/services/teen.ts`). Bump it whenever the teen or parent wording changes.

## 1. What happens, step by step

1. After sign-up, the person must answer an age gate: birth **month and year** only. (needs legal review)
2. Under 13: the request is refused (403 `age_restricted`) and deletion of the account (database rows, photos, the Supabase sign-in user) is attempted before answering. If a step of that deletion fails, the error is logged and the person still gets the refusal, so a partial clean-up is possible and is not retried automatically. The web shows a kind explanation. (needs legal review)
3. 13-17: the account becomes a teen account with consent `pending`. Every part of the API except the allow-list below answers 403 `consent_required` until a parent says yes.
4. The teen enters a parent or guardian email. Solace emails a one-time link (valid 7 days). The parent reads what is stored and chooses Approve or Decline. They can withdraw approval later from the same link.
5. 18 and over: adult mode, no consent needed.

Routes reachable without consent: `GET/PATCH /me`, `POST /me/age`, `GET /me/usage`, `GET /me/export`, `DELETE /me`, and `POST /me/consent` (teens). So a locked teen can always export or delete their data. (needs legal review)

## 2. What is stored about age and consent

| Data | Stored? | Notes |
|---|---|---|
| Birth date, year or month | **No** | Used once in memory to pick a band, then discarded. (needs legal review) |
| Age band (`13-15`, `16-17`, `18+`) | Yes, on the profile | Set once; later calls cannot change it. (needs legal review) |
| Account mode (`adult` / `teen`) and consent status | Yes, on the profile | `pending`, `granted`, `revoked` (also used for "declined"), `not_required`. |
| Parent email address | **No** | Only a SHA-256 hash of the lowercased address. It is sent to the email provider to deliver the message (see section 4). (needs legal review) |
| Consent token | **No** (clear text) | 32 random bytes, only its SHA-256 is stored; the clear token exists only inside the emailed link and, while the parent uses it, in the request URL. The API access log replaces the token in `/api/consent/:token` with a placeholder. Outside development the log mail transport never writes the link or the parent's address to the logs. |
| Consent record | Yes | `parental_consents`: user id, parent email hash, token hash, status (`pending`/`granted`/`denied`/`revoked`), policy version, requested at, decided at, expires at. |
| Parent identity | **No** | The link proves control of the email inbox, not who the person is. (see section 5) |

Under-13 attempts: nothing is retained, not even a log of the age answer. Standard request logs (IP, time, route) may still exist for about 30 days as described on the privacy page. (needs legal review)

## 3. Retention

- Teen data is kept while the account exists. No separate shorter retention is built yet (the plan mentioned "shorter retention options"; not implemented). (needs legal review)
- Deleting the account removes all rows and photos at once. The consent record is deleted with it (cascade). Whether a consent record must be kept longer as legal proof, and in what form, is an open question. (needs legal review)
- When a parent withdraws approval, the account is locked but **data is kept** (so the teen can export or delete). There is no automatic deletion after a lock. (needs legal review)
- Consent links expire after 7 days if unanswered; a granted link stays valid so approval can be withdrawn. (needs legal review)

## 4. Third-party processors

| Processor | What it receives | Notes |
|---|---|---|
| Google Gemini API | Entry text, Reflect questions, summaries input | Free tier today: Google may use inputs to improve products and humans may review them (`AI_TIER=free`). Paid tier does not. The parent page and privacy page state this per tier. Whether the free tier is acceptable for children's data is a key question. (needs legal review) |
| Supabase | Account, database, private photo storage | Region: set in the Supabase project (placeholder `[region]` on the privacy page). (needs legal review) |
| Render, Vercel | Run the API and website | Do not store the journal. |
| Transactional email provider (Resend, once configured) | The parent's email address and the message text, to deliver it | The only place the parent email is processed in clear text, transiently. A data processing agreement is needed. No tracking pixels or link tracking are used in the message. (needs legal review) |
| Browser speech recognition (voice dictation) | Audio, sent by Chrome to Google's speech service | Not controlled by Solace; disclosed in the UI. (needs legal review) |

## 5. India: DPDP Act and Rules

- The Digital Personal Data Protection Rules, 2025 require **verifiable** parental consent for a child (under 18) before processing, and the parent's identity and age must be checked using reliable means (for example, details a government-backed service already holds, or a virtual token). (needs legal review)
- **The gap:** Solace's current consent proves only that someone with access to an email inbox clicked a link. It does **not** verify that the person is an adult or the child's parent. This is not "verifiable consent" under the Rules. (needs legal review)
- Timing: the obligations on data fiduciaries take effect on a delayed schedule; the owner's working assumption is about **May 2027** for the consent and children's provisions, which needs to be confirmed against the notified dates. Solace is built so the consent step can be upgraded (for example to a DigiLocker-style check) without changing the rest of the app. (needs legal review)
- Section 9 (children): no tracking, behavioural monitoring or targeted advertising directed at children. Applied: no ads, no analytics trackers, and teen mode switches off streaks, reminders and nudges, share cards and the people map. Whether in-app summaries and mood analysis count as "behavioural monitoring" is an open question. (needs legal review)
- Whether the 18 cut-off, the parent-withdrawal flow and the export/delete rights satisfy the Rules; whether a Data Protection Officer or a representative is needed; breach notification duties. (needs legal review)

## 6. United States: COPPA (under 13)

- Solace does not knowingly allow under-13 users. The age gate is neutral (month and year, nothing pre-filled). Note: the web page currently shows a hint that a parent will be needed as soon as a 13-17 date is selected, i.e. before the answer is submitted, so the gate is not fully neutral until that hint is removed (open item in `apps/web/src/features/teen/AgeGatePage.tsx`), and an under-13 answer deletes the account at once and keeps nothing. (needs legal review)
- Open questions: whether deleting immediately is sufficient when a child gives their age and email at sign-up; whether the sign-up email address was "collected" before deletion; whether a cookie-style device block is needed to stop a retry with a different birth year (not built: the gate can be retried with another account). (needs legal review)
- State laws (for example age-appropriate design codes, parental-consent laws for minors' accounts) are not assessed. (needs legal review)

## 7. EU and UK: GDPR Art. 8 and the UK Children's Code

- Article 8 sets the age of digital consent per country between **13 and 16**. Where a country sets 14, 15 or 16, a 13-year-old there needs parental consent for *more* than Solace currently asks, or cannot consent themselves at all.
- **EU teens are not geo-gated.** Solace has no country detection: a 13-year-old in a country with a higher age is treated like any other teen. Until reviewed, launch outside the EU/UK or add country-based age thresholds. (needs legal review)
- The parent flow is parent consent for the child's use. Whether it satisfies "reasonable efforts to verify" under Art. 8(2) is open. (needs legal review)
- Other GDPR points: lawful basis for processing a child's journal text (contract versus consent); special-category data (mood, health, feelings are written in the journal); a data protection impact assessment for children's data; the UK Age Appropriate Design Code (high privacy by default, no nudge techniques: partly applied); international transfers to Google and Supabase. (needs legal review)

## 8. Behavioural-monitoring restrictions applied in teen mode

- No streak counters, "days in a row" lines or streak slides.
- No daily reminder and no in-app "you haven't written" nudges; for accounts onboarded as teens the reminder setting is hidden and stored as off. A reminder hour saved before an account became a teen account is not cleared, and `PATCH /me` still accepts one.
- No share cards.
- No people/places constellation or "people" slides.
- The enrichment AI is instructed not to create memories or graph entries about other people, and the server drops any it returns anyway (kinds `person`) for new entries.
- Life chapters: no cast list is requested, the server stores and serves an empty cast for teens (including chapters built earlier). Letters from your past self and growth notes are told not to name other people; this is an instruction to the model, not a server-side filter.
- Reflect and the memory-inspired daily prompt skip memories of kind `person` for teens, including ones recorded before the account became a teen account. The Memories list itself still shows any such legacy memory to its owner, and journal passages quoted in Reflect are the teen's own text, which may contain names.
- The companion never punishes breaks (all accounts).

The web screens read these flags from `features/teen/flags.ts`. (needs legal review for whether this list is sufficient)

## 9. Rights and controls for the family

- Teen can export (JSON or Markdown) and delete at any time, even while locked.
- Parent can withdraw approval at any time from the emailed link; account locks at once. A parent **cannot** read the journal.
- Declined requests can be re-sent by the teen (3 emails per day, a new link replaces the old one). A revoked account cannot be re-opened by the teen requesting a new link. Whether to allow a parent to re-approve later is a product and legal question. (needs legal review)
- Parent's right to see, correct or delete the child's data without the child's account: **not built**; today only the teen can delete. (needs legal review)

## 10. Abuse and security notes

- A teen can enter any email address, including a friend's. Solace cannot tell a parent from someone else. (needs legal review: see section 5)
- Rate limits: 3 consent emails per teen per day; per-IP limit on the public consent link; tokens are unguessable and links answer the same generic 404 whether a token is wrong, expired or replaced.
- Consent emails go out through a pluggable mailer (Resend in production). If no provider is configured in production, both the age gate (for a 13-17 answer) and a later consent request answer 503 `teen_signup_unavailable` and nothing is stored or logged. The in-process gate cache (5 seconds) is invalidated when consent changes and a read racing that change is not cached; with several API instances another instance can still serve the old state for up to 5 seconds.
- The data export includes a consent summary (status and decision time) but never the stored hashes.
- Crisis resources (Tele-MANAS 14416, KIRAN 1800-599-0019, CHILDLINE 1098, 988, Samaritans 116 123, findahelpline.com) are listed with a "last checked" date in `apps/web/src/features/teen/crisis-data.ts`. They must be re-verified by a person before launch and periodically. (needs legal review)

## 11. Open questions for the lawyer

1. Is email-link consent acceptable for launch in India before the Rules' verifiable-consent obligations apply, and for how long? What is the minimum viable verification afterwards?
2. Is the free Gemini tier acceptable for children's data at all, given that Google may use inputs and have humans read them?
3. Do we need a lawful basis other than consent for teens aged 16-17, and should they be treated differently from 13-15?
4. Which countries should be blocked or given a higher age until country-specific rules are handled?
5. How long should consent records and request logs be kept after account deletion, and in what form?
6. Do we need a parent-facing way to access or delete a child's data without the child's help?
7. Is a Data Protection Impact Assessment or similar required before launch?
8. Does the under-13 handling satisfy COPPA and the DPDP Rules (immediate deletion, no retained records)?
9. Is the privacy page's current wording ("Children" section still says under [16]; the new "Teen accounts" section says 13 and over) consistent, and which one is right?
10. Are the terms of service enforceable against a minor, and do they need a parent-facing version?
