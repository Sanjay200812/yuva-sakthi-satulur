import pg from 'pg';
import dotenv from 'dotenv';
dotenv.config();

async function diagnose() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('DATABASE_URL is not defined in environment!');
    process.exit(1);
  }

  // Parse safe host info
  const parsed = new URL(connectionString);
  console.log('=== DATABASE CONNECTION INFO ===');
  console.log('Protocol:', parsed.protocol);
  console.log('Username:', parsed.username);
  console.log('Host:', parsed.hostname);
  console.log('Port:', parsed.port);
  console.log('Database:', parsed.pathname);

  const pool = new pg.Pool({
    connectionString,
    ssl: connectionString.includes('localhost') ? false : { rejectUnauthorized: false },
    connectionTimeoutMillis: 10000,
  });

  try {
    const client = await pool.connect();
    console.log('Connected successfully to database!');

    // 1. Check Tables
    const tablesRes = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      ORDER BY table_name;
    `);
    console.log('\n=== TABLES IN PUBLIC SCHEMA ===');
    console.table(tablesRes.rows);

    // 2. Check Columns in bookings
    const columnsRes = await client.query(`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'bookings'
      ORDER BY ordinal_position;
    `);
    console.log('\n=== COLUMNS IN bookings TABLE ===');
    console.table(columnsRes.rows);

    // 3. Check Constraints on bookings
    const constraintsRes = await client.query(`
      SELECT conname, contype, pg_get_constraintdef(c.oid) as definition
      FROM pg_constraint c
      JOIN pg_class t ON c.conrelid = t.oid
      WHERE t.relname = 'bookings';
    `);
    console.log('\n=== CONSTRAINTS ON bookings TABLE ===');
    console.table(constraintsRes.rows);

    // 4. Test actual booking insert exactly as server/app.ts does
    console.log('\n=== TESTING EXACT BOOKING INSERT ===');
    const crypto = await import('crypto');
    const testBookingId = crypto.randomUUID();
    const testPublicId = `BK-TEST-${Date.now().toString().slice(-4)}`;
    const testPaymentRef = `YSYS-TEST-${Date.now().toString().slice(-4)}`;
    const testHash = crypto.createHash('sha256').update('test-token').digest('hex');
    const testExpiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();

    try {
      await client.query('BEGIN');
      const insertRes = await client.query(
        `INSERT INTO bookings (
          id, public_id, participant_name, phone, village, quantity,
          unit_price_paise, total_amount_paise, status, provider_name,
          download_token_hash, status_token_hash, selected_upi_app, payment_reference, payment_expires_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15) RETURNING id, public_id, status`,
        [
          testBookingId,
          testPublicId,
          'Test Participant',
          '9876543210',
          'Satulur',
          1,
          5000,
          5000,
          'payment_initiated',
          'direct_upi',
          testHash,
          testHash,
          'phonepe',
          testPaymentRef,
          testExpiresAt,
        ]
      );
      console.log('Insert SUCCESSFUL:', insertRes.rows[0]);
      await client.query('ROLLBACK'); // Roll back test insert
      console.log('Rolled back test insert successfully.');
    } catch (insertErr: any) {
      await client.query('ROLLBACK').catch(() => {});
      console.error('Insert FAILED with PostgreSQL Error:');
      console.error('Message:', insertErr.message);
      console.error('Code:', insertErr.code);
      console.error('Detail:', insertErr.detail);
      console.error('Hint:', insertErr.hint);
      console.error('Constraint:', insertErr.constraint);
      console.error('Table:', insertErr.table);
      console.error('Column:', insertErr.column);
      console.error('Position:', insertErr.position);
      console.error('Where:', insertErr.where);
    }

    client.release();
  } catch (err: any) {
    console.error('Database connection / query error:', err);
  } finally {
    await pool.end();
  }
}

diagnose();
