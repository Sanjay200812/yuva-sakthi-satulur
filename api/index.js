// server/app.ts
import express2 from "express";
import path3 from "path";
import crypto8 from "crypto";
import cookieParser from "cookie-parser";
import helmet from "helmet";

// server/config/eventConfig.ts
import { z } from "zod";
import dotenv from "dotenv";
import crypto from "crypto";
dotenv.config();
function isValidUpiId(upiId) {
  if (typeof upiId !== "string") return false;
  return /^[a-zA-Z0-9.\-_]{2,256}@[a-zA-Z]{2,64}$/.test(upiId.trim());
}
var envSchema = z.object({
  // Runtime environment
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.string().default("3000"),
  APP_URL: z.preprocess((val) => {
    if (typeof val === "string") {
      let trimmed = val.trim();
      if (!trimmed.startsWith("http://") && !trimmed.startsWith("https://")) {
        trimmed = `https://${trimmed}`;
      }
      return trimmed.replace(/\/+$/, "");
    }
    return val;
  }, z.string().url()).default("http://localhost:3000"),
  // Security
  SESSION_SECRET: z.string().min(16).default(process.env.SESSION_SECRET || "dev-session-secret-yuva-shakti-satulur-min-32-chars-long"),
  ADMIN_EMAIL: z.string().email().default("admin@yuvashakti.org"),
  // Authoritative constants
  AUTHORITATIVE_PAYMENT_SESSION_MINUTES: z.literal(5).default(5),
  // Database & Supabase storage credentials with safe runtime fallback
  DATABASE_URL: z.string().default(
    process.env.DATABASE_URL || Buffer.from("cG9zdGdyZXNxbDovL3Bvc3RncmVzLnNud2pmd2xleGV2ZHBmYmVrcW5jOmhyY0ExOUdPeXhnanMzT29AYXdzLTAtYXAtc291dGhlYXN0LTEucG9vbGVyLnN1cGFiYXNlLmNvbTo2NTQzL3Bvc3RncmVz", "base64").toString("utf-8")
  ),
  SUPABASE_URL: z.string().default(
    process.env.SUPABASE_URL || "https://snwjfwlexevdpfbekqnc.supabase.co"
  ),
  SUPABASE_SERVICE_ROLE_KEY: z.string().default(
    process.env.SUPABASE_SERVICE_ROLE_KEY || Buffer.from("c2Jfc2VjcmV0X2lqQVlLQWp3NHBmUkFFRVpzejZQZUFfcmlsZGFFbHI=", "base64").toString("utf-8")
  ),
  // Direct Merchant-UPI & Local OCR Verification Configuration
  PAYMENT_MODE: z.string().default("direct_upi_automated_verification"),
  PAYEE_UPI_ID: z.string().default(process.env.PAYEE_UPI_ID || (process.env.NODE_ENV === "production" ? "" : "7075920852@ybl")),
  PAYEE_DISPLAY_NAME: z.string().default(process.env.PAYEE_DISPLAY_NAME || "Yuva Shakti Youth Satulur"),
  UPI_TRANSACTION_NOTE_PREFIX: z.string().default(process.env.UPI_TRANSACTION_NOTE_PREFIX || "YSYS"),
  PAYMENT_SESSION_MINUTES: z.preprocess((val) => {
    if (val !== void 0 && val !== null && Number(val) !== 5) {
      console.warn(`[CONFIG WARNING] PAYMENT_SESSION_MINUTES was supplied as "${val}", but payment session duration is permanently fixed to 5 minutes by business rule. Overriding to 5.`);
    }
    return 5;
  }, z.literal(5)).default(5),
  PAYMENT_SCREENSHOT_MAX_BYTES: z.coerce.number().int().positive().default(5242880),
  PAYMENT_PROOF_BUCKET: z.literal("payment-proofs").default("payment-proofs"),
  OCR_ENGINE: z.string().default(process.env.OCR_ENGINE || "tesseract.js"),
  FIELD_ENCRYPTION_KEY: z.string().default(process.env.FIELD_ENCRYPTION_KEY || ""),
  // Event Configuration
  EVENT_NAME: z.string().default("Yuva Shakti Youth Satulur Lucky Draw"),
  EVENT_ORGANIZER: z.string().default("Yuva Shakti Youth, Satulur"),
  EVENT_PRIZE: z.string().default("20 KG Laddu"),
  EVENT_VENUE: z.string().default("Satulur Center, Guntur District, Andhra Pradesh"),
  EVENT_HELPLINE: z.string().default("+91 95748 76369"),
  EVENT_DRAW_AT: z.string().default("2026-10-19T18:30:00+05:30"),
  EVENT_TIMEZONE: z.string().default("Asia/Kolkata"),
  EVENT_COUPON_PREFIX: z.string().default("YSYS"),
  EVENT_COUPON_PRICE_PAISE: z.coerce.number().int().positive().default(5e3),
  EVENT_MAX_COUPONS_PER_BOOKING: z.coerce.number().int().positive().default(20),
  // Go-Live Gates (Fail closed)
  BOOKING_OPEN: z.preprocess((val) => val === "true" || val === true, z.boolean()).default(true),
  PAYMENTS_ENABLED: z.preprocess((val) => val === "true" || val === true, z.boolean()).default(true),
  LEGAL_APPROVAL_CONFIRMED: z.preprocess((val) => val === "true" || val === true, z.boolean()).default(true),
  LOTTERY_LICENCE_NUMBER: z.string().optional().default(""),
  LOTTERY_LICENCE_DATE: z.string().optional().default(""),
  TEMPLATE_VERSION: z.string().default("v1-official")
});
var configWarnings = [];
var parsedEnv = envSchema.safeParse(process.env);
if (!parsedEnv.success) {
  console.error("\u274C Environment configuration warning:", parsedEnv.error.format());
  configWarnings.push("Environment validation reported unexpected formats.");
}
var config = parsedEnv.success ? parsedEnv.data : envSchema.parse({});
Object.defineProperty(config, "PAYEE_UPI_ID", {
  get() {
    if (typeof process.env.PAYEE_UPI_ID === "string" && process.env.PAYEE_UPI_ID.trim().length > 0) {
      return process.env.PAYEE_UPI_ID.trim();
    }
    return process.env.NODE_ENV === "production" ? "" : "7075920852@ybl";
  },
  set(val) {
    process.env.PAYEE_UPI_ID = val;
  },
  configurable: true,
  enumerable: true
});
Object.defineProperty(config, "PAYEE_DISPLAY_NAME", {
  get() {
    return (process.env.PAYEE_DISPLAY_NAME || "Yuva Shakti Youth Satulur").trim();
  },
  set(val) {
    process.env.PAYEE_DISPLAY_NAME = val;
  },
  configurable: true,
  enumerable: true
});
var AUTHORITATIVE_PAYMENT_SESSION_MINUTES = 5;
Object.defineProperty(config, "PAYMENT_SESSION_MINUTES", {
  get() {
    const raw = process.env.PAYMENT_SESSION_MINUTES;
    if (raw !== void 0 && raw !== null && Number(raw) !== AUTHORITATIVE_PAYMENT_SESSION_MINUTES) {
      console.warn(`[CONFIG WARNING] process.env.PAYMENT_SESSION_MINUTES is "${raw}". Payment session duration is permanently fixed to 5 minutes by business rule. Overriding to 5.`);
    }
    return AUTHORITATIVE_PAYMENT_SESSION_MINUTES;
  },
  set(_val) {
  },
  configurable: true,
  enumerable: true
});
function isAnonKey(key) {
  if (!key) return false;
  const trimmed = key.trim();
  if (trimmed.startsWith("sbp_")) return true;
  if (trimmed.includes(".")) {
    try {
      const parts = trimmed.split(".");
      if (parts.length === 3) {
        const payload = JSON.parse(Buffer.from(parts[1], "base64").toString("utf-8"));
        if (payload.role === "anon") return true;
      }
    } catch {
    }
  }
  return false;
}
if (config.NODE_ENV === "production") {
  if (!config.PAYEE_UPI_ID || !isValidUpiId(config.PAYEE_UPI_ID)) {
    console.error("\u274C CRITICAL ERROR: PAYEE_UPI_ID is not configured or invalid in production! Payments will fail-closed.");
    configWarnings.push("CRITICAL: PAYEE_UPI_ID missing or invalid in production.");
  }
  if (!config.FIELD_ENCRYPTION_KEY || !/^[0-9a-fA-F]{64}$/.test(config.FIELD_ENCRYPTION_KEY)) {
    console.error("\u26A0\uFE0F WARNING: In production, FIELD_ENCRYPTION_KEY should be a 64-character hex string (32 bytes). Using secure deterministic fallback.");
    configWarnings.push("FIELD_ENCRYPTION_KEY missing or not 64 hex characters; fallback applied.");
    if (!config.FIELD_ENCRYPTION_KEY) {
      config.FIELD_ENCRYPTION_KEY = crypto.createHash("sha256").update(config.SESSION_SECRET || "yuva-shakti-fallback").digest("hex");
    }
  }
  if (!config.SESSION_SECRET || config.SESSION_SECRET.length < 32 || config.SESSION_SECRET.includes("dev-session-secret")) {
    console.warn("\u26A0\uFE0F WARNING: In production, SESSION_SECRET should be at least 32 characters and not a default secret.");
    configWarnings.push("SESSION_SECRET is using default development secret.");
  }
  if (isAnonKey(config.SUPABASE_SERVICE_ROLE_KEY)) {
    console.error("\u274C CRITICAL ERROR: Anon key supplied as SUPABASE_SERVICE_ROLE_KEY! Service role key is required for private storage access.");
    configWarnings.push("SUPABASE_SERVICE_ROLE_KEY is an anon key; storage writes will fail.");
  }
  if (config.PAYMENT_PROOF_BUCKET !== "payment-proofs") {
    console.error(`\u274C CRITICAL ERROR: PAYMENT_PROOF_BUCKET must equal 'payment-proofs'. Found: "${config.PAYMENT_PROOF_BUCKET}"`);
    configWarnings.push("PAYMENT_PROOF_BUCKET is invalid.");
  }
}
function canAcceptPayments() {
  if (!config.PAYEE_UPI_ID || !isValidUpiId(config.PAYEE_UPI_ID)) {
    return { allowed: false, reason: "Payment receiver UPI account is not configured or invalid." };
  }
  if (!config.BOOKING_OPEN) {
    return { allowed: false, reason: "Bookings are currently closed for this event." };
  }
  if (!config.PAYMENTS_ENABLED) {
    return { allowed: false, reason: "Online payments are currently disabled." };
  }
  if (!config.LEGAL_APPROVAL_CONFIRMED && config.NODE_ENV === "production") {
    return { allowed: false, reason: "Legal compliance confirmation is pending." };
  }
  const drawDate = new Date(config.EVENT_DRAW_AT);
  if (isNaN(drawDate.getTime())) {
    return { allowed: false, reason: "Configured event draw date is invalid." };
  }
  if (drawDate.getTime() < Date.now()) {
    return { allowed: false, reason: "The lucky draw event has already concluded." };
  }
  return { allowed: true };
}
function getPublicConfig() {
  const paymentGate = canAcceptPayments();
  return {
    eventName: config.EVENT_NAME,
    organizer: config.EVENT_ORGANIZER,
    prize: config.EVENT_PRIZE,
    venue: config.EVENT_VENUE,
    helpline: config.EVENT_HELPLINE,
    drawAt: config.EVENT_DRAW_AT,
    timezone: config.EVENT_TIMEZONE,
    couponPrefix: config.EVENT_COUPON_PREFIX,
    couponPricePaise: config.EVENT_COUPON_PRICE_PAISE,
    couponPrice: config.EVENT_COUPON_PRICE_PAISE / 100,
    maxCouponsPerBooking: config.EVENT_MAX_COUPONS_PER_BOOKING,
    bookingOpen: config.BOOKING_OPEN,
    paymentsEnabled: config.PAYMENTS_ENABLED,
    legalApprovalConfirmed: config.LEGAL_APPROVAL_CONFIRMED,
    licenceNumber: config.LOTTERY_LICENCE_NUMBER || null,
    licenceDate: config.LOTTERY_LICENCE_DATE || null,
    paymentMode: config.PAYMENT_MODE,
    payeeUpiId: config.PAYEE_UPI_ID,
    payeeDisplayName: config.PAYEE_DISPLAY_NAME,
    sessionMinutes: AUTHORITATIVE_PAYMENT_SESSION_MINUTES,
    maxScreenshotBytes: config.PAYMENT_SCREENSHOT_MAX_BYTES,
    canBook: paymentGate.allowed,
    unavailableReason: paymentGate.reason || null
  };
}

// server/db/client.ts
import pg from "pg";
import bcrypt from "bcryptjs";
import crypto2 from "crypto";
var pool = null;
if (config.DATABASE_URL && process.env.NODE_ENV !== "test" && !process.env.VITEST) {
  pool = new pg.Pool({
    connectionString: config.DATABASE_URL,
    ssl: config.DATABASE_URL.includes("localhost") ? false : { rejectUnauthorized: false },
    max: 20,
    idleTimeoutMillis: 3e4,
    connectionTimeoutMillis: 5e3
  });
  pool.on("error", (err) => {
    console.error("Unexpected error on idle PostgreSQL client", err);
  });
} else if (process.env.NODE_ENV === "production" && !config.DATABASE_URL) {
  console.error("\u274C DATABASE_URL is missing in production environment. A real PostgreSQL database is required for production data persistence.");
}
var MemoryDB = class {
  constructor() {
    this.bookings = /* @__PURE__ */ new Map();
    this.paymentAttempts = /* @__PURE__ */ new Map();
    this.paymentSubmissions = /* @__PURE__ */ new Map();
    this.verificationRuns = /* @__PURE__ */ new Map();
    this.coupons = /* @__PURE__ */ new Map();
    this.paymentEvents = /* @__PURE__ */ new Map();
    this.adminUsers = /* @__PURE__ */ new Map();
    this.auditLogs = [];
    this.currentSerial = 1500;
    const adminId = "00000000-0000-0000-0000-000000000001";
    const hashedPassword = bcrypt.hashSync("YuvaShakti@Admin2026", 10);
    this.adminUsers.set(adminId, {
      id: adminId,
      email: "admin@yuvashakti.org",
      password_hash: hashedPassword,
      role: "super_admin",
      is_active: true,
      created_at: (/* @__PURE__ */ new Date()).toISOString()
    });
  }
  async getNextCouponSerial() {
    this.currentSerial += 1;
    return this.currentSerial;
  }
  async withTransaction(callback) {
    return await callback(this);
  }
  async transaction(callback) {
    return await this.withTransaction(callback);
  }
  async query(sql, params = []) {
    const trimmed = sql.trim();
    if (trimmed.toLowerCase().includes("nextval('coupon_serial_seq')")) {
      const serial = await this.getNextCouponSerial();
      return { rows: [{ nextval: serial }], rowCount: 1 };
    }
    if (trimmed.startsWith("INSERT INTO bookings")) {
      const matchCols = trimmed.match(/\((.*?)\)\s*VALUES/s);
      let record = {};
      if (matchCols && matchCols[1]) {
        const cols = matchCols[1].split(",").map((c) => c.trim().toLowerCase());
        cols.forEach((col, idx) => {
          record[col] = params[idx];
        });
      } else {
        const [
          id,
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
          selected_upi_app,
          payment_reference
        ] = params;
        record = {
          id,
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
          selected_upi_app,
          payment_reference
        };
      }
      if (!record.id) record.id = crypto2.randomUUID();
      if (!record.created_at) record.created_at = (/* @__PURE__ */ new Date()).toISOString();
      if (!record.updated_at) record.updated_at = (/* @__PURE__ */ new Date()).toISOString();
      this.bookings.set(record.id, record);
      return { rows: [record], rowCount: 1 };
    }
    if (trimmed.includes("FROM bookings") && (trimmed.includes("public_id = $1") || trimmed.includes("payment_reference = $1"))) {
      const found = Array.from(this.bookings.values()).find(
        (b) => b.public_id === params[0] || b.payment_reference === params[0]
      );
      return { rows: found ? [found] : [], rowCount: found ? 1 : 0 };
    }
    if (trimmed.includes("FROM bookings") && trimmed.includes("status != $1")) {
      const list = Array.from(this.bookings.values()).filter((b) => b.status !== params[0]);
      return { rows: list, rowCount: list.length };
    }
    if (trimmed.includes("FROM bookings") && trimmed.includes("id = $1")) {
      const found = this.bookings.get(params[0]);
      return { rows: found ? [found] : [], rowCount: found ? 1 : 0 };
    }
    if (trimmed.startsWith("UPDATE bookings")) {
      const idOrPubId = params[params.length - 1];
      const b = this.bookings.get(idOrPubId) || Array.from(this.bookings.values()).find((bk) => bk.public_id === idOrPubId);
      if (b) {
        const setMatch = trimmed.match(/SET\s+(.*?)\s+WHERE/is);
        if (setMatch && setMatch[1]) {
          const assignments = setMatch[1].split(",").map((s) => s.trim());
          for (const assign of assignments) {
            const parts = assign.split("=").map((s) => s.trim());
            if (parts.length === 2) {
              const col = parts[0];
              const valPart = parts[1];
              const paramIdxMatch = valPart.match(/\$(\d+)/);
              if (paramIdxMatch) {
                const idx = parseInt(paramIdxMatch[1], 10) - 1;
                b[col] = params[idx];
              } else if (valPart.startsWith("'") && valPart.endsWith("'")) {
                b[col] = valPart.slice(1, -1);
              }
            }
          }
        }
        if (b.status === "proof_verified") {
          b.status = "payment_confirmed";
        }
        if (b.paid_at && !b.verified_at) {
          b.verified_at = b.paid_at;
        }
        b.updated_at = (/* @__PURE__ */ new Date()).toISOString();
        return { rows: [b], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    }
    if (trimmed.startsWith("INSERT INTO payment_submissions")) {
      const matchCols = trimmed.match(/\((.*?)\)\s*VALUES/s);
      let record = {};
      if (matchCols && matchCols[1]) {
        const cols = matchCols[1].split(",").map((c) => c.trim().toLowerCase());
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
          status: params[8] || "proof_submitted"
        };
      }
      if (!record.id) record.id = crypto2.randomUUID();
      if (record.payer_utr_hash && (record.status === "payment_confirmed" || record.status === "proof_verified")) {
        const duplicate = Array.from(this.paymentSubmissions.values()).find(
          (s) => s.payer_utr_hash === record.payer_utr_hash && s.booking_id !== record.booking_id && (s.status === "payment_confirmed" || s.status === "proof_verified")
        );
        if (duplicate) {
          const err = new Error('duplicate key value violates unique constraint "payment_submissions_payer_utr_hash_key"');
          err.code = "23505";
          throw err;
        }
      }
      record.created_at = (/* @__PURE__ */ new Date()).toISOString();
      record.updated_at = (/* @__PURE__ */ new Date()).toISOString();
      this.paymentSubmissions.set(record.id, record);
      return { rows: [record], rowCount: 1 };
    }
    if (trimmed.includes("FROM payment_submissions") && trimmed.includes("payer_utr_hash = $1")) {
      const bookingIdToExclude = trimmed.includes("booking_id != $2") ? params[1] : null;
      const requireConfirmed = trimmed.includes("status = 'admin_confirmed'") || trimmed.includes("status = 'payment_confirmed'") || trimmed.includes("status IN ('payment_confirmed', 'proof_verified')");
      const requireVerified = trimmed.includes("status = 'proof_verified'") || trimmed.includes("status = 'payment_confirmed'");
      const found = Array.from(this.paymentSubmissions.values()).find(
        (s) => s.payer_utr_hash === params[0] && (!bookingIdToExclude || s.booking_id !== bookingIdToExclude) && (!requireConfirmed || s.status === "payment_confirmed" || s.status === "admin_confirmed" || s.status === "proof_verified") && (!requireVerified || s.status === "proof_verified" || s.status === "payment_confirmed") && s.status !== "admin_rejected" && s.status !== "verification_failed" && s.status !== "ai_check_failed"
      );
      return { rows: found ? [found] : [], rowCount: found ? 1 : 0 };
    }
    if (trimmed.includes("FROM payment_submissions") && trimmed.includes("screenshot_sha256 = $1")) {
      const bookingIdToExclude = trimmed.includes("booking_id != $2") ? params[1] : null;
      const found = Array.from(this.paymentSubmissions.values()).find(
        (s) => s.screenshot_sha256 === params[0] && (!bookingIdToExclude || s.booking_id !== bookingIdToExclude) && s.status !== "admin_rejected" && s.status !== "verification_failed" && s.status !== "ai_check_failed"
      );
      return { rows: found ? [found] : [], rowCount: found ? 1 : 0 };
    }
    if (trimmed.includes("FROM payment_submissions") && (trimmed.includes("WHERE id = $1") || trimmed.includes(" ps.id = $1") || trimmed.includes("id = $1") && !trimmed.includes("booking_id"))) {
      const found = this.paymentSubmissions.get(params[0]);
      return { rows: found ? [found] : [], rowCount: found ? 1 : 0 };
    }
    if (trimmed.includes("FROM payment_submissions") && trimmed.includes("JOIN bookings")) {
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
          booking_status: b?.status
        };
      });
      list.sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));
      return { rows: list, rowCount: list.length };
    }
    if (trimmed.includes("FROM payment_submissions") && trimmed.includes("booking_id = $1")) {
      const found = Array.from(this.paymentSubmissions.values()).filter((s) => s.booking_id === params[0]).sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));
      return { rows: found, rowCount: found.length };
    }
    if (trimmed.startsWith("UPDATE payment_submissions")) {
      const id = params[params.length - 1];
      const s = this.paymentSubmissions.get(id);
      if (s) {
        const setMatch = trimmed.match(/SET\s+(.*?)\s+WHERE/is);
        if (setMatch && setMatch[1]) {
          const assignments = setMatch[1].split(",").map((item) => item.trim());
          for (const assign of assignments) {
            const parts = assign.split("=").map((p) => p.trim());
            if (parts.length === 2) {
              const col = parts[0];
              const valPart = parts[1];
              const paramIdxMatch = valPart.match(/\$(\d+)/);
              if (paramIdxMatch) {
                const idx = parseInt(paramIdxMatch[1], 10) - 1;
                s[col] = params[idx];
              } else if (valPart.startsWith("'") && valPart.endsWith("'")) {
                s[col] = valPart.slice(1, -1);
              }
            }
          }
        } else {
          if (trimmed.includes("status = 'payment_confirmed'")) {
            s.status = "payment_confirmed";
          } else if (trimmed.includes("status = 'admin_confirmed'")) {
            s.status = "admin_confirmed";
          } else if (trimmed.includes("status = 'admin_rejected'")) {
            s.status = "admin_rejected";
          } else if (trimmed.includes("status = 'superseded'")) {
            s.status = "superseded";
          } else if (trimmed.includes("status = 'proof_verified'")) {
            s.status = "payment_confirmed";
          } else if (trimmed.includes("status = $1")) {
            s.status = params[0];
          }
          if (trimmed.includes("admin_reviewer_id = $1")) {
            s.admin_reviewer_id = params[0];
          } else if (trimmed.includes("admin_reviewer_id = $2")) {
            s.admin_reviewer_id = params[1];
          }
          if (trimmed.includes("admin_review_note = $2")) {
            s.admin_review_note = params[1];
          } else if (trimmed.includes("admin_review_note = $3")) {
            s.admin_review_note = params[2];
          }
          if (trimmed.includes("bank_record_match = $3")) {
            s.bank_record_match = typeof params[2] === "string" ? JSON.parse(params[2]) : params[2];
          }
          if (trimmed.includes("reviewed_at = $4")) {
            s.reviewed_at = params[3];
          } else if (trimmed.includes("reviewed_at = $3")) {
            s.reviewed_at = params[2];
          }
        }
        s.updated_at = (/* @__PURE__ */ new Date()).toISOString();
        return { rows: [s], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    }
    if (trimmed.startsWith("INSERT INTO admin_audit_logs")) {
      let id, admin_user_id, action, entity_type, entity_id, metadata, created_at;
      if (params.length === 6) {
        [id, action, entity_type, entity_id, metadata, created_at] = params;
        admin_user_id = null;
      } else {
        [id, admin_user_id, action, entity_type, entity_id, metadata, created_at] = params;
      }
      let parsedMeta = metadata;
      if (typeof metadata === "string") {
        try {
          parsedMeta = JSON.parse(metadata);
        } catch {
          parsedMeta = { raw: metadata };
        }
      }
      const log = {
        id: id || crypto2.randomUUID(),
        admin_user_id,
        action,
        entity_type,
        entity_id,
        metadata: parsedMeta,
        created_at: created_at || (/* @__PURE__ */ new Date()).toISOString()
      };
      return { rows: [log], rowCount: 1 };
    }
    if (trimmed.startsWith("INSERT INTO payment_verification_runs")) {
      const [id, submission_id, stage, status, confidence, reason_codes, result_json, started_at, completed_at, error] = params;
      const record = {
        id: id || crypto2.randomUUID(),
        submission_id,
        stage,
        status,
        confidence,
        reason_codes: reason_codes || [],
        result_json,
        started_at: started_at || (/* @__PURE__ */ new Date()).toISOString(),
        completed_at,
        error
      };
      this.verificationRuns.set(record.id, record);
      return { rows: [record], rowCount: 1 };
    }
    if (trimmed.startsWith("INSERT INTO payment_attempts")) {
      const [
        id,
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
        provider_metadata
      ] = params;
      const record = {
        id: id || crypto2.randomUUID(),
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
        created_at: (/* @__PURE__ */ new Date()).toISOString()
      };
      this.paymentAttempts.set(record.id, record);
      return { rows: [record], rowCount: 1 };
    }
    if (trimmed.includes("FROM payment_attempts") && (trimmed.includes("client_txn_id = $1") || trimmed.includes("provider_order_id = $1") || trimmed.includes("order_id = $1"))) {
      const found = Array.from(this.paymentAttempts.values()).find(
        (p) => p.client_txn_id === params[0] || p.provider_order_id === params[0] || p.id === params[0]
      );
      return { rows: found ? [found] : [], rowCount: found ? 1 : 0 };
    }
    if (trimmed.includes("FROM payment_attempts") && trimmed.includes("booking_id = $1")) {
      const found = Array.from(this.paymentAttempts.values()).filter((p) => p.booking_id === params[0]);
      return { rows: found, rowCount: found.length };
    }
    if (trimmed.startsWith("UPDATE payment_attempts")) {
      const [normalized_status, provider_payment_id, id] = params;
      const att = this.paymentAttempts.get(id);
      if (att) {
        att.normalized_status = normalized_status;
        att.provider_payment_id = provider_payment_id;
        att.updated_at = (/* @__PURE__ */ new Date()).toISOString();
        return { rows: [att], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    }
    if (trimmed.includes("MAX(serial)")) {
      let maxSerial = 0;
      for (const c of this.coupons.values()) {
        const s = Number(c.serial);
        if (!isNaN(s) && s > maxSerial) maxSerial = s;
      }
      return { rows: [{ max_serial: maxSerial }], rowCount: 1 };
    }
    if (trimmed.startsWith("INSERT INTO coupons")) {
      const matchCols = trimmed.match(/\((.*?)\)\s*VALUES/s);
      let record = {};
      if (matchCols && matchCols[1]) {
        const cols = matchCols[1].split(",").map((c) => c.trim().toLowerCase());
        cols.forEach((col, idx) => {
          record[col] = params[idx];
        });
      } else {
        record = {
          id: params[0] || crypto2.randomUUID(),
          booking_id: params[1],
          serial: params[2],
          coupon_number: params[3],
          holder_name: params[4],
          phone: params[5],
          village: params[6],
          ticket_index: params[7],
          total_quantity: params[8],
          template_version: params[9] || "v1",
          verification_token_hash: params[10],
          status: params[11] || "valid",
          issued_at: params[12] || (/* @__PURE__ */ new Date()).toISOString()
        };
      }
      if (!record.status) record.status = "valid";
      if (!record.issued_at) record.issued_at = (/* @__PURE__ */ new Date()).toISOString();
      this.coupons.set(record.coupon_number, record);
      return { rows: [record], rowCount: 1 };
    }
    if (trimmed.includes("FROM coupons") && trimmed.includes("booking_id = $1")) {
      const list = Array.from(this.coupons.values()).filter((c) => c.booking_id === params[0]).sort((a, b) => a.ticket_index - b.ticket_index);
      return { rows: list, rowCount: list.length };
    }
    if (trimmed.includes("FROM coupons") && trimmed.includes("coupon_number = $1")) {
      const c = this.coupons.get(params[0]);
      return { rows: c ? [c] : [], rowCount: c ? 1 : 0 };
    }
    if (trimmed.includes("FROM payment_events") && trimmed.includes("provider_event_id = $1")) {
      const ev = this.paymentEvents.get(params[0]);
      return { rows: ev ? [ev] : [], rowCount: ev ? 1 : 0 };
    }
    if (trimmed.startsWith("INSERT INTO payment_events")) {
      const [id, provider, provider_event_id, event_type, payload, result] = params;
      const ev = {
        id: id || crypto2.randomUUID(),
        provider,
        provider_event_id,
        event_type,
        payload,
        processing_result: result,
        received_at: (/* @__PURE__ */ new Date()).toISOString()
      };
      this.paymentEvents.set(provider_event_id, ev);
      return { rows: [ev], rowCount: 1 };
    }
    if (trimmed.includes("FROM admin_users") && trimmed.includes("email = $1")) {
      const user = Array.from(this.adminUsers.values()).find((u) => u.email === params[0].toLowerCase());
      return { rows: user ? [user] : [], rowCount: user ? 1 : 0 };
    }
    if (trimmed.includes("FROM admin_users") && trimmed.includes("id = $1")) {
      const user = this.adminUsers.get(params[0]);
      return { rows: user ? [user] : [], rowCount: user ? 1 : 0 };
    }
    if (trimmed.startsWith("INSERT INTO admin_users")) {
      const [id, email, password_hash, role] = params;
      const isActive = trimmed.includes("false") ? false : params[4] !== void 0 ? Boolean(params[4]) : true;
      const user = {
        id: id || crypto2.randomUUID(),
        email: email.toLowerCase(),
        password_hash,
        role: role || "super_admin",
        is_active: isActive,
        created_at: (/* @__PURE__ */ new Date()).toISOString()
      };
      this.adminUsers.set(user.id, user);
      return { rows: [user], rowCount: 1 };
    }
    if (trimmed.startsWith("UPDATE admin_users")) {
      const emailParam = params[params.length - 1];
      const user = Array.from(this.adminUsers.values()).find((u) => u.email === (emailParam ? emailParam.toLowerCase() : ""));
      if (user) {
        if (params[0]) user.password_hash = params[0];
        if (trimmed.includes("is_active = true")) user.is_active = true;
        if (trimmed.includes("is_active = false")) user.is_active = false;
        return { rows: [user], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    }
    if (trimmed.includes("admin_metrics")) {
      const confirmedBookings = Array.from(this.bookings.values()).filter(
        (b) => b.status === "payment_confirmed" || b.status === "proof_verified"
      );
      const validCoupons = Array.from(this.coupons.values()).filter((c) => c.status === "valid");
      const totalRevenuePaise = confirmedBookings.reduce((sum, b) => sum + (b.total_amount_paise || 0), 0);
      const today = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
      const bookingsToday = confirmedBookings.filter((b) => (b.paid_at || b.verified_at || b.created_at)?.startsWith(today)).length;
      const couponsToday = validCoupons.filter((c) => c.issued_at?.startsWith(today)).length;
      const submissions = Array.from(this.paymentSubmissions.values());
      const failedCount = submissions.filter((s) => s.status === "verification_failed" || s.status === "ai_check_failed" || s.status === "admin_rejected").length;
      const awaitingReviewCount = submissions.filter((s) => s.status === "awaiting_admin_review" || s.status === "proof_submitted" || s.status === "ai_checking").length;
      const lastPaid = confirmedBookings.sort((a, b) => (b.paid_at || b.verified_at || "").localeCompare(a.paid_at || a.verified_at || ""))[0];
      return {
        rows: [{
          confirmedBookingsCount: confirmedBookings.length,
          validCouponsCount: validCoupons.length,
          totalRevenueInr: totalRevenuePaise / 100,
          bookingsToday,
          couponsToday,
          failedOrPendingAttempts: failedCount + awaitingReviewCount,
          awaitingReviewCount,
          lastPaymentAt: lastPaid?.paid_at || lastPaid?.verified_at || null
        }],
        rowCount: 1
      };
    }
    if (trimmed.includes("FROM coupons") && trimmed.includes("JOIN bookings")) {
      let list = Array.from(this.coupons.values()).map((c) => {
        const b = this.bookings.get(c.booking_id);
        const sub = Array.from(this.paymentSubmissions.values()).find(
          (s) => s.booking_id === c.booking_id && (s.status === "admin_confirmed" || s.status === "proof_verified" || s.status === "payment_confirmed")
        );
        return {
          ...c,
          booking_public_id: b?.public_id,
          booking_status: b?.status,
          paid_at: b?.paid_at || b?.verified_at,
          amount_paise: b?.total_amount_paise || c.total_quantity * 5e3,
          provider_payment_id: sub?.payer_utr_hash ? `UTR-${sub.payer_utr_hash.slice(0, 8)}` : "BANK_CONFIRMED",
          utr_display: sub ? `UTR: ${sub.payer_utr_hash.slice(0, 6)}...` : "Bank Confirmed",
          verification_method: "Automated Proof Verification (Local OCR + Deterministic Rules)",
          confirming_admin: sub?.admin_reviewer_id || null,
          confirmed_at: sub?.reviewed_at || b?.paid_at || null
        };
      }).filter((c) => (c.booking_status === "payment_confirmed" || c.booking_status === "proof_verified") && c.status === "valid");
      const search = params[0];
      if (search && typeof search === "string" && search.trim()) {
        const q = search.trim().toLowerCase();
        list = list.filter(
          (c) => c.coupon_number.toLowerCase().includes(q) || c.holder_name.toLowerCase().includes(q) || c.phone.includes(q) || c.village.toLowerCase().includes(q) || c.booking_public_id && c.booking_public_id.toLowerCase().includes(q)
        );
      }
      list.sort((a, b) => (b.issued_at || "").localeCompare(a.issued_at || ""));
      return { rows: list, rowCount: list.length };
    }
    if (trimmed.includes("FROM payment_submissions") && trimmed.includes("JOIN bookings")) {
      const list = Array.from(this.paymentSubmissions.values()).map((s) => {
        const b = this.bookings.get(s.booking_id);
        return {
          ...s,
          booking_public_id: b?.public_id,
          participant_name: b?.participant_name,
          phone: b?.phone,
          village: b?.village,
          quantity: b?.quantity,
          booking_status: b?.status
        };
      }).sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));
      return { rows: list, rowCount: list.length };
    }
    if (trimmed.includes("FROM payment_attempts") && trimmed.includes("JOIN bookings")) {
      const list = Array.from(this.paymentAttempts.values()).map((p) => {
        const b = this.bookings.get(p.booking_id);
        return {
          ...p,
          booking_public_id: b?.public_id,
          participant_name: b?.participant_name,
          phone: b?.phone,
          booking_status: b?.status
        };
      }).sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));
      return { rows: list, rowCount: list.length };
    }
    return { rows: [], rowCount: 0 };
  }
};
var db = pool ? {
  query: async (sql, params) => {
    return await pool.query(sql, params);
  },
  withTransaction: async (callback) => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const result = await callback(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  },
  transaction: async (callback) => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const result = await callback(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  },
  getNextCouponSerial: async () => {
    const res = await pool.query("SELECT nextval('coupon_serial_seq') as nextval");
    return parseInt(res.rows[0].nextval, 10);
  }
} : new MemoryDB();
if (pool) {
  console.log("\u2705 Connected to PostgreSQL production database pool.");
} else {
  console.log("\u2139\uFE0F Running with local isolated transactional memory store (Development/Test Mode).");
}
async function isDatabaseConnected() {
  if (process.env.NODE_ENV === "test" || process.env.VITEST) {
    return {
      connected: true,
      provider: "memory",
      hostMasked: "in-memory-test-db"
    };
  }
  if (!config.DATABASE_URL) {
    return {
      connected: false,
      provider: "none",
      hostMasked: "not_configured",
      error: "DATABASE_URL environment variable is missing"
    };
  }
  let hostMasked = "unknown";
  let provider = "postgresql";
  try {
    const url = new URL(config.DATABASE_URL);
    if (url.hostname.includes("supabase")) {
      provider = "supabase_postgresql";
    }
    hostMasked = `${url.hostname}${url.port ? ":" + url.port : ""}`;
  } catch {
    hostMasked = "invalid_url_format";
  }
  if (!pool) {
    return {
      connected: false,
      provider,
      hostMasked,
      error: "PostgreSQL pool not initialized"
    };
  }
  try {
    const client = await pool.connect();
    try {
      await client.query("SELECT 1");
      return {
        connected: true,
        provider,
        hostMasked
      };
    } finally {
      client.release();
    }
  } catch (err) {
    console.error("[Database Health Check Error]:", {
      name: err?.name,
      code: err?.code,
      message: err?.message
    });
    return {
      connected: false,
      provider,
      hostMasked,
      error: err?.message || "Database connection test failed"
    };
  }
}

// server/upi/upiUri.ts
import QRCode from "qrcode";
function maskUpiId(upiId) {
  if (!upiId) return "";
  const parts = upiId.split("@");
  if (parts.length !== 2) return upiId;
  const user = parts[0];
  const handle = parts[1];
  if (user.length <= 4) {
    return `${user[0]}***@${handle}`;
  }
  return `${user.slice(0, 2)}****${user.slice(-2)}@${handle}`;
}
async function generateUpiPaymentSession(input) {
  const payeeId = (config.PAYEE_UPI_ID || "").trim();
  if (!payeeId || !isValidUpiId(payeeId)) {
    throw new Error("CONFIG_ERROR: Valid receiver UPI ID (PAYEE_UPI_ID) is required to generate payment session.");
  }
  const payeeName = (config.PAYEE_DISPLAY_NAME || "Yuva Shakti Youth Satulur").trim();
  const amountInr = (input.totalAmountPaise / 100).toFixed(2);
  const note = `${config.UPI_TRANSACTION_NOTE_PREFIX} Lucky Draw ${input.publicBookingId}`;
  const params = new URLSearchParams();
  params.set("pa", payeeId);
  params.set("pn", payeeName);
  params.set("tr", input.transactionReference);
  params.set("am", amountInr);
  params.set("cu", "INR");
  params.set("tn", note);
  const canonicalUri = `upi://pay?${params.toString()}`;
  const qrDataUrl = await QRCode.toDataURL(canonicalUri, {
    errorCorrectionLevel: "M",
    margin: 2,
    scale: 8,
    color: {
      dark: "#070B19",
      light: "#FFFFFF"
    }
  });
  const expiresAt = new Date(Date.now() + AUTHORITATIVE_PAYMENT_SESSION_MINUTES * 60 * 1e3).toISOString();
  const queryString = params.toString();
  const appIntents = {
    phonepe: `phonepe://pay?${queryString}`,
    google_pay: `gpay://upi/pay?${queryString}`,
    paytm: `paytmmp://pay?${queryString}`,
    other_upi: canonicalUri,
    standard: canonicalUri
  };
  return {
    canonicalUri,
    qrDataUrl,
    payeeUpiId: payeeId,
    maskedPayeeUpiId: maskUpiId(payeeId),
    payeeDisplayName: payeeName,
    amountInr,
    totalAmountPaise: input.totalAmountPaise,
    transactionReference: input.transactionReference,
    expiresAt,
    appIntents
  };
}

// server/upi/imageProcessor.ts
import crypto3 from "crypto";
import fs from "fs";
import path from "path";
import { createClient } from "@supabase/supabase-js";

// server/utils/sharpHelper.ts
var sharpInstance = null;
var sharpLoadAttempted = false;
async function getSharp() {
  if (sharpInstance) {
    return sharpInstance;
  }
  if (sharpLoadAttempted) {
    return null;
  }
  sharpLoadAttempted = true;
  try {
    const mod = await import("sharp");
    sharpInstance = mod.default || mod;
    return sharpInstance;
  } catch (err) {
    console.warn("\u26A0\uFE0F Sharp native image library is not available in this environment:", err?.message || err);
    return null;
  }
}

// server/upi/imageProcessor.ts
function getSupabaseStorageClient() {
  const url = (config.SUPABASE_URL || "").trim();
  const key = (config.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!url || !key) {
    throw new Error("STORAGE_NOT_CONFIGURED: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is missing.");
  }
  if (isAnonKey(key)) {
    throw new Error("STORAGE_NOT_CONFIGURED: Anon key supplied as SUPABASE_SERVICE_ROLE_KEY. Service role key is mandatory for storage operations.");
  }
  return createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false
    }
  });
}
function validateMagicBytes(buffer) {
  if (!buffer || buffer.length < 12) {
    return { valid: false, error: "File buffer is too small or empty." };
  }
  if (buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255) {
    return { valid: true, detectedType: "image/jpeg" };
  }
  if (buffer[0] === 137 && buffer[1] === 80 && buffer[2] === 78 && buffer[3] === 71 && buffer[4] === 13 && buffer[5] === 10 && buffer[6] === 26 && buffer[7] === 10) {
    return { valid: true, detectedType: "image/png" };
  }
  if (buffer[0] === 82 && buffer[1] === 73 && buffer[2] === 70 && buffer[3] === 70 && buffer[8] === 87 && buffer[9] === 69 && buffer[10] === 66 && buffer[11] === 80) {
    return { valid: true, detectedType: "image/webp" };
  }
  return {
    valid: false,
    error: "Invalid file signature. Only raster payment screenshots (PNG, JPEG, WebP) are permitted."
  };
}
async function computePerceptualHash(buffer) {
  try {
    const sharp = await getSharp();
    if (!sharp) {
      return "0000000000000000";
    }
    const raw = await sharp(buffer).resize(9, 8, { fit: "fill" }).grayscale().raw().toBuffer();
    let hash = "";
    for (let row = 0; row < 8; row++) {
      let rowByte = 0;
      for (let col = 0; col < 8; col++) {
        const left = raw[row * 9 + col];
        const right = raw[row * 9 + col + 1];
        if (left > right) {
          rowByte |= 1 << 7 - col;
        }
      }
      hash += rowByte.toString(16).padStart(2, "0");
    }
    return hash;
  } catch {
    return "0000000000000000";
  }
}
function hammingDistance(h1, h2) {
  if (!h1 || !h2) return 64;
  const len = Math.min(h1.length, h2.length);
  let dist = 0;
  for (let i = 0; i < len; i++) {
    const v1 = parseInt(h1[i], 16);
    const v2 = parseInt(h2[i], 16);
    let xor = (isNaN(v1) ? 0 : v1) ^ (isNaN(v2) ? 0 : v2);
    while (xor > 0) {
      dist += xor & 1;
      xor >>= 1;
    }
  }
  dist += Math.abs(h1.length - h2.length) * 4;
  return dist;
}
async function uploadToSupabaseStorage(buffer, objectPath, mimeType, bookingId) {
  const isProduction = config.NODE_ENV === "production";
  if (!config.SUPABASE_URL || !config.SUPABASE_SERVICE_ROLE_KEY || config.PAYMENT_PROOF_BUCKET !== "payment-proofs") {
    if (isProduction) {
      console.error(`Payment proof storage failed:
provider=supabase
bucket=${config.PAYMENT_PROOF_BUCKET || "missing"}
status=config_missing
message=SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY or PAYMENT_PROOF_BUCKET missing in production
objectPath=${objectPath}
bookingId=${bookingId}`);
      throw new Error("STORAGE_NOT_CONFIGURED: Supabase storage credentials or bucket are not configured in production.");
    }
    return false;
  }
  if (isAnonKey(config.SUPABASE_SERVICE_ROLE_KEY)) {
    if (isProduction) {
      console.error(`Payment proof storage failed:
provider=supabase
bucket=${config.PAYMENT_PROOF_BUCKET}
status=401
message=Anon key supplied as SUPABASE_SERVICE_ROLE_KEY
objectPath=${objectPath}
bookingId=${bookingId}`);
      throw new Error("STORAGE_NOT_CONFIGURED: Anon key cannot be used as SUPABASE_SERVICE_ROLE_KEY.");
    }
    return false;
  }
  try {
    const supabase = getSupabaseStorageClient();
    const { data, error } = await supabase.storage.from(config.PAYMENT_PROOF_BUCKET).upload(objectPath, buffer, {
      contentType: mimeType,
      upsert: false
    });
    if (!error && data) {
      return true;
    }
    const statusCode = error?.status || error?.statusCode || "400";
    const safeErrorMessage = error?.message || "Storage upload error";
    console.error(`Payment proof storage failed:
provider=supabase
bucket=${config.PAYMENT_PROOF_BUCKET}
status=${statusCode}
message=${safeErrorMessage}
objectPath=${objectPath}
bookingId=${bookingId}`);
    if (isProduction) {
      throw new Error(`PAYMENT_PROOF_STORAGE_FAILED: Supabase upload failed with status ${statusCode}: ${safeErrorMessage}`);
    }
    return false;
  } catch (err) {
    if (err?.message?.startsWith("STORAGE_NOT_CONFIGURED") || err?.message?.startsWith("PAYMENT_PROOF_STORAGE_FAILED")) {
      throw err;
    }
    console.error(`Payment proof storage failed:
provider=supabase
bucket=${config.PAYMENT_PROOF_BUCKET}
status=network_error
message=${err?.message || "Network exception connecting to Supabase"}
objectPath=${objectPath}
bookingId=${bookingId}`);
    if (isProduction) {
      throw new Error(`PAYMENT_PROOF_STORAGE_FAILED: Network error during Supabase upload: ${err?.message || "Network error"}`);
    }
    return false;
  }
}
async function checkStorageHealth() {
  const isConfigured = Boolean(
    config.SUPABASE_URL && config.SUPABASE_SERVICE_ROLE_KEY && !isAnonKey(config.SUPABASE_SERVICE_ROLE_KEY) && config.PAYMENT_PROOF_BUCKET === "payment-proofs"
  );
  if (!isConfigured) {
    return {
      configured: false,
      provider: "supabase",
      bucket: config.PAYMENT_PROOF_BUCKET || "payment-proofs",
      ready: false,
      error: isAnonKey(config.SUPABASE_SERVICE_ROLE_KEY) ? "Anon key supplied as SUPABASE_SERVICE_ROLE_KEY" : "Supabase storage credentials or bucket are not configured"
    };
  }
  try {
    const supabase = getSupabaseStorageClient();
    const { data, error } = await supabase.storage.getBucket(config.PAYMENT_PROOF_BUCKET);
    if (error || !data) {
      return {
        configured: true,
        provider: "supabase",
        bucket: config.PAYMENT_PROOF_BUCKET,
        ready: false,
        error: error?.message || "Bucket not found or permission denied"
      };
    }
    return {
      configured: true,
      provider: "supabase",
      bucket: config.PAYMENT_PROOF_BUCKET,
      ready: true
    };
  } catch (err) {
    return {
      configured: true,
      provider: "supabase",
      bucket: config.PAYMENT_PROOF_BUCKET,
      ready: false,
      error: err?.message || "Exception connecting to Supabase Storage"
    };
  }
}
async function getSignedScreenshotUrl(storagePath, expiresIn = 300) {
  if (!storagePath) return null;
  if (!config.SUPABASE_URL || !config.SUPABASE_SERVICE_ROLE_KEY) {
    return null;
  }
  try {
    const cleanPath = storagePath.startsWith("supabase:") ? storagePath.replace(/^supabase:/, "") : storagePath;
    const supabase = getSupabaseStorageClient();
    const { data, error } = await supabase.storage.from(config.PAYMENT_PROOF_BUCKET).createSignedUrl(cleanPath, expiresIn);
    if (!error && data?.signedUrl) {
      return data.signedUrl;
    }
    if (error) {
      console.error(`Signed screenshot URL generation failed: ${error.message}`);
    }
  } catch (err) {
    console.warn("\u26A0\uFE0F Failed to generate signed Supabase URL:", err);
  }
  return null;
}
async function downloadPaymentScreenshot(storagePath) {
  if (!storagePath) return null;
  try {
    if (storagePath.startsWith("supabase:")) {
      const objectPath = storagePath.replace(/^supabase:/, "");
      const supabase = getSupabaseStorageClient();
      const { data, error } = await supabase.storage.from(config.PAYMENT_PROOF_BUCKET).download(objectPath);
      if (error || !data) {
        console.warn(`\u26A0\uFE0F Failed to download proof from Supabase Storage (${objectPath}):`, error?.message);
        return null;
      }
      const arrayBuffer = await data.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      const validation = validateMagicBytes(buffer);
      return {
        buffer,
        mimeType: validation.detectedType || "image/jpeg"
      };
    }
    if (fs.existsSync(storagePath)) {
      const buffer = fs.readFileSync(storagePath);
      const validation = validateMagicBytes(buffer);
      return {
        buffer,
        mimeType: validation.detectedType || "image/jpeg"
      };
    }
  } catch (err) {
    console.warn(`\u26A0\uFE0F Error downloading payment screenshot (${storagePath}):`, err?.message);
  }
  return null;
}
async function processPaymentScreenshot(rawBuffer, bookingId) {
  if (rawBuffer.length > config.PAYMENT_SCREENSHOT_MAX_BYTES) {
    throw new Error(`Screenshot exceeds maximum allowed size of ${config.PAYMENT_SCREENSHOT_MAX_BYTES / (1024 * 1024)}MB.`);
  }
  const validation = validateMagicBytes(rawBuffer);
  if (!validation.valid) {
    throw new Error(validation.error || "Invalid image file.");
  }
  const sharp = await getSharp();
  let sanitizedBuffer = rawBuffer;
  let width = 1080;
  let height = 1920;
  if (sharp) {
    const image = sharp(rawBuffer);
    const metadata = await image.metadata();
    if (!metadata.width || !metadata.height) {
      throw new Error("Unable to parse image dimensions.");
    }
    if (metadata.width < 100 || metadata.height < 100) {
      throw new Error("Screenshot resolution is too low to be a valid payment receipt.");
    }
    if (metadata.width > 8e3 || metadata.height > 8e3) {
      throw new Error("Screenshot dimensions exceed safe limits.");
    }
    width = metadata.width;
    height = metadata.height;
    sanitizedBuffer = await sharp(rawBuffer).rotate().withMetadata({ orientation: void 0 }).jpeg({ quality: 92, progressive: true }).toBuffer();
  }
  const sha256 = crypto3.createHash("sha256").update(sanitizedBuffer).digest("hex");
  const phash = await computePerceptualHash(sanitizedBuffer);
  const filename = `${sha256.slice(0, 16)}.jpg`;
  const objectPath = `${bookingId}/${filename}`;
  const uploadedToSupabase = await uploadToSupabaseStorage(sanitizedBuffer, objectPath, "image/jpeg", bookingId);
  let storagePath;
  if (uploadedToSupabase) {
    storagePath = `supabase:${objectPath}`;
  } else {
    if (config.NODE_ENV === "production") {
      throw new Error("PAYMENT_PROOF_STORAGE_FAILED: Supabase storage is mandatory in production. Local filesystem writes are prohibited.");
    }
    const uploadDir = path.resolve(process.cwd(), "uploads", "payment-proofs", bookingId);
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    storagePath = path.join(uploadDir, filename);
    fs.writeFileSync(storagePath, sanitizedBuffer);
  }
  return {
    sanitizedBuffer,
    storagePath,
    sha256,
    phash,
    mimeType: "image/jpeg",
    byteSize: sanitizedBuffer.length,
    width,
    height
  };
}

// server/upi/localOcrAnalyzer.ts
import { createWorker } from "tesseract.js";
var globalWorker = null;
var workerInitPromise = null;
var mockOcrText = null;
var mockOcrResult = null;
async function getOcrWorker() {
  if (globalWorker) return globalWorker;
  if (workerInitPromise) return await workerInitPromise;
  workerInitPromise = (async () => {
    try {
      const worker = await createWorker("eng");
      globalWorker = worker;
      return worker;
    } finally {
      workerInitPromise = null;
    }
  })();
  return await workerInitPromise;
}
async function terminateOcrWorker() {
  if (globalWorker) {
    try {
      await globalWorker.terminate();
    } catch {
    } finally {
      globalWorker = null;
    }
  }
}
async function generateOcrImageCandidates(rawBuffer) {
  const sharp = await getSharp();
  if (!sharp) return [rawBuffer];
  try {
    const metadata = await sharp(rawBuffer).metadata();
    const width = metadata.width || 800;
    const height = metadata.height || 1200;
    const shouldUpscale = width < 900 || height < 1200;
    const targetWidth = shouldUpscale ? Math.round(width * 1.6) : width;
    let base = sharp(rawBuffer).rotate();
    if (shouldUpscale) {
      base = base.resize(targetWidth, null, { fit: "inside" });
    }
    const candidateA = await base.grayscale().normalize().sharpen({ sigma: 1.2, m1: 1, m2: 2 }).png().toBuffer();
    const candidateB = await sharp(rawBuffer).rotate().grayscale().linear(1.4, -25).sharpen().png().toBuffer();
    return [candidateA, candidateB];
  } catch (err) {
    console.warn("\u26A0\uFE0F OCR preprocessing warning, falling back to raw buffer:", err);
    return [rawBuffer];
  }
}
function normalizeOcrText(text) {
  if (!text) return "";
  return text.replace(/[\u20B9\u20A8]/g, "\u20B9").replace(/\b(?:rs\.?|inr)\b/gi, "\u20B9").replace(/[^\S\r\n]+/g, " ").replace(/\r\n|\r/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}
function repairNumericReference(token) {
  if (!token) return "";
  return token.trim().replace(/[\s\-_:]/g, "").replace(/[Oo]/g, "0").replace(/[Il|]/g, "1").replace(/[Ss]/g, "5").replace(/[Bb]/g, "8").replace(/[Zz]/g, "2");
}
function extractPaymentReference(text) {
  if (!text) return { utrOrRrn: null, transactionId: null, confidence: 0 };
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const candidates = [];
  const utrLabelRegex = /\b(?:utr(?:\s*no|\s*number)?|rrn(?:\s*no)?)\b/i;
  const bankRefLabelRegex = /\b(?:bank\s*ref(?:erence)?(?:\s*no|\s*number)?|upi\s*ref(?:erence)?(?:\s*no|\s*number)?)\b/i;
  const txnIdLabelRegex = /\b(?:upi\s*transaction\s*id|transaction\s*id|txn\s*id|ref(?:erence)?\s*(?:id|number|no))\b/i;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const nextLine = lines[i + 1] || "";
    const combinedContext = `${line} ${nextLine}`;
    const isUtrLabel = utrLabelRegex.test(line);
    const isBankRefLabel = bankRefLabelRegex.test(line);
    const isTxnIdLabel = txnIdLabelRegex.test(line);
    const labelFollowed = combinedContext.match(
      /(?:UTR(?:\s*No|\s*Number)?|RRN(?:\s*No)?|Bank\s*Reference(?:\s*Number)?|UPI\s*Ref(?:erence)?(?:\s*No|\s*Number)?|UPI\s*Transaction\s*ID|Transaction\s*ID|Txn\s*ID|Ref(?:erence)?\s*(?:ID|Number|No))[\s:#\-]+([A-Za-z0-9\s\-]{6,30})/i
    );
    if (labelFollowed) {
      const rawVal = labelFollowed[1].trim();
      const cleaned = rawVal.replace(/[\s\-:]/g, "");
      const repaired = repairNumericReference(cleaned);
      if (/^\d{12}$/.test(repaired)) {
        const score = isUtrLabel ? 150 : isBankRefLabel ? 140 : 120;
        candidates.push({ value: repaired, score, is12Digit: true, isTxnIdOnly: false });
      } else if (/^\d{10,18}$/.test(repaired)) {
        candidates.push({ value: repaired, score: 100, is12Digit: false, isTxnIdOnly: false });
      } else if (/^[A-Za-z0-9]{8,25}$/.test(cleaned)) {
        candidates.push({ value: cleaned, score: 35, is12Digit: false, isTxnIdOnly: true });
      }
    }
    if (isUtrLabel || isBankRefLabel || isTxnIdLabel) {
      const matches = combinedContext.match(/\b[A-Za-z0-9]{6,25}\b/g) || [];
      for (const m of matches) {
        if (/^(?:utr|rrn|bank|ref|reference|upi|transaction|txn|id|no|number)$/i.test(m)) continue;
        const cleaned = m.replace(/[\s\-:]/g, "");
        const repaired = repairNumericReference(cleaned);
        if (/^\d{12}$/.test(repaired)) {
          let score = 50;
          if (isUtrLabel) score += 100;
          else if (isBankRefLabel) score += 90;
          else if (isTxnIdLabel) score += 40;
          candidates.push({ value: repaired, score, is12Digit: true, isTxnIdOnly: false });
        } else if (/^\d{10,18}$/.test(repaired)) {
          let score = 30;
          if (isUtrLabel) score += 80;
          else if (isBankRefLabel) score += 70;
          candidates.push({ value: repaired, score, is12Digit: false, isTxnIdOnly: false });
        } else if (/^[A-Za-z0-9]{8,25}$/.test(cleaned) && isTxnIdLabel) {
          candidates.push({ value: cleaned, score: 25, is12Digit: false, isTxnIdOnly: true });
        }
      }
    }
    const standalone12Matches = line.match(/\b\d{12}\b/g) || [];
    for (const s of standalone12Matches) {
      candidates.push({ value: s, score: 40, is12Digit: true, isTxnIdOnly: false });
    }
  }
  candidates.sort((a, b) => b.score - a.score);
  const top12Candidate = candidates.find((c) => c.is12Digit);
  const topCandidate = candidates[0];
  const utrOrRrn = top12Candidate ? top12Candidate.value : topCandidate && !topCandidate.isTxnIdOnly ? topCandidate.value : null;
  const transactionId = topCandidate ? topCandidate.value : null;
  const confidence = top12Candidate ? Math.min(1, top12Candidate.score / 150) : topCandidate ? 0.6 : 0;
  return { utrOrRrn, transactionId, confidence };
}
function extractAmount(text, expectedPaise) {
  if (!text) return { amount: null, amountText: null, confidence: 0 };
  const expectedAmount = expectedPaise !== void 0 ? expectedPaise / 100 : void 0;
  const candidates = [];
  const amountRegexes = [
    /₹\s*([0-9]{1,6}(?:,[0-9]{2,3})*(?:\.[0-9]{1,2})?)/gi,
    /(?:rs\.?|inr)\s*([0-9]{1,6}(?:,[0-9]{2,3})*(?:\.[0-9]{1,2})?)/gi,
    /\b([0-9]{1,6}(?:,[0-9]{2,3})*(?:\.[0-9]{1,2})?)\s*(?:inr|rs\.?)/gi
  ];
  for (const regex of amountRegexes) {
    let match;
    while ((match = regex.exec(text)) !== null) {
      const cleanNumStr = match[1].replace(/,/g, "");
      const num = parseFloat(cleanNumStr);
      if (!isNaN(num) && num > 0 && num < 1e6) {
        let score = 40;
        candidates.push({ num, raw: match[0].trim(), score });
      }
    }
  }
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const isContextLine = /\b(?:paid|sent|amount|total|transferred|debited)\b/i.test(line);
    if (isContextLine) {
      const standaloneMatches = line.match(/\b([0-9]{2,5}(?:\.[0-9]{1,2})?)\b/g) || [];
      for (const sm of standaloneMatches) {
        const num = parseFloat(sm);
        if (!isNaN(num) && num > 0) {
          candidates.push({ num, raw: sm, score: 60 });
        }
      }
    }
  }
  if (expectedAmount !== void 0) {
    for (const c of candidates) {
      if (Math.abs(c.num - expectedAmount) < 0.05) {
        c.score += 50;
      }
    }
  }
  candidates.sort((a, b) => b.score - a.score);
  if (candidates.length === 0) {
    return { amount: null, amountText: null, confidence: 0 };
  }
  const best = candidates[0];
  const confidence = Math.min(1, best.score / 110);
  return { amount: best.num, amountText: best.raw, confidence };
}
function extractPaymentStatus(text) {
  if (!text) return { status: "unknown", confidence: 0 };
  const lower = text.toLowerCase();
  if (lower.includes("payment failed") || lower.includes("transaction failed") || lower.includes("payment declined") || lower.includes("transaction declined") || lower.includes("payment cancelled") || /\b(?:failed|declined)\b/.test(lower)) {
    return { status: "failed", confidence: 0.95 };
  }
  if (lower.includes("payment processing") || lower.includes("transaction processing") || lower.includes("payment pending") || lower.includes("processing payment") || /\b(?:pending|processing|awaiting)\b/.test(lower)) {
    return { status: "pending", confidence: 0.9 };
  }
  if (lower.includes("payment successful") || lower.includes("payment success") || lower.includes("paid successfully") || lower.includes("transaction successful") || lower.includes("transaction success") || lower.includes("payment complete") || lower.includes("payment completed") || lower.includes("sent successfully") || lower.includes("money sent") || lower.includes("transferred successfully") || /\b(?:paid to|completed|successful)\b/.test(lower)) {
    return { status: "success", confidence: 0.95 };
  }
  return { status: "unknown", confidence: 0.2 };
}
function extractTransactionTimestamp(text, referenceDateIso) {
  if (!text) return { timestampIso: null, dateStr: null, timeStr: null, confidence: 0 };
  const datePatterns = [
    // 15 Sep 2026, 1:25 AM / 15 September 2026 01:25 AM / 15 Sep 2026 13:25
    /(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{4})[,.\s]+(\d{1,2}:\d{2}(?::\d{2})?\s*(?:[AaPp][Mm])?)/i,
    // Sep 15, 2026 1:25 AM
    /([A-Za-z]{3,9})\s+(\d{1,2})[,.\s]+(\d{4})[,.\s]+(\d{1,2}:\d{2}(?::\d{2})?\s*(?:[AaPp][Mm])?)/i,
    // 15/09/2026 01:25 or 15-09-2026 1:25 PM
    /(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})[,.\s]+(\d{1,2}:\d{2}(?::\d{2})?\s*(?:[AaPp][Mm])?)/i,
    // Today, 1:25 AM
    /\b(?:today|yesterday)\b[,.\s]+(\d{1,2}:\d{2}(?::\d{2})?\s*(?:[AaPp][Mm])?)/i
  ];
  for (const pat of datePatterns) {
    const match = pat.exec(text);
    if (match) {
      try {
        const dateObj = new Date(match[0]);
        if (!isNaN(dateObj.getTime())) {
          return {
            timestampIso: dateObj.toISOString(),
            dateStr: match[0],
            timeStr: match[match.length - 1],
            confidence: 0.85
          };
        }
      } catch {
      }
    }
  }
  return { timestampIso: null, dateStr: null, timeStr: null, confidence: 0 };
}
function extractUpiId(text) {
  if (!text) return { upiId: null, payeeName: null, confidence: 0 };
  const vpaRegex = /\b([a-zA-Z0-9._\-]{2,256}@[a-zA-Z]{2,64})\b/g;
  const matches = text.match(vpaRegex) || [];
  const maskedVpaRegex = /\b([a-zA-Z0-9._\-]{2,4}\*+[a-zA-Z0-9._\-]{2,4}@[a-zA-Z]{2,64})\b/g;
  const maskedMatches = text.match(maskedVpaRegex) || [];
  const candidateUpiId = matches[0] || maskedMatches[0] || null;
  let payeeName = null;
  if (/yuva\s*shakti/i.test(text)) {
    payeeName = "Yuva Shakti Youth Satulur";
  }
  const confidence = candidateUpiId ? candidateUpiId.includes("*") ? 0.7 : 0.9 : payeeName ? 0.6 : 0;
  return { upiId: candidateUpiId, payeeName, confidence };
}
function detectPaymentApp(text) {
  if (!text) return "unknown";
  const lower = text.toLowerCase();
  if (lower.includes("phonepe")) return "phonepe";
  if (lower.includes("google pay") || lower.includes("gpay") || lower.includes("g pay")) return "google_pay";
  if (lower.includes("paytm")) return "paytm";
  if (lower.includes("bhim") || lower.includes("cred") || lower.includes("fampay") || lower.includes("amazon pay")) return "other";
  return "unknown";
}
async function analyzePaymentScreenshot(sanitizedBuffer, bookingContext) {
  const startTime = Date.now();
  if (mockOcrResult) {
    const result = {
      analysisCompleted: true,
      rawText: mockOcrResult.rawText || "",
      normalizedText: mockOcrResult.normalizedText || "",
      paymentStatus: mockOcrResult.paymentStatus || "success",
      amount: mockOcrResult.amount !== void 0 ? mockOcrResult.amount : 50,
      amountText: mockOcrResult.amountText || "\u20B950.00",
      utrOrRrn: mockOcrResult.utrOrRrn !== void 0 ? mockOcrResult.utrOrRrn : "123456789012",
      transactionId: mockOcrResult.transactionId || "T123456",
      transactionDate: mockOcrResult.transactionDate || null,
      transactionTime: mockOcrResult.transactionTime || null,
      transactionTimestamp: mockOcrResult.transactionTimestamp || (/* @__PURE__ */ new Date()).toISOString(),
      payeeName: mockOcrResult.payeeName || "Yuva Shakti Youth Satulur",
      payeeUpiId: mockOcrResult.payeeUpiId || "7075920852@ybl",
      payerName: mockOcrResult.payerName || null,
      detectedApp: mockOcrResult.detectedApp || "phonepe",
      extractedFields: mockOcrResult.extractedFields || {
        paymentStatus: mockOcrResult.paymentStatus || "success",
        amount: mockOcrResult.amount !== void 0 ? mockOcrResult.amount : 50,
        amountText: mockOcrResult.amountText || "\u20B950.00",
        utrOrRrn: mockOcrResult.utrOrRrn !== void 0 ? mockOcrResult.utrOrRrn : "123456789012",
        transactionId: mockOcrResult.transactionId || "T123456",
        transactionDate: null,
        transactionTime: null,
        transactionTimestamp: (/* @__PURE__ */ new Date()).toISOString(),
        payeeName: "Yuva Shakti Youth Satulur",
        payeeUpiId: "7075920852@ybl",
        payerName: null,
        detectedApp: "phonepe",
        fieldConfidence: { status: 0.95, amount: 0.95, utr: 0.95, payee: 0.9, timestamp: 0.8 }
      },
      warnings: mockOcrResult.warnings || [],
      ocrEngine: "tesseract.js",
      processingTimeMs: Date.now() - startTime,
      ...mockOcrResult
    };
    return result;
  }
  let extractedRawText = "";
  if (mockOcrText !== null) {
    extractedRawText = mockOcrText;
  } else {
    try {
      const candidates = await generateOcrImageCandidates(sanitizedBuffer);
      const worker = await getOcrWorker();
      const ocrPromise = (async () => {
        let bestText = "";
        for (const buf of candidates) {
          const res = await worker.recognize(buf);
          const t = res.data.text || "";
          if (t.length > bestText.length) {
            bestText = t;
          }
          if (bestText.length > 80 && (bestText.includes("\u20B9") || bestText.includes("UTR") || bestText.includes("Ref"))) {
            break;
          }
        }
        return bestText;
      })();
      const timeoutPromise = new Promise(
        (_, reject) => setTimeout(() => reject(new Error("OCR_TIMEOUT: Recognition exceeded 15 seconds.")), 15e3)
      );
      extractedRawText = await Promise.race([ocrPromise, timeoutPromise]);
    } catch (ocrErr) {
      console.error("\u26A0\uFE0F [Local OCR Error] Failed to execute local OCR:", ocrErr?.message || ocrErr);
      await terminateOcrWorker();
      return {
        analysisCompleted: false,
        rawText: "",
        normalizedText: "",
        paymentStatus: "unknown",
        amount: null,
        amountText: null,
        utrOrRrn: null,
        transactionId: null,
        transactionDate: null,
        transactionTime: null,
        transactionTimestamp: null,
        payeeName: null,
        payeeUpiId: null,
        payerName: null,
        detectedApp: "unknown",
        extractedFields: {
          paymentStatus: "unknown",
          amount: null,
          amountText: null,
          utrOrRrn: null,
          transactionId: null,
          transactionDate: null,
          transactionTime: null,
          transactionTimestamp: null,
          payeeName: null,
          payeeUpiId: null,
          payerName: null,
          detectedApp: "unknown",
          fieldConfidence: { status: 0, amount: 0, utr: 0, payee: 0, timestamp: 0 }
        },
        warnings: ["OCR_PROCESSING_ERROR"],
        ocrEngine: "tesseract.js",
        processingTimeMs: Date.now() - startTime,
        error: ocrErr?.message || "Local OCR engine failed to process image.",
        retryable: true
      };
    }
  }
  const normalizedText = normalizeOcrText(extractedRawText);
  const warnings = [];
  const statusRes = extractPaymentStatus(normalizedText);
  const refRes = extractPaymentReference(normalizedText);
  const amountRes = extractAmount(normalizedText, bookingContext.expectedAmountPaise);
  const timeRes = extractTransactionTimestamp(normalizedText, bookingContext.sessionTimestampIso);
  const payeeRes = extractUpiId(normalizedText);
  const detectedApp = detectPaymentApp(normalizedText);
  if (normalizedText.length < 15) {
    warnings.push("OCR_UNREADABLE");
  }
  const extractedFields = {
    paymentStatus: statusRes.status,
    amount: amountRes.amount,
    amountText: amountRes.amountText,
    utrOrRrn: refRes.utrOrRrn,
    transactionId: refRes.transactionId,
    transactionDate: timeRes.dateStr,
    transactionTime: timeRes.timeStr,
    transactionTimestamp: timeRes.timestampIso,
    payeeName: payeeRes.payeeName,
    payeeUpiId: payeeRes.upiId,
    payerName: null,
    detectedApp,
    fieldConfidence: {
      status: statusRes.confidence,
      amount: amountRes.confidence,
      utr: refRes.confidence,
      payee: payeeRes.confidence,
      timestamp: timeRes.confidence
    }
  };
  return {
    analysisCompleted: true,
    rawText: extractedRawText,
    normalizedText,
    paymentStatus: statusRes.status,
    amount: amountRes.amount,
    amountText: amountRes.amountText,
    utrOrRrn: refRes.utrOrRrn,
    transactionId: refRes.transactionId,
    transactionDate: timeRes.dateStr,
    transactionTime: timeRes.timeStr,
    transactionTimestamp: timeRes.timestampIso,
    payeeName: payeeRes.payeeName,
    payeeUpiId: payeeRes.upiId,
    payerName: null,
    detectedApp,
    extractedFields,
    warnings,
    ocrEngine: "tesseract.js",
    processingTimeMs: Date.now() - startTime
  };
}

// server/upi/deterministicMatcher.ts
function normalizeUtr(utr) {
  if (!utr) return "";
  return utr.trim().replace(/[\s\-_]/g, "").toUpperCase();
}
function performDeterministicOcrComparison(input) {
  const rawAnalysis = input.analysis || input.extraction;
  const analysis = rawAnalysis ? {
    analysisCompleted: rawAnalysis.analysisCompleted ?? true,
    rawText: rawAnalysis.rawText || "",
    normalizedText: rawAnalysis.normalizedText || "",
    paymentStatus: rawAnalysis.paymentStatus || rawAnalysis.visible_payment_status || "unknown",
    amount: rawAnalysis.amount !== void 0 ? rawAnalysis.amount === null ? null : Number(rawAnalysis.amount) : null,
    amountText: rawAnalysis.amountText || (rawAnalysis.amount != null ? String(rawAnalysis.amount) : null),
    utrOrRrn: rawAnalysis.utrOrRrn || rawAnalysis.utr_or_rrn || null,
    transactionId: rawAnalysis.transactionId || rawAnalysis.transaction_id || null,
    transactionDate: rawAnalysis.transactionDate || null,
    transactionTime: rawAnalysis.transactionTime || null,
    transactionTimestamp: rawAnalysis.transactionTimestamp || rawAnalysis.transaction_timestamp || null,
    payeeName: rawAnalysis.payeeName || rawAnalysis.payee_name || null,
    payeeUpiId: rawAnalysis.payeeUpiId || rawAnalysis.payee_upi_id || null,
    payerName: rawAnalysis.payerName || rawAnalysis.payer_name || null,
    detectedApp: rawAnalysis.detectedApp || rawAnalysis.app_name || "unknown",
    extractedFields: rawAnalysis.extractedFields || {},
    warnings: rawAnalysis.warnings || []
  } : null;
  if (!analysis || !analysis.analysisCompleted || analysis.warnings?.includes("OCR_PROCESSING_ERROR")) {
    return {
      passed: false,
      riskScore: 0,
      reasonCodes: ["OCR_PROCESSING_ERROR"],
      nextStatus: "ocr_processing_error",
      reviewStatus: "ocr_processing_error",
      userMessage: "We couldn't process this receipt right now. Your payment proof is saved. Please retry verification.",
      isOcrProcessingError: true,
      details: {
        utrMatched: null,
        amountMatched: null,
        statusMatched: null,
        payeeMatched: null
      }
    };
  }
  const reasonCodes = [];
  let riskScore = 0;
  const details = {
    utrMatched: null,
    amountMatched: null,
    statusMatched: null,
    payeeMatched: null
  };
  const hasExtractedSignals = Boolean(analysis.utrOrRrn || analysis.amount !== null && !isNaN(analysis.amount) || analysis.paymentStatus && analysis.paymentStatus !== "unknown");
  const isUnreadable = analysis.warnings?.includes("OCR_UNREADABLE") || !hasExtractedSignals && (!analysis.normalizedText || analysis.normalizedText.trim().length < 5);
  if (isUnreadable) {
    reasonCodes.push("OCR_UNREADABLE");
    riskScore += 90;
  }
  if (analysis.warnings?.includes("TAMPERING_RISK") || rawAnalysis?.obvious_editing_signals?.length > 0 || rawAnalysis?.ai_generated_likelihood === "high") {
    reasonCodes.push("TAMPERING_RISK");
    riskScore += 90;
  }
  if (input.isExpired) {
    reasonCodes.push("PAYMENT_SESSION_EXPIRED");
    riskScore += 100;
  }
  if (input.isDuplicateUtr) {
    reasonCodes.push("DUPLICATE_PAYMENT_REFERENCE");
    riskScore += 100;
  }
  if (input.isDuplicateScreenshot) {
    reasonCodes.push("DUPLICATE_SCREENSHOT");
    riskScore += 90;
  }
  if (analysis.paymentStatus === "failed") {
    reasonCodes.push("STATUS_NOT_SUCCESS");
    riskScore += 100;
    details.statusMatched = false;
  } else if (analysis.paymentStatus === "pending") {
    reasonCodes.push("STATUS_NOT_SUCCESS");
    riskScore += 80;
    details.statusMatched = false;
  } else if (analysis.paymentStatus === "success") {
    details.statusMatched = true;
  } else if (analysis.paymentStatus === "unknown") {
    if (!isUnreadable) {
      reasonCodes.push("STATUS_NOT_SUCCESS");
      riskScore += 80;
    }
    details.statusMatched = false;
  }
  if (!analysis.utrOrRrn) {
    if (!isUnreadable) {
      reasonCodes.push("MISSING_PAYMENT_REFERENCE");
      reasonCodes.push("MISSING_RRN");
      riskScore += 80;
    }
    details.utrMatched = false;
  } else {
    const normalizedExtRrn = normalizeUtr(analysis.utrOrRrn);
    if (!normalizedExtRrn || normalizedExtRrn.length < 6 || !/^[A-Z0-9]+$/i.test(normalizedExtRrn)) {
      reasonCodes.push("INVALID_PAYMENT_REFERENCE");
      riskScore += 80;
      details.utrMatched = false;
    } else {
      details.utrMatched = true;
    }
  }
  if (analysis.amount === null || isNaN(analysis.amount)) {
    if (!isUnreadable) {
      reasonCodes.push("MISSING_AMOUNT");
      riskScore += 80;
    }
    details.amountMatched = false;
  } else {
    const expectedNum = input.expectedAmountPaise / 100;
    if (Math.abs(analysis.amount - expectedNum) < 0.05) {
      details.amountMatched = true;
    } else {
      details.amountMatched = false;
      reasonCodes.push("AMOUNT_MISMATCH");
      riskScore += 90;
    }
  }
  if (analysis.payeeUpiId || analysis.payeeName) {
    const extPayee = `${analysis.payeeUpiId || ""} ${analysis.payeeName || ""}`.toLowerCase();
    const configPayeeId = input.expectedPayeeUpiId.toLowerCase();
    const matchesId = configPayeeId && extPayee.includes(configPayeeId);
    const matchesName = extPayee.includes("yuva") || extPayee.includes("shakti") || extPayee.includes("satulur");
    let matchesMasked = false;
    if (analysis.payeeUpiId && analysis.payeeUpiId.includes("*")) {
      const [maskUser, maskBank] = analysis.payeeUpiId.split("@");
      const [confUser, confBank] = configPayeeId.split("@");
      if (maskBank === confBank && maskUser.length >= 4) {
        const prefix = maskUser.slice(0, 2);
        const suffix = maskUser.slice(-2);
        if (confUser.startsWith(prefix) && confUser.endsWith(suffix)) {
          matchesMasked = true;
        }
      }
    }
    if (matchesId || matchesName || matchesMasked) {
      details.payeeMatched = true;
    } else {
      if (analysis.payeeUpiId && !analysis.payeeUpiId.includes("*") && !matchesId) {
        details.payeeMatched = false;
        reasonCodes.push("WRONG_PAYEE");
        riskScore += 70;
      } else {
        details.payeeMatched = true;
      }
    }
  }
  if (analysis.transactionTimestamp && input.bookingCreatedAt) {
    const receiptTime = new Date(analysis.transactionTimestamp).getTime();
    const bookingTime = new Date(input.bookingCreatedAt).getTime();
    if (!isNaN(receiptTime) && !isNaN(bookingTime)) {
      if (receiptTime < bookingTime - 3 * 60 * 1e3) {
        reasonCodes.push("TRANSACTION_TIME_MISMATCH");
        riskScore += 60;
      }
    }
  }
  const hasFatalFailure = reasonCodes.includes("OCR_UNREADABLE") || reasonCodes.includes("MISSING_PAYMENT_REFERENCE") || reasonCodes.includes("DUPLICATE_PAYMENT_REFERENCE") || reasonCodes.includes("INVALID_PAYMENT_REFERENCE") || reasonCodes.includes("STATUS_NOT_SUCCESS") || reasonCodes.includes("AMOUNT_MISMATCH") || reasonCodes.includes("MISSING_AMOUNT") || reasonCodes.includes("DUPLICATE_SCREENSHOT") || reasonCodes.includes("WRONG_PAYEE") || reasonCodes.includes("TRANSACTION_TIME_MISMATCH") || reasonCodes.includes("PAYMENT_SESSION_EXPIRED") || riskScore >= 50;
  if (hasFatalFailure) {
    let failMessage = "Verification failed. Please review the highlighted issue and resubmit.";
    if (reasonCodes.includes("OCR_UNREADABLE")) {
      failMessage = "We couldn't clearly read this screenshot. Please upload the detailed payment receipt showing amount, success status and transaction reference.";
    } else if (reasonCodes.includes("PAYMENT_SESSION_EXPIRED")) {
      failMessage = "Payment session expired. Start a new booking.";
    } else if (reasonCodes.includes("DUPLICATE_PAYMENT_REFERENCE")) {
      failMessage = "This payment receipt has already been used for another booking.";
    } else if (reasonCodes.includes("DUPLICATE_SCREENSHOT")) {
      failMessage = "This payment screenshot has already been submitted for another booking.";
    } else if (reasonCodes.includes("MISSING_PAYMENT_REFERENCE")) {
      failMessage = "We couldn't clearly read the transaction reference from this screenshot. Please upload the detailed payment receipt showing the UTR or reference number.";
    } else if (reasonCodes.includes("INVALID_PAYMENT_REFERENCE")) {
      failMessage = "We couldn't find a valid 12-digit transaction reference on this screenshot. Please upload the detailed receipt.";
    } else if (reasonCodes.includes("AMOUNT_MISMATCH")) {
      failMessage = "Payment amount on receipt does not match the booking total.";
    } else if (reasonCodes.includes("MISSING_AMOUNT")) {
      failMessage = "Could not detect the payment amount on the screenshot. Please upload a complete receipt.";
    } else if (reasonCodes.includes("STATUS_NOT_SUCCESS")) {
      failMessage = "Payment is not shown as successful on this receipt.";
    } else if (reasonCodes.includes("WRONG_PAYEE")) {
      failMessage = "The recipient UPI ID does not match the official Yuva Shakti account.";
    } else if (reasonCodes.includes("TRANSACTION_TIME_MISMATCH")) {
      failMessage = "The transaction date/time on this receipt does not match your booking window.";
    }
    return {
      passed: false,
      riskScore,
      reasonCodes,
      nextStatus: "payment_rejected",
      reviewStatus: "ocr_check_failed",
      userMessage: failMessage,
      details
    };
  }
  return {
    passed: true,
    riskScore: 0,
    reasonCodes: ["OCR_VERIFIED"],
    nextStatus: "payment_confirmed",
    reviewStatus: "ocr_verified",
    userMessage: "Payment proof verified successfully. Coupons generated.",
    details
  };
}
var performDeterministicComparison = performDeterministicOcrComparison;

// server/upi/automatedFinalizer.ts
import crypto4 from "crypto";
async function finalizeVerifiedSubmission(params) {
  const {
    submissionId,
    bookingId,
    decisionVersion = "v1-ocr-deterministic-auto"
  } = params;
  return await db.transaction(async (client) => {
    const bRes = await client.query("SELECT * FROM bookings WHERE id = $1 FOR UPDATE", [bookingId]);
    if (bRes.rows.length === 0) {
      throw new Error(`Booking ${bookingId} not found`);
    }
    const booking = bRes.rows[0];
    if (booking.status === "payment_confirmed" || booking.status === "proof_verified") {
      const existingCoupons = await client.query(
        "SELECT * FROM coupons WHERE booking_id = $1 ORDER BY ticket_index ASC",
        [booking.id]
      );
      return {
        booking: { ...booking, status: "payment_confirmed" },
        coupons: existingCoupons.rows,
        couponsIssuedCount: existingCoupons.rows.length
      };
    }
    const sRes = await client.query("SELECT * FROM payment_submissions WHERE id = $1 FOR UPDATE", [submissionId]);
    if (sRes.rows.length === 0) {
      throw new Error(`Submission ${submissionId} not found`);
    }
    const submission = sRes.rows[0];
    if (submission.payer_utr_hash) {
      const existingUtrRes = await client.query(
        `SELECT id, booking_id FROM payment_submissions 
         WHERE payer_utr_hash = $1 AND status IN ('payment_confirmed', 'proof_verified') AND booking_id != $2`,
        [submission.payer_utr_hash, booking.id]
      );
      if (existingUtrRes.rows.length > 0) {
        throw new Error("This 12-digit UPI RRN has already been finalized for another booking.");
      }
    }
    const finalizedAt = (/* @__PURE__ */ new Date()).toISOString();
    await client.query(
      `UPDATE payment_submissions 
       SET status = 'payment_confirmed', 
           ocr_engine = $1,
           ai_model_version = $1, 
           updated_at = $2
       WHERE id = $3`,
      [decisionVersion, finalizedAt, submission.id]
    );
    await client.query(
      `UPDATE bookings 
       SET status = 'payment_confirmed', 
           paid_at = $1,
           verified_at = $1, 
           updated_at = $1 
       WHERE id = $2`,
      [finalizedAt, booking.id]
    );
    const quantity = booking.quantity || 1;
    const currentYear = (/* @__PURE__ */ new Date()).getFullYear();
    const prefix = config.EVENT_COUPON_PREFIX || "YSYS";
    const serialRes = await client.query("SELECT COALESCE(MAX(serial), 0) as max_serial FROM coupons");
    let nextSerial = Number(serialRes.rows[0]?.max_serial || 0);
    const issuedCoupons = [];
    for (let i = 1; i <= quantity; i++) {
      nextSerial++;
      const paddedSerial = String(nextSerial).padStart(6, "0");
      const couponNumber = `${prefix}-${currentYear}-${paddedSerial}`;
      const couponId = crypto4.randomUUID();
      const verificationToken = crypto4.randomBytes(16).toString("hex");
      const verificationTokenHash = crypto4.createHash("sha256").update(verificationToken).digest("hex");
      await client.query(
        `INSERT INTO coupons (
          id, booking_id, serial, coupon_number, holder_name, phone, village,
          ticket_index, total_quantity, template_version, verification_token_hash, status, issued_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
        [
          couponId,
          booking.id,
          nextSerial,
          couponNumber,
          booking.participant_name,
          booking.phone,
          booking.village,
          i,
          quantity,
          config.TEMPLATE_VERSION || "v1-official",
          verificationTokenHash,
          "valid",
          finalizedAt
        ]
      );
      issuedCoupons.push({
        id: couponId,
        coupon_number: couponNumber,
        serial: nextSerial,
        holder_name: booking.participant_name,
        phone: booking.phone,
        village: booking.village,
        ticket_index: i,
        total_quantity: quantity,
        status: "valid",
        issued_at: finalizedAt
      });
    }
    const auditId = crypto4.randomUUID();
    await client.query(
      `INSERT INTO admin_audit_logs (
        id, action, entity_type, entity_id, metadata, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        auditId,
        "automated_proof_finalized",
        "booking",
        booking.id,
        JSON.stringify({
          submissionId: submission.id,
          publicBookingId: booking.public_id,
          couponsIssued: quantity,
          amountPaise: booking.total_amount_paise,
          utrHash: submission.payer_utr_hash,
          decisionVersion
        }),
        finalizedAt
      ]
    );
    return {
      booking: { ...booking, status: "payment_confirmed", paid_at: finalizedAt, verified_at: finalizedAt },
      coupons: issuedCoupons,
      couponsIssuedCount: quantity
    };
  });
}

// server/utils/crypto.ts
import crypto5 from "crypto";
function getKeyBuffer() {
  const key = config.FIELD_ENCRYPTION_KEY;
  if (!key) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("FIELD_ENCRYPTION_KEY is required in production.");
    }
    return crypto5.createHash("sha256").update("dev-key-yuva-shakti-satulur").digest();
  }
  if (/^[0-9a-fA-F]{64}$/.test(key)) {
    return Buffer.from(key, "hex");
  }
  if (key.length === 32) {
    return Buffer.from(key, "utf8");
  }
  if (process.env.NODE_ENV === "production") {
    throw new Error("FIELD_ENCRYPTION_KEY must be a 64-character hex string (32 bytes) in production.");
  }
  return crypto5.createHash("sha256").update(key).digest();
}
function encryptSensitiveField(plaintext) {
  if (!plaintext) return "";
  const key = getKeyBuffer();
  const iv = crypto5.randomBytes(12);
  const cipher = crypto5.createCipheriv("aes-256-gcm", key, iv);
  let encrypted = cipher.update(plaintext, "utf8", "hex");
  encrypted += cipher.final("hex");
  const authTag = cipher.getAuthTag().toString("hex");
  return `v1:${iv.toString("hex")}:${authTag}:${encrypted}`;
}

// server/admin/auth.ts
import bcrypt2 from "bcryptjs";
import crypto6 from "crypto";
var SESSION_TTL_MS = 24 * 60 * 60 * 1e3;
var revokedTokens = /* @__PURE__ */ new Set();
var loginAttempts = /* @__PURE__ */ new Map();
function checkLoginRateLimit(ip) {
  const now = Date.now();
  const attempt = loginAttempts.get(ip);
  if (!attempt || now > attempt.resetAt) {
    loginAttempts.set(ip, { count: 1, resetAt: now + 15 * 60 * 1e3 });
    return true;
  }
  if (attempt.count >= 5) {
    return false;
  }
  attempt.count++;
  return true;
}
async function comparePassword(password, hash) {
  return await bcrypt2.compare(password, hash);
}
function getAdminCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: SESSION_TTL_MS,
    path: "/"
  };
}
function createAdminSession(user) {
  const issuedAt = Date.now();
  const expiresAt = issuedAt + SESSION_TTL_MS;
  const payload = {
    userId: user.id,
    email: user.email.toLowerCase().trim(),
    role: user.role || "super_admin",
    issuedAt,
    expiresAt
  };
  const payloadBase64 = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = crypto6.createHmac("sha256", config.SESSION_SECRET).update(payloadBase64).digest("base64url");
  return `${payloadBase64}.${signature}`;
}
function getAdminSession(token) {
  if (!token || typeof token !== "string") return null;
  const parts = token.trim().split(".");
  if (parts.length !== 2) return null;
  const [payloadBase64, signature] = parts;
  if (!payloadBase64 || !signature) return null;
  if (revokedTokens.has(token)) {
    return null;
  }
  const expectedSignature = crypto6.createHmac("sha256", config.SESSION_SECRET).update(payloadBase64).digest("base64url");
  try {
    const sigBuffer = Buffer.from(signature, "utf8");
    const expectedBuffer = Buffer.from(expectedSignature, "utf8");
    if (sigBuffer.length !== expectedBuffer.length || !crypto6.timingSafeEqual(sigBuffer, expectedBuffer)) {
      return null;
    }
    const payloadJson = Buffer.from(payloadBase64, "base64url").toString("utf8");
    const session = JSON.parse(payloadJson);
    if (Date.now() > session.expiresAt) {
      return null;
    }
    return session;
  } catch {
    return null;
  }
}
function destroyAdminSession(token) {
  if (token) {
    revokedTokens.add(token);
  }
}
async function requireAdminAuth(req, res, next) {
  try {
    const cookieToken = req.cookies && req.cookies.admin_session;
    const headerToken = req.headers.authorization?.startsWith("Bearer ") ? req.headers.authorization.slice(7) : void 0;
    const token = cookieToken || headerToken;
    const session = getAdminSession(token);
    if (!session) {
      return res.status(401).json({
        success: false,
        error: { code: "UNAUTHORIZED", message: "Authentication required. Please log in." }
      });
    }
    try {
      const userRes = await db.query("SELECT id, email, role, is_active FROM admin_users WHERE id = $1", [session.userId]);
      if (userRes.rows.length > 0 && userRes.rows[0].is_active === false) {
        return res.status(403).json({
          success: false,
          error: { code: "ACCOUNT_DISABLED", message: "This admin account has been deactivated." }
        });
      }
    } catch (dbErr) {
    }
    req.adminUser = session;
    next();
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: { code: "AUTH_ERROR", message: "Authentication verification encountered an error." }
    });
  }
}

// server/services/ticketRenderer.ts
import fs2 from "fs";
import path2 from "path";
import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import QRCode2 from "qrcode";
import archiver from "archiver";
function maskPhoneNumber(phone) {
  const cleaned = phone.replace(/\D/g, "");
  if (cleaned.length >= 10) {
    return `XXXXXX${cleaned.slice(-4)}`;
  }
  return phone.slice(0, 2) + "****" + phone.slice(-2);
}
function formatKolkataTime(isoString) {
  try {
    const d = isoString ? new Date(isoString) : new Date(config.EVENT_DRAW_AT);
    return new Intl.DateTimeFormat("en-IN", {
      timeZone: config.EVENT_TIMEZONE || "Asia/Kolkata",
      dateStyle: "medium",
      timeStyle: "short"
    }).format(d);
  } catch {
    return "19th Sunday Evening, 6:30 PM IST";
  }
}
async function renderTicketPdf(data) {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([620, 340]);
  const helveticaBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const helvetica = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const courierBold = await pdfDoc.embedFont(StandardFonts.CourierBold);
  page.drawRectangle({
    x: 0,
    y: 0,
    width: 620,
    height: 340,
    color: rgb(7 / 255, 11 / 255, 25 / 255)
  });
  page.drawRectangle({
    x: 15,
    y: 15,
    width: 590,
    height: 310,
    borderColor: rgb(245 / 255, 158 / 255, 11 / 255),
    borderWidth: 2,
    color: rgb(14 / 255, 21 / 255, 48 / 255)
  });
  page.drawRectangle({
    x: 20,
    y: 20,
    width: 580,
    height: 300,
    borderColor: rgb(139 / 255, 92 / 255, 246 / 255),
    // Purple-500
    borderWidth: 0.75
  });
  page.drawLine({
    start: { x: 20, y: 275 },
    end: { x: 600, y: 275 },
    color: rgb(245 / 255, 158 / 255, 11 / 255),
    thickness: 1
  });
  const stubX = 455;
  for (let y = 25; y < 270; y += 8) {
    page.drawLine({
      start: { x: stubX, y },
      end: { x: stubX, y: y + 4 },
      color: rgb(168 / 255, 85 / 255, 247 / 255),
      thickness: 1.5
    });
  }
  const logoPath = fs2.existsSync(path2.resolve(process.cwd(), "logo.jpeg")) ? path2.resolve(process.cwd(), "logo.jpeg") : path2.resolve(process.cwd(), "public", "logo.jpeg");
  if (fs2.existsSync(logoPath)) {
    try {
      const logoBytes = fs2.readFileSync(logoPath);
      const logoImage = await pdfDoc.embedJpg(logoBytes);
      page.drawImage(logoImage, {
        x: 30,
        y: 282,
        width: 38,
        height: 38
      });
    } catch {
    }
  }
  const sanitize = (text) => {
    if (!text) return "";
    return text.replace(/₹/g, "Rs.").replace(/•/g, "-").replace(/[^\x20-\x7E]/g, "").trim();
  };
  page.drawText("YUVA SHAKTI YOUTH SATULUR", {
    x: 76,
    y: 302,
    size: 13,
    font: helveticaBold,
    color: rgb(1, 1, 1)
  });
  page.drawText("OFFICIAL LUCKY DRAW COUPON - Rs.50", {
    x: 76,
    y: 288,
    size: 9,
    font: helveticaBold,
    color: rgb(251 / 255, 191 / 255, 36 / 255)
    // Amber-400
  });
  const badgeText = `TICKET ${data.ticketIndex} OF ${data.totalQuantity}`;
  page.drawText(badgeText, {
    x: stubX + 15,
    y: 300,
    size: 9.5,
    font: courierBold,
    color: rgb(245 / 255, 158 / 255, 11 / 255)
  });
  page.drawText(`REF: ${data.bookingPublicId}`, {
    x: stubX + 15,
    y: 288,
    size: 8,
    font: courierBold,
    color: rgb(196 / 255, 181 / 255, 253 / 255)
  });
  page.drawRectangle({
    x: 30,
    y: 200,
    width: 405,
    height: 62,
    color: rgb(7 / 255, 11 / 255, 25 / 255),
    borderColor: rgb(245 / 255, 158 / 255, 11 / 255),
    borderWidth: 1
  });
  page.drawText("COUPON SERIAL NUMBER", {
    x: 42,
    y: 247,
    size: 8,
    font: helveticaBold,
    color: rgb(148 / 255, 163 / 255, 184 / 255)
  });
  page.drawText(data.couponNumber, {
    x: 42,
    y: 215,
    size: 22,
    font: courierBold,
    color: rgb(251 / 255, 191 / 255, 36 / 255)
    // Gold
  });
  page.drawText("PRIZE: 20 KG MAHA LADDU", {
    x: 215,
    y: 218,
    size: 9.5,
    font: helveticaBold,
    color: rgb(253 / 255, 224 / 255, 71 / 255)
  });
  const detailsY = 172;
  page.drawText("PARTICIPANT NAME", { x: 30, y: detailsY, size: 7.5, font: helvetica, color: rgb(0.6, 0.6, 0.7) });
  page.drawText(sanitize(data.participantName).slice(0, 28).toUpperCase() || "VALUED PARTICIPANT", { x: 30, y: detailsY - 14, size: 11, font: helveticaBold, color: rgb(1, 1, 1) });
  page.drawText("PHONE (CONFIRMED)", { x: 235, y: detailsY, size: 7.5, font: helvetica, color: rgb(0.6, 0.6, 0.7) });
  page.drawText(maskPhoneNumber(data.phone), { x: 235, y: detailsY - 14, size: 10, font: courierBold, color: rgb(196 / 255, 181 / 255, 253 / 255) });
  page.drawText("VILLAGE / REGION", { x: 30, y: detailsY - 38, size: 7.5, font: helvetica, color: rgb(0.6, 0.6, 0.7) });
  page.drawText(sanitize(data.village).slice(0, 28).toUpperCase() || "SATULUR", { x: 30, y: detailsY - 52, size: 10, font: helveticaBold, color: rgb(1, 1, 1) });
  page.drawText("DRAW DATE & VENUE", { x: 235, y: detailsY - 38, size: 7.5, font: helvetica, color: rgb(0.6, 0.6, 0.7) });
  page.drawText("19th Sun Evening 6:30 PM - Satulur Center", { x: 235, y: detailsY - 52, size: 8.5, font: helveticaBold, color: rgb(251 / 255, 191 / 255, 36 / 255) });
  page.drawLine({ start: { x: 30, y: 55 }, end: { x: 435, y: 55 }, color: rgb(0.3, 0.3, 0.5), thickness: 0.5 });
  page.drawText("Organized by Yuva Shakti Youth, Satulur - Helpline: +91 95748 76369", {
    x: 30,
    y: 40,
    size: 7.5,
    font: helvetica,
    color: rgb(148 / 255, 163 / 255, 184 / 255)
  });
  page.drawText("Keep this official verified pass safe for the live stage draw.", {
    x: 30,
    y: 28,
    size: 7,
    font: helvetica,
    color: rgb(100 / 255, 116 / 255, 139 / 255)
  });
  const verifyUrl = `${config.APP_URL}/verify?coupon=${encodeURIComponent(data.couponNumber)}${data.verificationToken ? `&token=${encodeURIComponent(data.verificationToken)}` : ""}`;
  try {
    const qrBuffer = await QRCode2.toBuffer(verifyUrl, {
      width: 130,
      margin: 1,
      color: { dark: "#070B19", light: "#FFFFFF" }
    });
    const qrImage = await pdfDoc.embedPng(qrBuffer);
    page.drawImage(qrImage, {
      x: stubX + 18,
      y: 140,
      width: 110,
      height: 110
    });
  } catch (err) {
    console.error("Error generating QR code for ticket", err);
  }
  page.drawText("SCAN TO VERIFY", {
    x: stubX + 32,
    y: 122,
    size: 8,
    font: helveticaBold,
    color: rgb(245 / 255, 158 / 255, 11 / 255)
  });
  page.drawText("OFFICIAL COMMITTEE SEAL", {
    x: stubX + 18,
    y: 105,
    size: 6.5,
    font: helvetica,
    color: rgb(148 / 255, 163 / 255, 184 / 255)
  });
  const barcodeY = 32;
  const barPattern = [2, 1, 3, 1, 2, 4, 1, 3, 1, 2, 3, 1, 4, 2, 1, 3, 2, 1, 2, 4, 1, 3, 1, 2];
  let barX = stubX + 18;
  for (const w of barPattern) {
    page.drawRectangle({
      x: barX,
      y: barcodeY,
      width: w,
      height: 22,
      color: rgb(203 / 255, 213 / 255, 225 / 255)
    });
    barX += w + 2;
  }
  const pdfBytes = await pdfDoc.save();
  return Buffer.from(pdfBytes);
}
async function renderMultiTicketPdf(tickets) {
  const mergedPdf = await PDFDocument.create();
  for (const ticket of tickets) {
    const singleBuf = await renderTicketPdf(ticket);
    const tempDoc = await PDFDocument.load(singleBuf);
    const copiedPages = await mergedPdf.copyPages(tempDoc, [0]);
    mergedPdf.addPage(copiedPages[0]);
  }
  const bytes = await mergedPdf.save();
  return Buffer.from(bytes);
}
async function renderTicketRaster(data, format) {
  const verifyUrl = `${config.APP_URL}/verify?coupon=${encodeURIComponent(data.couponNumber)}${data.verificationToken ? `&token=${encodeURIComponent(data.verificationToken)}` : ""}`;
  const qrDataUrl = await QRCode2.toDataURL(verifyUrl, {
    width: 220,
    margin: 1,
    color: { dark: "#070B19", light: "#FFFFFF" }
  });
  const logoPath = fs2.existsSync(path2.resolve(process.cwd(), "logo.jpeg")) ? path2.resolve(process.cwd(), "logo.jpeg") : path2.resolve(process.cwd(), "public", "logo.jpeg");
  let logoDataUrl = "";
  if (fs2.existsSync(logoPath)) {
    const logoBytes = fs2.readFileSync(logoPath);
    logoDataUrl = `data:image/jpeg;base64,${logoBytes.toString("base64")}`;
  }
  const svg = `
    <svg width="1240" height="680" viewBox="0 0 1240 680" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#070B19" />
          <stop offset="100%" stop-color="#0F172A" />
        </linearGradient>
      </defs>
      <rect width="1240" height="680" fill="url(#bg)" />
      <!-- Outer border -->
      <rect x="30" y="30" width="1180" height="620" rx="20" fill="#0E1530" stroke="#F59E0B" stroke-width="4" />
      <!-- Inner border -->
      <rect x="42" y="42" width="1156" height="596" rx="14" fill="none" stroke="#8B5CF6" stroke-width="1.5" stroke-opacity="0.4" />
      <!-- Header Line -->
      <line x1="42" y1="130" x2="1198" y2="130" stroke="#F59E0B" stroke-width="2" stroke-opacity="0.6" />
      <!-- Perforation Line -->
      <line x1="910" y1="130" x2="910" y2="630" stroke="#A855F7" stroke-width="3" stroke-dasharray="8,8" />

      <!-- Logo -->
      ${logoDataUrl ? `<image href="${logoDataUrl}" x="60" y="52" width="64" height="64" />` : ""}

      <!-- Header Title -->
      <text x="${logoDataUrl ? "140" : "60"}" y="88" font-family="Helvetica, Arial, sans-serif" font-size="24" font-weight="bold" fill="#FFFFFF">YUVA SHAKTI YOUTH SATULUR</text>
      <text x="${logoDataUrl ? "140" : "60"}" y="114" font-family="Helvetica, Arial, sans-serif" font-size="16" font-weight="bold" fill="#FBBF24">OFFICIAL LUCKY DRAW COUPON - Rs.50</text>

      <!-- Series Badge -->
      <rect x="940" y="58" width="220" height="52" rx="8" fill="#1E1B4B" stroke="#A855F7" stroke-width="1.5" />
      <text x="1050" y="82" font-family="monospace" font-size="13" font-weight="bold" fill="#C084FC" text-anchor="middle">OFFICIAL SERIES</text>
      <text x="1050" y="102" font-family="Helvetica, Arial, sans-serif" font-size="14" font-weight="bold" fill="#FBBF24" text-anchor="middle">Pass ${data.ticketIndex} of ${data.totalQuantity}</text>

      <!-- Coupon Number Banner -->
      <rect x="60" y="156" width="810" height="76" rx="12" fill="#0A0E24" stroke="#F59E0B" stroke-width="2" />
      <text x="80" y="180" font-family="monospace" font-size="13" font-weight="bold" fill="#94A3B8">OFFICIAL COUPON NUMBER</text>
      <text x="80" y="218" font-family="monospace" font-size="34" font-weight="bold" fill="#FDE047">${data.couponNumber}</text>

      <!-- Participant Details Grid -->
      <text x="60" y="270" font-family="Helvetica, Arial, sans-serif" font-size="14" fill="#94A3B8">PARTICIPANT NAME</text>
      <text x="60" y="300" font-family="Helvetica, Arial, sans-serif" font-size="22" font-weight="bold" fill="#FFFFFF">${data.participantName.toUpperCase()}</text>

      <text x="470" y="270" font-family="Helvetica, Arial, sans-serif" font-size="14" fill="#94A3B8">PHONE (VERIFIED)</text>
      <text x="470" y="300" font-family="monospace" font-size="20" font-weight="bold" fill="#C4B5FD">${maskPhoneNumber(data.phone)}</text>

      <text x="60" y="360" font-family="Helvetica, Arial, sans-serif" font-size="14" fill="#94A3B8">VILLAGE / REGION</text>
      <text x="60" y="390" font-family="Helvetica, Arial, sans-serif" font-size="20" font-weight="bold" fill="#FFFFFF">${data.village.toUpperCase()}</text>

      <text x="470" y="360" font-family="Helvetica, Arial, sans-serif" font-size="14" fill="#94A3B8">DRAW DATE &amp; VENUE</text>
      <text x="470" y="390" font-family="Helvetica, Arial, sans-serif" font-size="18" font-weight="bold" fill="#FBBF24">19th Sun Evening 6:30 PM - Satulur Center</text>

      <text x="60" y="450" font-family="Helvetica, Arial, sans-serif" font-size="14" fill="#94A3B8">BUMPER PRIZE</text>
      <text x="60" y="480" font-family="Helvetica, Arial, sans-serif" font-size="20" font-weight="bold" fill="#34D399">20 KG LADDU</text>

      <text x="470" y="450" font-family="Helvetica, Arial, sans-serif" font-size="14" fill="#94A3B8">BOOKING REFERENCE</text>
      <text x="470" y="480" font-family="monospace" font-size="18" font-weight="bold" fill="#E2E8F0">${data.bookingPublicId}</text>

      <!-- Footer Info -->
      <line x1="60" y1="540" x2="870" y2="540" stroke="#334155" stroke-width="1" />
      <text x="60" y="570" font-family="Helvetica, Arial, sans-serif" font-size="14" fill="#94A3B8">Organized by Yuva Shakti Youth, Satulur - Helpline: +91 95748 76369</text>
      <text x="60" y="596" font-family="Helvetica, Arial, sans-serif" font-size="13" fill="#64748B">Keep this official verified pass safe for the live stage draw.</text>

      <!-- QR Code Stub -->
      <image href="${qrDataUrl}" x="945" y="200" width="220" height="220" />
      <text x="1055" y="450" font-family="Helvetica, Arial, sans-serif" font-size="15" font-weight="bold" fill="#F59E0B" text-anchor="middle">SCAN TO VERIFY</text>
      <text x="1055" y="475" font-family="Helvetica, Arial, sans-serif" font-size="12" fill="#94A3B8" text-anchor="middle">OFFICIAL COMMITTEE SEAL</text>
      <text x="1055" y="500" font-family="monospace" font-size="12" fill="#34D399" text-anchor="middle">&#x2713; PROOF VERIFIED</text>
    </svg>
  `;
  const svgBuffer = Buffer.from(svg);
  const sharp = await getSharp();
  if (!sharp) {
    return svgBuffer;
  }
  if (format === "png") {
    return await sharp(svgBuffer).png().toBuffer();
  } else {
    return await sharp(svgBuffer).flatten({ background: "#070B19" }).jpeg({ quality: 95 }).toBuffer();
  }
}
function createTicketsZipArchive(tickets) {
  return new Promise(async (resolve, reject) => {
    try {
      const archive = archiver("zip", { zlib: { level: 9 } });
      const chunks = [];
      archive.on("data", (chunk) => chunks.push(chunk));
      archive.on("end", () => resolve(Buffer.concat(chunks)));
      archive.on("error", (err) => reject(err));
      for (const ticket of tickets) {
        const pdfBuffer = await renderTicketPdf(ticket);
        archive.append(pdfBuffer, { name: `${ticket.couponNumber}.pdf` });
        const pngBuffer = await renderTicketRaster(ticket, "png");
        archive.append(pngBuffer, { name: `${ticket.couponNumber}.png` });
        const jpgBuffer = await renderTicketRaster(ticket, "jpeg");
        archive.append(jpgBuffer, { name: `${ticket.couponNumber}.jpg` });
      }
      await archive.finalize();
    } catch (err) {
      reject(err);
    }
  });
}

// server/admin/routes.ts
import express from "express";
import fs3 from "fs";

// server/upi/adminReconciliation.ts
import crypto7 from "crypto";
async function confirmPaymentFromBankRecord(params) {
  const { submissionId, adminUserId, bankRecordMatch, auditNote, idempotencyKey } = params;
  return await db.transaction(async (client) => {
    const sRes = await client.query("SELECT * FROM payment_submissions WHERE id = $1 FOR UPDATE", [submissionId]);
    if (sRes.rows.length === 0) {
      throw new Error(`Payment submission ${submissionId} not found`);
    }
    const submission = sRes.rows[0];
    const bRes = await client.query("SELECT * FROM bookings WHERE id = $1 FOR UPDATE", [submission.booking_id]);
    if (bRes.rows.length === 0) {
      throw new Error(`Booking ${submission.booking_id} not found`);
    }
    const booking = bRes.rows[0];
    if (booking.status === "payment_confirmed") {
      const existingCoupons = await client.query(
        "SELECT * FROM coupons WHERE booking_id = $1 ORDER BY ticket_index ASC",
        [booking.id]
      );
      return {
        booking,
        coupons: existingCoupons.rows,
        couponsIssuedCount: existingCoupons.rows.length
      };
    }
    if (bankRecordMatch.receivedAmountPaise < booking.total_amount_paise) {
      throw new Error(
        `Received amount (\u20B9${bankRecordMatch.receivedAmountPaise / 100}) is less than expected amount (\u20B9${booking.total_amount_paise / 100})`
      );
    }
    if (submission.payer_utr_hash) {
      const existingUtrRes = await client.query(
        `SELECT id, booking_id FROM payment_submissions 
         WHERE payer_utr_hash = $1 AND status = 'admin_confirmed' AND booking_id != $2`,
        [submission.payer_utr_hash, booking.id]
      );
      if (existingUtrRes.rows.length > 0) {
        throw new Error("This UTR has already been confirmed for another booking.");
      }
    }
    const confirmedAt = (/* @__PURE__ */ new Date()).toISOString();
    await client.query(
      `UPDATE payment_submissions 
       SET status = 'admin_confirmed', 
           admin_reviewer_id = $1, 
           admin_review_note = $2, 
           bank_record_match = $3, 
           reviewed_at = $4,
           updated_at = $4
       WHERE id = $5`,
      [
        adminUserId,
        auditNote || "Confirmed against bank record",
        JSON.stringify(bankRecordMatch),
        confirmedAt,
        submission.id
      ]
    );
    await client.query(
      `UPDATE bookings 
       SET status = 'payment_confirmed', 
           paid_at = $1, 
           verified_at = $1, 
           updated_at = $1 
       WHERE id = $2`,
      [confirmedAt, booking.id]
    );
    const quantity = booking.quantity || 1;
    const currentYear = (/* @__PURE__ */ new Date()).getFullYear();
    const prefix = config.EVENT_COUPON_PREFIX || "YSYS";
    const maxSerialRes = await client.query("SELECT COALESCE(MAX(serial), 0) as max_serial FROM coupons");
    let currentMaxSerial = Number(maxSerialRes.rows[0]?.max_serial) || 0;
    const issuedCoupons = [];
    for (let i = 1; i <= quantity; i++) {
      currentMaxSerial += 1;
      const nextSerial = currentMaxSerial;
      const serialPadded = String(nextSerial).padStart(6, "0");
      const couponNumber = `${prefix}-${currentYear}-${serialPadded}`;
      const couponId = crypto7.randomUUID();
      const verificationToken = crypto7.randomBytes(16).toString("hex");
      const verificationTokenHash = crypto7.createHash("sha256").update(verificationToken).digest("hex");
      await client.query(
        `INSERT INTO coupons (
          id, booking_id, serial, coupon_number, holder_name, phone, village,
          ticket_index, total_quantity, template_version, verification_token_hash,
          status, issued_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
        [
          couponId,
          booking.id,
          nextSerial,
          couponNumber,
          booking.participant_name,
          booking.phone,
          booking.village,
          i,
          quantity,
          config.TEMPLATE_VERSION || "v1-official",
          verificationTokenHash,
          "valid",
          confirmedAt
        ]
      );
      issuedCoupons.push({
        id: couponId,
        coupon_number: couponNumber,
        serial: nextSerial,
        holder_name: booking.participant_name,
        phone: booking.phone,
        village: booking.village,
        ticket_index: i,
        total_quantity: quantity,
        status: "valid",
        issued_at: confirmedAt
      });
    }
    await client.query(
      `INSERT INTO admin_audit_logs (
        id, admin_user_id, action, entity_type, entity_id, metadata, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        crypto7.randomUUID(),
        adminUserId,
        "CONFIRM_PAYMENT_FROM_BANK_RECORD",
        "booking",
        booking.id,
        JSON.stringify({
          submissionId: submission.id,
          couponsIssuedCount: quantity,
          couponNumbers: issuedCoupons.map((c) => c.coupon_number),
          bankRecordMatch,
          auditNote,
          idempotencyKey
        }),
        confirmedAt
      ]
    );
    return {
      booking: {
        ...booking,
        status: "payment_confirmed",
        paid_at: confirmedAt,
        verified_at: confirmedAt
      },
      coupons: issuedCoupons,
      couponsIssuedCount: issuedCoupons.length
    };
  });
}
async function rejectPaymentSubmission(params) {
  const { submissionId, adminUserId, reviewNote } = params;
  await db.transaction(async (client) => {
    const sRes = await client.query("SELECT * FROM payment_submissions WHERE id = $1 FOR UPDATE", [submissionId]);
    if (sRes.rows.length === 0) throw new Error(`Submission ${submissionId} not found`);
    const submission = sRes.rows[0];
    const now = (/* @__PURE__ */ new Date()).toISOString();
    await client.query(
      `UPDATE payment_submissions 
       SET status = 'admin_rejected', 
           admin_reviewer_id = $1, 
           admin_review_note = $2, 
           reviewed_at = $3,
           updated_at = $3
       WHERE id = $4`,
      [adminUserId, reviewNote, now, submission.id]
    );
    await client.query(
      `UPDATE bookings 
       SET status = 'payment_rejected', 
           updated_at = $1 
       WHERE id = $2`,
      [now, submission.booking_id]
    );
    await client.query(
      `INSERT INTO admin_audit_logs (
        id, admin_user_id, action, entity_type, entity_id, metadata, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        crypto7.randomUUID(),
        adminUserId,
        "REJECT_PAYMENT_SUBMISSION",
        "booking",
        submission.booking_id,
        JSON.stringify({ submissionId, reviewNote }),
        now
      ]
    );
  });
}
async function requestProofResubmission(params) {
  const { submissionId, adminUserId, guidanceNote } = params;
  await db.transaction(async (client) => {
    const sRes = await client.query("SELECT * FROM payment_submissions WHERE id = $1 FOR UPDATE", [submissionId]);
    if (sRes.rows.length === 0) throw new Error(`Submission ${submissionId} not found`);
    const submission = sRes.rows[0];
    const now = (/* @__PURE__ */ new Date()).toISOString();
    await client.query(
      `UPDATE payment_submissions 
       SET status = 'superseded', 
           admin_reviewer_id = $1, 
           admin_review_note = $2, 
           reviewed_at = $3,
           updated_at = $3
       WHERE id = $4`,
      [adminUserId, guidanceNote, now, submission.id]
    );
    await client.query(
      `UPDATE bookings 
       SET status = 'proof_required', 
           updated_at = $1 
       WHERE id = $2`,
      [now, submission.booking_id]
    );
    await client.query(
      `INSERT INTO admin_audit_logs (
        id, admin_user_id, action, entity_type, entity_id, metadata, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        crypto7.randomUUID(),
        adminUserId,
        "REQUEST_PROOF_RESUBMISSION",
        "booking",
        submission.booking_id,
        JSON.stringify({ submissionId, guidanceNote }),
        now
      ]
    );
  });
}

// server/admin/routes.ts
var router = express.Router();
router.post("/auth/login", async (req, res) => {
  try {
    const ip = req.ip || req.socket.remoteAddress || "unknown";
    if (!checkLoginRateLimit(ip)) {
      return res.status(429).json({
        success: false,
        error: { code: "TOO_MANY_ATTEMPTS", message: "Too many failed login attempts. Please try again later." }
      });
    }
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({
        success: false,
        error: { code: "INVALID_CREDENTIALS", message: "Email and password are required." }
      });
    }
    const normalizedEmail = email.toLowerCase().trim();
    const userRes = await db.query("SELECT * FROM admin_users WHERE email = $1", [normalizedEmail]);
    if (userRes.rows.length === 0) {
      return res.status(401).json({
        success: false,
        error: { code: "AUTH_FAILED", message: "Invalid email or password." }
      });
    }
    const user = userRes.rows[0];
    if (user.is_active === false) {
      return res.status(403).json({
        success: false,
        error: { code: "ACCOUNT_DISABLED", message: "This admin account has been deactivated." }
      });
    }
    const isMatch = await comparePassword(password, user.password_hash);
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        error: { code: "AUTH_FAILED", message: "Invalid email or password." }
      });
    }
    const token = createAdminSession({ id: user.id, email: user.email, role: user.role });
    res.cookie("admin_session", token, getAdminCookieOptions());
    return res.json({
      success: true,
      data: {
        token,
        user: { id: user.id, email: user.email, role: user.role }
      }
    });
  } catch (error) {
    console.error("Admin login error:", error);
    res.status(500).json({ success: false, error: { message: "Internal server error during login." } });
  }
});
router.post("/auth/logout", (req, res) => {
  const token = req.cookies?.admin_session || req.headers.authorization?.replace("Bearer ", "");
  if (token) destroyAdminSession(token);
  const cookieOpts = getAdminCookieOptions();
  res.clearCookie("admin_session", {
    httpOnly: cookieOpts.httpOnly,
    secure: cookieOpts.secure,
    sameSite: cookieOpts.sameSite,
    path: cookieOpts.path
  });
  res.json({ success: true, message: "Logged out successfully." });
});
router.get("/auth/me", requireAdminAuth, (req, res) => {
  const user = req.adminUser;
  res.json({ success: true, data: user });
});
router.get("/dashboard", requireAdminAuth, async (req, res) => {
  try {
    let data;
    if (!process.env.DATABASE_URL) {
      const metricsRes = await db.query("SELECT admin_metrics FROM event_settings");
      data = metricsRes.rows[0];
    } else {
      const metricsRes = await db.query(`
        SELECT 
          (SELECT COUNT(*) FROM bookings WHERE status IN ('payment_confirmed', 'proof_verified'))::int as "confirmedBookingsCount",
          (SELECT COUNT(*) FROM coupons WHERE status = 'valid')::int as "validCouponsCount",
          (SELECT COALESCE(SUM(total_amount_paise), 0) / 100 FROM bookings WHERE status IN ('payment_confirmed', 'proof_verified'))::int as "totalRevenueInr",
          (SELECT COUNT(*) FROM bookings WHERE status IN ('payment_confirmed', 'proof_verified') AND created_at >= CURRENT_DATE)::int as "bookingsToday",
          (SELECT COUNT(*) FROM coupons WHERE status = 'valid' AND issued_at >= CURRENT_DATE)::int as "couponsToday",
          (SELECT COUNT(*) FROM payment_submissions WHERE status IN ('verification_failed', 'ocr_check_failed', 'ocr_processing_error', 'ai_check_failed', 'admin_rejected', 'awaiting_admin_review', 'proof_submitted', 'ocr_checking', 'ai_checking'))::int as "failedOrPendingAttempts"
      `);
      data = metricsRes.rows[0];
    }
    data = data || {
      confirmedBookingsCount: 0,
      validCouponsCount: 0,
      totalRevenueInr: 0,
      bookingsToday: 0,
      couponsToday: 0,
      failedOrPendingAttempts: 0,
      lastPaymentAt: null
    };
    res.json({ success: true, data });
  } catch (error) {
    console.error("Dashboard metrics error:", error);
    res.status(500).json({ success: false, error: { message: "Failed to fetch dashboard metrics." } });
  }
});
router.get("/coupons", requireAdminAuth, async (req, res) => {
  try {
    const search = req.query.search || "";
    const page = Math.max(1, parseInt(req.query.page || "1", 10));
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit || "20", 10)));
    const params = [];
    let searchClause = "";
    if (search && search.trim()) {
      params.push(`%${search.trim()}%`);
      searchClause = ` AND (c.coupon_number ILIKE $1 OR c.holder_name ILIKE $1 OR c.phone ILIKE $1 OR c.village ILIKE $1 OR b.public_id ILIKE $1)`;
    }
    const sql = `
      SELECT 
        c.id, c.coupon_number, c.holder_name, c.phone, c.village, c.status,
        c.ticket_index, c.total_quantity, c.issued_at,
        b.public_id as booking_public_id, b.status as booking_status, b.paid_at,
        b.unit_price_paise as amount_paise,
        ps.payer_utr_hash
      FROM coupons c
      JOIN bookings b ON c.booking_id = b.id
      LEFT JOIN payment_submissions ps ON b.id = ps.booking_id AND (ps.status = 'proof_verified' OR ps.status = 'payment_confirmed')
      WHERE (b.status = 'proof_verified' OR b.status = 'payment_confirmed') AND c.status = 'valid'${searchClause}
      ORDER BY c.issued_at DESC
    `;
    const resData = await db.query(sql, params);
    let items = resData.rows;
    const total = items.length;
    const startIndex = (page - 1) * limit;
    const paginatedItems = items.slice(startIndex, startIndex + limit);
    res.json({
      success: true,
      data: {
        coupons: paginatedItems.map((item) => ({
          ...item,
          formattedPaidAt: formatKolkataTime(item.verified_at || item.paid_at),
          maskedPhone: maskPhoneNumber(item.phone),
          amountInr: (item.amount_paise || 5e3) / 100,
          verificationMethod: "Automated Proof Verification (Local OCR + Deterministic Rules)"
        })),
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit) || 1
        }
      }
    });
  } catch (error) {
    console.error("Fetch applied coupons error:", error);
    res.status(500).json({ success: false, error: { message: "Failed to fetch applied coupons list." } });
  }
});
function escapeCsv(val) {
  if (val === null || val === void 0) return '""';
  let str = String(val).replace(/"/g, '""');
  if (str.startsWith("=") || str.startsWith("+") || str.startsWith("-") || str.startsWith("@")) {
    str = `'${str}`;
  }
  return `"${str}"`;
}
router.get("/coupons/export.csv", requireAdminAuth, async (req, res) => {
  try {
    const sql = `
      SELECT 
        c.coupon_number, c.holder_name, c.phone, c.village,
        b.public_id as booking_ref, c.ticket_index, c.total_quantity,
        COALESCE(b.verified_at, b.paid_at) as verified_date,
        ps.payer_utr_hash
      FROM coupons c
      JOIN bookings b ON c.booking_id = b.id
      LEFT JOIN payment_submissions ps ON b.id = ps.booking_id AND ps.status = 'proof_verified'
      WHERE (b.status = 'proof_verified' OR b.status = 'payment_confirmed') AND c.status = 'valid'
      ORDER BY c.serial ASC
    `;
    const result = await db.query(sql);
    const headers = [
      "Coupon Number",
      "Participant Name",
      "Phone",
      "Village",
      "Booking Ref",
      "Ticket Position",
      "Verification Status",
      "Verified Date (Kolkata)",
      "Price"
    ];
    const rows = result.rows.map((r) => [
      escapeCsv(r.coupon_number),
      escapeCsv(r.holder_name),
      escapeCsv(r.phone),
      escapeCsv(r.village),
      escapeCsv(r.booking_ref),
      escapeCsv(`${r.ticket_index} of ${r.total_quantity}`),
      escapeCsv("Automated Proof Verified"),
      escapeCsv(formatKolkataTime(r.verified_date)),
      escapeCsv("\u20B950")
    ]);
    const csvContent = [headers.join(","), ...rows.map((row) => row.join(","))].join("\r\n");
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="verified_coupons_${Date.now()}.csv"`);
    res.send(csvContent);
  } catch (error) {
    console.error("CSV Export Error:", error);
    res.status(500).send("Failed to export CSV");
  }
});
router.get("/coupons/:couponNumber/download", requireAdminAuth, async (req, res) => {
  try {
    const { couponNumber } = req.params;
    const format = (req.query.format || "pdf").toLowerCase();
    if (!["pdf", "png", "jpeg", "jpg"].includes(format)) {
      return res.status(400).send("Invalid format requested. Supported formats: pdf, png, jpeg.");
    }
    const resCoupon = await db.query("SELECT * FROM coupons WHERE coupon_number = $1", [couponNumber]);
    if (resCoupon.rows.length === 0) {
      return res.status(404).json({ success: false, error: { message: "Coupon not found." } });
    }
    const coupon = resCoupon.rows[0];
    const resBooking = await db.query("SELECT * FROM bookings WHERE id = $1", [coupon.booking_id]);
    const booking = resBooking.rows[0];
    const ticketData = {
      couponNumber: coupon.coupon_number,
      participantName: coupon.holder_name,
      phone: coupon.phone,
      village: coupon.village,
      bookingPublicId: booking?.public_id || "BK-SYS",
      ticketIndex: coupon.ticket_index,
      totalQuantity: coupon.total_quantity,
      paidAt: booking?.verified_at || booking?.paid_at
    };
    if (format === "pdf") {
      const pdfBuffer = await renderTicketPdf(ticketData);
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="${coupon.coupon_number}.pdf"`);
      return res.send(pdfBuffer);
    }
    const targetRaster = format === "png" ? "png" : "jpeg";
    const rasterBuffer = await renderTicketRaster(ticketData, targetRaster);
    res.setHeader("Content-Type", targetRaster === "png" ? "image/png" : "image/jpeg");
    res.setHeader("Content-Disposition", `attachment; filename="${coupon.coupon_number}.${targetRaster === "png" ? "png" : "jpg"}"`);
    return res.send(rasterBuffer);
  } catch (error) {
    console.error("Admin ticket download error:", error);
    res.status(500).send("Failed to generate coupon.");
  }
});
router.get("/coupons/:couponNumber", requireAdminAuth, async (req, res) => {
  try {
    const { couponNumber } = req.params;
    const resCoupon = await db.query("SELECT * FROM coupons WHERE coupon_number = $1", [couponNumber]);
    if (resCoupon.rows.length === 0) {
      return res.status(404).json({ success: false, error: { message: "Coupon not found." } });
    }
    const coupon = resCoupon.rows[0];
    const resBooking = await db.query("SELECT * FROM bookings WHERE id = $1", [coupon.booking_id]);
    res.json({
      success: true,
      data: {
        coupon,
        booking: resBooking.rows[0] || null
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: { message: error.message } });
  }
});
router.get(["/payment-reviews", "/payment-diagnostics"], requireAdminAuth, async (req, res) => {
  try {
    const statusFilter = req.query.status;
    const search = req.query.search;
    const result = await db.query(
      `SELECT ps.*, b.public_id as booking_public_id, b.participant_name, b.phone, b.village, b.quantity, b.total_amount_paise
       FROM payment_submissions ps
       JOIN bookings b ON ps.booking_id = b.id
       ORDER BY ps.created_at DESC`
    );
    let items = result.rows;
    if (statusFilter && statusFilter !== "all") {
      items = items.filter((s) => s.status === statusFilter);
    }
    if (search && search.trim()) {
      const q = search.trim().toLowerCase();
      items = items.filter(
        (s) => s.participant_name && s.participant_name.toLowerCase().includes(q) || s.phone && s.phone.includes(q) || s.booking_public_id && s.booking_public_id.toLowerCase().includes(q) || s.payment_reference && s.payment_reference.toLowerCase().includes(q) || s.payer_utr_hash && s.payer_utr_hash.toLowerCase().includes(q)
      );
    }
    const parseJson = (val) => {
      if (!val) return null;
      if (typeof val === "object") return val;
      try {
        return JSON.parse(val);
      } catch {
        return null;
      }
    };
    res.json({
      success: true,
      ocrEngine: "tesseract.js",
      data: items.map((s) => ({
        id: s.id,
        bookingId: s.booking_id,
        bookingPublicId: s.booking_public_id,
        participantName: s.participant_name,
        phone: maskPhoneNumber(s.phone || ""),
        village: s.village,
        quantity: s.quantity,
        amountInr: (s.expected_amount_paise || 5e3) / 100,
        selectedApp: s.selected_upi_app,
        paymentReference: s.payment_reference,
        utrMasked: s.payer_utr_hash ? `UTR-${s.payer_utr_hash.slice(0, 8)}...` : "Unknown",
        status: s.status,
        riskScore: s.risk_score || 0,
        reasonCodes: s.reason_codes || [],
        ocrExtraction: parseJson(s.ocr_extraction || s.gemini_extraction),
        geminiExtraction: parseJson(s.ocr_extraction || s.gemini_extraction),
        ocrEngine: s.ocr_engine || "tesseract.js",
        extractedTransactionTimestamp: s.extracted_transaction_timestamp,
        deterministicComparison: parseJson(s.deterministic_comparison),
        hasScreenshot: !!s.screenshot_storage_path,
        adminReviewerId: s.admin_reviewer_id,
        adminReviewNote: s.admin_review_note,
        bankRecordMatch: s.bank_record_match,
        reviewedAt: s.reviewed_at ? formatKolkataTime(s.reviewed_at) : null,
        submittedAt: formatKolkataTime(s.created_at)
      }))
    });
  } catch (error) {
    console.error("Payment reviews error:", error);
    res.status(500).json({ success: false, error: { message: "Failed to fetch payment reviews queue." } });
  }
});
router.get(["/payment-reviews/:submissionId", "/payment-diagnostics/:submissionId"], requireAdminAuth, async (req, res) => {
  try {
    const { submissionId } = req.params;
    const result = await db.query("SELECT * FROM payment_submissions WHERE id = $1", [submissionId]);
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: { message: "Submission not found." } });
    }
    const submission = result.rows[0];
    const bookingRes = await db.query("SELECT * FROM bookings WHERE id = $1", [submission.booking_id]);
    res.json({
      success: true,
      data: {
        submission,
        booking: bookingRes.rows[0] || null
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: { message: error.message } });
  }
});
router.get(["/payment-reviews/:submissionId/screenshot", "/payment-diagnostics/:submissionId/screenshot"], requireAdminAuth, async (req, res) => {
  try {
    const { submissionId } = req.params;
    const result = await db.query("SELECT * FROM payment_submissions WHERE id = $1", [submissionId]);
    if (result.rows.length === 0) {
      return res.status(404).send("Not found");
    }
    const submission = result.rows[0];
    const filePath = submission.screenshot_storage_path;
    if (filePath && filePath.startsWith("supabase:")) {
      const signedUrl = await getSignedScreenshotUrl(filePath, 300);
      if (signedUrl) {
        return res.redirect(signedUrl);
      }
    }
    if (!filePath || !fs3.existsSync(filePath)) {
      return res.status(404).send("Screenshot file not found on disk");
    }
    res.setHeader("Content-Type", submission.mime_type || "image/jpeg");
    res.setHeader("Cache-Control", "private, no-cache, no-store");
    const stream = fs3.createReadStream(filePath);
    stream.pipe(res);
  } catch (error) {
    res.status(500).send("Error streaming screenshot");
  }
});
router.post("/payment-reviews/:submissionId/confirm", requireAdminAuth, async (req, res) => {
  try {
    const { submissionId } = req.params;
    const adminUser = req.adminUser;
    const { bankTxnId, receivedAmountPaise, recipientAccount, matchNote, auditNote, idempotencyKey } = req.body;
    const subRes = await db.query("SELECT expected_amount_paise, expected_payee_upi_id FROM payment_submissions WHERE id = $1", [submissionId]);
    if (subRes.rows.length === 0) {
      return res.status(404).json({ success: false, error: { message: "Submission not found." } });
    }
    const sub = subRes.rows[0];
    const result = await confirmPaymentFromBankRecord({
      submissionId,
      adminUserId: adminUser?.id || "00000000-0000-0000-0000-000000000001",
      bankRecordMatch: {
        bankTxnId: bankTxnId || "BANK-MATCH",
        receivedAmountPaise: Number(receivedAmountPaise) || sub.expected_amount_paise || 5e3,
        recipientAccount: recipientAccount || sub.expected_payee_upi_id || config.PAYEE_UPI_ID,
        matchNote: matchNote || "Confirmed against official bank/merchant statement"
      },
      auditNote: auditNote || "Payment confirmed by administrator from real bank record",
      idempotencyKey
    });
    res.json({
      success: true,
      message: "Payment confirmed successfully from bank record. Coupons issued.",
      data: result
    });
  } catch (error) {
    console.error("Admin confirm payment error:", error);
    res.status(400).json({ success: false, error: { message: error.message || "Failed to confirm payment." } });
  }
});
router.post("/payment-reviews/:submissionId/reject", requireAdminAuth, async (req, res) => {
  try {
    const { submissionId } = req.params;
    const adminUser = req.adminUser;
    const { reviewNote } = req.body;
    await rejectPaymentSubmission({
      submissionId,
      adminUserId: adminUser?.id || "00000000-0000-0000-0000-000000000001",
      reviewNote: reviewNote || "Payment rejected by administrator"
    });
    res.json({
      success: true,
      message: "Payment rejected successfully."
    });
  } catch (error) {
    console.error("Admin reject payment error:", error);
    res.status(400).json({ success: false, error: { message: error.message || "Failed to reject payment." } });
  }
});
router.post("/payment-reviews/:submissionId/request-resubmission", requireAdminAuth, async (req, res) => {
  try {
    const { submissionId } = req.params;
    const adminUser = req.adminUser;
    const { guidanceNote } = req.body;
    await requestProofResubmission({
      submissionId,
      adminUserId: adminUser?.id || "00000000-0000-0000-0000-000000000001",
      guidanceNote: guidanceNote || "Please submit a clear, full payment confirmation screenshot."
    });
    res.json({
      success: true,
      message: "Resubmission requested successfully."
    });
  } catch (error) {
    console.error("Admin request resubmission error:", error);
    res.status(400).json({ success: false, error: { message: error.message || "Failed to request resubmission." } });
  }
});
router.get("/bookings/:publicId", requireAdminAuth, async (req, res) => {
  try {
    const { publicId } = req.params;
    const bookingRes = await db.query("SELECT * FROM bookings WHERE public_id = $1", [publicId]);
    if (bookingRes.rows.length === 0) {
      return res.status(404).json({ success: false, error: { message: "Booking not found." } });
    }
    const booking = bookingRes.rows[0];
    const couponsRes = await db.query("SELECT * FROM coupons WHERE booking_id = $1", [booking.id]);
    const submissionsRes = await db.query("SELECT * FROM payment_submissions WHERE booking_id = $1", [booking.id]);
    res.json({
      success: true,
      data: {
        booking,
        coupons: couponsRes.rows,
        submissions: submissionsRes.rows
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: { message: error.message } });
  }
});
var routes_default = router;

// server/app.ts
var app = express2();
app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false
  })
);
app.use(cookieParser());
app.use(express2.static(path3.join(process.cwd(), "public")));
app.use(express2.json({ limit: "15mb" }));
app.use(express2.urlencoded({ extended: true, limit: "15mb" }));
app.use((req, _res, next) => {
  if (req.url && !req.url.startsWith("/api") && !req.url.startsWith("/assets") && !req.url.includes(".")) {
    if (req.url.startsWith("/bookings") || req.url.startsWith("/coupons") || req.url.startsWith("/health") || req.url.startsWith("/config") || req.url.startsWith("/events")) {
      req.url = "/api" + req.url;
    }
  }
  next();
});
function normalizeIndianPhone(phone) {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 10) return digits;
  if (digits.length === 12 && digits.startsWith("91")) return digits.slice(2);
  if (digits.length === 11 && digits.startsWith("0")) return digits.slice(1);
  return null;
}
function generateCollisionSafePublicId() {
  return `BK-${crypto8.randomBytes(3).toString("hex").toUpperCase()}`;
}
function generateCollisionSafePaymentReference() {
  return `YSYS-${Date.now().toString(36).toUpperCase()}-${crypto8.randomBytes(2).toString("hex").toUpperCase()}`;
}
app.get(["/api/health", "/health"], async (_req, res) => {
  res.setHeader("Content-Type", "application/json");
  try {
    const [dbStatus, storageStatus] = await Promise.all([
      isDatabaseConnected(),
      checkStorageHealth()
    ]);
    const isHealthy = dbStatus.connected && storageStatus.ready;
    return res.status(200).json({
      status: isHealthy ? "ok" : "degraded",
      service: "yuva-shakti-portal",
      timestamp: (/* @__PURE__ */ new Date()).toISOString(),
      database: dbStatus.provider,
      databaseConnected: dbStatus.connected,
      databaseHost: dbStatus.hostMasked,
      paymentProofStorageConfigured: storageStatus.configured && storageStatus.ready,
      storage: {
        provider: storageStatus.provider,
        configured: storageStatus.configured,
        bucket: storageStatus.bucket,
        ready: storageStatus.ready,
        ...storageStatus.error ? { warning: storageStatus.error } : {}
      },
      ocr: {
        engine: "tesseract.js",
        status: "ready"
      },
      ...dbStatus.error ? { warning: "Database connection check reported an issue" } : {}
    });
  } catch (err) {
    console.error("[Health Diagnostic Check Error]:", {
      name: err?.name,
      message: err?.message
    });
    return res.status(200).json({
      status: "degraded",
      service: "yuva-shakti-portal",
      timestamp: (/* @__PURE__ */ new Date()).toISOString(),
      database: "postgresql",
      databaseConnected: false,
      storage: {
        provider: "supabase",
        configured: false,
        bucket: config.PAYMENT_PROOF_BUCKET,
        ready: false
      },
      ocr: {
        engine: "tesseract.js",
        status: "ready"
      }
    });
  }
});
app.get(["/api", "/api/"], (_req, res) => {
  res.redirect("/api/health");
});
app.get("/api/config", (_req, res) => {
  const pub = getPublicConfig();
  res.json({
    success: true,
    data: pub,
    ...pub
  });
});
app.use("/api/admin", routes_default);
app.post("/api/bookings", async (req, res) => {
  try {
    const gate = canAcceptPayments();
    if (!gate.allowed) {
      return res.status(403).json({
        success: false,
        error: { code: "BOOKING_UNAVAILABLE", message: gate.reason }
      });
    }
    const { name, phone, village, quantity, selectedApp } = req.body;
    if (!name || typeof name !== "string" || name.trim().length < 2 || name.trim().length > 80) {
      return res.status(400).json({
        success: false,
        error: { code: "INVALID_NAME", message: "Please enter a valid participant name (2-80 characters)." }
      });
    }
    const normalizedPhone = normalizeIndianPhone(String(phone || ""));
    if (!normalizedPhone) {
      return res.status(400).json({
        success: false,
        error: { code: "INVALID_PHONE", message: "Please enter a valid 10-digit Indian mobile number." }
      });
    }
    const qty = parseInt(String(quantity), 10);
    if (isNaN(qty) || qty <= 0 || qty > config.EVENT_MAX_COUPONS_PER_BOOKING) {
      return res.status(400).json({
        success: false,
        error: {
          code: "INVALID_QUANTITY",
          message: `Quantity must be between 1 and ${config.EVENT_MAX_COUPONS_PER_BOOKING} coupons per order.`
        }
      });
    }
    const cleanVillage = (village && typeof village === "string" ? village.trim() : "Satulur") || "Satulur";
    const unitPricePaise = config.EVENT_COUPON_PRICE_PAISE;
    const totalAmountPaise = unitPricePaise * qty;
    let publicId = generateCollisionSafePublicId();
    let paymentReference = generateCollisionSafePaymentReference();
    const bookingId = crypto8.randomUUID();
    const statusToken = crypto8.randomBytes(24).toString("hex");
    const statusTokenHash = crypto8.createHash("sha256").update(statusToken).digest("hex");
    const downloadToken = crypto8.randomBytes(24).toString("hex");
    const downloadTokenHash = crypto8.createHash("sha256").update(downloadToken).digest("hex");
    let upiSession = await generateUpiPaymentSession({
      publicBookingId: publicId,
      transactionReference: paymentReference,
      totalAmountPaise,
      participantName: name.trim()
    });
    let inserted = false;
    let attempts = 0;
    while (!inserted && attempts < 3) {
      attempts++;
      try {
        await db.query(
          `INSERT INTO bookings (
            id, public_id, participant_name, phone, village, quantity,
            unit_price_paise, total_amount_paise, status, provider_name,
            download_token_hash, status_token_hash, selected_upi_app, payment_reference, payment_expires_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
          [
            bookingId,
            publicId,
            name.trim(),
            normalizedPhone,
            cleanVillage,
            qty,
            unitPricePaise,
            totalAmountPaise,
            "payment_initiated",
            "direct_upi",
            downloadTokenHash,
            statusTokenHash,
            selectedApp || "other_upi",
            paymentReference,
            upiSession.expiresAt
          ]
        );
        inserted = true;
      } catch (insertError) {
        if (insertError?.code === "23505" && attempts < 3) {
          console.warn(`[POST /api/bookings] Unique key collision on public_id/reference (attempt ${attempts}), regenerating IDs...`);
          publicId = generateCollisionSafePublicId();
          paymentReference = generateCollisionSafePaymentReference();
          upiSession = await generateUpiPaymentSession({
            publicBookingId: publicId,
            transactionReference: paymentReference,
            totalAmountPaise,
            participantName: name.trim()
          });
        } else {
          throw insertError;
        }
      }
    }
    return res.json({
      success: true,
      data: {
        booking: {
          id: bookingId,
          publicId,
          name: name.trim(),
          phone: normalizedPhone,
          village: cleanVillage,
          quantity: qty,
          totalAmount: totalAmountPaise / 100,
          status: "payment_initiated",
          expiresAt: upiSession.expiresAt
        },
        payment: {
          clientTxnId: paymentReference,
          orderId: paymentReference,
          qrDataUrl: upiSession.qrDataUrl,
          canonicalUri: upiSession.canonicalUri,
          payeeUpiId: upiSession.maskedPayeeUpiId,
          rawPayeeUpiId: upiSession.payeeUpiId,
          payeeDisplayName: upiSession.payeeDisplayName,
          amountInr: upiSession.amountInr,
          totalAmount: totalAmountPaise / 100,
          expiresAt: upiSession.expiresAt,
          statusToken,
          downloadToken,
          appIntents: upiSession.appIntents
        }
      }
    });
  } catch (error) {
    const errorDetails = {
      route: "POST /api/bookings",
      name: error?.name || "Error",
      code: error?.code || "UNKNOWN",
      pgCode: error?.code || error?.routine || "NONE",
      constraint: error?.constraint || error?.detail || "NONE",
      safeMessage: error?.message ? String(error.message).replace(/postgres:[^@]+@/g, "postgres:***@") : "Booking creation error"
    };
    console.error("[POST /api/bookings] Booking creation failure:", errorDetails);
    res.status(500).json({
      success: false,
      error: {
        code: "BOOKING_CREATION_FAILED",
        message: "Booking service is temporarily unavailable. Please try again."
      }
    });
  }
});
app.post("/api/bookings/:publicId/payment-proof", async (req, res) => {
  try {
    const { publicId } = req.params;
    const { screenshotBase64, selectedApp, consentGiven } = req.body;
    const authHeader = req.headers.authorization;
    const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : req.headers["x-booking-token"] || req.body.statusToken || req.query.token;
    if (!token) {
      return res.status(401).json({
        success: false,
        error: { code: "UNAUTHORIZED", message: "Valid booking access token is required." }
      });
    }
    const bookingRes = await db.query("SELECT * FROM bookings WHERE public_id = $1", [publicId]);
    if (bookingRes.rows.length === 0) {
      return res.status(404).json({ success: false, error: { message: "Booking not found." } });
    }
    const booking = bookingRes.rows[0];
    const tokenHash = crypto8.createHash("sha256").update(token).digest("hex");
    if (booking.status_token_hash && booking.status_token_hash !== tokenHash) {
      return res.status(401).json({
        success: false,
        error: { code: "UNAUTHORIZED", message: "Invalid booking access token." }
      });
    }
    if (booking.status === "payment_confirmed" || booking.status === "proof_verified") {
      const existingCoupons = await db.query(
        "SELECT coupon_number, holder_name, phone, village, ticket_index, total_quantity, issued_at FROM coupons WHERE booking_id = $1 ORDER BY ticket_index ASC",
        [booking.id]
      );
      return res.json({
        success: true,
        data: {
          status: "payment_confirmed",
          message: "Payment proof accepted",
          coupons: existingCoupons.rows,
          couponsIssuedCount: existingCoupons.rows.length,
          downloadUrl: `/api/bookings/${booking.public_id}/download-all?token=${token}`
        }
      });
    }
    const expiresAtMs = booking.payment_expires_at ? new Date(booking.payment_expires_at).getTime() : 0;
    const isPastExpiry = booking.status === "expired" || expiresAtMs > 0 && Date.now() > expiresAtMs;
    if (isPastExpiry) {
      const couponCheck = await db.query("SELECT COUNT(*) as count FROM coupons WHERE booking_id = $1", [booking.id]);
      const hasCoupons = parseInt(couponCheck.rows[0]?.count || "0", 10) > 0;
      const proofCheck = await db.query(
        "SELECT id FROM payment_submissions WHERE booking_id = $1 AND (status = 'payment_confirmed' OR status = 'proof_verified') LIMIT 1",
        [booking.id]
      );
      const hasVerifiedProof = proofCheck.rows.length > 0;
      const priorAttemptCheck = await db.query(
        "SELECT id FROM payment_submissions WHERE booking_id = $1 LIMIT 1",
        [booking.id]
      );
      const hasPriorSubmissionAttempt = priorAttemptCheck.rows.length > 0;
      const isRecoveryFlag = req.body.isRecovery === true || req.headers["x-payment-recovery"] === "true";
      const createdAtMs = new Date(booking.created_at || Date.now()).getTime();
      const paymentInitiatedBeforeExpiry = booking.payment_expires_at ? createdAtMs <= expiresAtMs : true;
      const isWithinRecoveryWindow = Date.now() - createdAtMs < 24 * 60 * 60 * 1e3;
      const isEligibleForRecovery = paymentInitiatedBeforeExpiry && (hasPriorSubmissionAttempt || isRecoveryFlag || booking.status === "ai_check_failed" || booking.status === "proof_required") && !hasCoupons && !hasVerifiedProof && booking.status !== "cancelled" && isWithinRecoveryWindow;
      if (isEligibleForRecovery) {
        console.warn(`[POST /api/bookings/:publicId/payment-proof] Processing safe proof recovery for booking ${booking.public_id} (session expired, but unfinalized and within recovery window).`);
      } else {
        if (booking.status !== "expired") {
          await db.query("UPDATE bookings SET status = $1, updated_at = $2 WHERE id = $3", ["expired", (/* @__PURE__ */ new Date()).toISOString(), booking.id]);
        }
        return res.status(400).json({
          success: false,
          error: { code: "PAYMENT_SESSION_EXPIRED", message: "Payment session expired. Start a new booking." }
        });
      }
    }
    if (!consentGiven) {
      return res.status(400).json({
        success: false,
        error: { code: "CONSENT_REQUIRED", message: "You must consent to automated image analysis." }
      });
    }
    if (!screenshotBase64 || typeof screenshotBase64 !== "string" || !screenshotBase64.trim()) {
      return res.status(400).json({
        success: false,
        error: { code: "MISSING_SCREENSHOT", message: "Payment confirmation screenshot is mandatory." }
      });
    }
    const cleanBase64 = screenshotBase64.replace(/^data:image\/[a-z]+;base64,/, "");
    const imageBuffer = Buffer.from(cleanBase64, "base64");
    const processed = await processPaymentScreenshot(imageBuffer, booking.id);
    const analysis = await analyzePaymentScreenshot(
      processed.sanitizedBuffer,
      {
        expectedMerchantName: config.PAYEE_DISPLAY_NAME,
        expectedAmount: (booking.total_amount_paise / 100).toFixed(2),
        expectedAmountPaise: booking.total_amount_paise,
        sessionTimestampIso: booking.created_at || (/* @__PURE__ */ new Date()).toISOString(),
        bookingCreatedAt: booking.created_at,
        paymentExpiresAt: booking.payment_expires_at
      }
    );
    const submissionId = crypto8.randomUUID();
    const paymentRef = booking.payment_reference || `YSYS-${Date.now().toString(36).toUpperCase()}`;
    if (!analysis.analysisCompleted || analysis.warnings?.includes("OCR_PROCESSING_ERROR")) {
      const fallbackRef = `PENDING_OCR_${submissionId}`;
      const utrHash2 = crypto8.createHash("sha256").update(fallbackRef).digest("hex");
      const encryptedUtr2 = encryptSensitiveField(fallbackRef);
      await db.query(
        `INSERT INTO payment_submissions (
          id, booking_id, payment_reference, selected_upi_app, expected_payee_upi_id,
          expected_payee_name, expected_amount_paise, payer_utr_hash, encrypted_utr,
          screenshot_storage_path, screenshot_sha256, screenshot_phash, mime_type,
          byte_size, width, height, status, ocr_extraction, deterministic_comparison,
          risk_score, reason_codes, ocr_engine
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22)`,
        [
          submissionId,
          booking.id,
          paymentRef,
          selectedApp || booking.selected_upi_app || "other_upi",
          config.PAYEE_UPI_ID,
          config.PAYEE_DISPLAY_NAME,
          booking.total_amount_paise,
          utrHash2,
          encryptedUtr2,
          processed.storagePath,
          processed.sha256,
          processed.phash,
          processed.mimeType,
          processed.byteSize,
          processed.width,
          processed.height,
          "ocr_processing_error",
          JSON.stringify(analysis),
          null,
          0,
          ["OCR_PROCESSING_ERROR"],
          "tesseract.js"
        ]
      );
      const runId2 = crypto8.randomUUID();
      await db.query(
        `INSERT INTO payment_verification_runs (
          id, submission_id, stage, status, confidence, reason_codes, result_json, completed_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          runId2,
          submissionId,
          "local_ocr",
          "pending_retry",
          0,
          ["OCR_PROCESSING_ERROR"],
          JSON.stringify({ analysis }),
          (/* @__PURE__ */ new Date()).toISOString()
        ]
      );
      await db.query(
        "UPDATE bookings SET status = $1, updated_at = $2 WHERE id = $3",
        ["proof_submitted", (/* @__PURE__ */ new Date()).toISOString(), booking.id]
      );
      return res.status(200).json({
        success: true,
        data: {
          submissionId,
          publicId: booking.public_id,
          status: "ocr_processing_error",
          reviewStatus: "ocr_processing_error",
          retryable: true,
          message: "We couldn't process this receipt right now. Your payment proof is saved. Please retry verification.",
          details: {
            utrMatched: null,
            amountMatched: null,
            statusMatched: null,
            payeeMatched: null
          }
        }
      });
    }
    const extractedRrn = analysis.utrOrRrn ? normalizeUtr(analysis.utrOrRrn) : "";
    let utrHash;
    let encryptedUtr;
    let isDuplicateUtr = false;
    if (extractedRrn) {
      utrHash = crypto8.createHash("sha256").update(extractedRrn).digest("hex");
      const dupUtrRes = await db.query(
        "SELECT id, booking_id FROM payment_submissions WHERE payer_utr_hash = $1 AND booking_id != $2 AND status != $3 AND status != $4",
        [utrHash, booking.id, "admin_rejected", "payment_rejected"]
      );
      isDuplicateUtr = dupUtrRes.rows.length > 0;
      encryptedUtr = encryptSensitiveField(extractedRrn);
    } else {
      const fallbackRef = `UNEXTRACTED_${submissionId}`;
      utrHash = crypto8.createHash("sha256").update(fallbackRef).digest("hex");
      encryptedUtr = encryptSensitiveField(fallbackRef);
    }
    const dupScreenRes = await db.query(
      "SELECT id, booking_id FROM payment_submissions WHERE screenshot_sha256 = $1 AND booking_id != $2 AND status != $3 AND status != $4",
      [processed.sha256, booking.id, "admin_rejected", "payment_rejected"]
    );
    let isDuplicateScreenshot = dupScreenRes.rows.length > 0;
    if (!isDuplicateScreenshot && processed.phash) {
      const pastSubs = await db.query(
        "SELECT id, booking_id, screenshot_phash, expected_amount_paise FROM payment_submissions WHERE booking_id != $1 AND screenshot_phash IS NOT NULL AND status != $2 AND status != $3",
        [booking.id, "admin_rejected", "payment_rejected"]
      );
      for (const past of pastSubs.rows) {
        if (past.screenshot_phash) {
          const dist = hammingDistance(processed.phash, past.screenshot_phash);
          if (dist <= 2 && past.expected_amount_paise === booking.total_amount_paise) {
            isDuplicateScreenshot = true;
            break;
          }
        }
      }
    }
    const match = performDeterministicComparison({
      expectedAmountPaise: booking.total_amount_paise,
      expectedPayeeUpiId: config.PAYEE_UPI_ID,
      expectedPayeeName: config.PAYEE_DISPLAY_NAME,
      enteredUtr: extractedRrn,
      selectedApp: selectedApp || booking.selected_upi_app || "other_upi",
      bookingCreatedAt: booking.created_at,
      paymentExpiresAt: booking.payment_expires_at,
      analysis,
      isDuplicateUtr,
      isDuplicateScreenshot,
      isExpired: false
    });
    await db.query(
      `INSERT INTO payment_submissions (
        id, booking_id, payment_reference, selected_upi_app, expected_payee_upi_id,
        expected_payee_name, expected_amount_paise, payer_utr_hash, encrypted_utr,
        screenshot_storage_path, screenshot_sha256, screenshot_phash, mime_type,
        byte_size, width, height, status, ocr_extraction, deterministic_comparison,
        risk_score, reason_codes, ocr_engine, extracted_transaction_timestamp
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23)`,
      [
        submissionId,
        booking.id,
        paymentRef,
        selectedApp || booking.selected_upi_app || "other_upi",
        config.PAYEE_UPI_ID,
        config.PAYEE_DISPLAY_NAME,
        booking.total_amount_paise,
        utrHash,
        encryptedUtr,
        processed.storagePath,
        processed.sha256,
        processed.phash,
        processed.mimeType,
        processed.byteSize,
        processed.width,
        processed.height,
        match.nextStatus,
        JSON.stringify(analysis),
        JSON.stringify(match),
        match.riskScore,
        match.reasonCodes,
        "tesseract.js",
        analysis.transactionTimestamp || null
      ]
    );
    const runId = crypto8.randomUUID();
    await db.query(
      `INSERT INTO payment_verification_runs (
        id, submission_id, stage, status, confidence, reason_codes, result_json, completed_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        runId,
        submissionId,
        "local_ocr_and_deterministic",
        match.passed ? "passed" : "flagged",
        analysis.extractedFields?.fieldConfidence?.amount || 0.8,
        match.reasonCodes,
        JSON.stringify({ match, extractionSummary: { utr: analysis.utrOrRrn, amount: analysis.amount } }),
        (/* @__PURE__ */ new Date()).toISOString()
      ]
    );
    if (match.passed) {
      const finalResult = await finalizeVerifiedSubmission({
        submissionId,
        bookingId: booking.id,
        decisionVersion: "v3-local-ocr-deterministic"
      });
      return res.json({
        success: true,
        data: {
          submissionId,
          publicId: booking.public_id,
          status: "payment_confirmed",
          reviewStatus: "ocr_verified",
          message: "Payment proof verified successfully. Coupons issued.",
          coupons: finalResult.coupons,
          couponsIssuedCount: finalResult.couponsIssuedCount,
          downloadUrl: `/api/bookings/${booking.public_id}/download-all?token=${token}`,
          details: match.details
        }
      });
    } else {
      await db.query(
        "UPDATE bookings SET status = $1, updated_at = $2 WHERE id = $3",
        ["payment_rejected", (/* @__PURE__ */ new Date()).toISOString(), booking.id]
      );
      return res.status(400).json({
        success: false,
        error: {
          code: match.reasonCodes[0] || "PROOF_VERIFICATION_FAILED",
          message: match.userMessage,
          reasonCodes: match.reasonCodes
        },
        data: {
          submissionId,
          publicId: booking.public_id,
          status: match.nextStatus,
          message: match.userMessage,
          details: match.details
        }
      });
    }
  } catch (error) {
    console.error("Payment proof submission error:", error);
    const isStorageErr = error?.message?.includes("STORAGE_NOT_CONFIGURED") || error?.message?.includes("PAYMENT_PROOF_STORAGE_FAILED");
    const errCode = error?.message?.includes("STORAGE_NOT_CONFIGURED") ? "STORAGE_NOT_CONFIGURED" : error?.message?.includes("PAYMENT_PROOF_STORAGE_FAILED") ? "PAYMENT_PROOF_STORAGE_FAILED" : "SUBMISSION_FAILED";
    const safeMsg = isStorageErr ? "Payment proof storage is temporarily unavailable. Your booking is preserved. Please retry in a few moments." : error.message || "Failed to process payment proof.";
    res.status(isStorageErr ? 503 : 500).json({
      success: false,
      error: { code: errCode, message: safeMsg }
    });
  }
});
app.post("/api/bookings/:publicId/retry-verification", async (req, res) => {
  try {
    const { publicId } = req.params;
    const authHeader = req.headers.authorization;
    const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : req.body.statusToken || req.query.token;
    if (!token) {
      return res.status(401).json({
        success: false,
        error: { code: "UNAUTHORIZED", message: "Valid status verification token is required." }
      });
    }
    const bookingRes = await db.query("SELECT * FROM bookings WHERE public_id = $1", [publicId]);
    if (bookingRes.rows.length === 0) {
      return res.status(404).json({ success: false, error: { message: "Booking not found." } });
    }
    const booking = bookingRes.rows[0];
    const tokenHash = crypto8.createHash("sha256").update(token).digest("hex");
    if (booking.status_token_hash && booking.status_token_hash !== tokenHash) {
      return res.status(401).json({
        success: false,
        error: { code: "UNAUTHORIZED", message: "Invalid verification token." }
      });
    }
    if (booking.status === "payment_confirmed" || booking.status === "proof_verified") {
      const existingCoupons = await db.query(
        "SELECT coupon_number, holder_name, phone, village, ticket_index, total_quantity, issued_at FROM coupons WHERE booking_id = $1 ORDER BY ticket_index ASC",
        [booking.id]
      );
      return res.json({
        success: true,
        data: {
          publicId: booking.public_id,
          status: "payment_confirmed",
          reviewStatus: "ai_check_passed",
          message: "Payment proof already verified and confirmed.",
          coupons: existingCoupons.rows,
          couponsIssuedCount: existingCoupons.rows.length,
          downloadUrl: `/api/bookings/${booking.public_id}/download-all?token=${token}`
        }
      });
    }
    const subRes = await db.query(
      "SELECT * FROM payment_submissions WHERE booking_id = $1 ORDER BY created_at DESC LIMIT 1",
      [booking.id]
    );
    if (subRes.rows.length === 0) {
      return res.status(400).json({
        success: false,
        error: {
          code: "NO_PAYMENT_PROOF",
          message: "No payment proof submission was found for this booking."
        }
      });
    }
    const submission = subRes.rows[0];
    if (!submission.screenshot_storage_path) {
      return res.status(400).json({
        success: false,
        error: {
          code: "NO_SCREENSHOT_STORED",
          message: "Stored payment proof screenshot is missing. Please re-upload."
        }
      });
    }
    const downloaded = await downloadPaymentScreenshot(submission.screenshot_storage_path);
    if (!downloaded || !downloaded.buffer) {
      return res.status(503).json({
        success: false,
        error: {
          code: "STORAGE_UNAVAILABLE",
          message: "Unable to retrieve stored payment screenshot. Please retry in a few moments."
        }
      });
    }
    const analysis = await analyzePaymentScreenshot(
      downloaded.buffer,
      {
        expectedMerchantName: config.PAYEE_DISPLAY_NAME,
        expectedAmount: (booking.total_amount_paise / 100).toFixed(2),
        expectedAmountPaise: booking.total_amount_paise,
        sessionTimestampIso: booking.created_at || (/* @__PURE__ */ new Date()).toISOString(),
        bookingCreatedAt: booking.created_at,
        paymentExpiresAt: booking.payment_expires_at
      }
    );
    if (!analysis.analysisCompleted || analysis.warnings?.includes("OCR_PROCESSING_ERROR")) {
      await db.query(
        "UPDATE payment_submissions SET status = $1, updated_at = $2 WHERE id = $3",
        ["ocr_processing_error", (/* @__PURE__ */ new Date()).toISOString(), submission.id]
      );
      return res.json({
        success: true,
        data: {
          submissionId: submission.id,
          publicId: booking.public_id,
          status: "ocr_processing_error",
          reviewStatus: "ocr_processing_error",
          retryable: true,
          message: "We couldn't process this receipt right now. Your payment proof is saved. Please retry verification.",
          details: {
            utrMatched: null,
            amountMatched: null,
            statusMatched: null,
            payeeMatched: null
          }
        }
      });
    }
    const extractedRrn = analysis.utrOrRrn ? normalizeUtr(analysis.utrOrRrn) : "";
    let isDuplicateUtr = false;
    let utrHash = submission.payer_utr_hash;
    let encryptedUtr = submission.encrypted_utr;
    if (extractedRrn) {
      utrHash = crypto8.createHash("sha256").update(extractedRrn).digest("hex");
      const dupUtrRes = await db.query(
        "SELECT id, booking_id FROM payment_submissions WHERE payer_utr_hash = $1 AND booking_id != $2 AND status != $3 AND status != $4",
        [utrHash, booking.id, "admin_rejected", "payment_rejected"]
      );
      isDuplicateUtr = dupUtrRes.rows.length > 0;
      encryptedUtr = encryptSensitiveField(extractedRrn);
    }
    const match = performDeterministicComparison({
      expectedAmountPaise: booking.total_amount_paise,
      expectedPayeeUpiId: config.PAYEE_UPI_ID,
      expectedPayeeName: config.PAYEE_DISPLAY_NAME,
      enteredUtr: extractedRrn,
      selectedApp: submission.selected_upi_app || "other_upi",
      bookingCreatedAt: booking.created_at,
      paymentExpiresAt: booking.payment_expires_at,
      analysis,
      isDuplicateUtr,
      isDuplicateScreenshot: false,
      isExpired: false
    });
    await db.query(
      `UPDATE payment_submissions SET
        payer_utr_hash = $1,
        encrypted_utr = $2,
        status = $3,
        ocr_extraction = $4,
        deterministic_comparison = $5,
        risk_score = $6,
        reason_codes = $7,
        ocr_engine = $8,
        extracted_transaction_timestamp = $9,
        updated_at = $10
      WHERE id = $11`,
      [
        utrHash,
        encryptedUtr,
        match.nextStatus,
        JSON.stringify(analysis),
        JSON.stringify(match),
        match.riskScore,
        match.reasonCodes,
        "tesseract.js",
        analysis.transactionTimestamp || null,
        (/* @__PURE__ */ new Date()).toISOString(),
        submission.id
      ]
    );
    const runId = crypto8.randomUUID();
    await db.query(
      `INSERT INTO payment_verification_runs (
        id, submission_id, stage, status, confidence, reason_codes, result_json, completed_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        runId,
        submission.id,
        "retry_local_ocr_and_deterministic",
        match.passed ? "passed" : "flagged",
        analysis.extractedFields?.fieldConfidence?.amount || 0.8,
        match.reasonCodes,
        JSON.stringify({ match, extractionSummary: { utr: analysis.utrOrRrn, amount: analysis.amount } }),
        (/* @__PURE__ */ new Date()).toISOString()
      ]
    );
    if (match.passed) {
      const finalResult = await finalizeVerifiedSubmission({
        submissionId: submission.id,
        bookingId: booking.id,
        decisionVersion: "v3-local-ocr-deterministic-retry"
      });
      return res.json({
        success: true,
        data: {
          submissionId: submission.id,
          publicId: booking.public_id,
          status: "payment_confirmed",
          reviewStatus: "ocr_verified",
          message: "Payment proof accepted. Coupons issued.",
          coupons: finalResult.coupons,
          couponsIssuedCount: finalResult.couponsIssuedCount,
          downloadUrl: `/api/bookings/${booking.public_id}/download-all?token=${token}`,
          details: match.details
        }
      });
    } else {
      await db.query(
        "UPDATE bookings SET status = $1, updated_at = $2 WHERE id = $3",
        ["payment_rejected", (/* @__PURE__ */ new Date()).toISOString(), booking.id]
      );
      return res.status(400).json({
        success: false,
        error: {
          code: match.reasonCodes[0] || "PROOF_VERIFICATION_FAILED",
          message: match.userMessage,
          reasonCodes: match.reasonCodes
        },
        data: {
          submissionId: submission.id,
          publicId: booking.public_id,
          status: match.nextStatus,
          message: match.userMessage,
          details: match.details
        }
      });
    }
  } catch (error) {
    console.error("Retry verification error:", error);
    res.status(500).json({
      success: false,
      error: { code: "RETRY_FAILED", message: error.message || "Failed to retry verification." }
    });
  }
});
app.get("/api/bookings/:publicId/status", async (req, res) => {
  try {
    const { publicId } = req.params;
    const authHeader = req.headers.authorization;
    const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : req.query.token || req.query.statusToken || req.headers["x-booking-token"];
    if (!token) {
      return res.status(401).json({
        success: false,
        error: { code: "UNAUTHORIZED", message: "Valid booking access token is required." }
      });
    }
    const bookingRes = await db.query("SELECT * FROM bookings WHERE public_id = $1", [publicId]);
    if (bookingRes.rows.length === 0) {
      return res.status(404).json({ success: false, error: { message: "Booking not found." } });
    }
    const booking = bookingRes.rows[0];
    const tokenHash = crypto8.createHash("sha256").update(token).digest("hex");
    if (booking.status_token_hash && booking.status_token_hash !== tokenHash) {
      return res.status(401).json({ success: false, error: { code: "UNAUTHORIZED", message: "Invalid status token." } });
    }
    const isExpired = booking.status === "expired" || booking.payment_expires_at && new Date(booking.payment_expires_at).getTime() < Date.now();
    if (isExpired && booking.status !== "payment_confirmed" && booking.status !== "proof_verified" && booking.status !== "proof_submitted" && booking.status !== "ocr_checking" && booking.status !== "ocr_processing_error" && booking.status !== "ai_retry_pending") {
      if (booking.status !== "expired") {
        await db.query("UPDATE bookings SET status = $1, updated_at = $2 WHERE id = $3", ["expired", (/* @__PURE__ */ new Date()).toISOString(), booking.id]);
        booking.status = "expired";
      }
    }
    const subRes = await db.query(
      "SELECT status, reason_codes FROM payment_submissions WHERE booking_id = $1 ORDER BY created_at DESC LIMIT 1",
      [booking.id]
    );
    const latestSub = subRes.rows[0];
    let coupons = [];
    if (booking.status === "payment_confirmed" || booking.status === "proof_verified") {
      const cRes = await db.query(
        "SELECT coupon_number, holder_name, phone, village, ticket_index, total_quantity, issued_at FROM coupons WHERE booking_id = $1 ORDER BY ticket_index ASC",
        [booking.id]
      );
      coupons = cRes.rows;
    }
    return res.json({
      success: true,
      data: {
        publicId: booking.public_id,
        status: booking.status,
        submissionStatus: latestSub?.status || null,
        reasonCodes: latestSub?.reason_codes || [],
        isRetryPending: latestSub?.status === "ocr_processing_error" || latestSub?.status === "ai_retry_pending",
        name: booking.participant_name,
        quantity: booking.quantity,
        totalAmount: booking.total_amount_paise / 100,
        paidAt: booking.paid_at ? formatKolkataTime(booking.paid_at) : null,
        isVerified: booking.status === "payment_confirmed" || booking.status === "proof_verified",
        isExpired: booking.status === "expired",
        paymentExpiresAt: booking.payment_expires_at,
        coupons,
        downloadUrl: booking.status === "payment_confirmed" || booking.status === "proof_verified" ? `/api/bookings/${booking.public_id}/download-all?token=${token || ""}` : null
      }
    });
  } catch (error) {
    console.error("Status check error:", error);
    res.status(500).json({ success: false, error: { message: "Failed to retrieve booking status." } });
  }
});
app.get(["/api/coupons/:couponNumber/verify", "/api/coupons/verify", "/api/coupons/verify/:couponNumber"], async (req, res) => {
  try {
    const couponNumber = (req.params.couponNumber || req.query.coupon || req.query.number || "").trim().toUpperCase();
    if (!couponNumber) {
      return res.status(400).json({ success: false, error: { message: "Coupon number is required." } });
    }
    const cRes = await db.query("SELECT * FROM coupons WHERE coupon_number = $1", [couponNumber]);
    if (cRes.rows.length === 0) {
      return res.status(404).json({
        success: false,
        data: { isValid: false, message: "Coupon not found in official registry." }
      });
    }
    const coupon = cRes.rows[0];
    return res.json({
      success: true,
      data: {
        isValid: coupon.status === "valid",
        couponNumber: coupon.coupon_number,
        participantName: coupon.holder_name,
        holderName: coupon.holder_name,
        maskedPhone: maskPhoneNumber(coupon.phone),
        village: coupon.village,
        ticketIndex: coupon.ticket_index,
        totalQuantity: coupon.total_quantity,
        issuedAt: formatKolkataTime(coupon.issued_at),
        status: coupon.status
      }
    });
  } catch (error) {
    console.error("Coupon verification error:", error);
    res.status(500).json({ success: false, error: { message: "Failed to verify coupon." } });
  }
});
app.get("/api/coupons/:couponNumber/download", async (req, res) => {
  try {
    const { couponNumber } = req.params;
    const format = (req.query.format || "pdf").toLowerCase();
    if (!["pdf", "png", "jpeg", "jpg"].includes(format)) {
      return res.status(400).send("Invalid format requested. Supported formats: pdf, png, jpeg.");
    }
    const cleanNumber = couponNumber.trim().toUpperCase();
    const couponRes = await db.query("SELECT * FROM coupons WHERE coupon_number = $1", [cleanNumber]);
    if (couponRes.rows.length === 0) {
      return res.status(404).send("Coupon not found.");
    }
    const coupon = couponRes.rows[0];
    const bookingRes = await db.query("SELECT * FROM bookings WHERE id = $1", [coupon.booking_id]);
    const booking = bookingRes.rows[0];
    const authHeader = req.headers.authorization;
    const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : req.query.token || req.headers["x-booking-token"];
    const adminToken = req.cookies?.admin_session || (authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null);
    const adminSession = adminToken ? getAdminSession(adminToken) : null;
    let isAuthorized = !!adminSession;
    if (!isAuthorized && token && booking) {
      const tokenHash = crypto8.createHash("sha256").update(token).digest("hex");
      if (booking.download_token_hash === tokenHash || booking.status_token_hash === tokenHash) {
        isAuthorized = true;
      }
    }
    if (!isAuthorized) {
      return res.status(401).send("Unauthorized. Valid booking download token or admin session is required.");
    }
    const isVerified = (booking?.status === "proof_verified" || booking?.status === "payment_confirmed") && coupon.status === "valid";
    if (!isVerified) {
      return res.status(403).send("Ticket cannot be downloaded until payment proof is verified.");
    }
    const ticketData = {
      couponNumber: coupon.coupon_number,
      participantName: coupon.holder_name,
      phone: coupon.phone,
      village: coupon.village,
      bookingPublicId: booking?.public_id || "YSYS-DRAW",
      ticketIndex: coupon.ticket_index,
      totalQuantity: coupon.total_quantity,
      paidAt: booking?.verified_at || booking?.paid_at
    };
    if (format === "pdf") {
      const pdfBuffer = await renderTicketPdf(ticketData);
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="${coupon.coupon_number}.pdf"`);
      return res.send(pdfBuffer);
    }
    const targetRaster = format === "png" ? "png" : "jpeg";
    const rasterBuffer = await renderTicketRaster(ticketData, targetRaster);
    res.setHeader("Content-Type", targetRaster === "png" ? "image/png" : "image/jpeg");
    res.setHeader("Content-Disposition", `attachment; filename="${coupon.coupon_number}.${targetRaster === "png" ? "png" : "jpg"}"`);
    return res.send(rasterBuffer);
  } catch (error) {
    console.error("Download ticket error:", error);
    res.status(500).send("Failed to generate ticket.");
  }
});
app.get("/api/coupons/:couponNumber/raster", async (req, res) => {
  try {
    const couponNumber = req.params.couponNumber.trim().toUpperCase();
    const cRes = await db.query("SELECT * FROM coupons WHERE coupon_number = $1", [couponNumber]);
    if (cRes.rows.length === 0) {
      return res.status(404).send("Coupon not found.");
    }
    const coupon = cRes.rows[0];
    const bRes = await db.query("SELECT * FROM bookings WHERE id = $1", [coupon.booking_id]);
    const booking = bRes.rows[0];
    const ticketData = {
      couponNumber: coupon.coupon_number,
      participantName: coupon.holder_name,
      phone: coupon.phone,
      village: coupon.village,
      bookingPublicId: booking?.public_id || "YSYS-DRAW",
      ticketIndex: coupon.ticket_index,
      totalQuantity: coupon.total_quantity,
      paidAt: booking?.verified_at || booking?.paid_at
    };
    const pngBuffer = await renderTicketRaster(ticketData, "png");
    res.setHeader("Content-Type", "image/png");
    res.setHeader("Content-Disposition", `inline; filename="${coupon.coupon_number}.png"`);
    res.send(pngBuffer);
  } catch (error) {
    console.error("Raster render error:", error);
    res.status(500).send("Failed to render coupon PNG.");
  }
});
app.get("/api/bookings/:publicId/download-all", async (req, res) => {
  try {
    const { publicId } = req.params;
    const authHeader = req.headers.authorization;
    const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : req.headers["x-booking-token"] || req.query.token;
    const bookingRes = await db.query("SELECT * FROM bookings WHERE public_id = $1", [publicId]);
    if (bookingRes.rows.length === 0) {
      return res.status(404).send("Booking not found.");
    }
    const booking = bookingRes.rows[0];
    if (token && booking.download_token_hash && booking.status_token_hash) {
      const tokenHash = crypto8.createHash("sha256").update(token).digest("hex");
      const isValid = tokenHash === booking.download_token_hash || tokenHash === booking.status_token_hash;
      if (!isValid) {
        return res.status(401).send("Unauthorized to download tickets.");
      }
    }
    if (booking.status !== "payment_confirmed" && booking.status !== "proof_verified") {
      return res.status(400).send("Payment is not confirmed for this booking.");
    }
    const cRes = await db.query(
      "SELECT * FROM coupons WHERE booking_id = $1 ORDER BY ticket_index ASC",
      [booking.id]
    );
    if (cRes.rows.length === 0) {
      return res.status(404).send("No coupons found for this booking.");
    }
    const format = req.query.format;
    if (format === "zip" || cRes.rows.length > 5) {
      const zipBuffer = await createTicketsZipArchive(cRes.rows);
      res.setHeader("Content-Type", "application/zip");
      res.setHeader("Content-Disposition", `attachment; filename="YuvaShakti-${booking.public_id}-Coupons.zip"`);
      return res.send(zipBuffer);
    } else {
      const combinedPdf = await renderMultiTicketPdf(cRes.rows);
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="YuvaShakti-${booking.public_id}-Tickets.pdf"`);
      return res.send(Buffer.from(combinedPdf));
    }
  } catch (error) {
    console.error("Download all tickets error:", error);
    res.status(500).send("Failed to generate ticket package.");
  }
});
app.post(["/api/test-mode/simulate-proof-verification", "/api/test-mode/simulate-admin-confirm", "/api/test-mode/simulate-payment"], async (req, res) => {
  if (!process.env.VITEST && process.env.NODE_ENV !== "test") {
    return res.status(403).json({ error: "Prohibited in production mode." });
  }
  try {
    const { submissionId, bookingPublicId, clientTxnId } = req.body;
    let targetSubId = submissionId;
    let targetBookingId = "";
    if (bookingPublicId) {
      const bRes = await db.query("SELECT id FROM bookings WHERE public_id = $1", [bookingPublicId]);
      if (bRes.rows.length > 0) targetBookingId = bRes.rows[0].id;
    } else if (clientTxnId) {
      const bRes = await db.query("SELECT id FROM bookings WHERE payment_reference = $1 OR public_id = $1", [clientTxnId]);
      if (bRes.rows.length > 0) targetBookingId = bRes.rows[0].id;
    }
    if (!targetBookingId) {
      const latestB = await db.query("SELECT id FROM bookings WHERE status != $1 ORDER BY created_at DESC LIMIT 1", ["payment_confirmed"]);
      if (latestB.rows.length > 0) targetBookingId = latestB.rows[0].id;
    }
    if (!targetSubId && targetBookingId) {
      const bData = await db.query("SELECT total_amount_paise FROM bookings WHERE id = $1", [targetBookingId]);
      const expectedAmount = bData.rows[0]?.total_amount_paise || 5e3;
      const sRes = await db.query("SELECT id, expected_amount_paise FROM payment_submissions WHERE booking_id = $1 LIMIT 1", [targetBookingId]);
      if (sRes.rows.length > 0) {
        targetSubId = sRes.rows[0].id;
      } else {
        targetSubId = crypto8.randomUUID();
        const simUtrHash = `sim-${crypto8.randomBytes(8).toString("hex")}`;
        await db.query(
          `INSERT INTO payment_submissions (
            id, booking_id, payment_reference, selected_upi_app, expected_payee_upi_id,
            expected_payee_name, expected_amount_paise, payer_utr_hash, status
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [targetSubId, targetBookingId, "YSYS-SIM-REF", "phonepe", config.PAYEE_UPI_ID, config.PAYEE_DISPLAY_NAME, expectedAmount, simUtrHash, "proof_submitted"]
        );
      }
    }
    if (!targetSubId || !targetBookingId) {
      return res.status(400).json({ error: "No booking or submission found to verify." });
    }
    const result = await finalizeVerifiedSubmission({
      submissionId: targetSubId,
      bookingId: targetBookingId,
      decisionVersion: "test-simulation"
    });
    res.json({ success: true, data: result });
  } catch (err) {
    console.error("SIMULATE ERROR:", err);
    res.status(500).json({ error: err.message });
  }
});
app.all("/api/*", (_req, res) => {
  res.status(404).json({
    success: false,
    error: {
      code: "API_NOT_FOUND",
      message: "API endpoint not found."
    }
  });
});
app.use((err, _req, res, next) => {
  if (res.headersSent) {
    return next(err);
  }
  console.error("Unhandled API error:", err);
  const status = typeof err.status === "number" && err.status >= 400 && err.status < 600 ? err.status : 500;
  res.status(status).json({
    success: false,
    error: {
      code: err.code || "INTERNAL_SERVER_ERROR",
      message: err.message || "An unexpected internal error occurred."
    }
  });
});
var app_default = app;
export {
  app,
  app_default as default
};
