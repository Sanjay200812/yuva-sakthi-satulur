export interface CouponBooking {
  id: string;
  ticketNumbers: string[];
  name: string;
  phone: string;
  village: string;
  quantity: number;
  totalAmount: number;
  bookedAt: string;
  status: 'confirmed' | 'payment_pending' | 'payment_confirmed' | 'payment_failed';
  transactionRef?: string;
  paymentGateway?: string;
  downloadUrl?: string;
}

export interface IssuedCoupon {
  couponNumber: string;
  holderName: string;
  phone: string;
  village: string;
  ticketIndex: number;
  totalQuantity: number;
  issuedAt: string;
}

export interface EventConfig {
  eventName: string;
  organizer: string;
  prize: string;
  venue: string;
  helpline: string;
  drawAt: string;
  timezone: string;
  couponPrefix: string;
  couponPricePaise: number;
  couponPrice: number;
  maxCouponsPerBooking: number;
  bookingOpen: boolean;
  paymentsEnabled: boolean;
  legalApprovalConfirmed: boolean;
  licenceNumber: string | null;
  licenceDate: string | null;
  paymentMode: 'test' | 'live';
  paymentProvider: string;
  canBook: boolean;
  unavailableReason: string | null;
}

export interface PrizeItem {
  rank: string;
  title: string;
  highlight: string;
  description: string;
  features: string[];
  badge: string;
}

export interface CoordinatorContact {
  name: string;
  role: string;
  phone: string;
  location: string;
}
