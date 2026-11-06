# Property partnership platform

This implementation extends the existing React/Vite application and native Node server. It does not replace neighborhood scoring, browser-local renter preferences, or the existing city datasets. Production operation requires the services below; tests use an isolated embedded PostgreSQL engine and a mocked object-storage transport, never production accounts or invented public inventory.

## Architecture

- `server/partners/schema.sql`: idempotent initial PostgreSQL schema; `npm run partners:migrate` applies it. Tables cover applications, users, organizations, memberships, partnerships, sessions, single-use tokens, properties, media, revisions, engagement events, campaigns, audit history, rate limits, and the email outbox. Foreign keys, unique application/company/address keys, status constraints and reporting indexes are included.
- `server/partners/db.ts`: a small `pg` connection pool and transaction wrapper. Every transaction uses one connection. Production expects PostgreSQL with durable storage and provider-required TLS.
- `domain.ts`: validation, five-slot limit, organization locking, credentials, encrypted email payloads, city lookup and publication eligibility. The city catalogue and neighborhood JSON files remain the source of truth.
- `workflows.ts`: application approval, invitation creation, property review, pilot lifecycle, notification queuing and delivery.
- `api.ts`: shared standalone/Vercel HTTP handler. All identifiers are resolved and authorized on the server. No client-supplied organization or role is trusted.
- `pages.ts`: server-rendered initial property/partner HTML, canonical metadata, property structured data and the property sitemap. React takes over after loading.
- React routes share the existing Geist, paper, charcoal and blue visual system. Partner workspaces have their own navigation; the renter navigation stays on renter pages.

## Setup

1. Install dependencies with `npm ci` using Node 22.18+ (validated locally with Node 24).
2. Provision PostgreSQL and a **private** S3-compatible bucket. Restrict the storage credential to the selected bucket's `partners/` prefix; enable provider encryption and backups appropriate to your operational requirements.
3. Copy `.env.example` to `.env`. Configure `DATABASE_URL`, `APP_ORIGIN`, `PARTNER_MAIL_SECRET`, `PARTNER_ADMIN_EMAIL`, the Resend settings and the S3 settings. Do not put these in `VITE_*` variables.
4. Generate `PARTNER_MAIL_SECRET` and `CRON_SECRET` independently from at least 32 random bytes. Keep the mail encryption secret stable: changing it without re-encrypting pending outbox rows makes those messages unreadable.
5. Run `npm run partners:migrate` against the target database before enabling applications.
6. Set `BOOTSTRAP_ADMIN_EMAIL` and a unique `BOOTSTRAP_ADMIN_PASSWORD` of at least 16 characters **for the bootstrap process only**, then run `npm run partners:admin`. Remove those variables immediately afterward. The script refuses to overwrite or promote an existing account.
7. Run `npm run build`, then `npm start`. For port 8788 set `PORT=8788` and `APP_ORIGIN=http://localhost:8788`. If using the Vite dev server, use its origin in `APP_ORIGIN` and keep the API on the configured proxy target, port 8787.

Required settings:

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string, including provider-required SSL configuration |
| `APP_ORIGIN` | Exact public browser origin; used for CSRF checks and invitation links |
| `PARTNER_MAIL_SECRET` | Encrypts outbox bodies, including invitation/recovery links |
| `PARTNER_ADMIN_EMAIL` | Receives new-application and property-review notifications |
| `RESEND_API_KEY`, `MAIL_FROM` | Verified email provider account and sender |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET` | Private image storage location |
| `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | Bucket-scoped storage credentials |
| `CRON_SECRET` | Bearer credential for scheduled maintenance |

If the database is absent, applications and account operations return a clear unavailable response. Renter pages continue operating and the public property list is empty. Missing email credentials leave messages in a visible failed state without discarding applications. Missing photo credentials disable successful upload with a clear error; there is no fake upload fallback.

## Deployment

Vercel uses the handlers in `api/partners/[...path].ts`, `api/out/[id].ts`, `api/partner-page.ts`, and `api/property-sitemap.ts`. `vercel.json` includes the neighborhood data and built HTML in the relevant function bundles, configures public-page rewrites and private-page indexing headers, and schedules `/api/partners/jobs` once daily at 10:00 UTC. Set `CRON_SECRET` in Vercel so scheduled requests carry its bearer token. More frequent scheduling is recommended when the hosting plan permits it.

The standalone server exposes the same routes. Schedule an HTTPS GET to `/api/partners/jobs` with `Authorization: Bearer <CRON_SECRET>` using your infrastructure scheduler. Never put that secret in a query string. Public eligibility checks the pilot end timestamp on **every request**, so listings stop displaying at expiry even if maintenance is delayed. Maintenance marks expired rows, queues near-expiry/expiry email, removes expired sessions/rate buckets, and removes engagement events older than 180 days.

The outbox worker sends at most five messages per pass. Application/approval/recovery and property actions attempt delivery after committing their business transaction. Administrators can retry delivery from `/admin/notifications`; schedule additional worker calls if a backlog develops. Provider idempotency keys and row locks reduce duplicate delivery. Delivery across a provider outage and retries beyond the provider's idempotency retention window cannot be guaranteed exactly once.

Uploads are JSON-wrapped binary images capped at **3 MB per original file**, below Vercel's request-body limit after base64 encoding. Sharp checks actual file contents, caps decoded pixels, strips metadata, auto-rotates, and generates WebP up to 1800 pixels. SVG and executable formats are rejected. Images stay private in object storage and are served only when referenced by an eligible published property, or to an authorized organization/admin. A property can select 12 images; 36 retained uploads per property bounds revision-storage abuse. Removed gallery images remain available to historical review. Establish an archival retention policy and orphan-object cleanup before high-volume operation.

## Routes and API

| UI route | Purpose |
|---|---|
| `/partners` | Public founding-partner offer and FAQ |
| `/partners/apply` | Validated application and confirmation |
| `/partners/login`, `/partners/recover`, `/partners/accept` | Authentication, recovery and single-use activation |
| `/partners/terms`, `/partners/privacy` | Pilot terms and data-use notice |
| `/partner/dashboard`, `/partner/properties` | Organization overview and property history |
| `/partner/properties/new`, `/partner/properties/:id` | Property drafts, photos, submission, withdrawal and archive |
| `/partner/analytics`, `/partner/profile`, `/partner/partnership` | Reporting, profile, commitments and referral link |
| `/admin/partners`, `/admin/properties` | Applications, organizations and property moderation |
| `/admin/partner-analytics`, `/admin/notifications`, `/admin/audit` | Platform reporting, delivery errors and audit history |
| `/properties/:slug` | Eligible public property detail page |

API prefix is `/api/partners/` unless noted:

- Public: `POST apply`, `POST login`, `POST recover`, `POST accept`, `GET public`, `GET neighborhoods?city=...`, `POST events`, `POST referral`.
- Session: `GET me`, `POST logout`, `GET dashboard`, `POST profile`, `GET analytics?days=7|30|90`.
- Properties: `POST properties`, `GET/POST properties/:id`, `POST properties/:id/action`, `POST properties/:id/media`, `GET/POST media/:id` (POST updates alt text).
- Admin: `GET admin/applications?q=&status=&from=&to=`, `POST admin/applications/:id`, `GET admin/organizations`, `POST admin/organizations/:id`, `GET admin/properties`, `GET admin/analytics`, `GET admin/summary`, `GET admin/mail`, `POST admin/mail/retry`, `GET admin/audit`.
- Public outbound: `GET /api/out/:propertyId`. Destination is always loaded from the eligible reviewed property; arbitrary URL parameters are ignored.
- Operational: bearer-protected `GET jobs`; public `/property-sitemap.xml`.

## Security and lifecycle decisions

- Passwords use unique salts and Node's scrypt. Sessions and activation/recovery tokens are random; only token/session hashes are stored. Session cookies are HttpOnly, SameSite=Lax, and Secure with a `__Host-` name when `APP_ORIGIN` is HTTPS. Sessions expire in 12 hours; invites in 72 hours; recovery links in one hour. Password reset revokes existing sessions.
- Every mutation checks exact origin; authenticated mutations also check a session CSRF token. Anonymous engagement endpoints check origin and rate limits. Authentication/application/upload limits are persisted in PostgreSQL, so they apply across server instances. Known bot user agents are excluded from analytics; this is basic filtering, not a guarantee of human traffic.
- Approval locks the application and creates one organization, membership and invitation. Repeated approval is idempotent. Existing platform administrators cannot be attached as applicant representatives. Partner invitations cannot assign platform roles.
- `MAX_PROPERTIES_PER_PARTNER=5` is centralized in domain logic. Each property creation locks the organization's database row before counting all nonarchived properties. Archive actions acquire the same organization lock. A maximum of ten creations in a rolling 90 days bounds replacement rotation, and archive/revision history remains recorded.
- All writes and private reads use server-resolved organization membership. Suspension blocks private organization access and publication. PostgreSQL credentials must not be given to partner clients; this implementation uses application-level authorization, not PostgreSQL row-level security.
- A draft and the last approved public snapshot are separate. Saving an edit resets its review status without changing the public snapshot. Rejection or requested corrections leave that snapshot intact. Withdrawal and archival remove it immediately. Admins verify neighborhood membership before publishing; suggested neighborhoods are not accepted as evidence.
- The 90-day pilot starts once on the first publication, or on explicit admin activation/extension. Approval of more properties does not reset the clock. Expiry keeps all records; it does not bill or delete accounts.
- Property cards are additional information on neighborhood detail pages. They do not modify the ranking engine. Filters enforce advertised rent, bedroom, pets and parking. If a total housing budget or move date cannot be verified, suggestions are withheld. Rent-range overlap is explicitly not a guarantee of a suitable available unit. Availability older than 30 days is called out on detail pages.
- Outbound events retain property/organization, timestamp, broad source, city/neighborhood, optional campaign and a hashed anonymous session. Raw IP addresses are not stored. Events deduplicate per property/type/session within 30-minute buckets. No applications, deposits, sensitive renter profiles or lease outcomes are collected.
- Partner/editor roles are represented in the membership schema; this MVP has no self-service teammate invitation UI. Platform admins are provisioned only through the server bootstrap script.

## Verification and first real partner

Automated checks cover application validation/duplicates, idempotent approval, invitation expiry/reuse, role checks, five-slot concurrency through transactions, edits at the cap, cross-organization access, private drafts/media, image decoding, review, preserved public revisions, suspension, expiry/extension, archive, destination validation, analytics deduplication/bot filtering/isolation, CSRF, session expiry and logout. The HTTP tests use PGlite's PostgreSQL engine; object storage is mocked. The concurrency test exercises serialized transactions; a multi-connection production PostgreSQL stress test is still required after provisioning.

Commands:

```text
npm run build
npm test
PARTNER_BROWSER_TEST=1 npx vitest run tests/partners-http.test.ts
BASE_URL=http://localhost:8788 npm run e2e
BASE_URL=http://localhost:8788 node scripts/ui-responsive.mjs
```

On PowerShell set environment variables with `$env:NAME='value'` before running the command. The browser integration test uses installed Edge by default; set `BROWSER_PATH` to another Chromium executable. It checks the real built screens at 320, 390, 768 and 1440 pixels and writes screenshots under ignored `.e2e/`.

Before the first real partner, verify the configured database migration, a delivered invitation email, a private bucket upload and authorized image retrieval on the deployed domain. Then apply as a Chicago company, approve it as administrator, activate its invitation, create five properties, verify the sixth is blocked, upload a real authorized photograph, submit and approve one listing, check the neighborhood/detail pages, click its official leasing link and inspect analytics. Set a test pilot end into the past to verify disappearance, then extend it and confirm restoration. Repeat one property in a second supported city. Use separate organization accounts to repeat isolation checks on the production provider.

External live delivery, S3/R2 permissions, hosted PostgreSQL concurrency, Vercel cron invocation and deployment behavior were not verified without those service credentials. Existing dependency audit findings in the pre-existing MapLibre and React Router versions also need a separately validated upgrade before declaring the whole application production-ready. This work introduces no payment integration or paid ranking. Future sponsored placements must remain labeled and separate from neighborhood scoring.

## Design verification

Applied `design-taste-frontend`, retaining the existing brand and choosing the editorial greeting direction for the partner workspace. Its primary facts are the real organization name, property slots and pilot dates, with flat reporting tables and a single blue chart color. Browser checks cover public forms, authenticated dashboards, editor, profile, partnership page and admin review. The supplied long marketing headline is kept verbatim; its multi-line wrapping is intentional and takes precedence over the skill's two-line headline heuristic. The renter navigation was removed from partner routes after screenshots revealed it covered mobile content.

Technical references: [node-postgres transactions](https://node-postgres.com/features/transactions), [Resend send-email API](https://resend.com/docs/api-reference/emails/send-email), [Vercel Node runtime](https://vercel.com/docs/functions/runtimes/node-js), [Vercel function limits](https://vercel.com/docs/functions/limitations).

Recorded local results (November 6, 2026): production build and TypeScript checks passed; 66 automated tests passed with the browser-only test skipped in the default run; the separate HTTP/browser run passed all eight checks, including its four-width screen walkthrough; existing renter E2E passed 50/50 checks and the responsive suite passed 20/20 page/width combinations. Server-rendered property metadata and unpublished-page 404 behavior were also checked in the HTTP suite. Live providers and deployed Vercel functions were not exercised.
