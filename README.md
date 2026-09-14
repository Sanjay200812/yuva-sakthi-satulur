# 🎟️ Yuva Shakti Youth Satulur - Lucky Draw Portal (Direct Merchant-UPI & Automated Verification)

An official, production-grade event coupon booking portal for **Yuva Shakti Youth Satulur**. Built with **React 19**, **Vite 6**, **TypeScript**, **Tailwind CSS**, **Express 4**, **PostgreSQL / Supabase**, and **Direct Merchant-UPI Collection with Automated Verification**:
1. **Server-Authoritative Pricing & 5-Minute Payment Session**: Server locks ₹50/coupon (`5000` integer paise), generates intent deep links for PhonePe, Google Pay, Paytm, and generic Other UPI Apps, and enforces a strict 5-minute session expiry.
2. **Automated AI Consistency & Fraud Screening**: Google Gemini structured OCR text extraction and fail-closed deterministic verification.
3. **Atomic Instant Coupon Finalization**: High-confidence verified submissions immediately call atomic finalization inside a database transaction, allocating unique coupon numbers without manual human bottlenecks.

---

> [!IMPORTANT]
> **Architecture & Settlement Verification Disclaimer**:
> Screenshot analysis via Google Gemini and the server deterministic comparison engine is an **automated consistency and fraud-screening mechanism**, not proof of bank settlement. Image receipts, OCR text, and client devices are untrusted inputs. Authoritative automatic settlement verification requires a supported bank/merchant PSP transaction-status API (e.g. NPCI/bank merchant settlement callbacks or UPI transaction status inquiry API).

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
  → Enter 12-Digit UPI RRN + Upload Screenshot Proof
  → Server Magic-Bytes, Sharp Sanitization, SHA-256 & Perceptual dHash Check
  → Gemini Structured OCR & Risk Analysis
  → Fail-Closed Deterministic Matcher
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
- **Strict 12-Digit Numeric RRN**: Validated on both frontend and backend using `/^\d{12}$/`.
- **Magic Bytes & Raster Sanitization**: Validates raster magic bytes (PNG, JPEG, WebP, max 5MB).
- **Sharp Re-Encoding**: Strips all EXIF/GPS metadata and comments.
- **Deduplication & Perceptual Hashing**: Computes SHA-256 for byte-level duplicate detection and 64-bit dHash (difference hash) for perceptual layout similarity comparison. Rejects duplicate confirmed RRNs and identical screenshots.
- **Production Screenshot Storage**: When Supabase is configured, sanitized screenshots are stored in a private bucket (`PAYMENT_PROOF_BUCKET`) and accessed only via short-lived signed URLs. Local filesystem fallback is used in offline development.
- **Authenticated Encryption (AES-256-GCM)**: Sensitive raw RRN data is encrypted at rest using AES-256-GCM with a random 12-byte IV and authentication tag (`v1:<iv>:<tag>:<ciphertext>`).

### 4. Gemini OCR & Fraud Risk Analysis
- **Server-Side Only**: Uses `@google/genai` on Express server. `GEMINI_API_KEY` is never exposed to Vite or client bundles.
- **Structured JSON Schema**: Extracts key visible receipt fields without hallucination:
  - `looks_like_payment_screen`: boolean
  - `visible_payment_status`: `success` | `pending` | `failed` | `unknown`
  - `app_name`: `phonepe` | `google_pay` | `paytm` | `other` | `unknown`
  - `amount`: string
  - `currency`: `INR`
  - `utr_or_rrn`: string
  - `payee_name`: string | null
  - `payee_upi_id`: string | null
  - `obvious_editing_signals`: array of strings
  - `ai_generated_likelihood`: `low` | `medium` | `high` | `unknown`
  - `field_confidence`: per-field confidence scores (0.0 to 1.0)
- **Prompt Injection Defense**: Strips delimiter markers and treats all image text as untrusted OCR data.

### 5. Fail-Closed Deterministic Matcher & Explicit Reason Codes
Every automated verification must satisfy all mandatory signals before coupon issuance:
- `looks_like_payment_screen === true`
- `visible_payment_status === "success"`
- Extracted RRN exists and matches entered RRN
- Extracted amount exists and matches booking `total_amount_paise`
- Currency is INR
- No duplicate RRN or duplicate screenshot
- Low AI-generated likelihood and no tampering indicators
- Sufficient OCR confidence for amount, RRN, and status
- Payment timestamp consistent with session when extractable
- Explicit failure reason codes:
  - `MISSING_RRN`
  - `MISSING_AMOUNT`
  - `RRN_MISMATCH`
  - `AMOUNT_MISMATCH`
  - `STATUS_NOT_SUCCESS`
  - `DUPLICATE_RRN`
  - `DUPLICATE_SCREENSHOT`
  - `TAMPERING_RISK`
  - `LOW_CONFIDENCE`
  - `PAYMENT_SESSION_EXPIRED`
  - `WRONG_PAYEE`
  - `INVALID_PAYMENT_SCREEN`

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
- **Verification & Audit Logs**: Shows all proof submissions, Gemini OCR metadata, risk signals, RRN hashes, reason codes, and short-lived signed screenshot previews.

---

## 📁 Repository Structure

```text
├── migrations/
│   ├── 001_init_schema.sql                 # Base PostgreSQL schema
│   ├── 002_direct_upi_schema.sql           # Direct UPI tables & RRN hash index
│   └── 003_automated_upi_verification.sql   # payment_expires_at, unified constraints
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
│   │   ├── geminiAnalyzer.ts               # Google Gemini OCR text extraction & risk analysis
│   │   ├── deterministicMatcher.ts         # Fail-closed comparison engine & reason codes
│   │   └── automatedFinalizer.ts           # Concurrency-safe atomic coupon finalizer
│   ├── utils/
│   │   └── crypto.ts                       # AES-256-GCM authenticated encryption
│   └── services/
│       ├── couponAllocator.ts              # Atomic sequential coupon allocator
│       └── ticketRenderer.ts               # Multi-format PDF, PNG, JPEG & ZIP generator
├── tests/
│   ├── booking-and-pricing.test.ts         # Server pricing, 5-min expiry, token security
│   ├── payments-and-webhooks.test.ts       # UPI intents, OCR matcher, duplicate checks, legacy 404s
│   ├── coupon-allocation-and-pdf.test.ts   # Ticket rendering & download authorization
│   └── admin.test.ts                       # Admin dashboard, audit logs, verified coupons
├── src/
│   ├── components/
│   │   ├── admin/
│   │   │   ├── AdminLogin.tsx              # Admin login
│   │   │   └── AdminDashboard.tsx          # Coupons registry & verification audit logs
│   │   ├── BookingModal.tsx                # 4-phase booking flow, 5-min timer, 4 apps, 12-digit RRN
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
PAYEE_UPI_ID=9574876369@ybl
PAYEE_DISPLAY_NAME=Yuva Shakti Youth Satulur
UPI_TRANSACTION_NOTE_PREFIX=YSYS
PAYMENT_SESSION_MINUTES=5
PAYMENT_SCREENSHOT_MAX_BYTES=5242880
PAYMENT_PROOF_BUCKET=payment-proofs
FIELD_ENCRYPTION_KEY=c9b68a3f81e9b2512a8848db92ea91bc310dc2e811c7fae98f0601931889c02b

# Google Gemini API (Server-Side Only)
GEMINI_API_KEY=your_gemini_api_key_here
GEMINI_MODEL=gemini-2.5-flash

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
