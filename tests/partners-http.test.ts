import { beforeAll, afterAll, describe, it, expect, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { createServer, type Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import sharp from 'sharp';
import { chromium } from 'playwright-core';
import { resolve, extname } from 'node:path';
const shared = vi.hoisted(() => ({ db: null as any, objects: new Map<string, Uint8Array>() }));
vi.mock('../server/partners/db.ts', () => ({
  database: () => shared.db,
  transaction: (fn: any) => shared.db.transaction(fn),
}));
vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: class {
    async send(c: any) {
      if (c.input.Body) {
        shared.objects.set(c.input.Key, c.input.Body);
        return {};
      }
      const bytes = shared.objects.get(c.input.Key);
      return { Body: { transformToByteArray: async () => bytes } };
    }
  },
  PutObjectCommand: class {
    input: any;
    constructor(input: any) {
      this.input = input;
    }
  },
  GetObjectCommand: class {
    input: any;
    constructor(input: any) {
      this.input = input;
    }
  },
}));
import { partnerAPI } from '../server/partners/api.ts';
import { passwordHash, decryptMail, hash } from '../server/partners/domain.ts';
import { publicPageHTML } from '../server/partners/pages.ts';
let pg: PGlite,
  server: Server,
  origin: string,
  adminCookie = '',
  adminCsrf = '',
  partnerCookie = '',
  partnerCsrf = '',
  propertyId = '',
  orgId = '';
const app = {
  company: 'HTTP Workflow Company',
  website: 'https://http-workflow.example.org',
  businessEmail: 'office@example.org',
  description: 'A company created only inside the isolated HTTP integration test.',
  operatingLocations: 'Chicago, IL',
  communityCount: 5,
  contactName: 'Integration Representative',
  contactRole: 'Director',
  contactEmail: 'partner@example.org',
  cities: ['chicago'],
  terms: true,
};
const property = {
  name: 'HTTP Test Apartments',
  address: '100 HTTP Avenue',
  city: 'chicago',
  state: 'IL',
  zip: '60608',
  neighborhood: 'chi-31',
  type: 'Apartment community',
  description: 'An isolated test property for the full application workflow.',
  website: 'https://http-workflow.example.org',
  leasingUrl: 'https://http-workflow.example.org/lease',
  rentMin: 1400,
  rentMax: 2100,
  bedrooms: [1],
  bathrooms: 1,
  leaseOptions: '12 months',
  pets: 'allowed',
  parking: 'available',
  availability: 'contact',
  verifiedAt: new Date().toISOString().slice(0, 10),
  amenities: [],
  media: [],
  advertisingPermission: true,
  photoRights: true,
};
async function request(path: string, data?: unknown, cookie = '', csrf = '', extra: Record<string, string> = {}) {
  return fetch(`${origin}${path}`, {
    method: data === undefined ? 'GET' : 'POST',
    headers: {
      Origin: origin,
      ...(data === undefined ? {} : { 'Content-Type': 'application/json' }),
      Cookie: cookie,
      'X-CSRF-Token': csrf,
      'User-Agent': 'Integration browser',
      ...extra,
    },
    body: data === undefined ? undefined : JSON.stringify(data),
    redirect: 'manual',
  });
}
const value = async (r: Response) => r.json();
beforeAll(async () => {
  pg = new PGlite();
  await pg.exec(await readFile(new URL('../server/partners/schema.sql', import.meta.url), 'utf8'));
  shared.db = pg;
  process.env.DATABASE_URL = 'postgres://test-only';
  process.env.PARTNER_MAIL_SECRET = 'http-test-mail-secret-not-for-production-12345';
  process.env.S3_ENDPOINT = 'https://storage.example.org';
  process.env.S3_BUCKET = 'private';
  process.env.S3_ACCESS_KEY_ID = 'test';
  process.env.S3_SECRET_ACCESS_KEY = 'test';
  delete process.env.RESEND_API_KEY;
  server = createServer(async (req, res) => {
    if (req.url?.startsWith('/api/')) return partnerAPI(req, res);
    try {
      const path = new URL(req.url ?? '/', 'http://localhost').pathname;
      const file = resolve(
        'dist',
        path.startsWith('/assets/') || path.startsWith('/fonts/') || path.startsWith('/images/')
          ? `.${path}`
          : 'index.html',
      );
      const mime: Record<string, string> = {
        '.html': 'text/html',
        '.js': 'application/javascript',
        '.css': 'text/css',
        '.woff2': 'font/woff2',
        '.jpg': 'image/jpeg',
      };
      res.writeHead(200, { 'Content-Type': mime[extname(file)] ?? 'application/octet-stream' });
      res.end(await readFile(file));
    } catch {
      res.writeHead(404);
      res.end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${(server.address() as any).port}`;
  process.env.APP_ORIGIN = origin;
  await pg.query<any>('INSERT INTO partner_users(id,email,password_hash,platform_admin) VALUES($1,$2,$3,true)', [
    randomUUID(),
    'admin@example.org',
    passwordHash('admin test password 123'),
  ]);
}, 30000);
afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await pg.close();
});
describe('HTTP authorization and acceptance workflow', () => {
  it('rejects foreign origins, validates applications and keeps failed mail visible', async () => {
    expect((await request('/api/partners/apply', app, '', '', { Origin: 'https://evil.example.org' })).status).toBe(
      403,
    );
    expect((await request('/api/partners/apply', { ...app, contactEmail: 'invalid' })).status).toBe(400);
    expect((await request('/api/partners/apply', app)).status).toBe(201);
    expect((await request('/api/partners/apply', app)).status).toBe(409);
    expect((await pg.query<any>('SELECT status FROM partner_mail')).rows[0]).toMatchObject({ status: 'failed' });
  });
  it('protects admin routes and issues a secure server session with CSRF protection', async () => {
    expect((await request('/api/partners/admin/applications')).status).toBe(401);
    const login = await request('/api/partners/login', {
      email: 'admin@example.org',
      password: 'admin test password 123',
    });
    expect(login.status).toBe(200);
    adminCookie = login.headers.get('set-cookie')!.split(';')[0];
    expect(login.headers.get('set-cookie')).toContain('HttpOnly');
    adminCsrf = (await value(login)).csrf;
    const application = (await pg.query<any>('SELECT id FROM partner_applications')).rows[0] as any;
    expect(
      (await request(`/api/partners/admin/applications/${application.id}`, { action: 'approve' }, adminCookie)).status,
    ).toBe(403);
    expect(
      (
        await request(
          `/api/partners/admin/applications/${application.id}`,
          { action: 'approve' },
          adminCookie,
          adminCsrf,
        )
      ).status,
    ).toBe(200);
    orgId = (await pg.query<any>('SELECT id FROM partner_organizations')).rows[0].id as string;
  });
  it('accepts a single-use invitation, rejects reuse and expiry, and grants only partner access', async () => {
    const mail = (await pg.query<any>("SELECT body FROM partner_mail WHERE subject='Your founding partner invitation'"))
      .rows[0] as any;
    const secret = decryptMail(mail.body).match(/#token=([\w-]+)/)![1];
    const accept = await request('/api/partners/accept', { token: secret, password: 'partner test password 123' });
    expect(accept.status).toBe(200);
    partnerCookie = accept.headers.get('set-cookie')!.split(';')[0];
    partnerCsrf = (await value(accept)).csrf;
    expect(
      (await request('/api/partners/accept', { token: secret, password: 'replacement password 123' })).status,
    ).toBe(400);
    expect((await request('/api/partners/admin/applications', undefined, partnerCookie)).status).toBe(403);
    const expired = 'x'.repeat(43),
      uid = (await pg.query<any>('SELECT user_id FROM partner_memberships')).rows[0].user_id;
    await pg.query<any>(
      "INSERT INTO partner_tokens(hash,user_id,purpose,expires_at) VALUES($1,$2,'invite',now()-interval '1 hour')",
      [hash(expired), uid],
    );
    expect(
      (await request('/api/partners/accept', { token: expired, password: 'replacement password 123' })).status,
    ).toBe(400);
  });
  it('creates a property, validates and uploads a real image, then publishes only after review', async () => {
    const create = await request('/api/partners/properties', property, partnerCookie, partnerCsrf);
    expect(create.status).toBe(201);
    propertyId = (await value(create)).id;
    expect(
      (
        await request(
          `/api/partners/properties/${propertyId}/media`,
          {
            base64: Buffer.from('<svg onload="alert(1)"></svg>').toString('base64'),
            alt: 'Invalid image',
            rights: true,
          },
          partnerCookie,
          partnerCsrf,
        )
      ).status,
    ).toBe(400);
    const image = await sharp({ create: { width: 40, height: 40, channels: 3, background: '#223344' } })
      .png()
      .toBuffer();
    const upload = await request(
      `/api/partners/properties/${propertyId}/media`,
      { base64: image.toString('base64'), alt: 'Test apartment exterior', rights: true },
      partnerCookie,
      partnerCsrf,
    );
    expect(upload.status).toBe(201);
    const media = await value(upload);
    expect((await request(`/api/partners/media/${media.id}`)).status).toBe(401);
    expect(
      (
        await request(
          `/api/partners/properties/${propertyId}`,
          { ...property, media: [media.id] },
          partnerCookie,
          partnerCsrf,
        )
      ).status,
    ).toBe(200);
    expect(await value(await request('/api/partners/public'))).toHaveLength(0);
    await request(`/api/partners/properties/${propertyId}/action`, { action: 'submit' }, partnerCookie, partnerCsrf);
    expect(
      (
        await request(
          `/api/partners/properties/${propertyId}/action`,
          { action: 'approve', verified: true },
          adminCookie,
          adminCsrf,
        )
      ).status,
    ).toBe(200);
    expect(await value(await request('/api/partners/public?city=chicago&neighborhood=chi-31'))).toHaveLength(1);
    expect((await request(`/api/partners/media/${media.id}`)).headers.get('content-type')).toBe('image/webp');
    const p = (await value(await request('/api/partners/public')))[0];
    const html = await publicPageHTML(
      `/properties/${p.slug}`,
      '<html><head><title>Test</title></head><body><div id="root"></div></body></html>',
    );
    expect(html.status).toBe(200);
    expect(html.html).toContain('application/ld+json');
    expect(html.html).toContain('rel="canonical"');
    expect(html.html).toContain(property.name);
  });
  it('redirects only to the reviewed leasing URL and deduplicates events while excluding bots', async () => {
    const first = await request(`/api/out/${propertyId}?url=https://evil.example.org`);
    expect(first.status).toBe(302);
    expect(first.headers.get('location')).toBe(property.leasingUrl);
    const cookie = first.headers.get('set-cookie')!.split(';')[0];
    await request(`/api/out/${propertyId}`, undefined, cookie);
    await request(`/api/out/${propertyId}`, undefined, '', '', { 'User-Agent': 'Googlebot' });
    const events = await pg.query<any>("SELECT * FROM partner_events WHERE kind='outbound'");
    expect(events.rows).toHaveLength(1);
    const analytics = await value(await request('/api/partners/analytics?days=7', undefined, partnerCookie));
    expect(analytics.rows[0].count).toBe(1);
    const summary = await request('/api/partners/admin/summary?days=30', undefined, adminCookie);
    expect(summary.status).toBe(200);
    expect((await value(summary)).counts.published).toBe(1);
    expect(
      (await request('/api/partners/admin/applications?from=2020-01-01&to=2099-01-01', undefined, adminCookie)).status,
    ).toBe(200);
  });
  it('isolates another organization across properties, media, writes and analytics', async () => {
    const uid = randomUUID(),
      otherOrg = randomUUID(),
      secret = 'y'.repeat(43);
    await pg.query<any>('INSERT INTO partner_users(id,email) VALUES($1,$2)', [uid, 'other@example.org']);
    await pg.query<any>('INSERT INTO partner_organizations(id,name) VALUES($1,$2)', [otherOrg, 'Other organization']);
    await pg.query<any>('INSERT INTO partner_memberships(user_id,org_id) VALUES($1,$2)', [uid, otherOrg]);
    await pg.query<any>(
      "INSERT INTO partner_sessions(hash,user_id,csrf,expires_at) VALUES($1,$2,'other-csrf',now()+interval '1 hour')",
      [hash(secret), uid],
    );
    const cookie = `partner_session=${secret}`;
    expect((await request(`/api/partners/properties/${propertyId}`, undefined, cookie)).status).toBe(404);
    expect(
      (await request(`/api/partners/properties/${propertyId}/action`, { action: 'archive' }, cookie, 'other-csrf'))
        .status,
    ).toBe(404);
    expect((await value(await request('/api/partners/analytics', undefined, cookie))).rows).toHaveLength(0);
    await request(`/api/partners/properties/${propertyId}/action`, { action: 'withdraw' }, partnerCookie, partnerCsrf);
    const media = (await pg.query<any>('SELECT id FROM partner_media')).rows[0].id;
    expect((await request(`/api/partners/media/${media}`, undefined, cookie)).status).toBe(404);
    expect((await request(`/api/out/${propertyId}`)).status).toBe(404);
    const p = (await pg.query<any>('SELECT slug FROM partner_properties WHERE id=$1', [propertyId])).rows[0];
    expect(
      (await publicPageHTML(`/properties/${p.slug}`, '<html><head></head><body><div id="root"></div></body></html>'))
        .status,
    ).toBe(404);
  });
  it('blocks suspended organizations and expired sessions, and supports logout', async () => {
    await request(`/api/partners/admin/organizations/${orgId}`, { action: 'suspend' }, adminCookie, adminCsrf);
    expect((await request('/api/partners/properties', property, partnerCookie, partnerCsrf)).status).toBe(403);
    await request(`/api/partners/admin/organizations/${orgId}`, { action: 'reactivate' }, adminCookie, adminCsrf);
    const logout = await request('/api/partners/logout', {}, partnerCookie, partnerCsrf);
    expect(logout.status).toBe(200);
    expect((await request('/api/partners/dashboard', undefined, partnerCookie)).status).toBe(401);
    await pg.query<any>("UPDATE partner_sessions SET expires_at=now()-interval '1 second'");
    expect((await request('/api/partners/admin/applications', undefined, adminCookie)).status).toBe(401);
  });
  it.skipIf(process.env.PARTNER_BROWSER_TEST !== '1')(
    'renders the real partner and admin workflows at desktop, tablet and phone widths',
    async () => {
      const browser = await chromium.launch({
        executablePath: process.env.BROWSER_PATH ?? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
        headless: true,
      });
      try {
        const page = await browser.newPage();
        const errors: string[] = [];
        page.on('pageerror', (e) => errors.push(e.message));
        for (const width of [1440, 768, 390, 320]) {
          await page.setViewportSize({ width, height: 900 });
          for (const route of ['/partners', '/partners/apply', '/partners/login']) {
            await page.goto(origin + route);
            await page.locator('h1').waitFor();
            expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
            if (width === 1440 || width === 390)
              await page.screenshot({ path: `.e2e/partners-${route.split('/').pop()}-${width}.png`, fullPage: true });
          }
        }
        await page.getByLabel('Email', { exact: true }).fill('partner@example.org');
        await page.getByLabel('Password', { exact: true }).fill('partner test password 123');
        await page.getByRole('button', { name: 'Sign in', exact: true }).click();
        await page.waitForURL('**/partner/dashboard');
        for (const width of [1440, 768, 390, 320]) {
          await page.setViewportSize({ width, height: 900 });
          for (const route of [
            '/partner/dashboard',
            `/partner/properties/${propertyId}`,
            '/partner/analytics',
            '/partner/profile',
            '/partner/partnership',
          ]) {
            await page.goto(origin + route);
            await page.locator('h1').waitFor();
            expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
            if (width === 1440 || width === 390)
              await page.screenshot({
                path: `.e2e/partners-${route.includes('/properties/') ? 'editor' : route.split('/').pop()}-${width}.png`,
                fullPage: true,
              });
          }
        }
        await page.getByRole('button', { name: 'Sign out' }).click();
        await page.waitForURL('**/partners/login');
        await page.getByLabel('Email', { exact: true }).fill('admin@example.org');
        await page.getByLabel('Password', { exact: true }).fill('admin test password 123');
        await page.getByRole('button', { name: 'Sign in', exact: true }).click();
        await page.waitForURL('**/admin/partners');
        await page.locator('h1').waitFor();
        await page.screenshot({ path: '.e2e/partners-admin-390.png', fullPage: true });
        await page.getByText('HTTP Workflow Company', { exact: true }).first().click();
        expect(await page.getByRole('button', { name: 'Approve & invite' }).isDisabled()).toBe(true);
        expect(errors).toEqual([]);
      } finally {
        await browser.close();
      }
    },
    120000,
  );
});
