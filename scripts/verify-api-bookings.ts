import dotenv from 'dotenv';
dotenv.config();

async function runVerification() {
  const { app } = await import('../server/app.ts');
  const supertest = (await import('supertest')).default;

  console.log('=== TEST 1: GET /api/health ===');
  const healthRes = await supertest(app).get('/api/health');
  console.log('Health Status:', healthRes.status);
  console.log('Health Response:', healthRes.body);

  const testCases = [
    { quantity: 1, expectedAmount: 50, expectedAmountInr: '50.00' },
    { quantity: 3, expectedAmount: 150, expectedAmountInr: '150.00' },
    { quantity: 10, expectedAmount: 500, expectedAmountInr: '500.00' },
  ];

  const generatedPublicIds = new Set<string>();
  const generatedTxnIds = new Set<string>();

  for (const tc of testCases) {
    console.log(`\n=== TEST 2: POST /api/bookings for Quantity ${tc.quantity} (Expected ₹${tc.expectedAmount}) ===`);
    const res = await supertest(app)
      .post('/api/bookings')
      .send({
        name: 'Test Participant',
        phone: '9876543210',
        village: 'Satulur',
        quantity: tc.quantity,
        selectedApp: 'phonepe',
      });

    console.log('HTTP Status:', res.status);
    if (res.status !== 200) {
      console.error('FAILED:', res.body);
      process.exit(1);
    }

    const { success, data } = res.body;
    console.log('success:', success);
    console.log('booking.publicId:', data.booking.publicId);
    console.log('booking.quantity:', data.booking.quantity);
    console.log('booking.totalAmount:', data.booking.totalAmount);
    console.log('booking.expiresAt:', data.booking.expiresAt);
    console.log('payment.amountInr:', data.payment.amountInr);
    console.log('payment.expiresAt:', data.payment.expiresAt);
    console.log('payment.statusToken (masked):', data.payment.statusToken?.slice(0, 10) + '...');
    console.log('payment.appIntents keys:', Object.keys(data.payment.appIntents));

    // Assertions
    if (!success) throw new Error('Expected success to be true');
    if (data.booking.quantity !== tc.quantity) throw new Error(`Expected quantity ${tc.quantity}, got ${data.booking.quantity}`);
    if (data.booking.totalAmount !== tc.expectedAmount) throw new Error(`Expected totalAmount ${tc.expectedAmount}, got ${data.booking.totalAmount}`);
    if (data.payment.amountInr !== tc.expectedAmountInr) throw new Error(`Expected amountInr ${tc.expectedAmountInr}, got ${data.payment.amountInr}`);
    if (!data.booking.publicId.startsWith('BK-')) throw new Error(`Expected publicId starting with BK-, got ${data.booking.publicId}`);
    if (!data.payment.statusToken) throw new Error('Missing payment.statusToken');
    if (!data.payment.appIntents?.phonepe) throw new Error('Missing payment.appIntents.phonepe');

    generatedPublicIds.add(data.booking.publicId);
    generatedTxnIds.add(data.payment.clientTxnId);
  }

  // Verify collision safety
  if (generatedPublicIds.size !== testCases.length) {
    throw new Error('Collision detected in generated publicIds!');
  }
  if (generatedTxnIds.size !== testCases.length) {
    throw new Error('Collision detected in generated payment references!');
  }

  console.log('\n✅ ALL VERIFICATION TESTS PASSED SUCCESSFULLY!');
}

runVerification().catch((err) => {
  console.error('❌ Verification failed:', err);
  process.exit(1);
});
