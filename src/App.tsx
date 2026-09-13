import React, { useState, useEffect } from 'react';
import { IntroAnimation } from './components/IntroAnimation.tsx';
import { Navbar } from './components/Navbar.tsx';
import { HeroSection } from './components/HeroSection.tsx';
import { EventCountdown } from './components/EventCountdown.tsx';
import { PrizeSection } from './components/PrizeSection.tsx';
import { CouponSection } from './components/CouponSection.tsx';
import { HowItWorks } from './components/HowItWorks.tsx';
import { CouponVerifier } from './components/CouponVerifier.tsx';
import { AboutSection } from './components/AboutSection.tsx';
import { FinalCTA } from './components/FinalCTA.tsx';
import { Footer } from './components/Footer.tsx';
import { AmbientParticles } from './components/AmbientParticles.tsx';
import { BookingModal } from './components/BookingModal.tsx';
import { TicketModal } from './components/TicketModal.tsx';
import { FloatingContact } from './components/FloatingContact.tsx';
import { AdminLogin } from './components/admin/AdminLogin.tsx';
import { AdminDashboard } from './components/admin/AdminDashboard.tsx';
import { CouponBooking } from './types.ts';

export default function App() {
  const [introFinished, setIntroFinished] = useState(false);
  const [isBookingModalOpen, setIsBookingModalOpen] = useState(false);
  const [isVerifyModalOpen, setIsVerifyModalOpen] = useState(false);
  const [activeBooking, setActiveBooking] = useState<CouponBooking | null>(null);
  const [initialBookingData, setInitialBookingData] = useState<any>(null);

  // Admin routing state
  const [isAdminRoute, setIsAdminRoute] = useState(() =>
    typeof window !== 'undefined' ? window.location.pathname.startsWith('/admin') : false
  );
  const [adminUser, setAdminUser] = useState<any>(null);

  // Check admin session on mount or route switch
  useEffect(() => {
    const handlePopState = () => {
      setIsAdminRoute(window.location.pathname.startsWith('/admin'));
    };

    window.addEventListener('popstate', handlePopState);

    // If on admin route, check existing session
    if (window.location.pathname.startsWith('/admin')) {
      fetch('/api/admin/auth/me')
        .then((res) => res.json())
        .then((json) => {
          if (json.success && json.data) {
            setAdminUser(json.data);
          }
        })
        .catch(() => {});
    }

    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  // Check for /orders/:id or /success?order_id=... on initial mount & popstate
  useEffect(() => {
    const resolveOrderFromUrl = () => {
      const pathname = window.location.pathname;
      const searchParams = new URLSearchParams(window.location.search);

      const orderMatch = pathname.match(/^\/orders\/([^/]+)/);
      const queryOrderId = searchParams.get('order_id') || searchParams.get('id') || searchParams.get('booking');
      const targetOrderId = (orderMatch && orderMatch[1]) || queryOrderId;

      if (targetOrderId && !isAdminRoute) {
        fetch(`/api/payment/status?order_id=${encodeURIComponent(targetOrderId)}`)
          .then((res) => res.json())
          .then((json) => {
            if (json.status === 'SUCCESS' && json.booking) {
              const b = json.booking;
              const couponNumbers = (b.coupons || []).map((c: any) => c.coupon_number);
              setActiveBooking({
                id: b.publicId || targetOrderId,
                ticketNumbers: couponNumbers,
                name: b.name || 'Participant',
                phone: b.phone || '',
                village: b.village || 'Satulur',
                quantity: b.quantity || 1,
                totalAmount: b.totalAmount || 50,
                bookedAt: new Date(b.paidAt || Date.now()).toLocaleDateString('en-IN', {
                  day: 'numeric',
                  month: 'short',
                  hour: '2-digit',
                  minute: '2-digit',
                }),
                status: 'confirmed',
                transactionRef: 'VYAPAR_UPI_VERIFIED',
                paymentGateway: 'VyaparGateway UPI',
                downloadUrl: `/api/coupons/${b.publicId || targetOrderId}/download.pdf`,
              });
            }
          })
          .catch(() => {});
      }
    };

    resolveOrderFromUrl();
    window.addEventListener('popstate', resolveOrderFromUrl);
    return () => window.removeEventListener('popstate', resolveOrderFromUrl);
  }, [isAdminRoute]);

  const navigateTo = (path: string) => {
    window.history.pushState({}, '', path);
    setIsAdminRoute(path.startsWith('/admin'));
  };

  const handleAdminLogout = async () => {
    try {
      await fetch('/api/admin/auth/logout', { method: 'POST' });
    } catch {}
    setAdminUser(null);
    navigateTo('/admin');
  };

  const handleOpenBooking = (data?: any) => {
    setInitialBookingData(data || null);
    setIsBookingModalOpen(true);
  };

  const handleBookCoupon = (newBooking: CouponBooking) => {
    setActiveBooking(newBooking);
  };

  const scrollToSection = (id: string) => {
    const el = document.getElementById(id);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth' });
    }
  };

  // 1. Render Admin Panel if on /admin route
  if (isAdminRoute) {
    if (adminUser) {
      return (
        <AdminDashboard
          adminUser={adminUser}
          onLogout={handleAdminLogout}
          onBackToSite={() => navigateTo('/')}
        />
      );
    }
    return (
      <AdminLogin
        onLoginSuccess={(user) => setAdminUser(user)}
        onBackToSite={() => navigateTo('/')}
      />
    );
  }

  // 2. Render Public Website
  return (
    <div className="relative min-h-screen bg-[#070B19] text-slate-100 selection:bg-amber-400 selection:text-slate-950 font-sans overflow-x-hidden">
      {/* Intro Opening Animation */}
      {!introFinished && <IntroAnimation onComplete={() => setIntroFinished(true)} />}

      {/* Floating Ambient Background Particles & Light Glows */}
      <AmbientParticles />

      {/* Sticky Top Navigation with Highlighted Helpline */}
      <Navbar
        onOpenBooking={() => handleOpenBooking()}
        onOpenVerify={() => setIsVerifyModalOpen(true)}
      />

      {/* Main Content Sections */}
      <main className="relative z-10 space-y-4 sm:space-y-8">
        {/* 1. Hero / Lucky Draw */}
        <HeroSection
          onOpenBooking={() => handleOpenBooking()}
          onExplorePrize={() => scrollToSection('prize')}
        />

        {/* 2. Official Draw Schedule & Countdown */}
        <EventCountdown />

        {/* 3. 1st Prize – 20 KG Laddu */}
        <PrizeSection onOpenBooking={() => handleOpenBooking()} />

        {/* 4. Coupon Section (SINGLE COUPON ₹50 & VyaparGateway UPI) */}
        <CouponSection
          onBookCoupon={handleBookCoupon}
          onOpenBookingModal={handleOpenBooking}
        />

        {/* 5. How It Works (01, 02, 03 steps) */}
        <HowItWorks onOpenBooking={() => handleOpenBooking()} />

        {/* 6. Coupon Verification & Search Tool */}
        <CouponVerifier />

        {/* 7. About Yuva Shakti Youth Satulur Committee */}
        <AboutSection />

        {/* 8. Final CTA (READY TO TRY YOUR LUCK?) */}
        <FinalCTA onOpenBooking={() => handleOpenBooking()} />
      </main>

      {/* Footer */}
      <Footer />

      {/* Floating 24/7 Enquiries & WhatsApp Help Action Widget */}
      <FloatingContact />

      {/* Quick Booking & Dynamic UPI QR Checkout Modal */}
      <BookingModal
        isOpen={isBookingModalOpen}
        onClose={() => setIsBookingModalOpen(false)}
        onBookSuccess={handleBookCoupon}
        initialData={initialBookingData}
      />

      {/* Coupon Verifier Modal */}
      <CouponVerifier isOpen={isVerifyModalOpen} onClose={() => setIsVerifyModalOpen(false)} />

      {/* Confirmed Ticket Pass Modal */}
      {activeBooking && (
        <TicketModal booking={activeBooking} onClose={() => setActiveBooking(null)} />
      )}
    </div>
  );
}
