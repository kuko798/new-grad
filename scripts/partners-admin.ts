import { randomUUID } from 'node:crypto';
import { database } from '../server/partners/db.ts';
import { passwordHash } from '../server/partners/domain.ts';
const email = process.env.BOOTSTRAP_ADMIN_EMAIL?.trim().toLowerCase();
const password = process.env.BOOTSTRAP_ADMIN_PASSWORD;
if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || !password || password.length < 16)
  throw new Error('Set BOOTSTRAP_ADMIN_EMAIL and BOOTSTRAP_ADMIN_PASSWORD (16+ characters) for this command only.');
const db = database();
try {
  const existing = await db.query('SELECT id FROM partner_users WHERE email=$1', [email]);
  if (existing.rows.length)
    throw new Error('Account already exists. Refusing to promote or overwrite an existing account.');
  await db.query('INSERT INTO partner_users(id,email,password_hash,platform_admin) VALUES($1,$2,$3,true)', [
    randomUUID(),
    email,
    passwordHash(password),
  ]);
  console.log('Administrator created. Remove bootstrap credentials from your environment.');
} finally {
  await db.end();
}
