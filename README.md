# 🎟️ Yuva Shakti Youth Satulur - Lucky Draw Portal (Production Edition)

An official, enterprise-grade event coupon booking portal for **Yuva Shakti Youth Satulur**. Built with **React 19**, **Vite 6**, **TypeScript**, **Tailwind CSS**, **Express 4**, **PostgreSQL / Supabase**, and **VyaparGateway UPI**.

---

## 📌 Event Overview

- **Event**: Yuva Shakti Youth Lucky Draw
- **1st Prize**: 🏆 **20 KG Maha Laddu**
- **Coupon Price**: **₹50 per ticket** (stored server-side as `5000` paise)
- **Series Available**: Serial numbers allocated atomically upon confirmed payment
- **Location**: Satulur Center, Guntur District, Andhra Pradesh
- **Helpline**: +91 95748 76369
- **Timezone**: `Asia/Kolkata`

---

## 🏗️ Architecture & Core Upgrades

### 1. Payment Gateway: VyaparGateway (`vyapargateway.com`)
- **Complete Razorpay Removal**: Razorpay SDK, scripts, routes, and credentials have been completely eradicated.
- **Provider Abstraction**: Decoupled `PaymentProvider` interface supporting `VyaparGatewayProvider` and `MockPaymentProvider` (forbidden in production).
- **Dynamic UPI QR & Intent**: Desktop displays dynamic UPI QR code with live polling; mobile devices render direct UPI Intent buttons (`upi://pay?...`).
- **Signed HMAC SHA-256 Webhooks**: Registered at `POST /api/payments/vyapar-gateway/webhook` using raw request bytes, 5-minute timestamp tolerance, and constant-time signature verification.

### 2. Concurrency-Safe Database Persistence (PostgreSQL / Supabase)
- **Single Source of Truth**: All bookings, payment attempts, issued coupons, and audit logs persist in PostgreSQL (with Supabase RLS policies).
- **Atomic Serial Allocation**: Coupon numbers (e.g. `YSYS-2026-000001`) are allocated inside isolated database transactions (`SERIALIZABLE` / `coupon_serial_seq`).
- **Idempotency & Replay Defense**: Replayed or duplicate webhooks create **zero** extra coupons. Failed or pending payments receive no serial numbers.

### 3. Server-Side Ticket PDF & Verification
- **High-Resolution Vector PDF**: Rendered server-side using `pdf-lib` incorporating the official Lord Ganesha emblem (`logo.jpeg`), gold foil borders, and dynamic QR codes.
- **Privacy & PII Protection**: Phone numbers are masked (`XXXXXX1234`) on public verification passes.
- **Bulk Downloads**: Multi-ticket bookings can be downloaded as a combined multi-page pass or as a ZIP archive of individual tickets.

### 4. Secure Admin Panel (`/admin`)
- **Strictly Confirmed Coupons**: The main **Applied Coupons** list fetches exclusively genuine, successfully paid bookings (`payment_confirmed` + `valid`). No fixtures, mock records, pending attempts, or simulator rows appear there.
- **Metrics Dashboard**: Live KPIs including Confirmed Bookings, Total Valid Coupons, Confirmed Revenue, Today's Bookings, and Diagnostics.
- **CSV Export**: Includes formula injection sanitization (stripping leading `=`, `+`, `-`, `@`).
- **Authentication**: Bcrypt password hashing, rate-limited login attempts, HTTP-only secure cookie sessions, and Bearer token fallback.

### 5. Go-Live Legal Gate
Payments and bookings remain fail-closed until legal confirmation is enabled via environment variables:
- `BOOKING_OPEN=true`
- `PAYMENTS_ENABLED=true`
- `LEGAL_APPROVAL_CONFIRMED=true`

---

## 📁 Repository Structure

```text
├── migrations/
│   └── 001_init_schema.sql           # Complete PostgreSQL DDL schema & constraints
├── server/
│   ├── admin/
│   │   ├── auth.ts                   # Admin bcrypt auth, rate limiting & session management
│   │   └── routes.ts                 # Protected admin APIs (metrics, coupons list, CSV export)
│   ├── config/
│   │   └── eventConfig.ts            # Zod-validated environment config & legal go-live gate
│   ├── db/
│   │   └── client.ts                 # PostgreSQL connection pool & transactional memory store
│   ├── payments/
│   │   ├── provider.ts               # PaymentProvider interface
│   │   ├── vyaparGateway.ts          # VyaparGateway API integration & HMAC webhook verification
│   │   ├── mockProvider.ts           # Development-only mock provider (forbidden in production)
│   │   └── index.ts                  # Provider factory
│   └── services/
│       ├── couponAllocator.ts        # Atomic, concurrency-safe coupon number generator
│       └── ticketRenderer.ts         # High-res PDF pass generator & ZIP archiver
├── scripts/
│   └── seed-admin.ts                 # Admin bootstrap script
├── tests/
│   ├── booking-and-pricing.test.ts   # Pricing & quantity validation tests
│   ├── payments-and-webhooks.test.ts # Webhook signature, timestamp tolerance & payment tests
│   ├── coupon-allocation-and-pdf.test.ts # PDF rendering, ZIP archive & PII masking tests
│   └── admin.test.ts                 # Admin auth, confirmed-only filtering & CSV export tests
├── src/
│   ├── components/
│   │   ├── admin/
│   │   │   ├── AdminLogin.tsx        # Secure admin login interface
│   │   │   └── AdminDashboard.tsx    # Admin KPI metrics, applied coupons table & export
│   │   ├── BookingModal.tsx          # Dynamic QR & UPI Intent checkout modal
│   │   ├── TicketModal.tsx           # Multi-ticket preview & PDF/ZIP download dialog
│   │   ├── CouponVerifier.tsx        # Real-time verification with PII masking
│   │   └── ...                       # Public UI components (Navbar, Hero, Prize, etc.)
│   └── App.tsx                       # Main router with public portal & /admin route
├── server.ts                         # Main Express server & API endpoints
└── package.json                      # Dependencies & NPM scripts
```

---

## 🚀 Quickstart & Local Development

### Prerequisites
- Node.js 18+ (tested on Node 20 & 24)
- npm or yarn

### 1. Installation
```bash
npm install
```

### 2. Configuration (`.env`)
Copy the template configuration:
```bash
cp .env.example .env
```

Key environment variables:
```env
# Server
NODE_ENV=development
PORT=3000
APP_URL=http://localhost:3000
SESSION_SECRET=replace_with_a_secure_random_64_character_hex_secret

# Database (Leave blank to use the built-in isolated in-memory transactional store)
DATABASE_URL=
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=

# Payments
PAYMENT_PROVIDER=vyapar_gateway
PAYMENT_MODE=test
VYAPAR_GATEWAY_BASE_URL=https://vyapargateway.com/api/v1/
VYAPAR_GATEWAY_API_KEY=
VYAPAR_GATEWAY_WEBHOOK_SECRET=
VYAPAR_GATEWAY_MERCHANT_ID=

# Go-Live Controls
BOOKING_OPEN=true
PAYMENTS_ENABLED=false
LEGAL_APPROVAL_CONFIRMED=false
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
- Public Portal: [http://localhost:3000](http://localhost:3000)
- Admin Portal: [http://localhost:3000/admin](http://localhost:3000/admin)

---

## 🧪 Testing & Build Verification

The repository includes a comprehensive automated test suite covering booking logic, pricing, HMAC webhook signatures, timestamp tolerances, replay prevention, PDF ticket generation, and admin security.

### Run Automated Tests
```bash
npm test
```
*Outputs:*
```text
Test Files  4 passed (4)
     Tests  18 passed (18)
```

### Run Type Checking & Build
```bash
npm run lint
npm run build
```

---

## 🗄️ Database Setup & Migration Instructions

To connect to a live **PostgreSQL** or **Supabase** instance:

1. Open your database console or Supabase SQL Editor.
2. Execute the migration script located at `migrations/001_init_schema.sql`.
3. Set `DATABASE_URL` in your `.env`:
   ```env
   DATABASE_URL="postgresql://postgres:[PASSWORD]@db.[REF].supabase.co:5432/postgres"
   ```
4. Run `npm run seed:admin` to create your initial administrator account.

---

## 💳 VyaparGateway Webhook Registration

In your [VyaparGateway Merchant Dashboard](https://vyapargateway.com):

1. Navigate to **Developer Settings** -> **Webhooks**.
2. Set the Webhook URL to:
   ```text
   https://[YOUR_PRODUCTION_DOMAIN]/api/payments/vyapar-gateway/webhook
   ```
3. Copy your **API Key** and **Webhook Secret** into `.env`:
   ```env
   VYAPAR_GATEWAY_API_KEY=your_live_api_key
   VYAPAR_GATEWAY_WEBHOOK_SECRET=your_live_webhook_secret
   VYAPAR_GATEWAY_MERCHANT_ID=your_merchant_id
   ```
4. Set `PAYMENT_MODE=live` when ready for production.

---

## 🛡️ Production Go-Live Checklist

Before accepting real public payments:
1. [ ] Confirm legal and entertainment-lottery permissions for Andhra Pradesh.
2. [ ] Enter `LOTTERY_LICENCE_NUMBER` and `LOTTERY_LICENCE_DATE` in `.env` if applicable.
3. [ ] Set `LEGAL_APPROVAL_CONFIRMED=true` in `.env`.
4. [ ] Set `PAYMENTS_ENABLED=true` in `.env`.
5. [ ] Ensure `PAYMENT_MODE=live` and `PAYMENT_PROVIDER=vyapar_gateway`.
6. [ ] Seed production admin with a strong custom password (`ADMIN_PASSWORD=... npm run seed:admin`).
7. [ ] Confirm the webhook URL is registered in VyaparGateway merchant dashboard.

---

## 📞 Support & Contacts

Organized by **Yuva Shakti Youth, Satulur**  
- **Helpline**: +91 95748 76369  
- **Venue**: Satulur Center, Guntur District, Andhra Pradesh
