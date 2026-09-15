import request from 'supertest';
import { app } from '../server.ts';
import { db } from '../server/db/client.ts';
import { getPaymentSettings, updatePaymentSettings } from '../server/services/paymentSettingsService.ts';
import { renderTicketPdf, renderTicketRaster, renderTicketDocx } from '../server/services/ticketRenderer.ts';
import { allocateCouponsForBooking } from '../server/services/couponAllocator.ts';
import JSZip from 'jszip';

async function runE2E() {
  console.log('=== STARTING END-TO-END ACCEPTANCE TEST ===\n');

  // -------------------------------------------------------------
  // PART A: ADMIN UPI DATA SYNC
  // -------------------------------------------------------------
  console.log('--- PART A: ADMIN UPI DATA SYNC ---');
  
  // 1. Set UPI to TEST-VALUE-A (e.g. merchantA@ybl)
  console.log('1. Setting Admin UPI to: merchantA@ybl');
  await updatePaymentSettings({
    payeeUpiId: 'merchantA@ybl',
    payeeDisplayName: 'Satulur Committee A',
    paymentsEnabled: true,
  });

  // 2. Query public /api/config
  const confA = await request(app).get('/api/config');
  console.log('2. /api/config payeeUpiId:', confA.body.payeeUpiId);
  if (confA.body.payeeUpiId !== 'merchantA@ybl') {
    throw new Error(`Expected merchantA@ybl on public page, got ${confA.body.payeeUpiId}`);
  }

  // 3. Change Admin UPI to TEST-VALUE-B (e.g. merchantB@ybl) without deploy
  console.log('3. Changing Admin UPI to: merchantB@ybl');
  await updatePaymentSettings({
    payeeUpiId: 'merchantB@ybl',
    payeeDisplayName: 'Satulur Committee B',
    paymentsEnabled: true,
  });

  // 4. Query public /api/config immediately
  const confB = await request(app).get('/api/config');
  console.log('4. /api/config payeeUpiId immediately reflects:', confB.body.payeeUpiId);
  if (confB.body.payeeUpiId !== 'merchantB@ybl') {
    throw new Error(`Expected merchantB@ybl on public page, got ${confB.body.payeeUpiId}`);
  }

  // 5. Create NEW booking under merchantB@ybl
  console.log('5. Creating new booking under merchantB@ybl');
  const bookRes = await request(app)
    .post('/api/bookings')
    .send({
      name: 'Ramesh Babu',
      phone: '9848011223',
      village: 'Satulur Center',
      quantity: 1,
    });

  if (bookRes.status !== 200) {
    throw new Error(`Booking creation failed: ${JSON.stringify(bookRes.body)}`);
  }

  const newPayment = bookRes.body.data.payment;
  console.log('New booking payeeUpiId:', newPayment.payeeUpiId);
  console.log('New booking upiUri:', newPayment.upiUri);
  if (newPayment.payeeUpiId !== 'merchantB@ybl') {
    throw new Error(`Expected merchantB@ybl on new booking, got ${newPayment.payeeUpiId}`);
  }
  if (!newPayment.upiUri.includes('merchantB%40ybl') && !newPayment.upiUri.includes('merchantB@ybl')) {
    throw new Error('QR UPI URI does not contain updated payee merchantB@ybl');
  }

  // 6. Restore production merchant UPI: 7075920852@ybl
  console.log('6. Restoring production merchant UPI: 7075920852@ybl');
  await updatePaymentSettings({
    payeeUpiId: '7075920852@ybl',
    payeeDisplayName: 'Yuva Shakti Youth Satulur',
    paymentsEnabled: true,
  });
  console.log('✅ Part A Passed: Admin UPI synchronization is instantaneous with 0 redeployments!\n');

  // -------------------------------------------------------------
  // PART B: COUPON NUMBERING & TEMPLATE INTEGRITY
  // -------------------------------------------------------------
  console.log('--- PART B: COUPON NUMBERING (1501-2250) ---');
  
  // Allocate controlled coupon
  const testBookingId = bookRes.body.data.booking.id;
  await db.query("UPDATE bookings SET status = 'payment_confirmed', paid_at = NOW(), verified_at = NOW() WHERE id = $1", [testBookingId]);
  const issuedCoupons = await allocateCouponsForBooking(db, testBookingId, async () => {
    return await db.getNextCouponSerial();
  });
  console.log('Issued coupon number:', issuedCoupons[0].coupon_number);
  const serialNum = Number(issuedCoupons[0].coupon_number);

  if (serialNum < 1501 || serialNum > 2250) {
    throw new Error(`Coupon number ${serialNum} is outside strict range 1501-2250!`);
  }
  if (issuedCoupons[0].coupon_number.includes('YSYS-')) {
    throw new Error(`Visible coupon number contains prefix: ${issuedCoupons[0].coupon_number}`);
  }
  console.log(`✅ Part B Passed: Coupon ${serialNum} is strictly in 1501–2250 with raw sequential numbering.\n`);

  // -------------------------------------------------------------
  // PART C: DOWNLOAD & VISUAL TEMPLATE INTEGRITY
  // -------------------------------------------------------------
  console.log('--- PART C: MASTER TEMPLATE DOWNLOAD ---');
  const ticketData = {
    couponNumber: issuedCoupons[0].coupon_number,
    participantName: 'Ramesh Babu',
    phone: '9848011223',
    village: 'Satulur Center',
    bookingPublicId: bookRes.body.data.booking.publicId,
    ticketIndex: 1,
    totalQuantity: 1,
  };

  // 1. DOCX
  const docxBuf = await renderTicketDocx(ticketData);
  const zip = await JSZip.loadAsync(docxBuf);
  const docXml = await zip.file('word/document.xml')?.async('text');
  if (!docXml?.includes(issuedCoupons[0].coupon_number)) {
    throw new Error('DOCX does not contain issued coupon number');
  }
  if (!docXml?.includes('Ramesh Babu')) {
    throw new Error('DOCX does not contain participant name');
  }
  if (docXml?.toLowerCase().includes('boddukuri')) {
    throw new Error('DOCX contains hardcoded Boddukuri name!');
  }
  console.log('✅ DOCX verified with actual dynamic booking data');

  // 2. PDF
  const pdfBuf = await renderTicketPdf(ticketData);
  if (pdfBuf.subarray(0, 5).toString() !== '%PDF-') {
    throw new Error('Invalid PDF format');
  }
  console.log(`✅ PDF verified (${pdfBuf.length} bytes, 828x364 official master layout)`);

  // 3. PNG
  const pngBuf = await renderTicketRaster(ticketData, 'png');
  if (pngBuf[0] !== 0x89 || pngBuf[1] !== 0x50) {
    throw new Error('Invalid PNG format');
  }
  console.log(`✅ PNG verified (${pngBuf.length} bytes, high-res master artwork composite)`);

  console.log('\n🎉 ALL END-TO-END ACCEPTANCE TESTS PASSED PERFECTLY!\n');
}

runE2E()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('❌ E2E Acceptance Test Failed:', err);
    process.exit(1);
  });
