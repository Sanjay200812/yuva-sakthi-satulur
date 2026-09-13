import crypto from 'crypto';
import { db } from '../server/db/client.ts';
import { hashPassword } from '../server/admin/auth.ts';
import { config } from '../server/config/eventConfig.ts';

async function seed() {
  const email = process.env.ADMIN_EMAIL || 'admin@yuvashakti.org';
  const password = process.env.ADMIN_PASSWORD || 'YuvaShakti@Admin2026';

  console.log(`🌱 Seeding admin user: ${email}...`);

  const hashedPassword = await hashPassword(password);
  const adminId = crypto.randomUUID();

  // Check if admin user already exists
  const existing = await db.query('SELECT * FROM admin_users WHERE email = $1', [email.toLowerCase()]);

  if (existing.rows.length > 0) {
    console.log(`ℹ️ Admin user ${email} already exists. Updating password hash...`);
    await db.query('UPDATE admin_users SET password_hash = $1 WHERE email = $2', [
      hashedPassword,
      email.toLowerCase(),
    ]);
  } else {
    await db.query(
      `INSERT INTO admin_users (id, email, password_hash, role, is_active)
       VALUES ($1, $2, $3, $4, true)`,
      [adminId, email.toLowerCase(), hashedPassword, 'super_admin']
    );
    console.log(`✅ Admin user ${email} created successfully!`);
  }

  console.log('--------------------------------------------------');
  console.log(`Admin Email:    ${email}`);
  console.log(`Admin Password: [Provided in environment or default]`);
  console.log('--------------------------------------------------');
}

seed()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('❌ Failed to seed admin:', err);
    process.exit(1);
  });
