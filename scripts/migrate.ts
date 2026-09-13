import fs from 'fs';
import path from 'path';
import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  console.error('❌ DATABASE_URL environment variable is missing.');
  process.exit(1);
}

async function runMigration() {
  console.log('🔄 Connecting to PostgreSQL database to apply schema...');
  const pool = new pg.Pool({
    connectionString: databaseUrl,
    ssl: databaseUrl.includes('localhost') ? false : { rejectUnauthorized: false },
    connectionTimeoutMillis: 10000,
  });

  const client = await pool.connect();
  try {
    const sqlPath = path.join(process.cwd(), 'migrations', '001_init_schema.sql');
    const sql = fs.readFileSync(sqlPath, 'utf8');

    console.log(`📄 Executing migration from ${sqlPath}...`);
    await client.query(sql);
    console.log('✅ Database migration applied successfully!');
  } finally {
    client.release();
    await pool.end();
  }
}

runMigration()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('❌ Migration failed:', err);
    process.exit(1);
  });
