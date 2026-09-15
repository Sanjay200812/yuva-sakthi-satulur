/**
 * Timezone and formatting utilities for Yuva Shakti Youth Satulur Lucky Draw.
 * Authoritative application timezone: Asia/Kolkata (IST: UTC+05:30).
 */

export function formatKolkataTime(value?: any): string {
  if (!value) return '-';
  try {
    const date = new Date(value);
    if (isNaN(date.getTime())) {
      return typeof value === 'string' ? value : '-';
    }
    return new Intl.DateTimeFormat('en-IN', {
      timeZone: 'Asia/Kolkata',
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: true,
    }).format(date);
  } catch {
    return typeof value === 'string' ? value : '-';
  }
}

/**
 * Distinguishes ISO timestamp (formatted via Asia/Kolkata) from literal receipt time strings (e.g. "10:32 PM")
 */
export function formatOcrTxnTime(isoTimestamp?: string | null, literalTime?: string | null): string {
  if (isoTimestamp) {
    const d = new Date(isoTimestamp);
    if (!isNaN(d.getTime())) {
      return formatKolkataTime(d);
    }
  }
  return literalTime || isoTimestamp || '-';
}
