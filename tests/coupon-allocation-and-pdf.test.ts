import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { app } from '../server.ts';
import { renderTicketPdf, renderTicketRaster, createTicketsZipArchive } from '../server/services/ticketRenderer.ts';

describe('Phase 11: Coupon Allocation and Multi-Format Pass Rendering', () => {
  it('renders a valid, print-ready PDF pass buffer', async () => {
    const pdfBuf = await renderTicketPdf({
      couponNumber: 'YSYS-2026-000001',
      participantName: 'Sita Rama Rao',
      phone: '9574876369',
      village: 'Satulur Center',
      bookingPublicId: 'BK-100293',
      ticketIndex: 1,
      totalQuantity: 1,
    });

    expect(pdfBuf).toBeInstanceOf(Buffer);
    expect(pdfBuf.length).toBeGreaterThan(1000);
    // Standard PDF file signature is %PDF-
    expect(pdfBuf.subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('renders a valid, high-resolution PNG pass buffer', async () => {
    const pngBuf = await renderTicketRaster({
      couponNumber: 'YSYS-2026-000001',
      participantName: 'Sita Rama Rao',
      phone: '9574876369',
      village: 'Satulur Center',
      bookingPublicId: 'BK-100293',
      ticketIndex: 1,
      totalQuantity: 1,
    }, 'png');

    expect(pngBuf).toBeInstanceOf(Buffer);
    expect(pngBuf.length).toBeGreaterThan(1000);
    // Standard PNG magic bytes: 0x89 0x50 0x4E 0x47
    expect(pngBuf[0]).toBe(0x89);
    expect(pngBuf[1]).toBe(0x50);
    expect(pngBuf[2]).toBe(0x4e);
    expect(pngBuf[3]).toBe(0x47);
  });

  it('renders a valid, print-quality JPEG pass buffer', async () => {
    const jpgBuf = await renderTicketRaster({
      couponNumber: 'YSYS-2026-000001',
      participantName: 'Sita Rama Rao',
      phone: '9574876369',
      village: 'Satulur Center',
      bookingPublicId: 'BK-100293',
      ticketIndex: 1,
      totalQuantity: 1,
    }, 'jpeg');

    expect(jpgBuf).toBeInstanceOf(Buffer);
    expect(jpgBuf.length).toBeGreaterThan(1000);
    // Standard JPEG magic bytes: 0xFF 0xD8 0xFF
    expect(jpgBuf[0]).toBe(0xff);
    expect(jpgBuf[1]).toBe(0xd8);
    expect(jpgBuf[2]).toBe(0xff);
  });

  it('creates a valid ZIP archive for multiple coupon downloads', async () => {
    const tickets = [
      {
        couponNumber: 'YSYS-2026-000002',
        participantName: 'Anil Kumar',
        phone: '9574876369',
        village: 'Satulur',
        bookingPublicId: 'BK-100294',
        ticketIndex: 1,
        totalQuantity: 2,
      },
      {
        couponNumber: 'YSYS-2026-000003',
        participantName: 'Anil Kumar',
        phone: '9574876369',
        village: 'Satulur',
        bookingPublicId: 'BK-100294',
        ticketIndex: 2,
        totalQuantity: 2,
      },
    ];

    const zipBuf = await createTicketsZipArchive(tickets);
    expect(zipBuf).toBeInstanceOf(Buffer);
    expect(zipBuf.length).toBeGreaterThan(1000);
    // Standard ZIP signature is PK (0x50 0x4B)
    expect(zipBuf[0]).toBe(0x50);
    expect(zipBuf[1]).toBe(0x4b);
  });

  it('protects privacy during public coupon verification by masking mobile number', async () => {
    // 1. Create and confirm a booking
    const bookingRes = await request(app)
      .post('/api/bookings')
      .send({
        name: 'Gopal Krishna',
        phone: '9848012345',
        village: 'Satulur',
        quantity: 1,
      });

    const { booking, payment } = bookingRes.body.data;
    await request(app)
      .post('/api/test-mode/simulate-payment')
      .send({ clientTxnId: payment.clientTxnId });

    // 2. Fetch allocated coupon number
    const statusRes = await request(app)
      .get(`/api/bookings/${booking.publicId}/status?token=${payment.statusToken}`);
    const couponNumber = statusRes.body.data.coupons[0].coupon_number;

    // 3. Query public verification endpoint
    const verifyRes = await request(app).get(`/api/coupons/${couponNumber}/verify`);
    expect(verifyRes.status).toBe(200);
    expect(verifyRes.body.success).toBe(true);

    const data = verifyRes.body.data;
    expect(data.isValid).toBe(true);
    expect(data.participantName).toBe('Gopal Krishna');
    // Mobile must be masked! Never reveal full phone
    expect(data.maskedPhone).toBe('XXXXXX2345');
    expect(data.maskedPhone).not.toBe('9848012345');
  });
});
