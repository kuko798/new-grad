import { randomUUID } from 'node:crypto';
import type { DB } from './db.ts';
import {
  applicationSchema,
  audit,
  mail,
  hash,
  token,
  requireThat,
  propertyAccess,
  propertySchema,
  neighborhoods,
  decryptMail,
  AGREEMENT_VERSION,
  type Actor,
} from './domain.ts';
export async function apply(db: DB, input: unknown) {
  const data = applicationSchema.parse(input);
  const id = randomUUID();
  await db.query('INSERT INTO partner_applications(id,email,company_key,data) VALUES($1,$2,$3,$4)', [
    id,
    data.contactEmail,
    new URL(data.website).hostname.replace(/^www\./, ''),
    JSON.stringify(data),
  ]);
  await mail(
    db,
    `application:${id}`,
    data.contactEmail,
    'Application received — Your Next Corner',
    'Thank you for applying. We will review your application and contact you. Your free 90-day pilot starts when your first property is published. No automatic billing.',
  );
  if (process.env.PARTNER_ADMIN_EMAIL)
    await mail(
      db,
      `application-admin:${id}`,
      process.env.PARTNER_ADMIN_EMAIL,
      'New partnership application',
      `${data.company} has applied. Review at ${process.env.APP_ORIGIN}/admin/partners`,
    );
  return { id, status: 'pending' };
}
export async function issueToken(db: DB, userId: string, purpose: 'invite' | 'recovery', email: string) {
  const secret = token();
  await db.query('UPDATE partner_tokens SET used_at=now() WHERE user_id=$1 AND purpose=$2 AND used_at IS NULL', [
    userId,
    purpose,
  ]);
  await db.query(
    "INSERT INTO partner_tokens(hash,user_id,purpose,expires_at) VALUES($1,$2,$3,now()+$4*interval '1 hour')",
    [hash(secret), userId, purpose, purpose === 'invite' ? 72 : 1],
  );
  await mail(
    db,
    `${purpose}:${hash(secret)}`,
    email,
    purpose === 'invite' ? 'Your founding partner invitation' : 'Reset your Your Next Corner password',
    `${purpose === 'invite' ? 'Your application is approved. Set up your account' : 'Set a new password'}: ${process.env.APP_ORIGIN}/partners/accept#token=${secret}\nThis single-use link expires in ${purpose === 'invite' ? '72 hours' : 'one hour'}.`,
  );
}
export async function reviewApplication(db: DB, actor: Actor, id: string, action: string, note: string) {
  requireThat(actor.platform_admin, 'Administrator access required', 403);
  const app = (await db.query('SELECT * FROM partner_applications WHERE id=$1 FOR UPDATE', [id])).rows[0];
  requireThat(app, 'Application not found', 404);
  requireThat(['approve', 'reject', 'request_info', 'note'].includes(action), 'Invalid action');
  if (action === 'note') {
    await db.query('UPDATE partner_applications SET notes=$2,updated_at=now() WHERE id=$1', [id, note]);
    await audit(db, actor.id, null, 'application.note', id);
    return { ok: true };
  }
  if (action === 'approve') {
    if (app.status === 'approved') return { ok: true };
    const orgId = randomUUID();
    const userId = randomUUID();
    const d = app.data;
    await db.query('INSERT INTO partner_organizations(id,application_id,name,profile) VALUES($1,$2,$3,$4)', [
      orgId,
      id,
      d.company,
      JSON.stringify(d),
    ]);
    const user = (
      await db.query(
        'INSERT INTO partner_users(id,email) VALUES($1,$2) ON CONFLICT(email) DO UPDATE SET email=excluded.email RETURNING id,platform_admin',
        [userId, d.contactEmail],
      )
    ).rows[0];
    requireThat(!user.platform_admin, 'Use a separate partner representative email');
    await db.query('INSERT INTO partner_memberships(user_id,org_id) VALUES($1,$2)', [user.id, orgId]);
    await db.query(
      'INSERT INTO partnerships(org_id,agreement_version,accepted_at,representative,advertising_permission,commitments) VALUES($1,$2,$3,$4,false,$5)',
      [
        orgId,
        AGREEMENT_VERSION,
        app.created_at,
        d.contactName,
        JSON.stringify(d.comarketing ? ['Discuss a launch announcement'] : []),
      ],
    );
    await db.query('INSERT INTO partner_campaigns(id,org_id,code) VALUES($1,$2,$3)', [
      randomUUID(),
      orgId,
      token().slice(0, 20),
    ]);
    await issueToken(db, user.id, 'invite', d.contactEmail);
    await audit(db, actor.id, orgId, 'application.approved', id);
  } else
    await mail(
      db,
      `application:${id}:${action}:${hash(note)}`,
      app.email,
      action === 'reject' ? 'Partnership application update' : 'More information requested',
      note ||
        (action === 'reject'
          ? 'We are unable to approve your application at this time.'
          : 'Please reply with additional information about your company.'),
    );
  await db.query('UPDATE partner_applications SET status=$2,notes=$3,updated_at=now() WHERE id=$1', [
    id,
    action === 'approve' ? 'approved' : action === 'reject' ? 'rejected' : 'under_review',
    note,
  ]);
  await audit(db, actor.id, null, `application.${action}`, id, { note });
  return { ok: true };
}
export async function propertyAction(db: DB, actor: Actor, id: string, action: string, note = '', verified = false) {
  const p = await propertyAccess(db, actor, id, true);
  requireThat(
    ['submit', 'approve', 'reject', 'changes_requested', 'archive', 'withdraw'].includes(action),
    'Invalid action',
  );
  if (['approve', 'reject', 'changes_requested'].includes(action)) {
    requireThat(actor.platform_admin, 'Administrator access required', 403);
    requireThat(p.status === 'pending_review', 'Property must be submitted for review', 409);
    if (action === 'approve') {
      const d = propertySchema.parse(p.draft);
      requireThat(
        verified &&
          d.neighborhood &&
          (await neighborhoods(d.city)).some((h: { id: string }) => h.id === d.neighborhood),
        'Verify the address belongs to this neighborhood before publication',
      );
      const org = (await db.query('SELECT status FROM partner_organizations WHERE id=$1 FOR UPDATE', [p.org_id]))
        .rows[0];
      requireThat(org.status === 'active', 'Organization is suspended');
      const s = (await db.query('SELECT * FROM partnerships WHERE org_id=$1 FOR UPDATE', [p.org_id])).rows[0];
      requireThat(
        s && ['invited', 'active'].includes(s.status) && (!s.ends_at || new Date(s.ends_at) > new Date()),
        'Extend or reactivate the partnership before publication',
      );
      await db.query(
        "UPDATE partnerships SET status='active',starts_at=COALESCE(starts_at,now()),ends_at=COALESCE(ends_at,now()+interval '90 days'),advertising_permission=true WHERE org_id=$1",
        [p.org_id],
      );
      await db.query(
        "UPDATE partner_properties SET published=draft,status='approved',neighborhood_verified=true,reviewed_by=$2,reviewed_at=now(),review_note=$3 WHERE id=$1",
        [id, actor.id, note],
      );
    } else
      await db.query(
        'UPDATE partner_properties SET status=$2,review_note=$3,reviewed_by=$4,reviewed_at=now() WHERE id=$1',
        [id, action === 'reject' ? 'rejected' : 'changes_requested', note, actor.id],
      );
  } else if (action === 'submit') {
    requireThat(['draft', 'changes_requested', 'rejected'].includes(p.status), 'Only a draft can be submitted');
    propertySchema.parse(p.draft);
    await db.query("UPDATE partner_properties SET status='pending_review',updated_at=now() WHERE id=$1", [id]);
    if (process.env.PARTNER_ADMIN_EMAIL)
      await mail(
        db,
        `submitted:${id}:${p.updated_at}`,
        process.env.PARTNER_ADMIN_EMAIL,
        'Property ready for review',
        `${p.draft.name} is ready at ${process.env.APP_ORIGIN}/admin/properties`,
      );
  } else {
    // Lock order is kept consistent by callers that archive: organization, then property.
    await db.query(
      `UPDATE partner_properties SET published=NULL,status=$2,archived_at=CASE WHEN $2='archived' THEN now() ELSE archived_at END,updated_at=now() WHERE id=$1`,
      [id, action === 'archive' ? 'archived' : 'draft'],
    );
  }
  await db.query('INSERT INTO partner_revisions(id,property_id,actor_id,data,action) VALUES($1,$2,$3,$4,$5)', [
    randomUUID(),
    id,
    actor.id,
    JSON.stringify(p.draft),
    action,
  ]);
  await audit(db, actor.id, p.org_id, `property.${action}`, id, { note });
  if (actor.platform_admin) {
    const members = await db.query(
      'SELECT u.email FROM partner_users u JOIN partner_memberships m ON m.user_id=u.id WHERE m.org_id=$1',
      [p.org_id],
    );
    for (const member of members.rows)
      await mail(
        db,
        `review:${id}:${action}:${p.updated_at}`,
        member.email,
        `Property ${action.replaceAll('_', ' ')}`,
        `${p.draft.name}: ${note || action}. Visit ${process.env.APP_ORIGIN}/partner/properties`,
      );
  }
  return { ok: true };
}
export async function maintenance(db: DB) {
  const partners = await db.query(
    "SELECT s.*,u.email FROM partnerships s JOIN partner_memberships m ON m.org_id=s.org_id JOIN partner_users u ON u.id=m.user_id WHERE s.status='active' AND s.ends_at<now()+interval '7 days'",
  );
  for (const p of partners.rows) {
    const expired = new Date(p.ends_at) <= new Date();
    if (expired)
      await db.query("UPDATE partnerships SET status='expired' WHERE org_id=$1 AND status='active'", [p.org_id]);
    await mail(
      db,
      `pilot:${p.org_id}:${new Date(p.ends_at).toISOString()}:${expired ? 'expired' : 'ending'}`,
      p.email,
      expired ? 'Your founding pilot has ended' : 'Your founding pilot ends soon',
      `Your free pilot ${expired ? 'ended' : 'ends'} on ${new Date(p.ends_at).toISOString().slice(0, 10)}. No charges apply. Contact us to discuss continuing. Your account and records remain available.`,
    );
  }
  await db.query('DELETE FROM partner_sessions WHERE expires_at<now()');
  await db.query('DELETE FROM partner_rate_limits WHERE expires_at<now()');
  await db.query("DELETE FROM partner_events WHERE created_at<now()-interval '180 days'");
}
export async function deliverMail(db: DB) {
  // Row locks keep concurrent workers from sending the same message. Provider idempotency covers a crash after send.
  const rows = (
    await db.query(
      "SELECT * FROM partner_mail WHERE status<>'sent' AND attempts<8 ORDER BY created_at LIMIT 5 FOR UPDATE SKIP LOCKED",
    )
  ).rows;
  for (const m of rows) {
    let error: string | null = null;
    if (!process.env.RESEND_API_KEY || !process.env.MAIL_FROM) error = 'Email provider is not configured';
    else
      try {
        const r = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
            'Content-Type': 'application/json',
            'Idempotency-Key': m.id,
          },
          body: JSON.stringify({
            from: process.env.MAIL_FROM,
            to: [m.recipient],
            subject: m.subject,
            text: decryptMail(m.body),
          }),
          signal: AbortSignal.timeout(8000),
        });
        if (!r.ok) error = `Provider returned HTTP ${r.status}`;
      } catch {
        error = 'Email provider could not be reached';
      }
    await db.query(
      "UPDATE partner_mail SET status=$2,attempts=attempts+$3,error=$4,sent_at=CASE WHEN $2='sent' THEN now() ELSE NULL END,body=CASE WHEN $2='sent' THEN '[delivered]' ELSE body END WHERE id=$1",
      [m.id, error ? 'failed' : 'sent', process.env.RESEND_API_KEY ? 1 : 0, error],
    );
  }
  return { processed: rows.length };
}
