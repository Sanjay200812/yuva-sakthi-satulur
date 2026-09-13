import React, { useState, useEffect } from 'react';
import { Ticket, Award, HelpCircle, CheckCircle2, Phone, Menu, X, Sparkles, MessageSquare } from 'lucide-react';

interface NavbarProps {
  onOpenBooking: () => void;
  onOpenVerify: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({ onOpenBooking, onOpenVerify }) => {
  const [scrolled, setScrolled] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const officialPhone = '+91 95748 76369';
  const rawPhone = '919574876369';

  useEffect(() => {
    const handleScroll = () => {
      setScrolled(window.scrollY > 20);
    };
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const navLinks = [
    { label: '1st Prize (20 KG)', href: '#prize', icon: Award },
    { label: 'Buy Coupon (₹50)', href: '#coupon', icon: Ticket },
    { label: 'How It Works', href: '#how-it-works', icon: HelpCircle },
    { label: 'Verify Coupon', href: '#verify', icon: CheckCircle2, action: onOpenVerify },
    { label: 'Satulur Committee', href: '#about', icon: Phone },
  ];

  return (
    <header
      className={`fixed top-0 left-0 right-0 z-40 transition-all duration-300 ${
        scrolled
          ? 'bg-[#070B19]/95 backdrop-blur-md border-b border-purple-900/30 shadow-[0_4px_20px_rgba(0,0,0,0.5)] py-3'
          : 'bg-transparent py-4 sm:py-5'
      }`}
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 flex items-center justify-between">
        {/* Brand Logo & Name */}
        <a href="#" className="flex items-center gap-2.5 group">
          <div className="relative flex items-center justify-center w-10 h-10 sm:w-11 sm:h-11 rounded-xl bg-gradient-to-br from-amber-400 via-yellow-500 to-purple-600 p-[1.5px] shadow-[0_0_15px_rgba(245,158,11,0.4)] group-hover:shadow-[0_0_22px_rgba(245,158,11,0.7)] transition-all">
            <div className="w-full h-full bg-[#070B19] rounded-[10px] overflow-hidden flex items-center justify-center">
              <img
                src="/logo.jpeg"
                alt="Yuva Shakti Satulur Emblem"
                className="w-full h-full object-cover rounded-[10px] transform group-hover:scale-105 transition-transform duration-300"
              />
            </div>
            <div className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-amber-400 rounded-full animate-ping" />
          </div>

          <div className="flex flex-col">
            <div className="flex items-center gap-1.5">
              <span className="font-display font-extrabold text-sm sm:text-base tracking-tight text-white group-hover:text-amber-300 transition-colors">
                YUVA SHAKTI
              </span>
              <span className="px-1.5 py-0.2 bg-purple-500/20 text-purple-300 text-[10px] font-bold rounded border border-purple-500/40">
                SATULUR
              </span>
            </div>
            <span className="text-[10px] text-slate-400 tracking-wider uppercase font-medium">
              LUCKY DRAW • ₹50 COUPON
            </span>
          </div>
        </a>

        {/* Desktop Nav Links */}
        <nav className="hidden lg:flex items-center gap-6 text-sm font-medium text-slate-300">
          {navLinks.map((link) => (
            <a
              key={link.label}
              href={link.href}
              onClick={(e) => {
                if (link.action) {
                  e.preventDefault();
                  link.action();
                }
              }}
              className="flex items-center gap-1.5 hover:text-amber-300 transition-colors py-1 cursor-pointer"
            >
              <link.icon className="w-4 h-4 text-purple-400" />
              <span>{link.label}</span>
            </a>
          ))}
        </nav>

        {/* Helpline Button & CTA */}
        <div className="hidden sm:flex items-center gap-3">
          {/* Highlighted Helpline Phone Number */}
          <a
            href={`tel:${rawPhone}`}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-purple-950/80 hover:bg-purple-900 border border-amber-400/40 text-amber-300 text-xs font-bold font-mono transition-all shadow-sm group"
            title="Official Helpline & Enquiries"
          >
            <Phone className="w-3.5 h-3.5 text-amber-400 group-hover:rotate-12 transition-transform" />
            <span>{officialPhone}</span>
          </a>

          <button
            id="nav-verify-btn"
            onClick={onOpenVerify}
            className="px-3 py-1.5 text-xs font-semibold text-slate-300 hover:text-white bg-slate-800/80 hover:bg-slate-700/80 border border-slate-700/80 rounded-xl transition-all cursor-pointer"
          >
            Check Pass
          </button>
          
          <button
            id="nav-get-coupon-btn"
            onClick={onOpenBooking}
            className="relative group overflow-hidden px-4 py-2 rounded-xl font-display font-bold text-xs sm:text-sm text-slate-950 bg-gradient-to-r from-amber-300 via-yellow-400 to-amber-500 shadow-[0_0_20px_rgba(245,158,11,0.4)] hover:shadow-[0_0_25px_rgba(245,158,11,0.7)] hover:scale-[1.02] active:scale-[0.98] transition-all cursor-pointer flex items-center gap-1.5"
          >
            <Sparkles className="w-4 h-4 text-slate-950" />
            <span>GET COUPON ₹50</span>
          </button>
        </div>

        {/* Mobile Menu Toggle Button */}
        <div className="flex sm:hidden items-center gap-2">
          <a
            href={`tel:${rawPhone}`}
            className="p-2 rounded-lg bg-amber-400 text-slate-950 font-bold text-xs flex items-center justify-center"
            title="Call Helpline"
          >
            <Phone className="w-4 h-4" />
          </a>
          <button
            id="nav-get-coupon-mobile-btn"
            onClick={onOpenBooking}
            className="px-2.5 py-1.5 rounded-lg font-bold text-xs text-slate-950 bg-gradient-to-r from-amber-300 to-yellow-400 font-display shadow-[0_0_10px_rgba(245,158,11,0.5)]"
          >
            ₹50 TICKET
          </button>
          <button
            id="mobile-menu-toggle"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="p-2 text-slate-300 hover:text-white bg-slate-800/80 border border-slate-700/70 rounded-lg"
            aria-label="Toggle menu"
          >
            {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>
      </div>

      {/* Mobile Drawer Menu */}
      {mobileMenuOpen && (
        <div className="sm:hidden bg-[#0B112C]/95 border-b border-purple-800/30 px-4 pt-3 pb-6 space-y-3 backdrop-blur-xl animate-in slide-in-from-top-2">
          <div className="p-3 bg-gradient-to-r from-purple-950 to-slate-900 border-2 border-amber-400/50 rounded-xl mb-3 text-center">
            <span className="text-[10px] text-amber-300 font-mono font-bold uppercase tracking-wider block">
              Official Helpline & Enquiries:
            </span>
            <a
              href={`tel:${rawPhone}`}
              className="text-lg font-black font-display text-white hover:text-amber-300 block my-1"
            >
              <span className="gold-gradient-text">{officialPhone}</span>
            </a>
            <div className="flex items-center justify-center gap-2 pt-1">
              <a
                href={`tel:${rawPhone}`}
                className="px-3 py-1 bg-amber-400 text-slate-950 font-bold text-xs rounded-lg flex items-center gap-1"
              >
                <Phone className="w-3 h-3" /> Call
              </a>
              <a
                href={`https://wa.me/${rawPhone}`}
                target="_blank"
                rel="noreferrer"
                className="px-3 py-1 bg-emerald-600 text-white font-bold text-xs rounded-lg flex items-center gap-1"
              >
                <MessageSquare className="w-3 h-3" /> WhatsApp
              </a>
            </div>
          </div>

          {navLinks.map((link) => (
            <a
              key={link.label}
              href={link.href}
              onClick={(e) => {
                setMobileMenuOpen(false);
                if (link.action) {
                  e.preventDefault();
                  link.action();
                }
              }}
              className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-slate-200 hover:bg-purple-900/30 text-sm font-medium"
            >
              <link.icon className="w-4 h-4 text-amber-400" />
              <span>{link.label}</span>
            </a>
          ))}

          <div className="pt-2 grid grid-cols-2 gap-2">
            <button
              onClick={() => {
                setMobileMenuOpen(false);
                onOpenVerify();
              }}
              className="w-full py-2.5 text-xs font-semibold text-slate-200 bg-slate-800 border border-slate-700 rounded-xl"
            >
              Verify Coupon
            </button>
            <button
              onClick={() => {
                setMobileMenuOpen(false);
                onOpenBooking();
              }}
              className="w-full py-2.5 text-xs font-bold text-slate-950 bg-gradient-to-r from-amber-300 to-yellow-400 rounded-xl font-display"
            >
              Get Coupon ₹50
            </button>
          </div>
        </div>
      )}
    </header>
  );
};
