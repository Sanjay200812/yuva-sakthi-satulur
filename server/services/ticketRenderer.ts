import fs from 'fs';
import path from 'path';
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import QRCode from 'qrcode';
import archiver from 'archiver';
import { config } from '../config/eventConfig.ts';

export interface TicketRenderData {
  couponNumber: string;
  participantName: string;
  phone: string;
  village: string;
  bookingPublicId: string;
  ticketIndex: number;
  totalQuantity: number;
  paidAt?: string;
  verificationToken?: string;
}

// Mask phone number for public privacy (show only last 4 digits)
export function maskPhoneNumber(phone: string): string {
  const cleaned = phone.replace(/\D/g, '');
  if (cleaned.length >= 10) {
    return `XXXXXX${cleaned.slice(-4)}`;
  }
  return phone.slice(0, 2) + '****' + phone.slice(-2);
}

// Format draw timestamp in Asia/Kolkata
export function formatKolkataTime(isoString?: string): string {
  try {
    const d = isoString ? new Date(isoString) : new Date(config.EVENT_DRAW_AT);
    return new Intl.DateTimeFormat('en-IN', {
      timeZone: config.EVENT_TIMEZONE || 'Asia/Kolkata',
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(d);
  } catch {
    return '19th Sunday Evening, 6:30 PM IST';
  }
}

/**
 * Generates an official, print-ready PDF pass for a single coupon
 */
export async function renderTicketPdf(data: TicketRenderData): Promise<Buffer> {
  // Landscape ticket dimensions: 620 x 340 points
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([620, 340]);

  const helveticaBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const helvetica = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const courierBold = await pdfDoc.embedFont(StandardFonts.CourierBold);

  // Background gradient-style fill: Deep Navy (#070B19)
  page.drawRectangle({
    x: 0,
    y: 0,
    width: 620,
    height: 340,
    color: rgb(7 / 255, 11 / 255, 25 / 255),
  });

  // Ticket Card Outer Border: Amber Gold (#F59E0B)
  page.drawRectangle({
    x: 15,
    y: 15,
    width: 590,
    height: 310,
    borderColor: rgb(245 / 255, 158 / 255, 11 / 255),
    borderWidth: 2,
    color: rgb(14 / 255, 21 / 255, 48 / 255),
  });

  // Inner decorative border
  page.drawRectangle({
    x: 20,
    y: 20,
    width: 580,
    height: 300,
    borderColor: rgb(139 / 255, 92 / 255, 246 / 255), // Purple-500
    borderWidth: 0.75,
  });

  // Header separator line
  page.drawLine({
    start: { x: 20, y: 275 },
    end: { x: 600, y: 275 },
    color: rgb(245 / 255, 158 / 255, 11 / 255),
    thickness: 1,
  });

  // Perforation line between main ticket and right verification stub
  const stubX = 455;
  for (let y = 25; y < 270; y += 8) {
    page.drawLine({
      start: { x: stubX, y },
      end: { x: stubX, y: y + 4 },
      color: rgb(168 / 255, 85 / 255, 247 / 255),
      thickness: 1.5,
    });
  }

  // Embed Logo Image if present in root
  const logoPath = path.resolve(process.cwd(), 'logo.jpeg');
  if (fs.existsSync(logoPath)) {
    try {
      const logoBytes = fs.readFileSync(logoPath);
      const logoImage = await pdfDoc.embedJpg(logoBytes);
      page.drawImage(logoImage, {
        x: 30,
        y: 282,
        width: 38,
        height: 38,
      });
    } catch {
      // ignore logo embedding if format issue
    }
  }

  // Helper to sanitize any string for Standard Helvetica (WinAnsi encoding)
  const sanitize = (text: string) => {
    if (!text) return '';
    return text
      .replace(/₹/g, 'Rs.')
      .replace(/•/g, '-')
      .replace(/[^\x20-\x7E]/g, '')
      .trim();
  };

  // Header Titles
  page.drawText('YUVA SHAKTI YOUTH SATULUR', {
    x: 76,
    y: 302,
    size: 13,
    font: helveticaBold,
    color: rgb(1, 1, 1),
  });

  page.drawText('OFFICIAL LUCKY DRAW COUPON - Rs.50', {
    x: 76,
    y: 288,
    size: 9,
    font: helveticaBold,
    color: rgb(251 / 255, 191 / 255, 36 / 255), // Amber-400
  });

  // Series & Index Badge on Header Right
  const badgeText = `TICKET ${data.ticketIndex} OF ${data.totalQuantity}`;
  page.drawText(badgeText, {
    x: stubX + 15,
    y: 300,
    size: 9.5,
    font: courierBold,
    color: rgb(245 / 255, 158 / 255, 11 / 255),
  });

  page.drawText(`REF: ${data.bookingPublicId}`, {
    x: stubX + 15,
    y: 288,
    size: 8,
    font: courierBold,
    color: rgb(196 / 255, 181 / 255, 253 / 255),
  });

  // Left Section - Coupon Number Box
  page.drawRectangle({
    x: 30,
    y: 200,
    width: 405,
    height: 62,
    color: rgb(7 / 255, 11 / 255, 25 / 255),
    borderColor: rgb(245 / 255, 158 / 255, 11 / 255),
    borderWidth: 1,
  });

  page.drawText('COUPON SERIAL NUMBER', {
    x: 42,
    y: 247,
    size: 8,
    font: helveticaBold,
    color: rgb(148 / 255, 163 / 255, 184 / 255),
  });

  page.drawText(data.couponNumber, {
    x: 42,
    y: 215,
    size: 22,
    font: courierBold,
    color: rgb(251 / 255, 191 / 255, 36 / 255), // Gold
  });

  // 1st Prize Tag
  page.drawText('PRIZE: 20 KG MAHA LADDU', {
    x: 215,
    y: 218,
    size: 9.5,
    font: helveticaBold,
    color: rgb(253 / 255, 224 / 255, 71 / 255),
  });

  // Participant & Booking Details Grid
  const detailsY = 172;
  page.drawText('PARTICIPANT NAME', { x: 30, y: detailsY, size: 7.5, font: helvetica, color: rgb(0.6, 0.6, 0.7) });
  page.drawText(sanitize(data.participantName).slice(0, 28).toUpperCase() || 'VALUED PARTICIPANT', { x: 30, y: detailsY - 14, size: 11, font: helveticaBold, color: rgb(1, 1, 1) });

  page.drawText('PHONE (CONFIRMED)', { x: 235, y: detailsY, size: 7.5, font: helvetica, color: rgb(0.6, 0.6, 0.7) });
  page.drawText(maskPhoneNumber(data.phone), { x: 235, y: detailsY - 14, size: 10, font: courierBold, color: rgb(196 / 255, 181 / 255, 253 / 255) });

  page.drawText('VILLAGE / REGION', { x: 30, y: detailsY - 38, size: 7.5, font: helvetica, color: rgb(0.6, 0.6, 0.7) });
  page.drawText(sanitize(data.village).slice(0, 28).toUpperCase() || 'SATULUR', { x: 30, y: detailsY - 52, size: 10, font: helveticaBold, color: rgb(1, 1, 1) });

  page.drawText('DRAW DATE & VENUE', { x: 235, y: detailsY - 38, size: 7.5, font: helvetica, color: rgb(0.6, 0.6, 0.7) });
  page.drawText('19th Sun Evening 6:30 PM - Satulur Center', { x: 235, y: detailsY - 52, size: 8.5, font: helveticaBold, color: rgb(251 / 255, 191 / 255, 36 / 255) });

  // Bottom Notice & Helpline
  page.drawLine({ start: { x: 30, y: 55 }, end: { x: 435, y: 55 }, color: rgb(0.3, 0.3, 0.5), thickness: 0.5 });
  page.drawText('Organized by Yuva Shakti Youth, Satulur - Helpline: +91 95748 76369', {
    x: 30,
    y: 40,
    size: 7.5,
    font: helvetica,
    color: rgb(148 / 255, 163 / 255, 184 / 255),
  });
  page.drawText('Keep this official verified pass safe for the live stage draw.', {
    x: 30,
    y: 28,
    size: 7,
    font: helvetica,
    color: rgb(100 / 255, 116 / 255, 139 / 255),
  });

  // Right Stub: Verification QR Code & Seal
  const verifyUrl = `${config.APP_URL}/verify?coupon=${encodeURIComponent(data.couponNumber)}${
    data.verificationToken ? `&token=${encodeURIComponent(data.verificationToken)}` : ''
  }`;

  try {
    const qrBuffer = await QRCode.toBuffer(verifyUrl, {
      width: 130,
      margin: 1,
      color: { dark: '#070B19', light: '#FFFFFF' },
    });
    const qrImage = await pdfDoc.embedPng(qrBuffer);
    page.drawImage(qrImage, {
      x: stubX + 18,
      y: 140,
      width: 110,
      height: 110,
    });
  } catch (err) {
    console.error('Error generating QR code for ticket', err);
  }

  page.drawText('SCAN TO VERIFY', {
    x: stubX + 32,
    y: 122,
    size: 8,
    font: helveticaBold,
    color: rgb(245 / 255, 158 / 255, 11 / 255),
  });

  page.drawText('OFFICIAL COMMITTEE SEAL', {
    x: stubX + 18,
    y: 105,
    size: 6.5,
    font: helvetica,
    color: rgb(148 / 255, 163 / 255, 184 / 255),
  });

  // Simulated Serial Barcode
  const barcodeY = 32;
  const barPattern = [2, 1, 3, 1, 2, 4, 1, 3, 1, 2, 3, 1, 4, 2, 1, 3, 2, 1, 2, 4, 1, 3, 1, 2];
  let barX = stubX + 18;
  for (const w of barPattern) {
    page.drawRectangle({
      x: barX,
      y: barcodeY,
      width: w,
      height: 22,
      color: rgb(203 / 255, 213 / 255, 225 / 255),
    });
    barX += w + 2;
  }

  const pdfBytes = await pdfDoc.save();
  return Buffer.from(pdfBytes);
}

/**
 * Generate a combined multi-page PDF containing all tickets for a booking
 */
export async function renderMultiTicketPdf(tickets: TicketRenderData[]): Promise<Buffer> {
  const mergedPdf = await PDFDocument.create();

  for (const ticket of tickets) {
    const singleBuf = await renderTicketPdf(ticket);
    const tempDoc = await PDFDocument.load(singleBuf);
    const copiedPages = await mergedPdf.copyPages(tempDoc, [0]);
    mergedPdf.addPage(copiedPages[0]);
  }

  const bytes = await mergedPdf.save();
  return Buffer.from(bytes);
}

/**
 * Creates a ZIP archive containing individual PDFs for all purchased tickets
 */
export function createTicketsZipArchive(tickets: TicketRenderData[]): Promise<Buffer> {
  return new Promise(async (resolve, reject) => {
    try {
      const archive = archiver('zip', { zlib: { level: 9 } });
      const chunks: Buffer[] = [];

      archive.on('data', (chunk) => chunks.push(chunk));
      archive.on('end', () => resolve(Buffer.concat(chunks)));
      archive.on('error', (err) => reject(err));

      for (const ticket of tickets) {
        const pdfBuffer = await renderTicketPdf(ticket);
        archive.append(pdfBuffer, { name: `${ticket.couponNumber}.pdf` });
      }

      await archive.finalize();
    } catch (err) {
      reject(err);
    }
  });
}
