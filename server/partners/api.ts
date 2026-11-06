import type { IncomingMessage, ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import sharp from 'sharp';
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { database, transaction, type DB } from './db.ts';
import {
  HttpError,
  requireThat,
  hash,
  token,
  passwordHash,
  passwordMatches,
  limit,
  audit,
  propertyAccess,
  saveProperty,
  publicProperties,
  neighborhoods,
  type Actor,
} from './domain.ts';
import { apply, reviewApplication, issueToken, propertyAction, maintenance, deliverMail } from './workflows.ts';
const secure = () => process.env.APP_ORIGIN?.startsWith('https:');
const cookieName = () => (secure() ? '__Host-partner_session' : 'partner_session');
function cookies(req: IncomingMessage) {
  return Object.fromEntries((req.headers.cookie ?? '').split(';').map((v) => v.trim().split('=')));
}
function reply(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'X-Robots-Tag': 'noindex',
  });
  res.end(JSON.stringify(body));
}
async function body(req: IncomingMessage, max = 100_000): Promise<any> {
  // Vercel parses request bodies before invoking Node handlers; the standalone server leaves the stream intact.
  const parsed = (req as IncomingMessage & { body?: unknown }).body;
  if (parsed !== undefined) {
    const raw = typeof parsed === 'string' ? parsed : JSON.stringify(parsed);
    requireThat(Buffer.byteLength(raw) <= max, 'Request is too large', 413);
    try {
      return JSON.parse(raw);
    } catch {
      throw new HttpError(400, 'Invalid JSON');
    }
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    requireThat(size <= max, 'Request is too large', 413);
    chunks.push(Buffer.from(chunk));
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString());
  } catch {
    throw new HttpError(400, 'Invalid JSON');
  }
}
async function actorFor(req: IncomingMessage, db: DB): Promise<Actor | null> {
  const secret = cookies(req)[cookieName()];
  if (!secret) return null;
  const { rows } = await db.query(
    `SELECT u.id,u.email,u.platform_admin,m.org_id,m.role,o.status AS org_status,s.csrf FROM partner_sessions s JOIN partner_users u ON u.id=s.user_id LEFT JOIN partner_memberships m ON m.user_id=u.id LEFT JOIN partner_organizations o ON o.id=m.org_id WHERE s.hash=$1 AND s.expires_at>now()`,
    [hash(secret)],
  );
  return (rows[0] as Actor) ?? null;
}
function authorized(actor: Actor | null, admin = false): asserts actor is Actor {
  requireThat(actor, 'Please sign in', 401);
  requireThat(!admin || actor.platform_admin, 'Administrator access required', 403);
  requireThat(
    actor.platform_admin || actor.org_status === 'active',
    'Your organization is suspended. Contact the administrator.',
    403,
  );
}
async function session(db: DB, res: ServerResponse, userId: string) {
  const secret = token(),
    csrf = token();
  await db.query(
    "INSERT INTO partner_sessions(hash,user_id,csrf,expires_at) VALUES($1,$2,$3,now()+interval '12 hours')",
    [hash(secret), userId, csrf],
  );
  res.setHeader(
    'Set-Cookie',
    `${cookieName()}=${secret}; HttpOnly; SameSite=Lax; Path=/; Max-Age=43200${secure() ? '; Secure' : ''}`,
  );
  return { ok: true, csrf };
}
function storage() {
  requireThat(
    process.env.S3_BUCKET &&
      process.env.S3_ENDPOINT &&
      process.env.S3_ACCESS_KEY_ID &&
      process.env.S3_SECRET_ACCESS_KEY,
    'Photo storage is not configured',
    503,
  );
  return new S3Client({
    endpoint: process.env.S3_ENDPOINT,
    region: process.env.S3_REGION ?? 'auto',
    forcePathStyle: true,
    credentials: { accessKeyId: process.env.S3_ACCESS_KEY_ID!, secretAccessKey: process.env.S3_SECRET_ACCESS_KEY! },
  });
}
async function event(
  db: DB,
  req: IncomingMessage,
  res: ServerResponse,
  p: any,
  kind: string,
  source: string,
  campaign?: string,
) {
  if (/bot|crawler|spider|headless|preview/i.test(req.headers['user-agent'] ?? '') || req.method === 'HEAD') return;
  let anonymous = cookies(req).ync_visit;
  if (!anonymous || !/^[A-Za-z0-9_-]{43}$/.test(anonymous)) {
    anonymous = token();
    res.setHeader(
      'Set-Cookie',
      `ync_visit=${anonymous}; HttpOnly; SameSite=Lax; Path=/; Max-Age=86400${secure() ? '; Secure' : ''}`,
    );
  }
  const sessionHash = hash(anonymous),
    bucket = Math.floor(Date.now() / 1800000);
  const campaignRow = campaign
    ? (await db.query('SELECT id FROM partner_campaigns WHERE code=$1 AND org_id=$2', [campaign, p.org_id])).rows[0]
    : null;
  await db.query(
    'INSERT INTO partner_events(id,org_id,property_id,kind,source,city,neighborhood,campaign_id,session_hash,dedup_key) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT(dedup_key) DO NOTHING',
    [
      randomUUID(),
      p.org_id,
      p.id,
      kind,
      ['neighborhood', 'property', 'campaign'].includes(source) ? source : 'property',
      p.data.city,
      p.data.neighborhood,
      campaignRow?.id ?? null,
      sessionHash,
      hash(`${p.org_id}:${p.id}:${kind}:${sessionHash}:${bucket}`),
    ],
  );
}
export async function partnerAPI(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const path = url.pathname;
  const method = req.method ?? 'GET';
  try {
    if (path === '/api/partners/neighborhoods' && method === 'GET')
      return reply(res, 200, await neighborhoods(url.searchParams.get('city') ?? ''));
    if (path === '/api/partners/public' && method === 'GET' && !process.env.DATABASE_URL) return reply(res, 200, []);
    if (!process.env.DATABASE_URL)
      throw new HttpError(503, 'Partnership services are not configured yet. Please try again later.');
    const db = database();
    if (path === '/api/partners/jobs') {
      requireThat(
        process.env.CRON_SECRET && req.headers.authorization === `Bearer ${process.env.CRON_SECRET}`,
        'Unauthorized',
        401,
      );
      const result = await transaction(async (tx) => {
        await maintenance(tx);
        return deliverMail(tx);
      });
      return reply(res, 200, result);
    }
    const actor = await actorFor(req, db);
    if (!['GET', 'HEAD'].includes(method)) {
      requireThat(
        process.env.APP_ORIGIN && req.headers.origin === new URL(process.env.APP_ORIGIN).origin,
        'Invalid request origin',
        403,
      );
      requireThat(req.headers['content-type']?.startsWith('application/json'), 'Use application/json', 415);
      if (actor && !['/api/partners/events', '/api/partners/referral'].includes(path))
        requireThat(req.headers['x-csrf-token'] === actor.csrf, 'Your session changed. Reload this page.', 403);
    }
    const ip = hash(
      process.env.VERCEL
        ? String(req.headers['x-forwarded-for'] ?? '').split(',')[0]
        : (req.socket.remoteAddress ?? 'unknown'),
    );
    if (path === '/api/partners/apply' && method === 'POST') {
      await limit(db, `apply:${ip}`, 5);
      const input = await body(req);
      const result = await transaction((tx) => apply(tx, input));
      await dispatch();
      return reply(res, 201, result);
    }
    if (path === '/api/partners/login' && method === 'POST') {
      await limit(db, `login:${ip}`, 20, 900);
      const input = z
        .object({ email: z.string().email().max(254), password: z.string().min(1).max(200) })
        .parse(await body(req));
      await limit(db, `login-email:${hash(input.email.toLowerCase())}`, 10, 900);
      const u = (await db.query('SELECT * FROM partner_users WHERE email=$1', [input.email.toLowerCase()])).rows[0];
      const dummy = '0123456789abcdef0123456789abcdef:'.concat('00'.repeat(64));
      requireThat(
        passwordMatches(input.password, u?.password_hash ?? dummy) && u?.password_hash,
        'Email or password is incorrect',
        401,
      );
      return reply(res, 200, await session(db, res, u.id));
    }
    if (path === '/api/partners/recover' && method === 'POST') {
      await limit(db, `recovery:${ip}`, 5);
      const input = z.object({ email: z.string().email().max(254) }).parse(await body(req));
      const u = (await db.query('SELECT id,email FROM partner_users WHERE email=$1', [input.email.toLowerCase()]))
        .rows[0];
      if (u) await transaction((tx) => issueToken(tx, u.id, 'recovery', u.email));
      await dispatch();
      return reply(res, 200, { ok: true, message: 'If that account exists, a reset link will be emailed.' });
    }
    if (path === '/api/partners/accept' && method === 'POST') {
      await limit(db, `accept:${ip}`, 10);
      const input = z
        .object({ token: z.string().min(40).max(100), password: z.string().min(12).max(200) })
        .parse(await body(req));
      const result = await transaction(async (tx) => {
        const t = (
          await tx.query(
            'SELECT * FROM partner_tokens WHERE hash=$1 AND used_at IS NULL AND expires_at>now() FOR UPDATE',
            [hash(input.token)],
          )
        ).rows[0];
        requireThat(t, 'This link is expired or has already been used', 400);
        await tx.query('UPDATE partner_users SET password_hash=$2 WHERE id=$1', [
          t.user_id,
          passwordHash(input.password),
        ]);
        await tx.query('UPDATE partner_tokens SET used_at=now() WHERE hash=$1', [t.hash]);
        await tx.query('DELETE FROM partner_sessions WHERE user_id=$1', [t.user_id]);
        await audit(tx, t.user_id, null, `account.${t.purpose}`, t.user_id);
        return session(tx, res, t.user_id);
      });
      return reply(res, 200, result);
    }
    if (path === '/api/partners/logout' && method === 'POST') {
      await db.query('DELETE FROM partner_sessions WHERE hash=$1', [hash(cookies(req)[cookieName()] ?? '')]);
      res.setHeader(
        'Set-Cookie',
        `${cookieName()}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secure() ? '; Secure' : ''}`,
      );
      return reply(res, 200, { ok: true });
    }
    if (path === '/api/partners/me') {
      authorized(actor);
      return reply(res, 200, actor);
    }
    if (path === '/api/partners/neighborhoods')
      return reply(res, 200, await neighborhoods(url.searchParams.get('city') ?? ''));
    if (path === '/api/partners/public') {
      const maxRent = url.searchParams.get('maxRent'),
        bedrooms = url.searchParams.get('bedrooms');
      return reply(
        res,
        200,
        await publicProperties(db, {
          slug: url.searchParams.get('slug') ?? undefined,
          city: url.searchParams.get('city') ?? undefined,
          neighborhood: url.searchParams.get('neighborhood') ?? undefined,
          maxRent: maxRent ? Number(maxRent) : undefined,
          bedrooms: bedrooms !== null ? Number(bedrooms) : undefined,
          pets: url.searchParams.get('pets') === 'true',
          parking: url.searchParams.get('parking') === 'true',
        }),
      );
    }
    const outbound = path.match(/^\/api\/out\/([a-f0-9-]{36})$/);
    if (outbound && method === 'GET') {
      const p = (await publicProperties(db, { id: outbound[1] }))[0];
      requireThat(p, 'This listing is not currently available', 404);
      try {
        await event(
          db,
          req,
          res,
          p,
          'outbound',
          url.searchParams.get('source') ?? 'property',
          url.searchParams.get('campaign') ?? undefined,
        );
      } catch {
        /* Valid redirects survive analytics outages. */
      }
      res.writeHead(302, {
        Location: p.data.leasingUrl,
        'Cache-Control': 'no-store',
        'Referrer-Policy': 'no-referrer',
      });
      return res.end();
    }
    if (path === '/api/partners/events' && method === 'POST') {
      await limit(db, `events:${ip}`, 200, 60);
      const input = z
        .object({
          id: z.string().uuid(),
          kind: z.enum(['impression', 'detail']),
          source: z.enum(['neighborhood', 'property', 'campaign']).default('property'),
          campaign: z.string().max(40).optional(),
        })
        .parse(await body(req));
      const p = (await publicProperties(db, { id: input.id }))[0];
      if (p) await event(db, req, res, p, input.kind, input.source, input.campaign);
      return reply(res, 200, { ok: true });
    }
    if (path === '/api/partners/referral' && method === 'POST') {
      await limit(db, `referral:${ip}`, 60, 60);
      const input = z.object({ code: z.string().min(10).max(40) }).parse(await body(req));
      const c = (
        await db.query(
          "SELECT c.* FROM partner_campaigns c JOIN partner_organizations o ON o.id=c.org_id WHERE c.code=$1 AND o.status='active'",
          [input.code],
        )
      ).rows[0];
      if (c)
        await event(
          db,
          req,
          res,
          { id: null, org_id: c.org_id, data: { city: null, neighborhood: null } },
          'referral',
          'campaign',
          input.code,
        );
      return reply(res, 200, { ok: true });
    }
    const mediaMatch = path.match(/^\/api\/partners\/media\/([a-f0-9-]{36})$/);
    if (mediaMatch && method === 'GET') {
      const m = (await db.query('SELECT * FROM partner_media WHERE id=$1', [mediaMatch[1]])).rows[0];
      requireThat(m, 'Photo not found', 404);
      const p = (await publicProperties(db, { id: m.property_id }))[0];
      const publicAllowed = p?.data.media?.includes(m.id);
      if (!publicAllowed) {
        authorized(actor);
        requireThat(actor.platform_admin || actor.org_id === m.org_id, 'Photo not found', 404);
      }
      const object = await storage().send(new GetObjectCommand({ Bucket: process.env.S3_BUCKET, Key: m.object_key }));
      res.writeHead(200, {
        'Content-Type': 'image/webp',
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'private, no-store',
      });
      return res.end(await object.Body!.transformToByteArray());
    }
    if (mediaMatch && method === 'POST') {
      authorized(actor);
      const input = z.object({ alt: z.string().trim().min(1).max(250) }).parse(await body(req));
      const m = (await db.query('SELECT * FROM partner_media WHERE id=$1 AND org_id=$2', [mediaMatch[1], actor.org_id]))
        .rows[0];
      requireThat(m, 'Photo not found', 404);
      await db.query('UPDATE partner_media SET alt=$2 WHERE id=$1', [m.id, input.alt]);
      await audit(db, actor.id, actor.org_id, 'photo.alt_updated', m.id);
      return reply(res, 200, { ok: true });
    }
    const uploadMatch = path.match(/^\/api\/partners\/properties\/([a-f0-9-]{36})\/media$/);
    if (uploadMatch && method === 'POST') {
      authorized(actor);
      const input = z
        .object({ base64: z.string().max(4_000_000), alt: z.string().trim().min(1).max(250), rights: z.literal(true) })
        .parse(await body(req, 4_100_000));
      await limit(db, `upload:${actor.id}`, 30);
      const p = await propertyAccess(db, actor, uploadMatch[1]);
      requireThat(p.status !== 'archived', 'Property is archived');
      const raw = Buffer.from(input.base64, 'base64');
      requireThat(raw.length <= 3_000_000, 'Photos must be at most 3 MB');
      let converted: Buffer;
      try {
        const image = sharp(raw, { limitInputPixels: 40_000_000, animated: false });
        const meta = await image.metadata();
        requireThat(['jpeg', 'png', 'webp'].includes(meta.format ?? ''), 'Use JPEG, PNG or WebP');
        converted = await image
          .rotate()
          .resize({ width: 1800, height: 1800, fit: 'inside', withoutEnlargement: true })
          .webp({ quality: 82 })
          .toBuffer();
      } catch {
        throw new HttpError(400, 'Upload a valid JPEG, PNG or WebP photo (maximum 40 megapixels)');
      }
      const result = await transaction(async (tx) => {
        await propertyAccess(tx, actor, p.id, true);
        const count = (await tx.query('SELECT count(*)::int AS n FROM partner_media WHERE property_id=$1', [p.id]))
          .rows[0].n;
        requireThat(count < 36, 'Photo history limit reached. Contact the administrator.');
        const id = randomUUID(),
          key = `partners/${p.org_id}/${p.id}/${id}.webp`;
        await storage().send(
          new PutObjectCommand({ Bucket: process.env.S3_BUCKET, Key: key, Body: converted, ContentType: 'image/webp' }),
        );
        await tx.query(
          'INSERT INTO partner_media(id,org_id,property_id,object_key,alt,bytes) VALUES($1,$2,$3,$4,$5,$6)',
          [id, p.org_id, p.id, key, input.alt, converted.length],
        );
        await audit(tx, actor.id, p.org_id, 'photo.uploaded', id);
        return { id, alt: input.alt };
      });
      return reply(res, 201, result);
    }
    authorized(actor, path.startsWith('/api/partners/admin'));
    if (path === '/api/partners/dashboard') {
      requireThat(actor.org_id, 'Partner membership required', 403);
      const org = (
        await db.query(
          'SELECT o.*,s.status AS partnership_status,s.starts_at,s.ends_at,s.max_properties,s.commitments,s.logo_permission,s.agreement_version FROM partner_organizations o JOIN partnerships s ON s.org_id=o.id WHERE o.id=$1',
          [actor.org_id],
        )
      ).rows[0];
      const properties = (
        await db.query('SELECT * FROM partner_properties WHERE org_id=$1 ORDER BY created_at DESC', [actor.org_id])
      ).rows;
      const campaigns = (await db.query('SELECT code FROM partner_campaigns WHERE org_id=$1', [actor.org_id])).rows;
      return reply(res, 200, { org, properties, campaigns });
    }
    if (path === '/api/partners/profile' && method === 'POST') {
      requireThat(actor.role === 'partner_admin', 'Partner administrator required', 403);
      const input = z
        .object({
          description: z.string().max(4000),
          phone: z.string().max(40),
          logoPermission: z.boolean(),
          commitments: z
            .array(z.enum(['Launch announcement', 'Social post', 'Backlink', 'Newsletter', 'Relocation resources']))
            .max(5),
        })
        .parse(await body(req));
      await transaction(async (tx) => {
        await tx.query('UPDATE partner_organizations SET profile=profile || $2::jsonb WHERE id=$1', [
          actor.org_id,
          JSON.stringify({ description: input.description, phone: input.phone }),
        ]);
        await tx.query('UPDATE partnerships SET logo_permission=$2,commitments=$3 WHERE org_id=$1', [
          actor.org_id,
          input.logoPermission,
          JSON.stringify(input.commitments),
        ]);
        await audit(tx, actor.id, actor.org_id, 'profile.updated', actor.org_id!);
      });
      return reply(res, 200, { ok: true });
    }
    if (path === '/api/partners/properties' && method === 'POST') {
      const input = await body(req);
      return reply(res, 201, await transaction((tx) => saveProperty(tx, actor, input)));
    }
    const propertyMatch = path.match(/^\/api\/partners\/properties\/([a-f0-9-]{36})(?:\/(action))?$/);
    if (propertyMatch) {
      const id = propertyMatch[1];
      if (method === 'GET') {
        const p = await propertyAccess(db, actor, id);
        const media = (await db.query('SELECT id,alt FROM partner_media WHERE property_id=$1', [id])).rows;
        const revisions = (
          await db.query(
            'SELECT id,action,created_at FROM partner_revisions WHERE property_id=$1 ORDER BY created_at DESC LIMIT 30',
            [id],
          )
        ).rows;
        return reply(res, 200, { ...p, media, revisions });
      }
      if (method === 'POST') {
        const input = await body(req);
        if (propertyMatch[2]) {
          const v = z
            .object({
              action: z.string(),
              note: z.string().max(4000).default(''),
              verified: z.boolean().default(false),
              neighborhood: z.string().max(100).optional(),
            })
            .parse(input);
          const result = await transaction(async (tx) => {
            const p = await propertyAccess(tx, actor, id);
            const currentOrg = (
              await tx.query('SELECT id,status FROM partner_organizations WHERE id=$1 FOR UPDATE', [p.org_id])
            ).rows[0];
            requireThat(actor.platform_admin || currentOrg?.status === 'active', 'Organization is suspended', 403);
            if (actor.platform_admin && v.action === 'approve' && v.neighborhood) {
              requireThat(
                (await neighborhoods(p.draft.city)).some((h: { id: string }) => h.id === v.neighborhood),
                'Unknown neighborhood',
              );
              await tx.query(
                "UPDATE partner_properties SET draft=jsonb_set(draft,'{neighborhood}',to_jsonb($2::text)) WHERE id=$1",
                [id, v.neighborhood],
              );
            }
            return propertyAction(tx, actor, id, v.action, v.note, v.verified);
          });
          await dispatch();
          return reply(res, 200, result);
        }
        return reply(res, 200, await transaction((tx) => saveProperty(tx, actor, input, id)));
      }
    }
    if (path === '/api/partners/analytics' || path === '/api/partners/admin/analytics') {
      const days = Number(url.searchParams.get('days') ?? 30);
      requireThat([7, 30, 90].includes(days), 'Choose 7, 30 or 90 days');
      const org = actor.platform_admin && path.includes('/admin/') ? null : actor.org_id;
      requireThat(org || actor.platform_admin, 'Partner membership required');
      const rows = (
        await db.query(
          `SELECT e.property_id,COALESCE(p.published->>'name',p.draft->>'name','Referral') AS name,e.city,e.kind,count(*)::int AS count FROM partner_events e LEFT JOIN partner_properties p ON p.id=e.property_id WHERE ($1::uuid IS NULL OR e.org_id=$1) AND e.created_at>now()-$2*interval '1 day' GROUP BY e.property_id,p.published->>'name',p.draft->>'name',e.city,e.kind ORDER BY count DESC`,
          [org, days],
        )
      ).rows;
      const daily = (
        await db.query(
          "SELECT to_char(created_at,'YYYY-MM-DD') AS day,kind,count(*)::int AS count FROM partner_events WHERE ($1::uuid IS NULL OR org_id=$1) AND created_at>now()-$2*interval '1 day' GROUP BY day,kind ORDER BY day",
          [org, days],
        )
      ).rows;
      return reply(res, 200, { rows, daily, days });
    }
    if (path === '/api/partners/admin/applications' && method === 'GET') {
      const search = (url.searchParams.get('q') ?? '').slice(0, 100),
        status = url.searchParams.get('status') || null;
      const from = url.searchParams.get('from') || null,
        to = url.searchParams.get('to') || null;
      requireThat(
        [from, to].every((v) => !v || /^\d{4}-\d{2}-\d{2}$/.test(v)),
        'Invalid date filter',
      );
      return reply(
        res,
        200,
        (
          await db.query(
            "SELECT * FROM partner_applications WHERE ($1::text IS NULL OR status=$1) AND (data::text ILIKE '%'||$2||'%') AND ($3::date IS NULL OR created_at >= $3::date) AND ($4::date IS NULL OR created_at < $4::date+interval '1 day') ORDER BY created_at DESC LIMIT 200",
            [status, search, from, to],
          )
        ).rows,
      );
    }
    if (path === '/api/partners/admin/summary') {
      const days = Number(url.searchParams.get('days') ?? 30);
      requireThat([7, 30, 90].includes(days), 'Choose 7, 30 or 90 days');
      const counts = (
        await db.query(
          `SELECT (SELECT count(*)::int FROM partner_applications WHERE created_at>now()-$1*interval '1 day') AS applications,(SELECT count(*)::int FROM partner_applications WHERE status='approved') AS approved,(SELECT count(*)::int FROM partnerships s JOIN partner_organizations o ON o.id=s.org_id WHERE s.status='active' AND s.ends_at>now() AND o.status='active') AS active,(SELECT count(*)::int FROM partnerships WHERE status='expired' OR ends_at<=now()) AS expired,(SELECT count(*)::int FROM partner_properties p JOIN partnerships s ON s.org_id=p.org_id JOIN partner_organizations o ON o.id=p.org_id WHERE p.published IS NOT NULL AND p.status<>'archived' AND s.status='active' AND s.ends_at>now() AND o.status='active') AS published,(SELECT count(*)::int FROM partner_properties WHERE status='pending_review') AS pending`,
          [days],
        )
      ).rows[0];
      const organizations = (
        await db.query(
          "SELECT o.name,e.kind,count(*)::int AS count FROM partner_events e JOIN partner_organizations o ON o.id=e.org_id WHERE e.created_at>now()-$1*interval '1 day' GROUP BY o.name,e.kind ORDER BY count DESC LIMIT 30",
          [days],
        )
      ).rows;
      const cities = (
        await db.query(
          "SELECT city,kind,count(*)::int AS count FROM partner_events WHERE created_at>now()-$1*interval '1 day' GROUP BY city,kind ORDER BY count DESC LIMIT 30",
          [days],
        )
      ).rows;
      return reply(res, 200, { counts, organizations, cities });
    }
    const applicationMatch = path.match(/^\/api\/partners\/admin\/applications\/([a-f0-9-]{36})$/);
    if (applicationMatch && method === 'POST') {
      const v = z.object({ action: z.string(), note: z.string().max(4000).default('') }).parse(await body(req));
      const result = await transaction((tx) => reviewApplication(tx, actor, applicationMatch[1], v.action, v.note));
      await dispatch();
      return reply(res, 200, result);
    }
    if (path === '/api/partners/admin/organizations')
      return reply(
        res,
        200,
        (
          await db.query(
            "SELECT o.*,s.status AS partnership_status,s.starts_at,s.ends_at,(SELECT count(*)::int FROM partner_properties p WHERE p.org_id=o.id AND p.status<>'archived') AS property_count FROM partner_organizations o JOIN partnerships s ON s.org_id=o.id ORDER BY o.created_at DESC",
          )
        ).rows,
      );
    const orgMatch = path.match(/^\/api\/partners\/admin\/organizations\/([a-f0-9-]{36})$/);
    if (orgMatch && method === 'POST') {
      const v = z
        .object({
          action: z.enum(['suspend', 'reactivate', 'extend', 'invite']),
          days: z.number().int().min(1).max(365).default(90),
        })
        .parse(await body(req));
      await transaction(async (tx) => {
        const o = (await tx.query('SELECT * FROM partner_organizations WHERE id=$1 FOR UPDATE', [orgMatch[1]])).rows[0];
        requireThat(o, 'Partner not found', 404);
        if (v.action === 'suspend' || v.action === 'reactivate')
          await tx.query('UPDATE partner_organizations SET status=$2 WHERE id=$1', [
            o.id,
            v.action === 'suspend' ? 'suspended' : 'active',
          ]);
        if (v.action === 'extend')
          await tx.query(
            "UPDATE partnerships SET status='active',starts_at=COALESCE(starts_at,now()),ends_at=GREATEST(COALESCE(ends_at,now()),now())+$2*interval '1 day' WHERE org_id=$1",
            [o.id, v.days],
          );
        if (v.action === 'invite') {
          const u = (
            await tx.query(
              'SELECT u.id,u.email FROM partner_users u JOIN partner_memberships m ON m.user_id=u.id WHERE m.org_id=$1',
              [o.id],
            )
          ).rows[0];
          await issueToken(tx, u.id, 'invite', u.email);
        }
        await audit(tx, actor.id, o.id, `organization.${v.action}`, o.id, { days: v.days });
      });
      await dispatch();
      return reply(res, 200, { ok: true });
    }
    if (path === '/api/partners/admin/properties')
      return reply(
        res,
        200,
        (
          await db.query(
            'SELECT p.*,o.name AS company FROM partner_properties p JOIN partner_organizations o ON o.id=p.org_id ORDER BY p.updated_at DESC LIMIT 200',
          )
        ).rows,
      );
    if (path === '/api/partners/admin/mail')
      return reply(
        res,
        200,
        (
          await db.query(
            'SELECT id,recipient,subject,status,attempts,error,created_at FROM partner_mail ORDER BY created_at DESC LIMIT 100',
          )
        ).rows,
      );
    if (path === '/api/partners/admin/mail/retry' && method === 'POST') {
      return reply(
        res,
        200,
        await transaction(async (tx) => {
          await tx.query("UPDATE partner_mail SET attempts=0 WHERE status='failed'");
          return deliverMail(tx);
        }),
      );
    }
    if (path === '/api/partners/admin/audit')
      return reply(res, 200, (await db.query('SELECT * FROM partner_audit ORDER BY created_at DESC LIMIT 200')).rows);
    throw new HttpError(404, 'Endpoint not found');
  } catch (error) {
    if (error instanceof z.ZodError)
      return reply(res, 400, { error: error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') });
    if (error instanceof HttpError) return reply(res, error.status, { error: error.message });
    if ((error as { code?: string }).code === '23505')
      return reply(res, 409, { error: 'This company, email or property address is already registered.' });
    console.error('Partnership request failed', path, (error as { code?: string }).code ?? (error as Error).name);
    return reply(res, 503, { error: 'Partnership services are temporarily unavailable. Please try again.' });
  }
}
async function dispatch() {
  try {
    await transaction(deliverMail);
  } catch {
    /* Durable outbox is retried by the scheduled worker. */
  }
}
