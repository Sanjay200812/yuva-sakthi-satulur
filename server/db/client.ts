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
  transaction<T>(callback: (client: DBClient) => Promise<T>): Promise<T>;
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
  private paymentSubmissions = new Map<string, any>();
  private verificationRuns = new Map<string, any>();
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

  async transaction<T>(callback: (client: DBClient) => Promise<T>): Promise<T> {
    return await this.withTransaction(callback);
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
      const matchCols = trimmed.match(/\((.*?)\)\s*VALUES/s);
      let record: any = {};
      if (matchCols && matchCols[1]) {
        const cols = matchCols[1].split(',').map((c) => c.trim().toLowerCase());
        cols.forEach((col, idx) => {
          record[col] = params[idx];
        });
      } else {
        const [
          id, public_id, participant_name, phone, village, quantity,
          unit_price_paise, total_amount_paise, status, provider_name,
          download_token_hash, status_token_hash, selected_upi_app, payment_reference
        ] = params;
        record = {
          id, public_id, participant_name, phone, village, quantity,
          unit_price_paise, total_amount_paise, status, provider_name,
          download_token_hash, status_token_hash, selected_upi_app, payment_reference
        };
      }
      if (!record.id) record.id = crypto.randomUUID();
      if (!record.created_at) record.created_at = new Date().toISOString();
      if (!record.updated_at) record.updated_at = new Date().toISOString();
      this.bookings.set(record.id, record);
      return { rows: [record] as any, rowCount: 1 };
    }

    // 3. Find booking by public_id or payment_reference
    if (trimmed.includes('FROM bookings') && (trimmed.includes('public_id = $1') || trimmed.includes('payment_reference = $1'))) {
      const found = Array.from(this.bookings.values()).find(
        (b) => b.public_id === params[0] || b.payment_reference === params[0]
      );
      return { rows: (found ? [found] : []) as any, rowCount: found ? 1 : 0 };
    }

    // 3.5. Find bookings with status != $1
    if (trimmed.includes('FROM bookings') && trimmed.includes('status != $1')) {
      const list = Array.from(this.bookings.values()).filter((b) => b.status !== params[0]);
      return { rows: list as any, rowCount: list.length };
    }

    // 4. Find booking by id (with or without FOR UPDATE)
    if (trimmed.includes('FROM bookings') && trimmed.includes('id = $1')) {
      const found = this.bookings.get(params[0]);
      return { rows: (found ? [found] : []) as any, rowCount: found ? 1 : 0 };
    }

    // 5. Update booking status
    if (trimmed.startsWith('UPDATE bookings')) {
      const idOrPubId = params[params.length - 1];
      const b = this.bookings.get(idOrPubId) || Array.from(this.bookings.values()).find((bk) => bk.public_id === idOrPubId);
      if (b) {
        if (trimmed.includes('payment_expires_at = $1')) {
          b.payment_expires_at = params[0];
        }
        if (trimmed.includes("status = 'payment_confirmed'")) {
          b.status = 'payment_confirmed';
        } else if (trimmed.includes("status = 'payment_rejected'")) {
          b.status = 'payment_rejected';
        } else if (trimmed.includes("status = 'expired'")) {
          b.status = 'expired';
        } else if (trimmed.includes("status = 'proof_required'")) {
          b.status = 'proof_required';
        } else if (trimmed.includes("status = 'awaiting_admin_review'")) {
          b.status = 'awaiting_admin_review';
        } else if (trimmed.includes("status = 'ai_check_failed'")) {
          b.status = 'ai_check_failed';
        } else if (trimmed.includes("status = 'proof_verified'")) {
          b.status = 'payment_confirmed';
        } else if (trimmed.includes('status = $1')) {
          b.status = params[0];
        }

        if (trimmed.includes('paid_at = $1')) {
          b.paid_at = params[0];
          b.verified_at = params[0];
        } else if (trimmed.includes('verified_at = $1')) {
          b.verified_at = params[0];
          b.paid_at = params[0];
        } else if (trimmed.includes('paid_at = $2')) {
          b.paid_at = params[1];
        }
        b.updated_at = new Date().toISOString();
        return { rows: [b] as any, rowCount: 1 };
      }
      return { rows: [] as any, rowCount: 0 };
    }

    // 6. Insert payment submission
    if (trimmed.startsWith('INSERT INTO payment_submissions')) {
      const matchCols = trimmed.match(/\((.*?)\)\s*VALUES/s);
      let record: any = {};
      if (matchCols && matchCols[1]) {
        const cols = matchCols[1].split(',').map((c) => c.trim().toLowerCase());
        cols.forEach((col, idx) => {
          record[col] = params[idx];
        });
      } else {
        record = {
          id: params[0],
          booking_id: params[1],
          payment_reference: params[2],
          selected_upi_app: params[3],
          expected_payee_upi_id: params[4],
          expected_payee_name: params[5],
          expected_amount_paise: params[6],
          payer_utr_hash: params[7],
          status: params[8] || 'proof_submitted',
        };
      }

      if (!record.id) record.id = crypto.randomUUID();

      // Check unique payer_utr_hash (matching partial unique index WHERE status IN ('payment_confirmed', 'proof_verified'))
      if (record.payer_utr_hash && (record.status === 'payment_confirmed' || record.status === 'proof_verified')) {
        const duplicate = Array.from(this.paymentSubmissions.values()).find(
          (s) =>
            s.payer_utr_hash === record.payer_utr_hash &&
            s.booking_id !== record.booking_id &&
            (s.status === 'payment_confirmed' || s.status === 'proof_verified')
        );
        if (duplicate) {
          const err = new Error('duplicate key value violates unique constraint "payment_submissions_payer_utr_hash_key"');
          (err as any).code = '23505';
          throw err;
        }
      }

      record.created_at = new Date().toISOString();
      record.updated_at = new Date().toISOString();
      this.paymentSubmissions.set(record.id, record);
      return { rows: [record] as any, rowCount: 1 };
    }

    // 7. Check UTR duplicate
    if (trimmed.includes('FROM payment_submissions') && trimmed.includes('payer_utr_hash = $1')) {
      const bookingIdToExclude = trimmed.includes('booking_id != $2') ? params[1] : null;
      const requireConfirmed = trimmed.includes("status = 'admin_confirmed'") || trimmed.includes("status = 'payment_confirmed'") || trimmed.includes("status IN ('payment_confirmed', 'proof_verified')");
      const requireVerified = trimmed.includes("status = 'proof_verified'") || trimmed.includes("status = 'payment_confirmed'");
      const found = Array.from(this.paymentSubmissions.values()).find(
        (s) =>
          s.payer_utr_hash === params[0] &&
          (!bookingIdToExclude || s.booking_id !== bookingIdToExclude) &&
          (!requireConfirmed || s.status === 'payment_confirmed' || s.status === 'admin_confirmed' || s.status === 'proof_verified') &&
          (!requireVerified || s.status === 'proof_verified' || s.status === 'payment_confirmed') &&
          s.status !== 'admin_rejected' &&
          s.status !== 'verification_failed' &&
          s.status !== 'ai_check_failed'
      );
      return { rows: (found ? [found] : []) as any, rowCount: found ? 1 : 0 };
    }

    // 8. Check screenshot SHA256 duplicate
    if (trimmed.includes('FROM payment_submissions') && trimmed.includes('screenshot_sha256 = $1')) {
      const bookingIdToExclude = trimmed.includes('booking_id != $2') ? params[1] : null;
      const found = Array.from(this.paymentSubmissions.values()).find(
        (s) =>
          s.screenshot_sha256 === params[0] &&
          (!bookingIdToExclude || s.booking_id !== bookingIdToExclude) &&
          s.status !== 'admin_rejected' &&
          s.status !== 'verification_failed' &&
          s.status !== 'ai_check_failed'
      );
      return { rows: (found ? [found] : []) as any, rowCount: found ? 1 : 0 };
    }

    // 9. Find submission by id
    if (trimmed.includes('FROM payment_submissions') && trimmed.includes('id = $1')) {
      const found = this.paymentSubmissions.get(params[0]);
      return { rows: (found ? [found] : []) as any, rowCount: found ? 1 : 0 };
    }

    // 9.5 Join payment submissions with bookings (Payment Reviews / Diagnostics)
    if (trimmed.includes('FROM payment_submissions') && trimmed.includes('JOIN bookings')) {
      let list = Array.from(this.paymentSubmissions.values()).map((ps) => {
        const b = this.bookings.get(ps.booking_id);
        return {
          ...ps,
          booking_public_id: b?.public_id,
          participant_name: b?.participant_name,
          phone: b?.phone,
          village: b?.village,
          quantity: b?.quantity,
          total_amount_paise: b?.total_amount_paise,
          booking_status: b?.status,
        };
      });
      list.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
      return { rows: list as any, rowCount: list.length };
    }

    // 10. Find submission by booking_id
    if (trimmed.includes('FROM payment_submissions') && trimmed.includes('booking_id = $1')) {
      const found = Array.from(this.paymentSubmissions.values()).filter((s) => s.booking_id === params[0]);
      return { rows: found as any, rowCount: found.length };
    }

    // 11. Update payment submission
    if (trimmed.startsWith('UPDATE payment_submissions')) {
      const id = params[params.length - 1];
      const s = this.paymentSubmissions.get(id);
      if (s) {
        if (trimmed.includes("status = 'payment_confirmed'")) {
          s.status = 'payment_confirmed';
        } else if (trimmed.includes("status = 'admin_confirmed'")) {
          s.status = 'admin_confirmed';
        } else if (trimmed.includes("status = 'admin_rejected'")) {
          s.status = 'admin_rejected';
        } else if (trimmed.includes("status = 'superseded'")) {
          s.status = 'superseded';
        } else if (trimmed.includes("status = 'proof_verified'")) {
          s.status = 'payment_confirmed';
        } else if (trimmed.includes('status = $1')) {
          s.status = params[0];
        }

        if (trimmed.includes('admin_reviewer_id = $1')) {
          s.admin_reviewer_id = params[0];
        } else if (trimmed.includes('admin_reviewer_id = $2')) {
          s.admin_reviewer_id = params[1];
        }

        if (trimmed.includes('admin_review_note = $2')) {
          s.admin_review_note = params[1];
        } else if (trimmed.includes('admin_review_note = $3')) {
          s.admin_review_note = params[2];
        }

        if (trimmed.includes('bank_record_match = $3')) {
          s.bank_record_match = typeof params[2] === 'string' ? JSON.parse(params[2]) : params[2];
        }

        if (trimmed.includes('reviewed_at = $4')) {
          s.reviewed_at = params[3];
        } else if (trimmed.includes('reviewed_at = $3')) {
          s.reviewed_at = params[2];
        }

        s.updated_at = new Date().toISOString();
        return { rows: [s] as any, rowCount: 1 };
      }
      return { rows: [] as any, rowCount: 0 };
    }

    // 11.5 Insert Admin Audit Logs
    if (trimmed.startsWith('INSERT INTO admin_audit_logs')) {
      let id, admin_user_id, action, entity_type, entity_id, metadata, created_at;
      if (params.length === 6) {
        [id, action, entity_type, entity_id, metadata, created_at] = params;
        admin_user_id = null;
      } else {
        [id, admin_user_id, action, entity_type, entity_id, metadata, created_at] = params;
      }

      let parsedMeta = metadata;
      if (typeof metadata === 'string') {
        try {
          parsedMeta = JSON.parse(metadata);
        } catch {
          parsedMeta = { raw: metadata };
        }
      }

      const log = {
        id: id || crypto.randomUUID(),
        admin_user_id,
        action,
        entity_type,
        entity_id,
        metadata: parsedMeta,
        created_at: created_at || new Date().toISOString(),
      };
      return { rows: [log] as any, rowCount: 1 };
    }

    // 12. Insert verification run
    if (trimmed.startsWith('INSERT INTO payment_verification_runs')) {
      const [id, submission_id, stage, status, confidence, reason_codes, result_json, started_at, completed_at, error] = params;
      const record = {
        id: id || crypto.randomUUID(),
        submission_id,
        stage,
        status,
        confidence,
        reason_codes: reason_codes || [],
        result_json,
        started_at: started_at || new Date().toISOString(),
        completed_at,
        error,
      };
      this.verificationRuns.set(record.id, record);
      return { rows: [record] as any, rowCount: 1 };
    }

    // 13. Insert payment attempt (legacy compatibility)
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

    // 8.5. Max Serial for Sequential Coupon Allocation
    if (trimmed.includes('MAX(serial)')) {
      let maxSerial = 0;
      for (const c of this.coupons.values()) {
        const s = Number(c.serial);
        if (!isNaN(s) && s > maxSerial) maxSerial = s;
      }
      return { rows: [{ max_serial: maxSerial }] as any, rowCount: 1 };
    }

    // 9. Insert coupon
    if (trimmed.startsWith('INSERT INTO coupons')) {
      const matchCols = trimmed.match(/\((.*?)\)\s*VALUES/s);
      let record: any = {};
      if (matchCols && matchCols[1]) {
        const cols = matchCols[1].split(',').map((c) => c.trim().toLowerCase());
        cols.forEach((col, idx) => {
          record[col] = params[idx];
        });
      } else {
        record = {
          id: params[0] || crypto.randomUUID(),
          booking_id: params[1],
          serial: params[2],
          coupon_number: params[3],
          holder_name: params[4],
          phone: params[5],
          village: params[6],
          ticket_index: params[7],
          total_quantity: params[8],
          template_version: params[9] || 'v1',
          verification_token_hash: params[10],
          status: params[11] || 'valid',
          issued_at: params[12] || new Date().toISOString(),
        };
      }

      if (!record.status) record.status = 'valid';
      if (!record.issued_at) record.issued_at = new Date().toISOString();
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

    // 17. Admin Dashboard Metrics (Confirmed Bookings & Valid Coupons)
    if (trimmed.includes('admin_metrics')) {
      const confirmedBookings = Array.from(this.bookings.values()).filter(
        (b) => b.status === 'payment_confirmed' || b.status === 'proof_verified'
      );
      const validCoupons = Array.from(this.coupons.values()).filter((c) => c.status === 'valid');
      const totalRevenuePaise = confirmedBookings.reduce((sum, b) => sum + (b.total_amount_paise || 0), 0);

      const today = new Date().toISOString().slice(0, 10);
      const bookingsToday = confirmedBookings.filter((b) => (b.paid_at || b.verified_at || b.created_at)?.startsWith(today)).length;
      const couponsToday = validCoupons.filter((c) => c.issued_at?.startsWith(today)).length;

      const submissions = Array.from(this.paymentSubmissions.values());
      const failedCount = submissions.filter((s) => s.status === 'verification_failed' || s.status === 'ai_check_failed' || s.status === 'admin_rejected').length;
      const awaitingReviewCount = submissions.filter((s) => s.status === 'awaiting_admin_review' || s.status === 'proof_submitted' || s.status === 'ai_checking').length;

      const lastPaid = confirmedBookings.sort((a, b) => ((b.paid_at || b.verified_at || '')).localeCompare(a.paid_at || a.verified_at || ''))[0];

      return {
        rows: [{
          confirmedBookingsCount: confirmedBookings.length,
          validCouponsCount: validCoupons.length,
          totalRevenueInr: totalRevenuePaise / 100,
          bookingsToday,
          couponsToday,
          failedOrPendingAttempts: failedCount + awaitingReviewCount,
          awaitingReviewCount,
          lastPaymentAt: lastPaid?.paid_at || lastPaid?.verified_at || null,
        }] as any,
        rowCount: 1,
      };
    }

    // 18. Admin Applied Coupons List (STRICTLY payment_confirmed & valid ONLY)
    if (trimmed.includes('FROM coupons') && trimmed.includes('JOIN bookings')) {
      let list = Array.from(this.coupons.values())
        .map((c) => {
          const b = this.bookings.get(c.booking_id);
          const sub = Array.from(this.paymentSubmissions.values()).find(
            (s) => s.booking_id === c.booking_id && (s.status === 'admin_confirmed' || s.status === 'proof_verified' || s.status === 'payment_confirmed')
          );
          return {
            ...c,
            booking_public_id: b?.public_id,
            booking_status: b?.status,
            paid_at: b?.paid_at || b?.verified_at,
            amount_paise: b?.total_amount_paise || (c.total_quantity * 5000),
            provider_payment_id: sub?.payer_utr_hash ? `UTR-${sub.payer_utr_hash.slice(0, 8)}` : 'BANK_CONFIRMED',
            utr_display: sub ? `UTR: ${sub.payer_utr_hash.slice(0, 6)}...` : 'Bank Confirmed',
            verification_method: 'Automated Proof Verification (Gemini OCR + Deterministic Rules)',
            confirming_admin: sub?.admin_reviewer_id || null,
            confirmed_at: sub?.reviewed_at || b?.paid_at || null,
          };
        })
        .filter((c) => (c.booking_status === 'payment_confirmed' || c.booking_status === 'proof_verified') && c.status === 'valid');

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

    // 19. Admin Payment Reviews List (Submissions requiring review or audit)
    if (trimmed.includes('FROM payment_submissions') && trimmed.includes('JOIN bookings')) {
      const list = Array.from(this.paymentSubmissions.values())
        .map((s) => {
          const b = this.bookings.get(s.booking_id);
          return {
            ...s,
            booking_public_id: b?.public_id,
            participant_name: b?.participant_name,
            phone: b?.phone,
            village: b?.village,
            quantity: b?.quantity,
            booking_status: b?.status,
          };
        })
        .sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));

      return { rows: list as any, rowCount: list.length };
    }

    // 20. Admin Payment Diagnostics (fallback legacy)
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
      transaction: async <T>(callback: (client: DBClient) => Promise<T>): Promise<T> => {
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
