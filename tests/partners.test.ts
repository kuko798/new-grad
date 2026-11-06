import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { apply, reviewApplication, propertyAction, maintenance } from '../server/partners/workflows.ts';
import {
  saveProperty,
  publicProperties,
  propertyAccess,
  passwordHash,
  passwordMatches,
  safeURL,
  neighborhoods,
  type Actor,
} from '../server/partners/domain.ts';
import type { DB } from '../server/partners/db.ts';
let pg: PGlite;
let db: DB;
let admin: Actor;
let partner: Actor;
let outsider: Actor;
const application = {
  company: 'Lakefront Residential Test',
  website: 'https://lakefront-example.org',
  businessEmail: 'office@lakefront-example.org',
  description: 'A test property management company operating in Chicago.',
  operatingLocations: 'Chicago, IL',
  communityCount: 8,
  contactName: 'Test Representative',
  contactRole: 'Leasing director',
  contactEmail: 'representative@lakefront-example.org',
  cities: ['chicago'],
  terms: true,
};
const draft = (n: number) => ({
  name: `Test Community ${n}`,
  address: `${100 + n} Test Avenue`,
  city: 'chicago',
  state: 'IL',
  zip: '60608',
  neighborhood: 'chi-31',
  type: 'Apartment community',
  description: 'An authorized test community used only for automated validation.',
  website: 'https://lakefront-example.org',
  leasingUrl: 'https://lakefront-example.org/leasing',
  rentMin: 1400,
  rentMax: 2200,
  bedrooms: [1, 2],
  bathrooms: 1,
  squareFeet: 800,
  leaseOptions: '12 months',
  pets: 'allowed',
  parking: 'available',
  availability: 'contact',
  verifiedAt: new Date().toISOString().slice(0, 10),
  amenities: ['Elevator'],
  media: [],
  advertisingPermission: true,
});
const tx = <T>(fn: (db: DB) => Promise<T>) => pg.transaction((p) => fn(p as unknown as DB));
beforeAll(async () => {
  process.env.APP_ORIGIN = 'http://localhost:8788';
  process.env.PARTNER_MAIL_SECRET = 'test-only-mail-key-not-for-production-123456';
  pg = new PGlite();
  await pg.exec(await readFile(new URL('../server/partners/schema.sql', import.meta.url), 'utf8'));
  db = pg as unknown as DB;
  admin = {
    id: randomUUID(),
    email: 'admin@example.org',
    platform_admin: true,
    org_id: null,
    role: null,
    org_status: null,
  };
  await db.query('INSERT INTO partner_users(id,email,platform_admin) VALUES($1,$2,true)', [admin.id, admin.email]);
}, 30000);
afterAll(async () => {
  await pg.close();
});
describe('founding partnership workflow', () => {
  it('validates and persists applications, rejects duplicate companies and invalid submissions', async () => {
    await expect(tx((d) => apply(d, { ...application, terms: false }))).rejects.toThrow();
    const result = await tx((d) => apply(d, application));
    expect(result.status).toBe('pending');
    await expect(tx((d) => apply(d, application))).rejects.toThrow();
    expect((await db.query('SELECT * FROM partner_applications')).rows).toHaveLength(1);
  });
  it('requires admin and approves once with one organization and hashed invitation', async () => {
    const id = (await db.query('SELECT id FROM partner_applications')).rows[0].id;
    await expect(
      tx((d) => reviewApplication(d, { ...admin, platform_admin: false }, id, 'approve', '')),
    ).rejects.toThrow('Administrator');
    await tx((d) => reviewApplication(d, admin, id, 'approve', ''));
    await tx((d) => reviewApplication(d, admin, id, 'approve', ''));
    expect((await db.query('SELECT * FROM partner_organizations')).rows).toHaveLength(1);
    const org = (await db.query('SELECT * FROM partner_organizations')).rows[0];
    const u = (await db.query('SELECT * FROM partner_users WHERE platform_admin=false')).rows[0];
    partner = {
      id: u.id,
      email: u.email,
      platform_admin: false,
      org_id: org.id,
      role: 'partner_admin',
      org_status: 'active',
    };
    outsider = { ...partner, id: randomUUID(), org_id: randomUUID() };
    const t = (await db.query('SELECT * FROM partner_tokens')).rows[0];
    expect(t.hash).toMatch(/^[a-f0-9]{64}$/);
    expect(t.used_at).toBeNull();
    const s = (await db.query('SELECT * FROM partnerships')).rows[0];
    expect(s.starts_at).toBeNull();
    expect(s.status).toBe('invited');
    expect(u.platform_admin).toBe(false);
  });
  it('allows five concurrent draft creations and refuses a sixth, without restricting edits', async () => {
    const results = await Promise.allSettled(
      Array.from({ length: 6 }, (_, n) => tx((d) => saveProperty(d, partner, draft(n)))),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(5);
    expect((await db.query('SELECT * FROM partner_properties')).rows).toHaveLength(5);
    const p = (await db.query('SELECT * FROM partner_properties ORDER BY created_at')).rows[0];
    await tx((d) => saveProperty(d, partner, { ...p.draft, name: 'Updated community' }, p.id));
    await expect(propertyAccess(db, outsider, p.id)).rejects.toThrow('not found');
    await expect(tx((d) => saveProperty(d, outsider, p.draft, p.id))).rejects.toThrow();
  });
  it('keeps drafts private, requires review and address verification, then starts the pilot', async () => {
    expect(await publicProperties(db)).toHaveLength(0);
    const p = (await db.query('SELECT * FROM partner_properties ORDER BY created_at')).rows[0];
    await tx((d) => propertyAction(d, partner, p.id, 'submit'));
    await expect(tx((d) => propertyAction(d, partner, p.id, 'approve', '', true))).rejects.toThrow('Administrator');
    await expect(tx((d) => propertyAction(d, admin, p.id, 'approve', '', false))).rejects.toThrow('Verify');
    await tx((d) => propertyAction(d, admin, p.id, 'approve', 'Address verified', true));
    const pub = await publicProperties(db, { city: 'chicago', neighborhood: 'chi-31' });
    expect(pub).toHaveLength(1);
    expect(await publicProperties(db, { city: 'austin' })).toHaveLength(0);
    expect(await publicProperties(db, { maxRent: 1000 })).toHaveLength(0);
    expect(await publicProperties(db, { bedrooms: 3 })).toHaveLength(0);
    const s = (await db.query('SELECT * FROM partnerships')).rows[0];
    expect(s.status).toBe('active');
    expect(s.starts_at).not.toBeNull();
    expect(new Date(s.ends_at).getTime() - new Date(s.starts_at).getTime()).toBe(90 * 86400000);
  });
  it('preserves approved content while edits await review; rejects foreign photos', async () => {
    const p = (await publicProperties(db))[0];
    await expect(
      tx((d) => saveProperty(d, partner, { ...p.data, media: [randomUUID()], photoRights: true }, p.id)),
    ).rejects.toThrow('photographs');
    await tx((d) => saveProperty(d, partner, { ...p.data, name: 'Unreviewed replacement' }, p.id));
    expect((await publicProperties(db))[0].data.name).toBe('Updated community');
    await tx((d) => propertyAction(d, partner, p.id, 'submit'));
    await tx((d) => propertyAction(d, admin, p.id, 'changes_requested', 'Correct the rent'));
    expect((await publicProperties(db))[0].data.name).toBe('Updated community');
  });
  it('hides suspended and expired partnerships immediately; maintenance preserves records', async () => {
    await db.query("UPDATE partner_organizations SET status='suspended' WHERE id=$1", [partner.org_id]);
    expect(await publicProperties(db)).toHaveLength(0);
    await db.query("UPDATE partner_organizations SET status='active' WHERE id=$1", [partner.org_id]);
    await db.query("UPDATE partnerships SET ends_at=now()-interval '1 day' WHERE org_id=$1", [partner.org_id]);
    expect(await publicProperties(db)).toHaveLength(0);
    await tx(maintenance);
    expect((await db.query('SELECT status FROM partnerships')).rows[0].status).toBe('expired');
    expect((await db.query('SELECT * FROM partner_properties')).rows).toHaveLength(5);
    await db.query("UPDATE partnerships SET status='active',ends_at=now()+interval '90 days' WHERE org_id=$1", [
      partner.org_id,
    ]);
    expect(await publicProperties(db)).toHaveLength(1);
  });
  it('archives immediately and frees one slot while retaining review history', async () => {
    const p = (await publicProperties(db))[0];
    await tx((d) => propertyAction(d, partner, p.id, 'archive'));
    expect(await publicProperties(db)).toHaveLength(0);
    await tx((d) => saveProperty(d, partner, draft(99)));
    expect((await db.query('SELECT * FROM partner_properties')).rows).toHaveLength(6);
    await expect(tx((d) => saveProperty(d, partner, draft(100)))).rejects.toThrow('five');
    expect(
      (await db.query('SELECT * FROM partner_revisions WHERE property_id=$1', [p.id])).rows.length,
    ).toBeGreaterThan(3);
  });
  it('publishes a second city using the shared dataset without leaking its listings into Chicago', async () => {
    const application2 = await tx((d) =>
      apply(d, {
        ...application,
        company: 'Austin Test Residential',
        website: 'https://austin-example.org',
        contactEmail: 'austin@example.org',
        cities: ['austin'],
      }),
    );
    await tx((d) => reviewApplication(d, admin, application2.id, 'approve', ''));
    const user = (
      await db.query(
        'SELECT u.id,u.email,m.org_id FROM partner_users u JOIN partner_memberships m ON m.user_id=u.id WHERE u.email=$1',
        ['austin@example.org'],
      )
    ).rows[0];
    const actor: Actor = { ...partner, ...user };
    const hood = (await neighborhoods('austin'))[0];
    const property = await tx((d) =>
      saveProperty(d, actor, { ...draft(200), city: 'austin', state: 'TX', zip: '78701', neighborhood: hood.id }),
    );
    await tx((d) => propertyAction(d, actor, property.id, 'submit'));
    await tx((d) => propertyAction(d, admin, property.id, 'approve', 'Verified', true));
    expect(await publicProperties(db, { city: 'austin', neighborhood: hood.id })).toHaveLength(1);
    expect(await publicProperties(db, { city: 'chicago', neighborhood: hood.id })).toHaveLength(0);
  });
});
describe('credential and destination validation', () => {
  it('salts passwords and verifies without storing plaintext', () => {
    const a = passwordHash('a secure example password'),
      b = passwordHash('a secure example password');
    expect(a).not.toBe(b);
    expect(passwordMatches('a secure example password', a)).toBe(true);
    expect(passwordMatches('wrong', a)).toBe(false);
  });
  it('rejects unsafe leasing destinations', () => {
    for (const u of [
      'javascript:alert(1)',
      'http://example.org',
      'https://127.0.0.1',
      'https://localhost',
      'https://user:pass@example.org',
      'https://example.org:8443',
      'https://[::1]',
    ])
      expect(safeURL(u)).toBe(false);
    expect(safeURL('https://example.org/leasing?floorplan=1')).toBe(true);
  });
});
