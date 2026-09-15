import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import crypto from 'crypto';
import { app } from '../server/app.ts';
import { db } from '../server/db/client.ts';
import { createAdminSession } from '../server/admin/auth.ts';

describe('Coupon Download Authorization Security Tests (Section 26)', () => {
  let bookingA: any;
  let downloadTokenA: string;
  let statusTokenA: string;
  let couponA: any;

  let bookingB: any;
  let downloadTokenB: string;
  let couponB: any;

  let bookingC: any;
  let downloadTokenC: string;
  let couponC: any;

  let bookingD: any;
  let downloadTokenD: string;
  let couponD1: any;
  let couponD2: any;

  let adminSessionToken: string;

  beforeAll(async () => {
    // 1. Create Booking A (Confirmed, 1 Coupon)
    const bAId = crypto.randomUUID();
    const bAPublicId = `BK-TEST-AUTH-A-${Date.now().toString().slice(-6)}`;
    downloadTokenA = crypto.randomBytes(24).toString('hex');
    const downloadTokenHashA = crypto.createHash('sha256').update(downloadTokenA).digest('hex');
    statusTokenA = crypto.randomBytes(24).toString('hex');
    const statusTokenHashA = crypto.createHash('sha256').update(statusTokenA).digest('hex');

    const bARes = await db.query(
      `INSERT INTO bookings (
        id, public_id, participant_name, phone, village, quantity,
        total_amount_paise, status, download_token_hash, status_token_hash, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), NOW()) RETURNING *`,
      [bAId, bAPublicId, 'Customer A', '9876543210', 'Satulur', 1, 5000, 'proof_verified', downloadTokenHashA, statusTokenHashA]
    );
    bookingA = bARes.rows[0];

    // Issue Coupon A (Serial in safe mock range 2101)
    const cAId = crypto.randomUUID();
    const cARes = await db.query(
      `INSERT INTO coupons (
        id, booking_id, serial, coupon_number, holder_name, phone, village,
        status, template_version, ticket_index, total_quantity, issued_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW())
      ON CONFLICT (serial) DO UPDATE SET holder_name = EXCLUDED.holder_name
      RETURNING *`,
      [cAId, bAId, 2101, '2101', 'Customer A', '9876543210', 'Satulur', 'valid', 'official-editable-docx-v1', 1, 1]
    );
    couponA = cARes.rows[0];

    // 2. Create Booking B (Confirmed, 1 Coupon - for cross-booking tests)
    const bBId = crypto.randomUUID();
    const bBPublicId = `BK-TEST-AUTH-B-${Date.now().toString().slice(-6)}`;
    downloadTokenB = crypto.randomBytes(24).toString('hex');
    const downloadTokenHashB = crypto.createHash('sha256').update(downloadTokenB).digest('hex');

    const bBRes = await db.query(
      `INSERT INTO bookings (
        id, public_id, participant_name, phone, village, quantity,
        total_amount_paise, status, download_token_hash, status_token_hash, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), NOW()) RETURNING *`,
      [bBId, bBPublicId, 'Customer B', '9123456780', 'Satulur', 1, 5000, 'proof_verified', downloadTokenHashB, null]
    );
    bookingB = bBRes.rows[0];

    const cBId = crypto.randomUUID();
    const cBRes = await db.query(
      `INSERT INTO coupons (
        id, booking_id, serial, coupon_number, holder_name, phone, village,
        status, template_version, ticket_index, total_quantity, issued_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW())
      ON CONFLICT (serial) DO UPDATE SET holder_name = EXCLUDED.holder_name
      RETURNING *`,
      [cBId, bBId, 2102, '2102', 'Customer B', '9123456780', 'Satulur', 'valid', 'official-editable-docx-v1', 1, 1]
    );
    couponB = cBRes.rows[0];

    // 3. Create Booking C (Unverified / Payment Pending)
    const bCId = crypto.randomUUID();
    const bCPublicId = `BK-TEST-AUTH-C-${Date.now().toString().slice(-6)}`;
    downloadTokenC = crypto.randomBytes(24).toString('hex');
    const downloadTokenHashC = crypto.createHash('sha256').update(downloadTokenC).digest('hex');

    const bCRes = await db.query(
      `INSERT INTO bookings (
        id, public_id, participant_name, phone, village, quantity,
        total_amount_paise, status, download_token_hash, status_token_hash, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), NOW()) RETURNING *`,
      [bCId, bCPublicId, 'Customer C', '9998887776', 'Satulur', 1, 5000, 'payment_initiated', downloadTokenHashC, null]
    );
    bookingC = bCRes.rows[0];

    const cCId = crypto.randomUUID();
    const cCRes = await db.query(
      `INSERT INTO coupons (
        id, booking_id, serial, coupon_number, holder_name, phone, village,
        status, template_version, ticket_index, total_quantity, issued_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW())
      ON CONFLICT (serial) DO UPDATE SET holder_name = EXCLUDED.holder_name
      RETURNING *`,
      [cCId, bCId, 2103, '2103', 'Customer C', '9998887776', 'Satulur', 'unclaimed', 'official-editable-docx-v1', 1, 1]
    );
    couponC = cCRes.rows[0];

    // 4. Create Booking D (Confirmed, Multi-Coupon: 2 coupons)
    const bDId = crypto.randomUUID();
    const bDPublicId = `BK-TEST-AUTH-D-${Date.now().toString().slice(-6)}`;
    downloadTokenD = crypto.randomBytes(24).toString('hex');
    const downloadTokenHashD = crypto.createHash('sha256').update(downloadTokenD).digest('hex');

    const bDRes = await db.query(
      `INSERT INTO bookings (
        id, public_id, participant_name, phone, village, quantity,
        total_amount_paise, status, download_token_hash, status_token_hash, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), NOW()) RETURNING *`,
      [bDId, bDPublicId, 'Customer D Multi', '9440011223', 'Satulur', 2, 10000, 'proof_verified', downloadTokenHashD, null]
    );
    bookingD = bDRes.rows[0];

    const cD1Res = await db.query(
      `INSERT INTO coupons (
        id, booking_id, serial, coupon_number, holder_name, phone, village,
        status, template_version, ticket_index, total_quantity, issued_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW())
      ON CONFLICT (serial) DO UPDATE SET holder_name = EXCLUDED.holder_name
      RETURNING *`,
      [crypto.randomUUID(), bDId, 2104, '2104', 'Customer D Multi', '9440011223', 'Satulur', 'valid', 'official-editable-docx-v1', 1, 2]
    );
    couponD1 = cD1Res.rows[0];

    const cD2Res = await db.query(
      `INSERT INTO coupons (
        id, booking_id, serial, coupon_number, holder_name, phone, village,
        status, template_version, ticket_index, total_quantity, issued_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW())
      ON CONFLICT (serial) DO UPDATE SET holder_name = EXCLUDED.holder_name
      RETURNING *`,
      [crypto.randomUUID(), bDId, 2105, '2105', 'Customer D Multi', '9440011223', 'Satulur', 'valid', 'official-editable-docx-v1', 2, 2]
    );
    couponD2 = cD2Res.rows[0];

    // 5. Create valid Admin session
    adminSessionToken = createAdminSession({
      id: 'admin_test_user_id',
      email: 'admin@yuvaluckydraw.org',
      role: 'super_admin',
    });
  });

  // TEST 1: confirmed booking + correct downloadToken -> PDF 200
  it('TEST 1: confirmed booking + correct downloadToken returns PDF 200 with valid binary', async () => {
    const res = await request(app)
      .get(`/api/coupons/${couponA.coupon_number}/download?format=pdf`)
      .set('Authorization', `Bearer ${downloadTokenA}`);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('application/pdf');
    expect(res.headers['content-disposition']).toContain(`${couponA.coupon_number}.pdf`);
    expect(res.body.subarray(0, 5).toString()).toBe('%PDF-');
  });

  // TEST 2: confirmed booking + correct downloadToken -> PNG 200
  it('TEST 2: confirmed booking + correct downloadToken returns PNG 200', async () => {
    const res = await request(app)
      .get(`/api/coupons/${couponA.coupon_number}/download?format=png`)
      .set('Authorization', `Bearer ${downloadTokenA}`);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('image/png');
    expect(res.headers['content-disposition']).toContain(`${couponA.coupon_number}.png`);
    // PNG magic number
    expect(res.body[0]).toBe(0x89);
    expect(res.body[1]).toBe(0x50);
  });

  // TEST 3: confirmed booking + correct downloadToken -> JPEG 200
  it('TEST 3: confirmed booking + correct downloadToken returns JPEG 200', async () => {
    const res = await request(app)
      .get(`/api/coupons/${couponA.coupon_number}/download?format=jpeg`)
      .set('Authorization', `Bearer ${downloadTokenA}`);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('image/jpeg');
    expect(res.headers['content-disposition']).toContain(`${couponA.coupon_number}.jpg`);
    // JPEG magic number
    expect(res.body[0]).toBe(0xff);
    expect(res.body[1]).toBe(0xd8);
  });

  // TEST 4: confirmed booking + correct downloadToken -> download-all 200
  it('TEST 4: confirmed booking + correct downloadToken returns download-all 200', async () => {
    const res = await request(app)
      .get(`/api/bookings/${bookingA.public_id}/download-all`)
      .set('Authorization', `Bearer ${downloadTokenA}`);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('application/pdf');
    expect(res.body.subarray(0, 5).toString()).toBe('%PDF-');
  });

  // TEST 5: missing token -> 401
  it('TEST 5: missing token returns 401 Unauthorized', async () => {
    const res = await request(app)
      .get(`/api/coupons/${couponA.coupon_number}/download?format=pdf`);

    expect(res.status).toBe(401);
    expect(res.text).toContain('Unauthorized');
  });

  // TEST 6: wrong token -> 401
  it('TEST 6: wrong token returns 401 Unauthorized', async () => {
    const res = await request(app)
      .get(`/api/coupons/${couponA.coupon_number}/download?format=pdf`)
      .set('Authorization', 'Bearer wrong_random_token_123456');

    expect(res.status).toBe(401);
    expect(res.text).toContain('Unauthorized');
  });

  // TEST 7: Booking A token used against Booking B coupon -> 401
  it('TEST 7: Booking A token used against Booking B coupon returns 401 Unauthorized', async () => {
    const res = await request(app)
      .get(`/api/coupons/${couponB.coupon_number}/download?format=pdf`)
      .set('Authorization', `Bearer ${downloadTokenA}`);

    expect(res.status).toBe(401);
    expect(res.text).toContain('Unauthorized');
  });

  // TEST 8: admin session -> download allowed (200)
  it('TEST 8: admin session cookie authorizes download without customer token', async () => {
    const res = await request(app)
      .get(`/api/coupons/${couponA.coupon_number}/download?format=pdf`)
      .set('Cookie', [`admin_session=${adminSessionToken}`]);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('application/pdf');
    expect(res.body.subarray(0, 5).toString()).toBe('%PDF-');
  });

  // TEST 9: unverified booking -> 403
  it('TEST 9: unverified booking returns 403 Forbidden even with download token', async () => {
    const res = await request(app)
      .get(`/api/coupons/${couponC.coupon_number}/download?format=pdf`)
      .set('Authorization', `Bearer ${downloadTokenC}`);

    expect(res.status).toBe(403);
    expect(res.text).toContain('payment proof is verified');
  });

  // TEST 10: statusToken compatibility if intentionally retained -> allowed (200)
  it('TEST 10: statusToken allows download as backward-compatible fallback', async () => {
    const res = await request(app)
      .get(`/api/coupons/${couponA.coupon_number}/download?format=pdf`)
      .set('Authorization', `Bearer ${statusTokenA}`);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('application/pdf');
    expect(res.body.subarray(0, 5).toString()).toBe('%PDF-');
  });

  // TEST 11: public verify route remains accessible without download token
  it('TEST 11: public verify route remains accessible without token and never leaks secrets', async () => {
    const res = await request(app)
      .get(`/api/coupons/${couponA.coupon_number}/verify`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.couponNumber).toBe(couponA.coupon_number);
    expect(res.body.data.participantName).toBe('Customer A');
    // Masked phone check
    expect(res.body.data.maskedPhone).toContain('XXXXXX');
    // Secrets must NOT be returned
    expect(res.body.data.downloadToken).toBeUndefined();
    expect(res.body.data.statusToken).toBeUndefined();
    expect(res.body.data.download_token_hash).toBeUndefined();
  });

  // TEST 12: private raster/full coupon artifact cannot bypass auth
  it('TEST 12: private raster route rejects unauthorized requests (401) and allows authorized (200)', async () => {
    // Without token -> 401
    const unauthRes = await request(app)
      .get(`/api/coupons/${couponA.coupon_number}/raster`);
    expect(unauthRes.status).toBe(401);

    // With token -> 200
    const authRes = await request(app)
      .get(`/api/coupons/${couponA.coupon_number}/raster`)
      .set('Authorization', `Bearer ${downloadTokenA}`);
    expect(authRes.status).toBe(200);
    expect(authRes.headers['content-type']).toContain('image/png');
  });

  // TEST 13: successful verification -> immediate DOCX download works
  it('TEST 13: DOCX format download works with downloadToken and returns valid docx document', async () => {
    const res = await request(app)
      .get(`/api/coupons/${couponA.coupon_number}/download?format=docx`)
      .set('Authorization', `Bearer ${downloadTokenA}`)
      .buffer(true)
      .parse((res, callback) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
        res.on('end', () => callback(null, Buffer.concat(chunks)));
      });

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    expect(res.headers['content-disposition']).toContain(`${couponA.coupon_number}.docx`);
    expect(Buffer.isBuffer(res.body)).toBe(true);
    // Zip/docx magic bytes: PK (0x50, 0x4B)
    expect(res.body[0]).toBe(0x50);
    expect(res.body[1]).toBe(0x4b);
  });

  // TEST 14: query parameter token fallback works (?token=<downloadToken>)
  it('TEST 14: query parameter ?token=<downloadToken> works as safe transport fallback', async () => {
    const res = await request(app)
      .get(`/api/coupons/${couponA.coupon_number}/download?format=pdf&token=${downloadTokenA}`);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('application/pdf');
    expect(res.body.subarray(0, 5).toString()).toBe('%PDF-');
  });

  // TEST 15: successful multi-coupon booking -> Download All works for all coupons
  it('TEST 15: multi-coupon booking authorizes download of each individual coupon and combined package', async () => {
    // Coupon D1 with downloadTokenD -> 200
    const resD1 = await request(app)
      .get(`/api/coupons/${couponD1.coupon_number}/download?format=pdf`)
      .set('Authorization', `Bearer ${downloadTokenD}`);
    expect(resD1.status).toBe(200);

    // Coupon D2 with downloadTokenD -> 200
    const resD2 = await request(app)
      .get(`/api/coupons/${couponD2.coupon_number}/download?format=pdf`)
      .set('Authorization', `Bearer ${downloadTokenD}`);
    expect(resD2.status).toBe(200);

    // Download-all package with downloadTokenD -> 200
    const resAll = await request(app)
      .get(`/api/bookings/${bookingD.public_id}/download-all`)
      .set('Authorization', `Bearer ${downloadTokenD}`);
    expect(resAll.status).toBe(200);
    expect(resAll.headers['content-disposition']).toContain(`YuvaShakti-${bookingD.public_id}`);
  });
});
