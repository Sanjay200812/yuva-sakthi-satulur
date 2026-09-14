# 🎟️ Yuva Shakti Youth Satulur - Lucky Draw Portal (Direct Merchant-UPI & Automated Local OCR Verification)

An official, production-grade event coupon booking portal for **Yuva Shakti Youth Satulur**. Built with **React 19**, **Vite 6**, **TypeScript**, **Tailwind CSS**, **Express 4**, **PostgreSQL / Supabase**, and **Direct Merchant-UPI Collection with Automated Local Server OCR Verification**:
1. **Server-Authoritative Pricing & 5-Minute Payment Session**: Server locks ₹50/coupon (`5000` integer paise), generates intent deep links for PhonePe, Google Pay, Paytm, and generic Other UPI Apps, and enforces a strict 5-minute session expiry.
2. **Deterministic Server-Side OCR & Consistency Verification**: Local server-side OCR (Tesseract.js) with Sharp multi-variant preprocessing, candidate-scoring parsing, and fail-closed deterministic verification without any external AI or LLM API calls.
3. **Atomic Instant Coupon Finalization**: High-confidence verified submissions immediately call atomic finalization inside a database transaction, allocating unique coupon numbers without manual human bottlenecks.

---

> [!IMPORTANT]
> **Architecture & Receipt Verification Disclaimer**:
> Server-side receipt analysis via local OCR and the deterministic comparison engine is an **automated consistency and fraud-screening mechanism**, not proof of bank settlement. Image receipts, OCR text, and client devices are untrusted inputs. The system verifies visible receipt status, expected amount, unique 12-digit RRN, payee VPA, and timestamp consistency before issuing coupons. Authoritative automatic settlement verification requires a supported bank/merchant PSP transaction-status API.

---

## 📌 Event Overview

- **Event**: Yuva Shakti Youth Satulur Lucky Draw
- **Organizer**: Yuva Shakti Youth, Satulur
- **1st Prize**: 🏆 **20 KG Maha Laddu**
- **Coupon Price**: **₹50 per ticket** (stored server-side as `5000` integer paise)
- **Venue**: Satulur Center, Guntur District, Andhra Pradesh
- **Helpline**: +91 95748 76369
- **Timezone**: `Asia/Kolkata`
- **Coupon Prefix**: `YSYS` (e.g. `YSYS-2026-000001`)

---

## 🏗️ Architecture & Core System Design

### 1. Customer Payment Flow
```text
Participant Details
  → Select Quantity
  → Server Calculates & Locks Amount (₹50 × quantity)
  → Server Initiates 5-Minute Session (`payment_expires_at`)
  → Customer Selects UPI App (PhonePe / Google Pay / Paytm / Other UPI Apps)
  → Launch App Intent / Scan Prominent QR
  → Customer Pays in UPI App
  → Return to Website
  → Upload Payment Screenshot Proof (Zero Manual UTR Entry Required)
  → Server Magic-Bytes, Sharp Sanitization, SHA-256 & Perceptual dHash Check
  → Multi-Variant Sharp Preprocessing & Local Tesseract.js OCR
  → Candidate Scoring for Amount, 12-Digit RRN/UTR, Status, Payee & Timestamp
  → Fail-Closed Deterministic Matcher & Duplicate Protection
  → Atomic Concurrency-Safe Finalizer
  → Immediate Coupon Issuance & TicketModal Download (PDF, PNG, JPEG, ZIP)
```

### 2. Direct Merchant-UPI Collection & App Intents
- **No Hosted Gateways**: Third-party hosted gateways (Razorpay, VyaparGateway, Cashfree, PhonePe Gateway) are absent. All payments go directly to the merchant UPI VPA.
- **Server-Authoritative Pricing**: The client never controls the price. Total amount is calculated server-side: `totalAmountPaise = EVENT_COUPON_PRICE_PAISE * quantity`. Client request amounts are ignored.
- **5-Minute Payment Session**: The server computes `payment_expires_at = now() + 5 minutes`. The client displays a live MM:SS countdown driven strictly by this server timestamp. Proof submitted after expiry is rejected with `PAYMENT_SESSION_EXPIRED`.
- **4 Dedicated Payment Choices**:
  1. **PhonePe**: Official deep link intent `phonepe://pay?...`
  2. **Google Pay**: Official deep link intent `gpay://upi/pay?...`
  3. **Paytm**: Official deep link intent `paytmmp://pay?...`
  4. **Other UPI Apps**: Canonical generic `upi://pay?...` for system UPI app selection.
- **Fixed Amount Parameter**: Uses exact fixed `am` parameter and omits `mam` to prevent partial amount tampering.
- **Responsive Presentation**: Prominent QR code on desktop devices; dynamic payment launch button on mobile devices.

### 3. Strict 12-Digit RRN & Screenshot Processing
- **Automatic RRN Extraction**: The user is never prompted to type a manual UTR. The backend extracts the 12-digit numeric RRN directly from the receipt.
- **Magic Bytes & Raster Sanitization**: Validates raster magic bytes (PNG, JPEG, WebP, max 5MB).
- **Sharp Re-Encoding**: Strips all EXIF/GPS metadata and comments.
- **Deduplication & Perceptual Hashing**: Computes SHA-256 for byte-level duplicate detection and 64-bit dHash (difference hash) for perceptual layout similarity comparison. Rejects duplicate confirmed RRNs and identical screenshots.
- **Production Screenshot Storage**: When Supabase is configured, sanitized screenshots are stored in a private bucket (`PAYMENT_PROOF_BUCKET`) and accessed only via short-lived signed URLs. Local filesystem fallback is used in offline development.
- **Authenticated Encryption (AES-256-GCM)**: Sensitive raw RRN data is encrypted at rest using AES-256-GCM with a random 12-byte IV and authentication tag (`v1:<iv>:<tag>:<ciphertext>`).

### 4. Local Server-Side OCR (Tesseract.js) & Preprocessing
- **100% Local & Code-Only**: Zero external AI APIs, LLMs, or cloud OCR services. Runs entirely within the Node.js serverless execution environment.
- **Multi-Variant Sharp Preprocessing**: Generates in-memory candidates (grayscale, contrast-enhanced, sharpened/upscaled) without writing temporary files to disk.
- **Candidate Scoring Engine**:
  - **Payment Reference**: Labels scored by proximity (`UTR`, `RRN`, `UPI Ref`, `Bank Reference`). 12-digit numeric sequences prioritized.
  - **Amount**: Proximity scoring near "Paid", "Amount", "Sent", "Total" with INR / ₹ symbol parsing.
  - **Payment Status**: Explicit status priority (`FAILED` > `PENDING` > `SUCCESS`).
  - **Transaction Timestamp**: Indian receipt formats parsed in `Asia/Kolkata` time zone and checked against the 5-minute booking window.
  - **Payee & App Detection**: Checks recipient UPI ID against `PAYEE_UPI_ID` and identifies app signatures (PhonePe, Google Pay, Paytm).

### 5. Fail-Closed Deterministic Matcher & Reason Codes
Every automated verification must satisfy all mandatory signals before coupon issuance:
- Sufficient readable text from OCR (`OCR_UNREADABLE` if empty/blurry)
- `paymentStatus === "success"`
- Extracted 12-digit RRN exists and matches format
- Extracted amount exists and matches booking `total_amount_paise`
- No duplicate RRN or duplicate screenshot across finalized bookings
- Payee VPA must not be positively identified as a different UPI account
- Explicit failure reason codes:
  - `MISSING_PAYMENT_REFERENCE`
  - `INVALID_PAYMENT_REFERENCE`
  - `MISSING_AMOUNT`
  - `AMOUNT_MISMATCH`
  - `STATUS_NOT_SUCCESS`
  - `DUPLICATE_PAYMENT_REFERENCE`
  - `DUPLICATE_SCREENSHOT`
  - `WRONG_PAYEE`
  - `TRANSACTION_TIME_MISMATCH`
  - `OCR_UNREADABLE`
  - `OCR_PROCESSING_ERROR` (allows customer retry on stored proof)

### 6. Atomic Instant Finalizer & Secure Access Tokens
- **Instant Automatic Finalization**: High-confidence verification immediately calls `finalizeVerifiedSubmission(...)`.
- **Database Transaction & Concurrency Safety**:
  - Locks booking and payment submission rows (`FOR UPDATE`).
  - Confirms booking has not already been finalized (idempotent for retries).
  - Enforces global uniqueness on confirmed RRN hash.
  - Generates exact quantity of coupons paid for with sequential numbers (`YSYS-2026-XXXXXX`).
  - Updates booking to authoritative completed status: `payment_confirmed`.
  - Records an immutable audit log entry.
- **Secure Access Tokens**: Status polling and proof submission require the cryptographically random `statusToken` (stored as SHA-256 hash). Guessing a public booking ID (`BK-XXXXXX`) does not expose participant data or coupons.
- **Authenticated Downloads**: Coupon downloads require a secure download token or admin authentication.

### 7. Multi-Format Personalized Ticket Generation
- **Supported Formats**: PDF (printable with vector QR), lossless PNG, crisp JPEG, and multi-ticket ZIP bundles.
- **Multilingual Support**: Supports both English and Telugu participant names and village names.

### 8. Admin Portal (`/admin`)
- **Genuine Issued Coupons**: Shows genuine issued coupons with applicant details, booking reference, amount, and download passes.
- **Verification & Audit Logs**: Shows all proof submissions, OCR engine metadata (Tesseract.js), extracted amounts, masked RRNs, transaction timestamps, detected apps, reason codes, and short-lived signed screenshot previews.

---

## 📁 Repository Structure

```text
├── migrations/
│   ├── 001_init_schema.sql                 # Base PostgreSQL schema
│   ├── 002_direct_upi_schema.sql           # Direct UPI tables & RRN hash index
│   ├── 003_automated_upi_verification.sql   # payment_expires_at, unified constraints
│   ├── 004_fix_admin_users.sql             # Admin user schema hardening
│   └── 005_local_ocr_verification.sql      # ocr_extraction, ocr_engine, extracted_transaction_timestamp
├── server/
│   ├── admin/
│   │   ├── auth.ts                         # Admin bcrypt auth & sessions
│   │   └── routes.ts                       # Admin APIs (coupons, verification logs, signed screenshot URLs)
│   ├── config/
│   │   └── eventConfig.ts                  # Zod config, 5-min session, AES-GCM key validation
│   ├── db/
│   │   └── client.ts                       # PostgreSQL pool & in-memory store
│   ├── upi/
│   │   ├── upiUri.ts                       # NPCI UPI URI generator (PhonePe, GPay, Paytm, Other UPI)
│   │   ├── imageProcessor.ts               # Sharp sanitization, magic bytes, SHA256, dHash, Supabase Storage
│   │   ├── localOcrAnalyzer.ts             # In-memory Sharp multi-variant & local Tesseract.js OCR engine
│   │   ├── deterministicMatcher.ts         # Fail-closed comparison engine & reason codes
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
