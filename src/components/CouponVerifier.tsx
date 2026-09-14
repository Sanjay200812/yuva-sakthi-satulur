import React, { useState } from 'react';
import { Search, CheckCircle2, XCircle, Ticket, ShieldCheck, User, Calendar, MapPin, X, Tag, Download, Loader2 } from 'lucide-react';
import { safeFetchJson } from '../utils/api.ts';

interface CouponVerifierProps {
  bookings?: any[];
  isOpen?: boolean;
  onClose?: () => void;
}

export const CouponVerifier: React.FC<CouponVerifierProps> = ({ isOpen, onClose }) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [searchResult, setSearchResult] = useState<{
    found: boolean;
    data?: any;
    searched: boolean;
    error?: string;
  }>({
    found: false,
    searched: false,
  });

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    const query = searchQuery.trim().toUpperCase();
    if (!query) return;

    setLoading(true);
    setSearchResult({ found: false, searched: false });

    try {
      const json = await safeFetchJson<any>(
        `/api/coupons/${encodeURIComponent(query)}/verify`,
        {},
        'Coupon verification service'
      );

      if (json.success && json.data) {
        setSearchResult({
          found: true,
          data: json.data,
          searched: true,
        });
      } else {
        setSearchResult({
          found: false,
          searched: true,
          error: json.error?.message || 'No confirmed ticket found with this coupon number.',
        });
      }
    } catch (err: any) {
      setSearchResult({
        found: false,
        searched: true,
        error: err.message || 'Verification service temporarily unavailable.',
      });
    } finally {
      setLoading(false);
    }
  };

  const content = (
    <div className="space-y-6">
      <div className="text-center space-y-2">
        <div className="flex flex-wrap items-center justify-center gap-2">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-purple-950 border border-purple-500/30 text-purple-300 text-xs font-semibold uppercase">
            <Ticket className="w-3.5 h-3.5 text-amber-400" />
            <span>OFFICIAL COUPON VERIFICATION</span>
          </div>
          <div className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-amber-500/10 border border-amber-400/30 text-amber-300 text-xs font-mono">
            <ShieldCheck className="w-3 h-3 text-emerald-400" />
            100% Genuine Database Record
          </div>
        </div>

        <h3 className="text-2xl font-black font-display text-white">
          Verify Your <span className="gold-gradient-text">Lucky Coupon</span>
        </h3>
        <p className="text-xs text-slate-400 max-w-md mx-auto">
          Enter your unique Coupon Number (e.g., <strong className="text-amber-300 font-mono">YSYS-2026-000001</strong>) to verify its authenticity and status.
        </p>
      </div>

      {/* Search Input Box */}
      <form onSubmit={handleSearch} className="flex gap-2 max-w-md mx-auto">
        <div className="relative flex-1">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Enter Coupon Number (e.g. YSYS-2026-000001)"
            className="w-full pl-4 pr-10 py-3 rounded-2xl bg-slate-950/80 border border-purple-500/30 focus:border-amber-400 outline-none text-white text-sm placeholder:text-slate-500"
          />
          <Search className="w-4 h-4 text-slate-400 absolute right-3.5 top-3.5" />
        </div>
        <button
          type="submit"
          disabled={loading}
          className="px-5 py-3 rounded-2xl bg-gradient-to-r from-amber-400 to-yellow-500 hover:from-amber-300 hover:to-yellow-400 text-slate-950 font-display font-extrabold text-xs uppercase tracking-wider shadow-md hover:shadow-lg transition cursor-pointer disabled:opacity-50"
        >
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Verify'}
        </button>
      </form>

      {/* Result Card */}
      {searchResult.searched && (
        <div className="max-w-md mx-auto animate-in fade-in zoom-in-95 duration-200">
          {searchResult.found && searchResult.data ? (
            <div className="p-5 rounded-2xl bg-gradient-to-br from-[#121A3B] to-[#0A0E24] border-2 border-emerald-500/40 shadow-xl space-y-4">
              <div className="flex items-center justify-between pb-3 border-b border-purple-500/20">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                  <span className="font-bold text-emerald-300 text-xs uppercase tracking-wider">
                    CONFIRMED & VALID ENTRY
                  </span>
                </div>
                <span className="font-mono text-xs font-bold text-amber-300 px-2.5 py-0.5 rounded-full bg-amber-500/20 border border-amber-400/30">
                  {searchResult.data.couponNumber}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-3 text-xs">
                <div>
                  <span className="text-[10px] text-slate-400 block font-mono">Participant</span>
                  <span className="font-bold text-white text-sm">{searchResult.data.participantName}</span>
                </div>
                <div>
                  <span className="text-[10px] text-slate-400 block font-mono">Mobile (Masked)</span>
                  <span className="font-mono font-bold text-purple-300">{searchResult.data.maskedPhone}</span>
                </div>
                <div>
                  <span className="text-[10px] text-slate-400 block font-mono">Village / Town</span>
                  <span className="text-slate-200 font-medium">{searchResult.data.village}</span>
                </div>
                <div>
                  <span className="text-[10px] text-slate-400 block font-mono">1st Prize</span>
                  <span className="font-bold text-amber-400">{searchResult.data.prize}</span>
                </div>
              </div>

              <div className="pt-2 flex items-center justify-between">
                <span className="text-[10px] text-slate-400">
                  Issued: {searchResult.data.issuedAt}
                </span>
                <a
                  href={`/api/coupons/${searchResult.data.couponNumber}/download`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-3 py-1.5 rounded-lg bg-amber-400 hover:bg-amber-300 text-slate-950 text-xs font-bold flex items-center gap-1 transition shadow-sm"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Download PDF Pass</span>
                </a>
              </div>
            </div>
          ) : (
            <div className="p-5 rounded-2xl bg-rose-950/40 border border-rose-500/30 text-center space-y-2">
              <XCircle className="w-8 h-8 text-rose-400 mx-auto" />
              <h4 className="text-sm font-bold text-white">Coupon Not Found or Invalid</h4>
              <p className="text-xs text-rose-300">
                {searchResult.error || 'Please double-check your coupon number and try again.'}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );

  // If used as modal
  if (isOpen !== undefined) {
    if (!isOpen) return null;
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-200 overflow-y-auto">
        <div className="relative w-full max-w-lg my-auto bg-[#0C122C] border border-amber-400/40 rounded-3xl p-6 sm:p-8 shadow-2xl text-left">
          {onClose && (
            <button
              onClick={onClose}
              className="absolute top-4 right-4 p-2 text-slate-400 hover:text-white rounded-full bg-slate-800/80 hover:bg-slate-700 cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          )}
          {content}
        </div>
      </div>
    );
  }

  // In-page section
  return (
    <section id="verify" className="py-16 px-4 sm:px-6 relative z-10">
      <div className="max-w-3xl mx-auto bg-[#0A0E24]/90 border border-purple-500/30 rounded-3xl p-6 sm:p-10 shadow-2xl backdrop-blur-sm">
        {content}
      </div>
    </section>
  );
};
