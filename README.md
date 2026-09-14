# 🎟️ Yuva Shakti Youth Satulur - Lucky Draw Portal (Direct Merchant-UPI & Deterministic Proof Verification)

An official, production-grade event coupon booking portal for **Yuva Shakti Youth Satulur**. Built with **React 19**, **Vite 6**, **TypeScript**, **Tailwind CSS**, **Express 4**, **PostgreSQL / Supabase**, and **Direct Merchant-UPI Collection with Automated Local Server OCR & Deterministic Verification**:
1. **Customer uploads payment screenshot**: The payment confirmation screenshot itself is the authoritative source of UTR/RRN, amount, status, date/time, and payee details.
2. **No manual UTR entry**: Customer never needs to manually type any transaction ID, UTR, or reference number.
3. **Local OCR automatically extracts transaction reference**: High-speed, deterministic local OCR (Tesseract.js) extracts the genuine 12-digit UPI RRN / UTR, amount, status, timestamp, and receiver VPA directly from the image.
4. **5-minute complete payment session**: Server-authoritative 5-minute payment session (`AUTHORITATIVE_PAYMENT_SESSION_MINUTES = 5`). Single countdown timer shared across payment and verification screens without restarting on refresh or app switching. Verification disables at 00:00.
5. **No Gemini & No AI API**: 100% deterministic code-only OCR and matching engine. Completely free of Gemini, Google GenAI, ChatGPT, or external cloud AI APIs.
6. **No admin approval**: Passing screenshots automatically trigger atomic coupon issuance into the official registry without manual bottlenecks.
7. **Automatic proof verification**: Normal verification completes in ~2–5 seconds with safe multi-stage progress profiling.
8. **Private Supabase Storage**: Sanitized payment receipts are stored securely in a private Supabase bucket (`payment-proofs`) with short-lived signed URLs. Production serverless environments never persist uploads to `/var/task`.

---

> [!IMPORTANT]
> **Architecture & Receipt Verification Disclaimer**:
> Server-side receipt analysis via local OCR and the deterministic comparison engine is an **automated consistency and payment-proof verification mechanism**, NOT proof of bank settlement. The system verifies visible receipt status, expected amount, extracted 12-digit UTR/RRN, payee VPA, timestamp consistency, and duplicate fraud protection before issuing coupons.
> Never display "Bank Verified" or "Bank Settlement Confirmed" in user-facing messaging; always state **"Payment Proof Verified"** or **"Receipt Verified"**.

---

## 📌 Event Overview

- **Event**: Yuva Shakti Youth Satulur Lucky Draw
- **Organizer**: Yuva Shakti Youth, Satulur
- **1st Prize**: 🏆 **20 KG Maha Laddu**
- **Coupon Price**: **₹50 per ticket** (represented server-side as `5000` integer paise)
- **Authoritative Receiver**: `7075920852@ybl` (Yuva Shakti Youth Satulur)
- **Venue**: Satulur Center, Guntur District, Andhra Pradesh
- **Helpline**: +91 95748 76369
- **Timezone**: `Asia/Kolkata`
- **Coupon Prefix**: `YSYS` (e.g. `YSYS-2026-000001`)

---

## 🏗️ Architecture & Core System Design

### 1. Customer Payment & Verification Flow
```text
Participant Details (Starts empty, no sample personal names)
  → Select Dynamic Quantity
  → Server Calculates & Locks Amount (₹50 × quantity = total_amount_paise)
  → Server Initiates 5-Minute Session (payment_expires_at = now() + 5 mins)
  → Customer Selects UPI App (PhonePe / Google Pay / Paytm / FamPay / Other UPI)
  → Launch App Intent / Scan Canonical Dynamic QR
  → Customer Pays in UPI App
  → Return to Website ("I have completed payment")
  → Verification Page: Screenshot Upload ONLY (No manual UTR entry)
  → Server Magic-Bytes, Sharp Sanitization, SHA-256 & Perceptual dHash Check
  → Fast Single-Pass Sharp Preprocessing & Local Tesseract.js OCR
  → Candidate Scoring for Amount, Status, 12-Digit RRN/UTR, Payee, & Timestamp
  → Fail-Closed Deterministic Decision Engine & Duplicate Reference / Screenshot Checks
  → Atomic Concurrency-Safe PostgreSQL Transaction
  → Immediate Coupon Issuance & Customer Success UI
  → Multi-format Downloads (PDF, PNG, JPEG, ZIP)
```

### 2. Direct Merchant-UPI Collection & App Intents
- **No Third-Party Hosted Gateways**: Third-party hosted gateways (Razorpay, Cashfree, PhonePe Gateway API, bank APIs) are absent. All payments go directly to the merchant UPI VPA.
- **Server-Authoritative Pricing**: Total amount is calculated server-side: `totalAmountPaise = EVENT_COUPON_PRICE_PAISE * quantity`. Client request amounts are ignored.
- **5-Minute Payment Session**: The server computes `payment_expires_at = now() + 5 minutes`. Both payment and verification pages display the same authoritative timer. Page reload or UPI app switching does NOT reset the timer. At 00:00, verification is disabled with: "Payment session expired. Start a new payment session."
- **5 Dedicated Payment Choices**: PhonePe, Google Pay, Paytm, FamPay, and Other UPI Apps.
- **Fixed Amount Parameter**: Uses exact fixed `am` parameter and omits `mam` to prevent partial amount tampering.

### 3. Customer Verification Page (Screenshot Upload Only)
- **Zero Manual Reference Typing**: No UTR, RRN, or transaction ID inputs exist on the verification page.
- **Screenshot As Authoritative Source**: Customer selects payment screenshot (PNG, JPG, JPEG, WebP, max 5MB) and clicks `[ VERIFY PAYMENT ]`.
- **Local OCR Extraction**: The server automatically extracts UTR/RRN, amount, status, date/time, payee, and app name.
- **Duplicate Protection**: Extracted reference is normalized, hashed, and checked against the database. Exact duplicate images (SHA-256) and reused references are rejected (`DUPLICATE_TRANSACTION_REFERENCE`, `DUPLICATE_SCREENSHOT`).
- **Production Screenshot Storage**: Stored exclusively in private Supabase Storage (`payment-proofs`). Never written to `/var/task`.

### 4. Local Server-Side OCR (Tesseract.js) & Preprocessing
- **100% Local & Code-Only**: Zero external AI APIs, LLMs, or cloud OCR services.
- **Optimized Fast OCR Pipeline**: Sharp preprocesses once; runs primary pass; extracts fields in ~1–3s; secondary pass only if fields are missing.
- **Target Verification Duration**: 2–5 seconds with no artificial delays.
- **AI Generator Watermark Detection**: Rejects AI watermarks (`Generated with AI`, `ChatGPT`, `DALL-E`, `Midjourney`, etc.) without rejecting legitimate apps (`Google Pay`).

### 5. Fail-Closed Deterministic Decision Engine & Reason Codes
Standardized failure reasons:
- `REFERENCE_NOT_READABLE`: Could not clearly read the transaction reference from the screenshot.
- `DUPLICATE_TRANSACTION_REFERENCE`: Reference already used for another confirmed booking.
- `MISSING_AMOUNT`: Could not detect payment amount.
- `AMOUNT_MISMATCH`: Extracted amount differs from booking total.
- `STATUS_NOT_SUCCESS`: Screenshot shows pending or failed payment.
- `DUPLICATE_SCREENSHOT`: Screenshot previously submitted.
- `WRONG_PAYEE`: Receiver VPA does not match configured merchant UPI.
- `TRANSACTION_TIME_MISMATCH`: Timestamp outside the 5-minute window.
- `OCR_UNREADABLE`: Screenshot unreadable.
- `OCR_PROCESSING_ERROR`: Technical OCR processing error (retryable, not marked fraud).
- `AI_GENERATOR_WATERMARK`: Explicit generator watermark detected.
- `INVALID_SCREENSHOT_FORMAT`: File is not a valid PNG/JPEG/WebP image.
- `PAYMENT_SESSION_EXPIRED`: 5-minute window expired.

### 6. Atomic Concurrency-Safe Finalization
- Instant automatic coupon issuance without admin approval.
- Concurrency-safe PostgreSQL transaction with unique reference hash constraints.
- Double-click protection on frontend and server idempotency.

### 7. Admin Portal (`/admin`)
- Monitoring & audit only: No manual payment approvals needed.
- Displays OCR extracted reference, amount, status, transaction time, payee, UPI ID, screenshot, and coupon numbers.

---

## 📁 Repository Structure

```text
├── migrations/
│   ├── 001_init_schema.sql                 # Base PostgreSQL schema
│   ├── 002_direct_upi_schema.sql           # Direct UPI tables & RRN hash index
│   ├── 003_automated_upi_verification.sql   # payment_expires_at, unified constraints
│   ├── 004_fix_admin_users.sql             # Admin user schema hardening
│   ├── 005_local_ocr_verification.sql      # ocr_extraction, ocr_engine, timestamp
│   └── 006_deterministic_receipt_verification.sql # Payment settings table, reference hashes, forensics
├── server/
│   ├── admin/
│   │   ├── auth.ts                         # Admin bcrypt auth & sessions
│   │   └── routes.ts                       # Admin APIs (coupons, audit logs, payment settings)
│   ├── config/
│   │   └── eventConfig.ts                  # Zod config, 5-min session, AES-GCM key validation
│   ├── db/
│   │   └── client.ts                       # PostgreSQL pool & in-memory store
│   ├── upi/
│   │   ├── upiUri.ts                       # Canonical UPI URI generator (PhonePe, GPay, Paytm, FamPay, Other)
│   │   ├── imageProcessor.ts               # Sharp sanitization, magic bytes, SHA256, dHash, Supabase Storage
│   │   ├── localOcrAnalyzer.ts             # Sharp multi-variant & local Tesseract.js OCR engine
│   │   ├── deterministicReceiptVerifier.ts # Standalone 18-reason deterministic decision engine
│   │   ├── deterministicMatcher.ts         # Deterministic matching & UTR cross-check
│   │   └── automatedFinalizer.ts           # Concurrency-safe atomic coupon finalizer
│   ├── utils/
│   │   └── crypto.ts                       # AES-256-GCM authenticated encryption
│   └── services/
│       ├── couponAllocator.ts              # Atomic sequential coupon allocator
│       └── ticketRenderer.ts               # Multi-format PDF, PNG, JPEG & ZIP generator
├── tests/
│   ├── booking-and-pricing.test.ts         # Server pricing, 5-min expiry, token security
│   ├── payments-and-webhooks.test.ts       # UPI intents, local OCR matcher, duplicate checks
│   ├── coupon-allocation-and-pdf.test.ts   # Ticket rendering & download authorization
│   └── admin.test.ts                       # Admin dashboard, audit logs, verified coupons
├── src/
│   ├── components/
│   │   ├── admin/
│   │   │   ├── AdminLogin.tsx              # Admin login
│   │   │   └── AdminDashboard.tsx          # Coupons registry & verification audit logs
│   │   ├── BookingModal.tsx                # Payment flow, 5-min timer, 4 apps, automatic OCR verification
│   │   ├── TicketModal.tsx                 # Ticket preview & multi-format download
│   │   └── ...                             # Public event components
│   └── utils/
│       └── payment.ts                      # Client booking, proof submission & polling with auth tokens
├── server.ts                               # Main Express application & secure endpoints
└── package.json                            # Dependencies & scripts
```

---

## 🚀 Quickstart & Local Development

### 1. Installation
```bash
npm install
```

### 2. Environment Configuration (`.env`)
```env
# Server & Runtime
NODE_ENV=development
PORT=3000
APP_URL=http://localhost:3000
SESSION_SECRET=a_very_strong_random_secret_at_least_32_characters_long

# Database (Leave blank for in-memory transactional mock store)
DATABASE_URL=
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=

# Direct Merchant-UPI Configuration
PAYMENT_MODE=direct_upi_automated_verification
PAYEE_UPI_ID=7075920852@ybl
PAYEE_DISPLAY_NAME=Yuva Shakti Youth Satulur
UPI_TRANSACTION_NOTE_PREFIX=YSYS
PAYMENT_SESSION_MINUTES=5
PAYMENT_SCREENSHOT_MAX_BYTES=5242880
PAYMENT_PROOF_BUCKET=payment-proofs
FIELD_ENCRYPTION_KEY=c9b68a3f81e9b2512a8848db92ea91bc310dc2e811c7fae98f0601931889c02b

# Local Server OCR Engine (No external AI API keys needed)
OCR_ENGINE=tesseract.js

# Event Configuration
EVENT_NAME=Yuva Shakti Youth Satulur Lucky Draw
EVENT_COUPON_PRICE_PAISE=5000
EVENT_MAX_COUPONS_PER_BOOKING=20
```

### 3. Bootstrap Administrator Account
```bash
npm run seed:admin
```

### 4. Run Development Server
```bash
npm run dev
```

---

## 🧪 Testing & Build Verification

```bash
# Run automated test suites
npm test

# Run TypeScript type check
npm run lint

# Build client and server bundles
npm run build
```

---

## 📞 Support & Organizer Contact

Organized by **Yuva Shakti Youth, Satulur**  
- **Helpline**: +91 95748 76369  
- **Venue**: Satulur Center, Guntur District, Andhra Pradesh
