import { z } from 'zod';
import {
  randomUUID,
  randomBytes,
  createHash,
  scryptSync,
  timingSafeEqual,
  createCipheriv,
  createDecipheriv,
} from 'node:crypto';
import { isIP } from 'node:net';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { CITIES, isCityId } from '../../src/lib/cities.ts';
import type { DB } from './db.ts';
export const MAX_PROPERTIES_PER_PARTNER = 5;
export const AGREEMENT_VERSION = 'founding-2026-11-v1';
export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}
export function requireThat(value: unknown, message: string, status = 400): asserts value {
  if (!value) throw new HttpError(status, message);
}
export const hash = (value: string) => createHash('sha256').update(value).digest('hex');
export const token = () => randomBytes(32).toString('base64url');
function mailKey() {
  requireThat(
    process.env.PARTNER_MAIL_SECRET && process.env.PARTNER_MAIL_SECRET.length >= 32,
    'Email encryption key is not configured',
    503,
  );
  return createHash('sha256').update(process.env.PARTNER_MAIL_SECRET).digest();
}
export function encryptMail(body: string) {
  const iv = randomBytes(12),
    cipher = createCipheriv('aes-256-gcm', mailKey(), iv);
  const data = Buffer.concat([cipher.update(body, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), data].map((b) => b.toString('base64url')).join('.');
}
export function decryptMail(body: string) {
  const [iv, tag, data] = body.split('.').map((s) => Buffer.from(s, 'base64url'));
  const cipher = createDecipheriv('aes-256-gcm', mailKey(), iv);
  cipher.setAuthTag(tag);
  return Buffer.concat([cipher.update(data), cipher.final()]).toString('utf8');
}
export function passwordHash(password: string) {
  const salt = randomBytes(16).toString('hex');
  return `${salt}:${scryptSync(password, salt, 64).toString('hex')}`;
}
export function passwordMatches(password: string, stored: string) {
  const [salt, digest] = stored.split(':');
  const expected = Buffer.from(digest, 'hex');
  const actual = scryptSync(password, salt, 64);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
export function safeURL(value: string) {
  try {
    const u = new URL(value);
    return (
      u.protocol === 'https:' &&
      !u.username &&
      !u.password &&
      !u.port &&
      !isIP(u.hostname) &&
      u.hostname.includes('.') &&
      !/(localhost|\.local|\.internal|\.test)$/.test(u.hostname) &&
      !u.hostname.startsWith('[')
    );
  } catch {
    return false;
  }
}
const text = z.string().trim().min(1).max(250);
const email = z.string().trim().toLowerCase().email().max(254);
const url = z
  .string()
  .trim()
  .max(2048)
  .refine(safeURL, 'Use a public HTTPS website without credentials or a custom port');
const city = z.string().refine(isCityId, 'Choose a supported city');
export const applicationSchema = z.object({
  company: text,
  website: url,
  businessEmail: email,
  description: z.string().trim().min(20).max(4000),
  operatingLocations: text,
  communityCount: z.number().int().min(1).max(100000),
  contactName: text,
  contactRole: text,
  contactEmail: email,
  phone: z.string().trim().max(40).default(''),
  cities: z.array(city).min(1).max(40),
  comarketing: z.boolean().default(false),
  notes: z.string().max(4000).default(''),
  terms: z.literal(true),
  websiteConfirm: z.string().max(0).default(''),
});
export const propertySchema = z
  .object({
    name: text,
    address: text,
    city,
    state: z.string().length(2),
    zip: z.string().regex(/^\d{5}(-\d{4})?$/),
    neighborhood: z.string().max(100).default(''),
    type: z.enum(['Apartment community', 'Condominium', 'Townhomes', 'Other']),
    description: z.string().trim().min(20).max(6000),
    website: url,
    leasingUrl: url,
    rentMin: z.number().min(1).max(100000),
    rentMax: z.number().min(1).max(100000),
    bedrooms: z.array(z.number().int().min(0).max(6)).min(1).max(7),
    bathrooms: z.number().min(0.5).max(10),
    squareFeet: z.number().min(50).max(30000).nullable().default(null),
    leaseOptions: text,
    pets: z.enum(['allowed', 'not_allowed', 'contact']),
    parking: z.enum(['available', 'not_available', 'contact']),
    availability: z.enum(['contact', 'available', 'unavailable']),
    verifiedAt: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .refine(
        (v) => Number.isFinite(Date.parse(v)) && Date.parse(v) <= Date.now(),
        'Verification cannot be in the future',
      ),
    amenities: z.array(z.string().trim().min(1).max(80)).max(30),
    media: z.array(z.string().uuid()).max(12).default([]),
    advertisingPermission: z.literal(true),
    photoRights: z.boolean().default(false),
  })
  .refine((v) => v.rentMax >= v.rentMin, 'Maximum rent must be at least minimum rent')
  .refine((v) => CITIES.find((c) => c.id === v.city)?.state === v.state, 'City and state must match');
export type PropertyData = z.infer<typeof propertySchema>;
export type Actor = {
  id: string;
  email: string;
  platform_admin: boolean;
  org_id: string | null;
  role: string | null;
  org_status: string | null;
  csrf?: string;
};
export async function audit(
  db: DB,
  actor: string | null,
  org: string | null,
  action: string,
  target: string,
  detail: unknown = {},
) {
  await db.query('INSERT INTO partner_audit(id,actor_id,org_id,action,target,detail) VALUES($1,$2,$3,$4,$5,$6)', [
    randomUUID(),
    actor,
    org,
    action,
    target,
    JSON.stringify(detail),
  ]);
}
export async function mail(db: DB, key: string, to: string, subject: string, body: string) {
  await db.query(
    'INSERT INTO partner_mail(id,dedup_key,recipient,subject,body) VALUES($1,$2,$3,$4,$5) ON CONFLICT(dedup_key) DO NOTHING',
    [randomUUID(), key, to, subject, encryptMail(body)],
  );
}
export async function limit(db: DB, key: string, max: number, seconds = 3600) {
  const { rows } = await db.query(
    `INSERT INTO partner_rate_limits(key,count,expires_at) VALUES($1,1,now()+$2*interval '1 second') ON CONFLICT(key) DO UPDATE SET count=CASE WHEN partner_rate_limits.expires_at<now() THEN 1 ELSE partner_rate_limits.count+1 END, expires_at=CASE WHEN partner_rate_limits.expires_at<now() THEN now()+$2*interval '1 second' ELSE partner_rate_limits.expires_at END RETURNING count`,
    [key, seconds],
  );
  requireThat(rows[0].count <= max, 'Too many requests. Please try again later.', 429);
}
export async function neighborhoods(cityId: string) {
  requireThat(isCityId(cityId), 'Unsupported city');
  const data = JSON.parse(await readFile(resolve(process.env.DATA_DIR ?? 'public/data', `${cityId}.json`), 'utf8'));
  return data.neighborhoods.map((h: { id: string; name: string }) => ({ id: h.id, name: h.name }));
}
export async function propertyAccess(db: DB, actor: Actor, id: string, lock = false) {
  const { rows } = await db.query(
    `SELECT * FROM partner_properties WHERE id=$1 AND ($2::boolean OR org_id=$3)${lock ? ' FOR UPDATE' : ''}`,
    [id, actor.platform_admin, actor.org_id],
  );
  requireThat(rows[0], 'Property not found', 404);
  return rows[0];
}
export async function saveProperty(db: DB, actor: Actor, input: unknown, id?: string) {
  requireThat(actor.org_id && actor.org_status === 'active', 'Active partner account required', 403);
  const data = propertySchema.parse(input);
  const org = actor.org_id;
  // Every insert and archive locks the same organization row. Never use a process-local count.
  const lockedOrg = (await db.query('SELECT id,status FROM partner_organizations WHERE id=$1 FOR UPDATE', [org]))
    .rows[0];
  requireThat(lockedOrg?.status === 'active', 'Organization is suspended', 403);
  const partnership = (await db.query('SELECT status FROM partnerships WHERE org_id=$1', [org])).rows[0];
  requireThat(
    partnership && !['suspended', 'terminated'].includes(partnership.status),
    'Partnership is suspended or terminated',
    403,
  );
  const old = id ? await propertyAccess(db, actor, id, true) : null;
  requireThat(!old || old.status !== 'archived', 'Archived properties cannot be edited');
  if (!id) {
    const count = (
      await db.query("SELECT count(*)::int AS n FROM partner_properties WHERE org_id=$1 AND status<>'archived'", [org])
    ).rows[0].n;
    requireThat(
      count < MAX_PROPERTIES_PER_PARTNER,
      'All five property slots are used. Contact the administrator.',
      409,
    );
    const recent = (
      await db.query(
        "SELECT count(*)::int AS n FROM partner_properties WHERE org_id=$1 AND created_at>now()-interval '90 days'",
        [org],
      )
    ).rows[0].n;
    requireThat(recent < 10, 'Replacement limit reached. Contact the administrator.', 409);
  }
  if (data.neighborhood)
    requireThat(
      (await neighborhoods(data.city)).some((h: { id: string }) => h.id === data.neighborhood),
      'Unknown neighborhood',
    );
  if (data.media.length) {
    requireThat(data.photoRights, 'Confirm photo rights');
    requireThat(!!id, 'Save the property before adding photographs');
    const media = await db.query(
      'SELECT id FROM partner_media WHERE org_id=$1 AND property_id=$2 AND id=ANY($3::uuid[])',
      [org, id, data.media],
    );
    requireThat(media.rows.length === new Set(data.media).size, 'Invalid property photographs');
  }
  const propertyId = id ?? randomUUID();
  const key = `${data.address} ${data.city} ${data.zip}`.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (old)
    await db.query(
      "UPDATE partner_properties SET draft=$2,address_key=$3,status='draft',neighborhood_verified=false,updated_at=now() WHERE id=$1",
      [id, JSON.stringify(data), key],
    );
  else
    await db.query('INSERT INTO partner_properties(id,org_id,slug,draft,address_key) VALUES($1,$2,$3,$4,$5)', [
      propertyId,
      org,
      `${data.name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .slice(0, 65)}-${propertyId.slice(0, 8)}`,
      JSON.stringify(data),
      key,
    ]);
  await db.query('INSERT INTO partner_revisions(id,property_id,actor_id,data,action) VALUES($1,$2,$3,$4,$5)', [
    randomUUID(),
    propertyId,
    actor.id,
    JSON.stringify(data),
    'saved',
  ]);
  await audit(db, actor.id, org, 'property.saved', propertyId);
  return { id: propertyId };
}
export const eligibleSQL = `p.published IS NOT NULL AND p.status<>'archived' AND o.status='active' AND s.status='active' AND s.ends_at>now()`;
type PublicProperty = { id: string; slug: string; org_id: string; data: PropertyData; updated_at: string };
export async function publicProperties(
  db: DB,
  filters: {
    id?: string;
    slug?: string;
    city?: string;
    neighborhood?: string;
    maxRent?: number;
    bedrooms?: number;
    pets?: boolean;
    parking?: boolean;
  } = {},
) {
  const { rows } = await db.query<PublicProperty>(
    `SELECT p.id,p.slug,p.org_id,p.published AS data,p.updated_at FROM partner_properties p JOIN partner_organizations o ON o.id=p.org_id JOIN partnerships s ON s.org_id=p.org_id WHERE ${eligibleSQL} AND ($1::text IS NULL OR p.id::text=$1) AND ($2::text IS NULL OR p.slug=$2) AND ($3::text IS NULL OR p.published->>'city'=$3) AND ($4::text IS NULL OR p.published->>'neighborhood'=$4) ORDER BY p.created_at DESC LIMIT 100`,
    [filters.id ?? null, filters.slug ?? null, filters.city ?? null, filters.neighborhood ?? null],
  );
  const eligible = rows.filter(
    (p) =>
      safeURL(p.data.leasingUrl) &&
      p.data.availability !== 'unavailable' &&
      (!filters.maxRent || p.data.rentMin <= filters.maxRent) &&
      (filters.bedrooms === undefined || p.data.bedrooms.includes(filters.bedrooms)) &&
      (!filters.pets || p.data.pets === 'allowed') &&
      (!filters.parking || p.data.parking === 'available'),
  );
  const ids = eligible.flatMap((p) => p.data.media ?? []);
  const photos = ids.length
    ? (await db.query('SELECT id,alt FROM partner_media WHERE id=ANY($1::uuid[])', [ids])).rows
    : [];
  return eligible.map((p) => ({ ...p, photos: photos.filter((m) => p.data.media.includes(m.id)) }));
}
