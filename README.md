# 🎟️ Yuva Shakti Youth Satulur - Lucky Draw Portal (Direct Merchant-UPI & Deterministic Proof Verification)

An official, production-grade event coupon booking portal for **Yuva Shakti Youth Satulur**. Built with **React 19**, **Vite 6**, **TypeScript**, **Tailwind CSS**, **Express 4**, **PostgreSQL / Supabase**, and **Direct Merchant-UPI Collection with Automated Local Server OCR & Deterministic Verification**:
1. **Server-Authoritative Pricing & 5-Minute Payment Session**: Server calculates and locks ₹50/coupon (`5000` integer paise), generates canonical UPI intent deep links for PhonePe, Google Pay, Paytm, FamPay, and Other UPI Apps, and enforces a strict 5-minute session expiry (`AUTHORITATIVE_PAYMENT_SESSION_MINUTES = 5`).
2. **Two Mandatory Verification Inputs**: Customer enters their 12-digit UPI UTR / Transaction ID and uploads their payment confirmation receipt screenshot.
3. **Deterministic Local OCR & Cross-Checking**: Local server-side OCR (Tesseract.js) with Sharp multi-variant preprocessing, candidate scoring, entered UTR vs OCR UTR cross-checking, AI generator watermark detection, and fail-closed deterministic verification without any external AI or cloud LLM APIs.
4. **Instant Atomic Concurrency-Safe Coupon Finalization**: Passing submissions instantly call atomic PostgreSQL transaction finalization, allocating unique coupon numbers without manual human bottlenecks or admin approvals.
5. **Private Supabase Storage**: Sanitized payment receipts are stored securely in a private Supabase bucket (`payment-proofs`) with short-lived signed URLs. Production serverless environments never persist uploads to `/var/task` or the local filesystem.

---

> [!IMPORTANT]
> **Architecture & Receipt Verification Disclaimer**:
> Server-side receipt analysis via local OCR and the deterministic comparison engine is an **automated consistency and payment-proof verification mechanism**, NOT proof of bank settlement. The system verifies visible receipt status, expected amount, entered vs extracted 12-digit UTR/RRN, payee VPA, timestamp consistency, and duplicate fraud protection before issuing coupons.
> Never display "Bank Verified" or "Bank Settlement Confirmed" in user-facing messaging; always state **"Payment Proof Verified"** or **"Receipt Verified"**. Authoritative independent bank settlement verification requires a dedicated bank/merchant PSP transaction-status API.

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
Participant Details
  → Select Dynamic Quantity
  → Server Calculates & Locks Amount (₹50 × quantity = total_amount_paise)
  → Server Initiates 5-Minute Session (`payment_expires_at = now() + 5 mins`)
  → Customer Selects UPI App (PhonePe / Google Pay / Paytm / FamPay / Other UPI)
  → Launch App Intent / Scan Canonical Dynamic QR
  → Customer Pays in UPI App
  → Return to Website ("I have completed payment")
  → Verification Page: TWO Mandatory Inputs:
      1. UTR / Transaction ID (Text Entry)
      2. Payment Screenshot (File Upload)
  → Server Magic-Bytes, Sharp Sanitization, SHA-256 & Perceptual dHash Check
  → Multi-Variant Sharp Preprocessing & Local Tesseract.js OCR
  → Candidate Scoring for Amount, Status, 12-Digit RRN/UTR, Payee, & Timestamp
  → Entered UTR vs Screenshot UTR Cross-Check
  → Fail-Closed Deterministic Decision Engine & Duplicate Protections
  → Atomic Concurrency-Safe PostgreSQL Transaction
  → Immediate Coupon Issuance & Customer Success UI
  → Multi-format Downloads (PDF, PNG, JPEG, ZIP)
```

### 2. Direct Merchant-UPI Collection & App Intents
- **No Third-Party Hosted Gateways**: Third-party hosted gateways (Razorpay, Cashfree, PhonePe Gateway API, bank APIs) are absent. All payments go directly to the merchant UPI VPA.
- **Server-Authoritative Pricing**: The client never controls the price. Total amount is calculated server-side: `totalAmountPaise = EVENT_COUPON_PRICE_PAISE * quantity`. Client request amounts are ignored.
- **5-Minute Payment Session**: The server computes `payment_expires_at = now() + 5 minutes`. The client displays a live MM:SS countdown driven strictly by this server timestamp.
- **5 Dedicated Payment Choices**:
  1. **PhonePe**: Deep link intent `phonepe://pay?...`
  2. **Google Pay**: Deep link intent `gpay://upi/pay?...`
  3. **Paytm**: Deep link intent `paytmmp://pay?...`
  4. **FamPay**: Deep link intent or standard UPI fallback `upi://pay?...`
  5. **Other UPI Apps**: Canonical generic `upi://pay?...` for system UPI app selection.
- **Fixed Amount Parameter**: Uses exact fixed `am` parameter and omits `mam` to prevent partial amount tampering.
- **Responsive Presentation**: Prominent QR code on desktop devices; dynamic payment launch button on mobile devices.

### 3. Verification Page (Two Mandatory Inputs)
- **Mandatory Input 1: UTR / Transaction ID**: User manually enters their 12-digit UPI RRN / UTR / Reference ID from their payment app.
- **Mandatory Input 2: Payment Receipt Screenshot**: User uploads their payment confirmation screen.
- **Cross-Check**: Server extracts visible reference from OCR and cross-checks with entered UTR. Mismatch triggers `TRANSACTION_REFERENCE_MISMATCH`.
- **Magic Bytes & Raster Sanitization**: Validates raster magic bytes (PNG, JPEG, WebP, max 5MB).
- **Sharp Re-Encoding**: Strips all EXIF/GPS metadata and comments.
- **Deduplication & Forensics**: SHA-256 for exact duplicate detection and 64-bit dHash for perceptual layout similarity. Blocks duplicate confirmed UTRs (`DUPLICATE_TRANSACTION_REFERENCE`) and duplicate screenshots (`DUPLICATE_SCREENSHOT`).
- **Production Screenshot Storage**: Sanitized screenshots are stored in private Supabase Storage (`payment-proofs`) and accessed only via short-lived signed URLs. Local filesystem fallback is permitted only in offline development (`NODE_ENV === 'development' && VERCEL !== '1'`).
- **Authenticated Encryption (AES-256-GCM)**: Sensitive raw transaction references are encrypted at rest using authenticated AES-256-GCM encryption (`v1:<iv>:<tag>:<ciphertext>`).

### 4. Local Server-Side OCR (Tesseract.js) & Preprocessing
- **100% Local & Code-Only**: Zero external AI APIs, LLMs, or cloud OCR services. Runs entirely within the serverless execution environment.
- **Multi-Variant Sharp Preprocessing**: Generates in-memory candidates (grayscale, contrast-enhanced, sharpened/upscaled) without writing temporary files to disk.
- **Candidate Scoring Engine**:
  - **Payment Reference**: Labels scored by proximity (`UTR`, `RRN`, `UPI Ref`, `Bank Reference`). 12-digit numeric sequences prioritized.
  - **Amount**: Proximity scoring near "Paid", "Amount", "Sent", "Total" with INR / ₹ symbol parsing.
  - **Payment Status**: Explicit status priority (`FAILED` > `PENDING` > `SUCCESS`).
  - **Transaction Timestamp**: Indian receipt formats parsed in `Asia/Kolkata` time zone and checked against the 5-minute booking window.
  - **Payee & App Detection**: Checks recipient UPI ID against `PAYEE_UPI_ID` and identifies app signatures (PhonePe, Google Pay, Paytm, FamPay).
  - **AI Generator Watermark Detection**: Checks for explicit generator watermarks (`Generated with AI`, `ChatGPT`, `OpenAI`, `DALL-E`, `Midjourney`, `Adobe Firefly`, `Generated with Gemini`) while allowing normal app branding (`Google Pay`).

### 5. Fail-Closed Deterministic Decision Engine & Reason Codes
Every automated verification must satisfy all mandatory signals before coupon issuance:
- Readable text from OCR (`OCR_UNREADABLE` if unreadable)
- `paymentStatus === "success"`
- Extracted reference matches entered UTR (`TRANSACTION_REFERENCE_MISMATCH` if disparate)
- Extracted amount matches booking `total_amount_paise` (`AMOUNT_MISMATCH` if disparate)
- No duplicate UTR across confirmed bookings (`DUPLICATE_TRANSACTION_REFERENCE`)
- No duplicate screenshot SHA across confirmed bookings (`DUPLICATE_SCREENSHOT`)
- Payee VPA must not be a different account (`WRONG_PAYEE`)
- No explicit AI generator watermark (`AI_GENERATOR_WATERMARK`)
- All 18 exact reason codes supported:
  - `INVALID_SCREENSHOT_FORMAT`
  - `OCR_UNREADABLE`
  - `OCR_PROCESSING_ERROR`
  - `MISSING_TRANSACTION_REFERENCE`
  - `REFERENCE_NOT_READABLE`
  - `TRANSACTION_REFERENCE_MISMATCH`
  - `INVALID_TRANSACTION_REFERENCE`
  - `DUPLICATE_TRANSACTION_REFERENCE`
  - `MISSING_AMOUNT`
  - `AMOUNT_MISMATCH`
  - `STATUS_NOT_SUCCESS`
  - `DUPLICATE_SCREENSHOT`
  - `WRONG_PAYEE`
  - `TRANSACTION_TIME_MISMATCH`
  - `AI_GENERATOR_WATERMARK`
  - `SUSPICIOUS_FILENAME`
  - `SCREENSHOT_SECURITY_RISK`
  - `PAYMENT_SESSION_EXPIRED`

### 6. Atomic Instant Finalizer & Concurrency Safety
- **Instant Automatic Finalization**: Verification pass immediately finalizes the booking without human intervention.
- **Database Transaction & Concurrency Safety**:
  - Locks booking and payment submission rows (`FOR UPDATE`).
  - Idempotent: safe against double-clicks and network retries.
  - Partial unique index on confirmed reference hashes prevents race conditions.
  - Generates exact quantity of coupons paid for with sequential numbers (`YSYS-2026-XXXXXX`).
  - Updates booking to authoritative completed status: `payment_confirmed`.
- **Retry Endpoint**: `POST /api/bookings/:publicId/retry-verification` allows rerunning verification on already-stored proofs without requiring duplicate payment.

### 7. Admin Portal (`/admin`)
- **Monitoring Only**: No manual payment approval or confirmation in the normal flow.
- **Genuine Issued Coupons**: Registry of genuine issued coupons with download links.
- **Verification & Audit Logs**: Detailed audit records showing entered UTR (masked), OCR reference (masked), OCR amount, status, timestamp, original filename, and signed screenshot preview.
- **Payment Settings**: Admin can configure payee UPI ID, business name, coupon price, and maximum quantity. Payment session duration is strictly locked to **5 Minutes — Security Rule**.

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
