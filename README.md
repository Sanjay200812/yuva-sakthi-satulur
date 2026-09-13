# 🎟️ Yuva Shakti Youth Satulur - Lucky Draw Portal (Direct Merchant-UPI & Automated Proof Verification)

An official, production-grade event coupon booking portal for **Yuva Shakti Youth Satulur**. Built with **React 19**, **Vite 6**, **TypeScript**, **Tailwind CSS**, **Express 4**, **PostgreSQL / Supabase**, and a **Direct Merchant-UPI Collection with 100% Automated Proof Verification Engine** powered by Google Gemini and deterministic matching rules.

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

### 1. Direct Merchant-UPI Collection Workflow
- **Complete Legacy Gateway Removal**: Razorpay, VyaparGateway, and all old third-party hosted payment gateways, SDKs, scripts, and webhook endpoints have been completely removed.
- **Server-Generated Payment Sessions**: When a participant books coupons, the server validates input and calculates the exact amount at ₹50/ticket. It generates a unique booking public ID, payment reference, and expiring session (default: 20 minutes).
- **Canonical NPCI UPI URI**: The backend builds a canonical `upi://pay` URI conforming strictly to NPCI standards with URL-encoded parameters:
  - Payee VPA (`pa`): `PAYEE_UPI_ID` (e.g. `9574876369@ybl`)
  - Payee Display Name (`pn`): `PAYEE_DISPLAY_NAME`
  - Transaction Reference (`tr`): Server-generated unique reference (e.g. `YSYS-...`)
  - Transaction Note (`tn`): `YSYS Lucky Draw Entry`
  - Amount (`am`): Exact calculated amount (e.g. `50.00` or `100.00`)
  - Currency (`cu`): `INR`
- **Dynamic QR Code**: Rendered server-side using `qrcode` with high error correction and returned directly to the client.
- **Deep Intent App Launch**: Mobile users can launch PhonePe, Google Pay, Paytm, or FamApp via official universal links / intents (`upi://pay`), with an automatic chooser fallback and desktop QR display.

### 2. Mandatory UTR & Payment Screenshot Proof
- **Payer Proof Submission**: After making the payment in their external UPI app, the user submits:
  1. **Mandatory UTR / RRN**: Payer-entered 12-digit reference number.
  2. **Mandatory Payment Screenshot**: High-resolution receipt image (PNG, JPEG, WebP, max 5MB).
  3. **Explicit Consent**: Consent checkbox agreeing to automated image processing for verification.
- **Security & Image Sanitization**:
  - Validates file magic bytes (stripping non-raster/executable files).
  - Decompresses and re-encodes image via `sharp` to strip all EXIF metadata and hidden payloads.
  - Generates SHA-256 and perceptual difference hash (dHash) to detect identical or visually near-duplicate screenshots.
  - Stores sanitized proof in private object storage (`payment-proofs`). Never exposes permanent public URLs.

### 3. Gemini-Assisted OCR & Tampering Risk Analysis
- **Server-Side GenAI Client**: Uses the official Google GenAI SDK (`@google/genai`) strictly on the server (`GEMINI_API_KEY` is never exposed to the browser).
- **Strict Structured JSON Schema**: Extracts key visible fields without hallucination:
  - `looks_like_payment_screen`: boolean
  - `visible_payment_status`: `success` | `pending` | `failed` | `unknown`
  - `app_name`: `phonepe` | `google_pay` | `paytm` | `fam` | `other` | `unknown`
  - `amount`: string
  - `currency`: `INR`
  - `utr_or_rrn`: string
  - `payee_name`: string | null
  - `payee_upi_id`: string | null
  - `obvious_editing_signals`: array of strings
  - `ai_generated_likelihood`: `low` | `medium` | `high` | `unknown`
  - `field_confidence`: per-field confidence scores (0.0 to 1.0)
- **Privacy Controls**: Direct image bytes are processed with `store: false` to ensure sensitive payment data is not retained in model training datasets.
- > [!IMPORTANT]
  > **Non-Authoritative Role**: Gemini is an advisory OCR and tampering detection signal. Automated proof verification does **NOT** constitute authoritative bank settlement. Screenshots can be fabricated or manipulated; verification confirms visible proof matching and risk absence under residual fraud risk.

### 4. Server-Side Deterministic Comparison Engine
Before accepting any proof, server code evaluates deterministic criteria:
- **Normalized UTR Match**: Payer-entered UTR matches Gemini-extracted UTR exactly.
- **Exact Amount Match**: Extracted amount matches expected booking total in paise.
- **Payee Match**: Matches configured merchant UPI ID or name when visible.
- **Visible Status Check**: Transaction must visibly state `success`.
- **Duplicate UTR Prevention**: Rejects UTR if already associated with another verified submission.
- **Duplicate Screenshot Prevention**: Rejects identical SHA-256 or perceptually identical dHash images across different bookings.
- **Confidence & Risk Thresholds**: All required fields must exceed confidence threshold (>= 0.70), `ai_generated_likelihood` must be `low`, and zero tampering signals must be detected.
- **Fail-Closed Policy**: If any check fails, status becomes `verification_failed` with specific reason codes (e.g. `UTR_MISMATCH`, `AMOUNT_MISMATCH`, `DUPLICATE_UTR`, `TAMPERING_RISK`). The user can review the issue and resubmit proof.

### 5. 100% Automated Finalization & Atomic Coupon Allocation
- **NO Admin Verification Step**: Per the organizer's strict requirement, there is **no manual payment approval queue, bank reconciliation button, or confirm/reject action**.
- **Atomic Database Transaction**: When all deterministic checks pass, `finalizeVerifiedSubmission` executes inside an isolated transaction:
  1. Locks the booking and payment submission (`FOR UPDATE`).
  2. Enforces partial unique constraint on `payer_utr_hash`.
  3. Transitions statuses to `proof_verified`.
  4. Concurrently allocates sequential coupon numbers: `YSYS-2026-000001`, `YSYS-2026-000002`, etc.
  5. Inserts coupon records and system audit event.
  6. Unlocks multi-format coupon download for the customer.

### 6. Multi-Format Personalized Ticket Generation (PDF, PNG, JPEG)
- **Authoritative Assets Preserved**:
  - Official Logo: `src/assets/logo.jpeg`
  - Official Coupon Template: `public/coupon-template.png`
- **Universal Coordinate Mapping**: Field coordinates, fonts, and dimensions are maintained in `server/services/ticketRenderer.ts` ensuring pixel-identical alignment across all formats.
- **Supported Formats**:
  - **PDF**: Vector-sharp printable pass rendered via `pdf-lib` with embedded fonts, official logo, and dynamic verification QR code.
  - **PNG**: Lossless, high-resolution raster pass rendered via `sharp`.
  - **JPEG**: Crisp, 95-quality sRGB image for mobile saving and sharing.
  - **ZIP Archive**: Multi-coupon purchases can be downloaded at once as a single ZIP bundle containing all tickets in PDF, PNG, and JPEG formats.
- **Multilingual Support**: Supports both English and Telugu participant names and village names.

### 7. Secure Admin Portal (`/admin`)
- **Strictly Verified Coupons Only**: The primary **Applied Coupons** table queries exclusively bookings with status `proof_verified` and coupons with status `valid`. Fixtures, mock records, pending attempts, and failed verification attempts are strictly excluded.
- **Read-Only Payment Diagnostics**: Diagnostic tab providing complete operational transparency: view submission attempts, extracted OCR text, deterministic comparison logs, reason codes, and short-lived signed screenshot URLs for security audits. No manual approval buttons exist.
- **Live Metrics**: Automatically verified bookings, valid coupons issued, accepted-proof revenue, and daily totals.
- **Security Hardening**: Argon2id/bcrypt password hashing, rate-limited login attempts, HTTP-only secure cookie sessions, CSRF headers, and CSV export protection against spreadsheet formula injection.

---

## 📁 Repository Structure

```text
├── migrations/
│   ├── 001_init_schema.sql           # Base PostgreSQL schema (bookings, coupons, admin tables)
│   └── 002_direct_upi_schema.sql     # Direct UPI submissions, verification runs & partial index
├── server/
│   ├── admin/
│   │   ├── auth.ts                   # Admin bcrypt auth, rate limiting & session management
│   │   └── routes.ts                 # Read-only admin APIs (metrics, verified coupons, diagnostics)
│   ├── config/
│   │   └── eventConfig.ts            # Zod-validated environment config & go-live gates
│   ├── db/
│   │   └── client.ts                 # PostgreSQL connection pool & transactional memory store
│   ├── upi/
│   │   ├── upiUri.ts                 # Canonical NPCI UPI URI and dynamic QR generation
│   │   ├── imageProcessor.ts         # Magic byte validation, EXIF stripping, SHA256 & dHash
│   │   ├── geminiAnalyzer.ts         # Google Gemini structured OCR & tampering analysis
│   │   ├── deterministicMatcher.ts   # Strict server comparison engine & fail-closed rules
│   │   └── automatedFinalizer.ts     # Concurrency-safe atomic transaction finalizer
│   └── services/
│       ├── couponAllocator.ts        # Atomic, concurrency-safe coupon number generator
│       └── ticketRenderer.ts         # Multi-format PDF, PNG, JPEG pass generator & ZIP archiver
├── scripts/
│   └── seed-admin.ts                 # Administrator bootstrap script
├── tests/
│   ├── booking-and-pricing.test.ts   # Pricing & quantity validation tests (5 tests)
│   ├── payments-and-webhooks.test.ts # Direct UPI URI, QR, OCR matcher, and security tests (9 tests)
│   ├── coupon-allocation-and-pdf.test.ts # PDF, PNG, JPEG rendering, ZIP & privacy tests (5 tests)
│   └── admin.test.ts                 # Admin auth, verified-only filtering & CSV export tests (8 tests)
├── src/
│   ├── components/
│   │   ├── admin/
│   │   │   ├── AdminLogin.tsx        # Secure admin login interface
│   │   │   └── AdminDashboard.tsx    # Admin KPI metrics, verified coupons table & diagnostics
│   │   ├── BookingModal.tsx          # Direct UPI QR, app chooser, UTR & screenshot proof upload
│   │   ├── TicketModal.tsx           # Multi-ticket preview & PDF/PNG/JPEG/ZIP download dialog
│   │   ├── CouponVerifier.tsx        # Real-time verification with PII masking
│   │   └── ...                       # Public UI components (Navbar, Hero, Prize, Countdown)
│   └── App.tsx                       # Main router with public portal & /admin route
├── server.ts                         # Main Express server & API endpoints
└── package.json                      # Dependencies & NPM scripts
```

---

## 🚀 Quickstart & Local Development

### Prerequisites
- Node.js 18+ (tested on Node 20 & 22)
- npm or yarn

### 1. Installation
```bash
npm install
```

### 2. Environment Configuration (`.env`)
Create a `.env` file from the template below:

```env
# Server & Runtime
NODE_ENV=development
PORT=3000
APP_URL=http://localhost:3000
SESSION_SECRET=a_very_strong_random_secret_at_least_32_characters_long

# Database (Leave blank to use the built-in isolated in-memory transactional store)
DATABASE_URL=
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=

# Direct Merchant-UPI Configuration
PAYMENT_MODE=direct_upi_automated_proof
PAYEE_UPI_ID=9574876369@ybl
PAYEE_DISPLAY_NAME=Yuva Shakti Youth Satulur
UPI_TRANSACTION_NOTE_PREFIX=YSYS
PAYMENT_SESSION_MINUTES=20
PAYMENT_SCREENSHOT_MAX_BYTES=5242880
PAYMENT_PROOF_BUCKET=payment-proofs
FIELD_ENCRYPTION_KEY=c9b68a3f81e9b2512a8848db92ea91bc310dc2e811c7fae98f0601931889c02b

# Google Gemini API Configuration (Server-Side Only)
GEMINI_API_KEY=your_gemini_api_key_here
GEMINI_MODEL=gemini-2.5-flash
GEMINI_STORE_INTERACTIONS=false

# Event Configuration
EVENT_NAME=Yuva Shakti Youth Satulur Lucky Draw
EVENT_ORGANIZER=Yuva Shakti Youth, Satulur
EVENT_PRIZE=20 KG Laddu
EVENT_VENUE=Satulur Center, Guntur District, Andhra Pradesh
EVENT_HELPLINE=+91 95748 76369
EVENT_DRAW_AT=2026-10-19T18:30:00+05:30
EVENT_TIMEZONE=Asia/Kolkata
EVENT_COUPON_PREFIX=YSYS
EVENT_COUPON_PRICE_PAISE=5000
EVENT_MAX_COUPONS_PER_BOOKING=20

# Go-Live Legal Gate (Fail closed by default in production)
BOOKING_OPEN=true
PAYMENTS_ENABLED=true
LEGAL_APPROVAL_CONFIRMED=true
LOTTERY_LICENCE_NUMBER=
LOTTERY_LICENCE_DATE=
```

### 3. Bootstrap Administrator Account
Run the admin bootstrap seed script:
```bash
npm run seed:admin
```
*Default local credentials:*
- **Email**: `admin@yuvashakti.org`
- **Password**: `YuvaShakti@Admin2026`

### 4. Run Development Server
```bash
npm run dev
```
Navigate to:
- **Public Portal**: [http://localhost:3000](http://localhost:3000)
- **Admin Portal**: [http://localhost:3000/admin](http://localhost:3000/admin)

---

## 🧪 Testing & Build Verification

The repository contains 27 automated tests across 4 test suites:
- `booking-and-pricing.test.ts`: Pricing calculations, multi-coupon limits, input validation.
- `payments-and-webhooks.test.ts`: Canonical NPCI URI generation, QR codes, deterministic matcher, duplicate detection, and legacy route removal.
- `coupon-allocation-and-pdf.test.ts`: PDF, PNG, and JPEG pass rendering, ZIP creation, PII phone masking.
- `admin.test.ts`: Authentication, rate limiting, verified-only coupon list filtering, formula injection defense.

```bash
# Run automated tests
npm test

# Run TypeScript type check
npm run lint

# Build client and server bundles
npm run build
```

---

## 🗄️ Database Setup & Supabase Migrations

To connect to a live **PostgreSQL** or **Supabase** instance:

1. Open the Supabase SQL Editor or your PostgreSQL management console.
2. Run `migrations/001_init_schema.sql` to create base tables, sequences, and RLS policies.
3. Run `migrations/002_direct_upi_schema.sql` to add Direct UPI submission tables, verification run logs, and the partial unique index on `payer_utr_hash`.
4. Configure `DATABASE_URL` in your production environment:
   ```env
   DATABASE_URL="postgresql://postgres:[PASSWORD]@db.[PROJECT-REF].supabase.co:5432/postgres"
   ```
5. Run `npm run seed:admin` to create your initial administrator account.

---

## 🛡️ Production Go-Live Checklist

Before opening public bookings and real UPI collections:
1. [ ] Confirm written permission/legal confirmation for Andhra Pradesh entertainment-lottery regulations.
2. [ ] Enter `LOTTERY_LICENCE_NUMBER` and `LOTTERY_LICENCE_DATE` in `.env` if required.
3. [ ] Verify that the payee UPI ID (`PAYEE_UPI_ID`) is a verified merchant account.
4. [ ] Set `LEGAL_APPROVAL_CONFIRMED=true` in production environment.
5. [ ] Set `PAYMENTS_ENABLED=true` and `BOOKING_OPEN=true`.
6. [ ] Seed production administrator with a strong custom password (`ADMIN_PASSWORD=... npm run seed:admin`).
7. [ ] Verify Google Gemini API quota and billing in Google Cloud Console.

---

## 📞 Support & Organizer Contact

Organized by **Yuva Shakti Youth, Satulur**  
- **Helpline**: +91 95748 76369  
- **Venue**: Satulur Center, Guntur District, Andhra Pradesh
