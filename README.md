# RS Practice Health Check

The web part of the RS Medical Consultancy recruitment funnel: a landing page, the 13-statement Practice Health Check (scoring v1.0), an on-page confirm/edit step, and the result with six domain bars. Static HTML, CSS and JS, plus one Vercel function.

- `/` landing page. Invite links can carry `?rid=<Airtable record ID>&src=wa|email&name=…&phone=…&email=…`, which are passed into the form.
- `/check` the Health Check as a web form (the email path).
- `/preview` a clickable WhatsApp-style preview of the whole funnel, with the 13 statements answered in the chat. It needs no Meta account; submissions are sent to `/api/submit` marked `src: "preview"`.
- `/api/submit` validates a completed check and forwards it to Make. Set `MAKE_WEBHOOK_URL` in Vercel → Project → Settings → Environment Variables. Without it, submissions are accepted and only logged.
- `assets/config.js` holds the reviews, Calendly and brochure links. An empty link hides its button.
- `assets/scoring.js` holds the 13 statements (draft wording, awaiting RS) and the scoring. `npm test` runs the boundary tests from the build plan.

The site sends `noindex` headers while the funnel is being built. Remove them from `vercel.json` and the two HTML files at launch.

## WhatsApp bot (`/api/whatsapp`)

The full Health Check runs inside WhatsApp: a doctor messages the number, gets the welcome with Start / Brochure / Reviews, answers turnover and the 13 statements from WhatsApp lists, confirms or edits, and sees the score. Results go to Make (`MAKE_WEBHOOK_URL`). Typed messages are forwarded to Make as notes for RS. No database: each list row carries the answers so far in its id.

Vercel env vars: `WA_TOKEN`, `WA_PHONE_NUMBER_ID`, `WA_VERIFY_TOKEN` (any secret string, also pasted into Meta's webhook settings). Optional: `CALENDLY_URL`, `REVIEWS_URL`. Leave `WA_APP_SECRET` unset for now.

The bot asks RS's questions in RS's order: doctor name, practice name and speciality (typed), the 13 statements,
biggest challenge (typed, can skip), then turnover. Typed answers need a little memory: in Vercel, Storage → Upstash
for Redis (free) → connect to this project. Without it the bot skips the typed questions.

In the Meta app: WhatsApp → Configuration → Webhook. Callback URL `https://rs-health-check.vercel.app/api/whatsapp`, verify token = `WA_VERIFY_TOKEN`, then subscribe to `messages`.

## Airtable CRM

Base `app9s53ZbRzNxBNDI` (drqcele's Airtable) has three tables: **Doctors** (one row per doctor, matched on `WA ID`),
**Assessments** (one row per completed check, linked to the doctor) and **Messages** (free text sent to the bot).
`api/_airtable.js` builds the Airtable request bodies; the Make scenario "RS Health Check - 1 Receive submission"
just forwards them (PATCH Doctors, then POST the linked row). Empty values are skipped, so a WhatsApp visit never
wipes details typed on the website.

## Outbound invites (`/api/invite`)

The bot can text first, using an approved WhatsApp template. In Airtable, add a **Button** field to Doctors
("Send invite", action *Open URL*) with this formula, replacing `YOUR_INVITE_KEY`:

```
"https://rs-health-check.vercel.app/api/invite?k=YOUR_INVITE_KEY&rec=" & RECORD_ID() & "&to=" & ENCODE_URL_COMPONENT({WhatsApp}) & "&name=" & ENCODE_URL_COMPONENT({Doctor})
```

Set the same key as `INVITE_KEY` in Vercel. Pressing the button opens a confirm page; **Send invite** sends the
`rs_health_check_invite` template (override with `WA_INVITE_TEMPLATE` / `WA_INVITE_LANG`) and marks the doctor
*Invited*. The template's quick-reply buttons carry the payloads `START`, `BROCHURE` and `TESTIMONIALS`, which the bot
already handles. Business-initiated messages need an approved template and a payment method on the WhatsApp account.

## Placeholders to fill in later

- `assets/config.js`: `reviewsUrl` (Google reviews link) and `calendlyUrl` (booking page). Empty values hide the buttons; the preview uses a stand-in calendar.
- Vercel env var `MAKE_WEBHOOK_URL`, once the Make scenario exists.
- Statements, scale, bands and scoring follow RS's Practice Health Check questionnaire and scoring guide (v2.0, Nov 2026).
- Live WhatsApp: Meta app, test number, then RS's own number after business verification.
