import { config } from '../config/eventConfig.ts';
import { PaymentProvider } from './provider.ts';
import { VyaparGatewayProvider } from './vyaparGateway.ts';
import { MockPaymentProvider } from './mockProvider.ts';

export * from './provider.ts';
export * from './vyaparGateway.ts';
export * from './mockProvider.ts';

export function getPaymentProvider(): PaymentProvider {
  if (process.env.VITEST || process.env.NODE_ENV === 'test') {
    return new MockPaymentProvider();
  }

  if (config.NODE_ENV === 'production' || config.PAYMENT_MODE === 'live') {
    return new VyaparGatewayProvider();
  }

  // In development mode, if Vyapar API key is present, use VyaparGateway
  if (config.VYAPAR_GATEWAY_API_KEY && config.PAYMENT_PROVIDER === 'vyapar_gateway') {
    return new VyaparGatewayProvider();
  }

  // Otherwise, fallback to MockPaymentProvider for local dev / tests
  console.warn('⚠️ [TEST MODE] Using MockPaymentProvider. Real payments are not being processed.');
  return new MockPaymentProvider();
}
