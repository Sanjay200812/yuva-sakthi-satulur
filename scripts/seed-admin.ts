import crypto from 'crypto';
import { db, closePool } from '../server/db/client.ts';
import { hashPassword } from '../server/admin/auth.ts';

async function seed() {
  const rawEmail = process.env.ADMIN_EMAIL || 'admin@yuvashakti.org';
  const email = rawEmail.trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD;

  if (!password) {
    console.error('❌ ERROR: ADMIN_PASSWORD environment variable is required to seed/reset admin credentials.');
    console.error('Example: ADMIN_EMAIL=admin@yuvashakti.org ADMIN_PASSWORD=your_secure_password npm run seed:admin');
    process.exit(1);
  }

  console.log(`🌱 Seeding/updating admin user: ${email}...`);

  const hashedPassword = await hashPassword(password);
  const adminId = crypto.randomUUID();

  // Check if admin user already exists
  const existing = await db.query('SELECT id, email, role, is_active FROM admin_users WHERE email = $1', [email]);

  if (existing.rows.length > 0) {
    console.log(`ℹ️ Admin user ${email} already exists. Updating password hash and ensuring is_active = true...`);
    await db.query('UPDATE admin_users SET password_hash = $1, is_active = true WHERE email = $2', [
      hashedPassword,
      email,
    ]);
    console.log(`✅ Admin credentials for ${email} updated successfully! (Active: true)`);
  } else {
    await db.query(
      `INSERT INTO admin_users (id, email, password_hash, role, is_active)
       VALUES ($1, $2, $3, $4, true)`,
      [adminId, email, hashedPassword, 'super_admin']
    );
    console.log(`✅ Admin user ${email} created successfully as super_admin! (Active: true)`);
  }

  console.log('--------------------------------------------------');
  console.log(`Admin Email:     ${email}`);
  console.log(`Admin Status:    Active`);
  console.log(`Database:        ${process.env.DATABASE_URL ? 'PostgreSQL' : 'Memory'}`);
  console.log('--------------------------------------------------');

  await closePool();
}

seed()
  .then(() => process.exit(0))
  .catch(async (err) => {
    console.error('❌ Failed to seed admin:', err.message || err);
    await closePool().catch(() => {});
    process.exit(1);
  });

