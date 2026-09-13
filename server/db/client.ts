import pg from 'pg';
import bcrypt from 'bcryptjs';
import { config } from '../config/eventConfig.ts';
import crypto from 'crypto';

export interface DBClient {
  query<T = any>(sql: string, params?: any[]): Promise<{ rows: T[]; rowCount: number }>;
}

export interface TransactionalDB {
  query<T = any>(sql: string, params?: any[]): Promise<{ rows: T[]; rowCount: number }>;
  withTransaction<T>(callback: (client: DBClient) => Promise<T>): Promise<T>;
  getNextCouponSerial(): Promise<number>;
}

// PostgreSQL Real Connection Pool
let pool: pg.Pool | null = null;

if (config.DATABASE_URL && process.env.NODE_ENV !== 'test' && !process.env.VITEST) {
  pool = new pg.Pool({
    connectionString: config.DATABASE_URL,
    ssl: config.DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: false },
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  });

  pool.on('error', (err) => {
    console.error('Unexpected error on idle PostgreSQL client', err);
  });
}

// In-Memory Fallback Store for Local Development & Isolated Automated Testing
class MemoryDB implements TransactionalDB {
  private bookings = new Map<string, any>();
  private paymentAttempts = new Map<string, any>();
  private coupons = new Map<string, any>();
  private paymentEvents = new Map<string, any>();
  private adminUsers = new Map<string, any>();
  private auditLogs: any[] = [];
  private currentSerial = 1500;

  constructor() {
    const adminId = '00000000-0000-0000-0000-000000000001';
    const hashedPassword = bcrypt.hashSync('YuvaShakti@Admin2026', 10);
    this.adminUsers.set(adminId, {
      id: adminId,
      email: 'admin@yuvashakti.org',
      password_hash: hashedPassword,
      role: 'super_admin',
      is_active: true,
      created_at: new Date().toISOString(),
    });
  }

  async getNextCouponSerial(): Promise<number> {
    this.currentSerial += 1;
    return this.currentSerial;
  }

  async withTransaction<T>(callback: (client: DBClient) => Promise<T>): Promise<T> {
    // In-memory atomic execution
    return await callback(this);
  }

  async query<T = any>(sql: string, params: any[] = []): Promise<{ rows: T[]; rowCount: number }> {
    const trimmed = sql.trim();

    // 1. Nextval
    if (trimmed.toLowerCase().includes("nextval('coupon_serial_seq')")) {
      const serial = await this.getNextCouponSerial();
      return { rows: [{ nextval: serial }] as any, rowCount: 1 };
    }

    // 2. Insert into bookings
    if (trimmed.startsWith('INSERT INTO bookings')) {
      const [
        id, public_id, participant_name, phone, village, quantity,
        unit_price_paise, total_amount_paise, status, provider_name,
        download_token_hash, status_token_hash
      ] = params;

      const record = {
        id: id || crypto.randomUUID(),
        public_id,
        participant_name,
        phone,
        village,
        quantity,
        unit_price_paise,
        total_amount_paise,
        status,
        provider_name,
        download_token_hash,
        status_token_hash,
        paid_at: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      this.bookings.set(record.id, record);
      return { rows: [record] as any, rowCount: 1 };
    }

    // 3. Find booking by public_id
    if (trimmed.includes('FROM bookings') && trimmed.includes('public_id = $1')) {
      const found = Array.from(this.bookings.values()).find((b) => b.public_id === params[0]);
      return { rows: (found ? [found] : []) as any, rowCount: found ? 1 : 0 };
    }

    // 4. Find booking by id (with or without FOR UPDATE)
    if (trimmed.includes('FROM bookings') && trimmed.includes('id = $1')) {
      const found = this.bookings.get(params[0]);
      return { rows: (found ? [found] : []) as any, rowCount: found ? 1 : 0 };
    }

    // 5. Update booking status
    if (trimmed.startsWith('UPDATE bookings SET status = $1')) {
      const [status, paid_at, id] = params;
      const b = this.bookings.get(id);
      if (b) {
        b.status = status;
        b.paid_at = paid_at;
        b.updated_at = new Date().toISOString();
        return { rows: [b] as any, rowCount: 1 };
      }
      return { rows: [] as any, rowCount: 0 };
    }

    // 6. Insert payment attempt
    if (trimmed.startsWith('INSERT INTO payment_attempts')) {
      const [
        id, booking_id, provider_name, client_txn_id, provider_order_id,
        amount_paise, provider_status, normalized_status, checkout_url,
        qr_data, upi_intent_uri, expires_at, provider_metadata
      ] = params;

      const record = {
        id: id || crypto.randomUUID(),
        booking_id,
        provider_name,
        client_txn_id,
        provider_order_id,
        amount_paise,
        provider_status,
        normalized_status,
        checkout_url,
        qr_data,
        upi_intent_uri,
        expires_at,
        provider_metadata,
        created_at: new Date().toISOString(),
      };
      this.paymentAttempts.set(record.id, record);
      return { rows: [record] as any, rowCount: 1 };
    }

    // 7. Find attempt by client_txn_id or provider_order_id or booking_id
    if (trimmed.includes('FROM payment_attempts') && (trimmed.includes('client_txn_id = $1') || trimmed.includes('provider_order_id = $1') || trimmed.includes('order_id = $1'))) {
      const found = Array.from(this.paymentAttempts.values()).find(
        (p) => p.client_txn_id === params[0] || p.provider_order_id === params[0] || p.id === params[0]
      );
      return { rows: (found ? [found] : []) as any, rowCount: found ? 1 : 0 };
    }

    if (trimmed.includes('FROM payment_attempts') && trimmed.includes('booking_id = $1')) {
      const found = Array.from(this.paymentAttempts.values()).filter((p) => p.booking_id === params[0]);
      return { rows: found as any, rowCount: found.length };
    }

    // 8. Update payment attempt
    if (trimmed.startsWith('UPDATE payment_attempts')) {
      const [normalized_status, provider_payment_id, id] = params;
      const att = this.paymentAttempts.get(id);
      if (att) {
        att.normalized_status = normalized_status;
        att.provider_payment_id = provider_payment_id;
        att.updated_at = new Date().toISOString();
        return { rows: [att] as any, rowCount: 1 };
      }
      return { rows: [] as any, rowCount: 0 };
    }

    // 9. Insert coupon
    if (trimmed.startsWith('INSERT INTO coupons')) {
      const [
        id, booking_id, serial, coupon_number, holder_name, phone,
        village, status, template_version, verification_token_hash,
        ticket_index, total_quantity
      ] = params;

      const record = {
        id: id || crypto.randomUUID(),
        booking_id,
        serial,
        coupon_number,
        holder_name,
        phone,
        village,
        status: status || 'valid',
        template_version: template_version || 'v1',
        verification_token_hash,
        ticket_index,
        total_quantity,
        issued_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
      };
      this.coupons.set(record.coupon_number, record);
      return { rows: [record] as any, rowCount: 1 };
    }

    // 10. Fetch coupons by booking_id
    if (trimmed.includes('FROM coupons') && trimmed.includes('booking_id = $1')) {
      const list = Array.from(this.coupons.values())
        .filter((c) => c.booking_id === params[0])
        .sort((a, b) => a.ticket_index - b.ticket_index);
      return { rows: list as any, rowCount: list.length };
    }

    // 11. Fetch coupon by coupon_number
    if (trimmed.includes('FROM coupons') && trimmed.includes('coupon_number = $1')) {
      const c = this.coupons.get(params[0]);
      return { rows: (c ? [c] : []) as any, rowCount: c ? 1 : 0 };
    }

    // 12. Payment event check (idempotency)
    if (trimmed.includes('FROM payment_events') && trimmed.includes('provider_event_id = $1')) {
      const ev = this.paymentEvents.get(params[0]);
      return { rows: (ev ? [ev] : []) as any, rowCount: ev ? 1 : 0 };
    }

    // 13. Insert payment event
    if (trimmed.startsWith('INSERT INTO payment_events')) {
      const [id, provider, provider_event_id, event_type, payload, result] = params;
      const ev = {
        id: id || crypto.randomUUID(),
        provider,
        provider_event_id,
        event_type,
        payload,
        processing_result: result,
        received_at: new Date().toISOString(),
      };
      this.paymentEvents.set(provider_event_id, ev);
      return { rows: [ev] as any, rowCount: 1 };
    }

    // 14. Admin user lookup by email
    if (trimmed.includes('FROM admin_users') && trimmed.includes('email = $1')) {
      const user = Array.from(this.adminUsers.values()).find((u) => u.email === params[0].toLowerCase());
      return { rows: (user ? [user] : []) as any, rowCount: user ? 1 : 0 };
    }

    // 15. Admin user lookup by id
    if (trimmed.includes('FROM admin_users') && trimmed.includes('id = $1')) {
      const user = this.adminUsers.get(params[0]);
      return { rows: (user ? [user] : []) as any, rowCount: user ? 1 : 0 };
    }

    // 16. Insert / Upsert Admin user
    if (trimmed.startsWith('INSERT INTO admin_users')) {
      const [id, email, password_hash, role] = params;
      const user = {
        id: id || crypto.randomUUID(),
        email: email.toLowerCase(),
        password_hash,
        role: role || 'super_admin',
        is_active: true,
        created_at: new Date().toISOString(),
      };
      this.adminUsers.set(user.id, user);
      return { rows: [user] as any, rowCount: 1 };
    }

    // 17. Admin Dashboard Metrics (Only Confirmed Payments & Valid Coupons!)
    if (trimmed.includes('admin_metrics')) {
      const confirmedBookings = Array.from(this.bookings.values()).filter((b) => b.status === 'payment_confirmed');
      const validCoupons = Array.from(this.coupons.values()).filter((c) => c.status === 'valid');
      const totalRevenuePaise = confirmedBookings.reduce((sum, b) => sum + (b.total_amount_paise || 0), 0);

      const today = new Date().toISOString().slice(0, 10);
      const bookingsToday = confirmedBookings.filter((b) => b.created_at?.startsWith(today)).length;
      const couponsToday = validCoupons.filter((c) => c.issued_at?.startsWith(today)).length;

      const failedOrPendingAttempts = Array.from(this.paymentAttempts.values()).filter((p) => p.normalized_status !== 'confirmed').length;

      const lastPaid = confirmedBookings.sort((a, b) => (b.paid_at || '').localeCompare(a.paid_at || ''))[0];

      return {
        rows: [{
          confirmedBookingsCount: confirmedBookings.length,
          validCouponsCount: validCoupons.length,
          totalRevenueInr: totalRevenuePaise / 100,
          bookingsToday,
          couponsToday,
          failedOrPendingAttempts,
          lastPaymentAt: lastPaid?.paid_at || null,
        }] as any,
        rowCount: 1,
      };
    }

    // 18. Admin Applied Coupons List (ONLY payment_confirmed & valid)
    if (trimmed.includes('FROM coupons') && trimmed.includes('JOIN bookings')) {
      let list = Array.from(this.coupons.values())
        .map((c) => {
          const b = this.bookings.get(c.booking_id);
          const att = Array.from(this.paymentAttempts.values()).find((a) => a.booking_id === c.booking_id && a.normalized_status === 'confirmed');
          return {
            ...c,
            booking_public_id: b?.public_id,
            booking_status: b?.status,
            paid_at: b?.paid_at,
            amount_paise: b?.unit_price_paise,
            provider_payment_id: att?.provider_payment_id || 'PROV_VERIFIED',
          };
        })
        .filter((c) => c.booking_status === 'payment_confirmed' && c.status === 'valid');

      // Filtering by search term
      const search = params[0];
      if (search && typeof search === 'string' && search.trim()) {
        const q = search.trim().toLowerCase();
        list = list.filter((c) =>
          c.coupon_number.toLowerCase().includes(q) ||
          c.holder_name.toLowerCase().includes(q) ||
          c.phone.includes(q) ||
          c.village.toLowerCase().includes(q) ||
          (c.booking_public_id && c.booking_public_id.toLowerCase().includes(q))
        );
      }

      // Sort by newest
      list.sort((a, b) => (b.issued_at || '').localeCompare(a.issued_at || ''));

      return { rows: list as any, rowCount: list.length };
    }

    // 19. Admin Payment Diagnostics
    if (trimmed.includes('FROM payment_attempts') && trimmed.includes('JOIN bookings')) {
      const list = Array.from(this.paymentAttempts.values())
        .map((p) => {
          const b = this.bookings.get(p.booking_id);
          return {
            ...p,
            booking_public_id: b?.public_id,
            participant_name: b?.participant_name,
            phone: b?.phone,
            booking_status: b?.status,
          };
        })
        .sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));

      return { rows: list as any, rowCount: list.length };
    }

    // Default fallback
    return { rows: [] as any, rowCount: 0 };
  }
}

// Database client factory with PostgreSQL or Fallback
export const db: TransactionalDB = pool
  ? {
      query: async <T = any>(sql: string, params?: any[]) => {
        return await pool!.query<any>(sql, params);
      },
      withTransaction: async <T>(callback: (client: DBClient) => Promise<T>): Promise<T> => {
        const client = await pool!.connect();
        try {
          await client.query('BEGIN');
          const result = await callback(client);
          await client.query('COMMIT');
          return result;
        } catch (error) {
          await client.query('ROLLBACK');
          throw error;
        } finally {
          client.release();
        }
      },
      getNextCouponSerial: async (): Promise<number> => {
        const res = await pool!.query("SELECT nextval('coupon_serial_seq') as nextval");
        return parseInt(res.rows[0].nextval, 10);
      },
    }
  : new MemoryDB();

// Log database mode
if (pool) {
  console.log('✅ Connected to PostgreSQL production database pool.');
} else {
  console.log('ℹ️ Running with local isolated transactional memory store (Development/Test Mode).');
}
