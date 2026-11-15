# RS Practice Health Check

The web part of the RS Medical Consultancy recruitment funnel: a landing page, the 13-statement Practice Health Check (scoring v1.0), an on-page confirm/edit step, and the result with six domain bars. Static HTML, CSS and JS, plus one Vercel function.

- `/` landing page. Invite links can carry `?rid=<Airtable record ID>&src=wa|email&name=…&phone=…&email=…`, which are passed into the form.
- `/check` the Health Check.
- `/api/submit` validates a completed check and forwards it to Make. Set `MAKE_WEBHOOK_URL` in Vercel → Project → Settings → Environment Variables. Without it, submissions are accepted and only logged.
- `assets/config.js` holds the reviews, Calendly and brochure links. An empty link hides its button.
- `assets/scoring.js` holds the 13 statements (draft wording, awaiting RS) and the scoring. `npm test` runs the boundary tests from the build plan.

The site sends `noindex` headers while the funnel is being built. Remove them from `vercel.json` and the two HTML files at launch.
