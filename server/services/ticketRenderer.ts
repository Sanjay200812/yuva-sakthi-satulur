import fs from 'fs';
import path from 'path';
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import JSZip from 'jszip';
import archiver from 'archiver';
import { getSharp } from '../utils/sharpHelper.ts';
import { config } from '../config/eventConfig.ts';

// Directory resolution compatible with both CJS and ESM environments
const currentDir = typeof __dirname !== 'undefined' ? __dirname : process.cwd();

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

// Mask phone number for public privacy if needed
export function maskPhoneNumber(phone: string): string {
  const cleaned = phone.replace(/\D/g, '');
  if (cleaned.length >= 10) {
    return `XXXXXX${cleaned.slice(-4)}`;
  }
  return phone.slice(0, 2) + '****' + phone.slice(-2);
}

// Format draw timestamp or date in DD-MM-YYYY format
export function formatTicketDate(isoString?: string): string {
  try {
    const d = isoString ? new Date(isoString) : new Date(config.EVENT_DRAW_AT || Date.now());
    if (isNaN(d.getTime())) return '19-09-2026';
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const year = d.getFullYear();
    return `${day}-${month}-${year}`;
  } catch {
    return '19-09-2026';
  }
}

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

// Helper to sanitize XML special characters
function escapeXml(unsafe: string): string {
  return (unsafe || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// Cached Master Assets in Memory
let cachedMasterDocx: Buffer | null = null;
let cachedMasterImage: Buffer | null = null;

/**
 * Locate and read the master DOCX template file in a runtime-resilient way.
 * Handles root dir, server/assets, relative to currentDir, and Vercel serverless bundles.
 */
export function getMasterDocxBuffer(): Buffer {
  if (cachedMasterDocx) return cachedMasterDocx;

  const candidatePaths = [
    path.resolve(process.cwd(), 'Vinayaka_Chavithi_Coupon_Editable.docx'),
    path.resolve(process.cwd(), 'server', 'assets', 'Vinayaka_Chavithi_Coupon_Editable.docx'),
    path.resolve(process.cwd(), 'public', 'assets', 'Vinayaka_Chavithi_Coupon_Editable.docx'),
    path.resolve(currentDir, '..', '..', 'Vinayaka_Chavithi_Coupon_Editable.docx'),
    path.resolve(currentDir, '..', 'assets', 'Vinayaka_Chavithi_Coupon_Editable.docx'),
    path.resolve(currentDir, 'assets', 'Vinayaka_Chavithi_Coupon_Editable.docx'),
    path.resolve(currentDir, 'Vinayaka_Chavithi_Coupon_Editable.docx'),
  ];

  for (const p of candidatePaths) {
    if (fs.existsSync(p)) {
      cachedMasterDocx = fs.readFileSync(p);
      return cachedMasterDocx;
    }
  }

  throw new Error('Master coupon template Vinayaka_Chavithi_Coupon_Editable.docx could not be located.');
}

/**
 * Locate and read the official coupon background artwork (image1.png).
 * Extracted directly from Vinayaka_Chavithi_Coupon_Editable.docx word/media/image1.png.
 */
export async function getMasterImageBuffer(): Promise<Buffer> {
  if (cachedMasterImage) return cachedMasterImage;

  const candidatePaths = [
    path.resolve(process.cwd(), 'server', 'assets', 'image1.png'),
    path.resolve(process.cwd(), 'public', 'assets', 'image1.png'),
    path.resolve(currentDir, '..', 'assets', 'image1.png'),
    path.resolve(currentDir, 'assets', 'image1.png'),
  ];

  for (const p of candidatePaths) {
    if (fs.existsSync(p)) {
      cachedMasterImage = fs.readFileSync(p);
      return cachedMasterImage;
    }
  }

  // Fallback: extract image1.png directly from the master DOCX in memory
  const docxBuf = getMasterDocxBuffer();
  const zip = await JSZip.loadAsync(docxBuf);
  const mediaFile = zip.file('word/media/image1.png');
  if (mediaFile) {
    cachedMasterImage = await mediaFile.async('nodebuffer');
    return cachedMasterImage;
  }

  throw new Error('Master coupon artwork image1.png could not be loaded from template.');
}

/**
 * Generates an official DOCX coupon populated with dynamic booking data.
 * The master file Vinayaka_Chavithi_Coupon_Editable.docx is NEVER modified on disk.
 */
export async function renderTicketDocx(data: TicketRenderData): Promise<Buffer> {
  const masterBuffer = getMasterDocxBuffer();
  const zip = await JSZip.loadAsync(masterBuffer);

  let docXml = await zip.file('word/document.xml')?.async('text');
  if (!docXml) {
    throw new Error('Invalid DOCX template: word/document.xml not found.');
  }

  const formattedDate = formatTicketDate(data.paidAt);
  const cleanNumber = data.couponNumber || '1501';
  const cleanName = (data.participantName || '').trim();
  const cleanVillage = (data.village || 'Satulur').trim();
  const cleanPhone = (data.phone || '').trim();

  // Map exact Structured Document Tags (w:tag) from Vinayaka_Chavithi_Coupon_Editable.docx
  const replacements: Record<string, string> = {
    stub_coupon_number: escapeXml(cleanNumber),
    stub_date: escapeXml(formattedDate),
    stub_name: escapeXml(cleanName),
    stub_village: escapeXml(cleanVillage),
    stub_mobile: escapeXml(cleanPhone),
    main_coupon_number: escapeXml(cleanNumber),
    main_date: escapeXml(formattedDate),
    main_name: escapeXml(cleanName),
    main_mobile: escapeXml(cleanPhone),
  };

  for (const [tag, val] of Object.entries(replacements)) {
    // Matches: <w:tag w:val="tag"/>...<w:t>...</w:t> inside the SDT block
    const regex = new RegExp(`(<w:tag w:val="${tag}"[\\s\\S]*?<w:t>)[^<]*(<\\/w:t>)`, 'g');
    docXml = docXml.replace(regex, `$1${val}$2`);
  }

  zip.file('word/document.xml', docXml);
  const generatedBuffer = await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });

  return generatedBuffer;
}

/**
 * Generates an official, print-ready PDF coupon strictly matching
 * the Vinayaka_Chavithi_Coupon_Editable.docx layout, dimensions, artwork, and coordinates.
 * Dimensions: 828 x 364 points (16560 x 7283 dxa from master template).
 */
export async function renderTicketPdf(data: TicketRenderData): Promise<Buffer> {
  const imageBytes = await getMasterImageBuffer();

  // Page dimensions matching Word template: 828 pt wide x 364 pt high
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([828, 364]);

  // Embed the official master coupon artwork covering the entire page (full-bleed)
  const bgImage = await pdfDoc.embedPng(imageBytes);
  page.drawImage(bgImage, {
    x: 0,
    y: 0,
    width: 828,
    height: 364,
  });

  const helveticaBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const helvetica = await pdfDoc.embedFont(StandardFonts.Helvetica);

  // Text color from master template: #5A4350 (rgb: 90, 67, 80)
  const textColor = rgb(90 / 255, 67 / 255, 80 / 255);

  const formattedDate = formatTicketDate(data.paidAt);
  const cleanNumber = data.couponNumber || '1501';
  const cleanName = (data.participantName || '').trim().toUpperCase();
  const cleanVillage = (data.village || 'Satulur').trim().toUpperCase();
  const cleanPhone = (data.phone || '').trim();

  // Coordinates strictly mapped from Vinayaka_Chavithi_Coupon_Editable.docx VML boxes:
  // In PDF, Y = 364 - Word_Margin_Top - Font_Baseline_Offset

  // 1. Stub: Coupon Number (Word: margin-left: 91.6pt, margin-top: 119.7pt)
  page.drawText(cleanNumber, {
    x: 92,
    y: 364 - 119.7 - 13,
    size: 11,
    font: helveticaBold,
    color: textColor,
  });

  // 2. Stub: Date (Word: margin-left: 92.2pt, margin-top: 170.9pt)
  page.drawText(formattedDate, {
    x: 92,
    y: 364 - 170.9 - 12,
    size: 10,
    font: helvetica,
    color: textColor,
  });

  // 3. Stub: Participant Name (Word: margin-left: 81.4pt, margin-top: 224.3pt)
  page.drawText(cleanName.slice(0, 24), {
    x: 82,
    y: 364 - 224.3 - 12,
    size: 10,
    font: helveticaBold,
    color: textColor,
  });

  // 4. Stub: Village (Word: margin-left: 89.5pt, margin-top: 265.8pt)
  page.drawText(cleanVillage.slice(0, 22), {
    x: 90,
    y: 364 - 265.8 - 12,
    size: 10,
    font: helvetica,
    color: textColor,
  });

  // 5. Stub: Mobile (Word: margin-left: 81.4pt, margin-top: 307.8pt)
  page.drawText(cleanPhone, {
    x: 82,
    y: 364 - 307.8 - 12,
    size: 10,
    font: helvetica,
    color: textColor,
  });

  // 6. Main: Coupon Number (Word: margin-left: 341.8pt, margin-top: 112.1pt)
  page.drawText(cleanNumber, {
    x: 342,
    y: 364 - 112.1 - 13,
    size: 11,
    font: helveticaBold,
    color: textColor,
  });

  // 7. Main: Date (Word: margin-left: 674.9pt, margin-top: 120.2pt)
  page.drawText(formattedDate, {
    x: 675,
    y: 364 - 120.2 - 12,
    size: 9.5,
    font: helvetica,
    color: textColor,
  });

  // 8. Main: Participant Name (Word: margin-left: 349.3pt, margin-top: 151.5pt)
  page.drawText(cleanName.slice(0, 36), {
    x: 350,
    y: 364 - 151.5 - 13,
    size: 11,
    font: helveticaBold,
    color: textColor,
  });

  // 9. Main: Mobile (Word: margin-left: 360.1pt, margin-top: 191.4pt)
  page.drawText(cleanPhone, {
    x: 360,
    y: 364 - 191.4 - 13,
    size: 11,
    font: helvetica,
    color: textColor,
  });

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
 * Render high-resolution raster image (PNG or JPEG) for a ticket
 * using the official master artwork and SVG text composite.
 */
export async function renderTicketRaster(data: TicketRenderData, format: 'png' | 'jpeg'): Promise<Buffer> {
  const imageBytes = await getMasterImageBuffer();
  const sharpInstance = await getSharp();

  const formattedDate = formatTicketDate(data.paidAt);
  const cleanNumber = escapeXml(data.couponNumber || '1501');
  const cleanName = escapeXml((data.participantName || '').trim().toUpperCase());
  const cleanVillage = escapeXml((data.village || 'Satulur').trim().toUpperCase());
  const cleanPhone = escapeXml((data.phone || '').trim());

  // 1536 x 674 SVG overlay aligned precisely with image1.png coordinates
  const svgOverlay = `
    <svg width="1536" height="674" viewBox="0 0 1536 674" xmlns="http://www.w3.org/2000/svg">
      <style>
        .bold { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Noto Sans", sans-serif; font-weight: 700; fill: #5A4350; }
        .regular { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Noto Sans", sans-serif; font-weight: 500; fill: #5A4350; }
      </style>
      <!-- Stub dynamic fields -->
      <text x="170" y="238" class="bold" font-size="20">${cleanNumber}</text>
      <text x="171" y="331" class="regular" font-size="18">${formattedDate}</text>
      <text x="151" y="430" class="bold" font-size="18">${cleanName.slice(0, 24)}</text>
      <text x="166" y="507" class="regular" font-size="18">${cleanVillage.slice(0, 22)}</text>
      <text x="151" y="585" class="regular" font-size="18">${cleanPhone}</text>

      <!-- Main coupon dynamic fields -->
      <text x="634" y="224" class="bold" font-size="20">${cleanNumber}</text>
      <text x="1252" y="238" class="regular" font-size="17">${formattedDate}</text>
      <text x="648" y="296" class="bold" font-size="20">${cleanName.slice(0, 36)}</text>
      <text x="668" y="370" class="regular" font-size="20">${cleanPhone}</text>
    </svg>
  `;

  let pipeline = sharpInstance(imageBytes)
    .composite([{ input: Buffer.from(svgOverlay), top: 0, left: 0 }]);

  if (format === 'png') {
    return await pipeline.png().toBuffer();
  } else {
    return await pipeline.jpeg({ quality: 95 }).toBuffer();
  }
}

/**
 * Creates a ZIP archive containing the official PDF, PNG, and DOCX files for all tickets in a booking.
 */
export async function createTicketsZipArchive(tickets: any[]): Promise<Buffer> {
  return new Promise(async (resolve, reject) => {
    const archive = archiver('zip', { zlib: { level: 9 } });
    const chunks: Buffer[] = [];

    archive.on('data', (chunk) => chunks.push(chunk));
    archive.on('end', () => resolve(Buffer.concat(chunks)));
    archive.on('error', (err) => reject(err));

    try {
      for (const t of tickets) {
        const ticketData: TicketRenderData = {
          couponNumber: t.coupon_number,
          participantName: t.holder_name,
          phone: t.phone,
          village: t.village,
          bookingPublicId: t.booking_public_id || 'YSYS-COUPON',
          ticketIndex: t.ticket_index,
          totalQuantity: t.total_quantity,
          paidAt: t.issued_at,
        };

        // Add PDF
        const pdfBuf = await renderTicketPdf(ticketData);
        archive.append(pdfBuf, { name: `Coupon-${ticketData.couponNumber}.pdf` });

        // Add PNG
        const pngBuf = await renderTicketRaster(ticketData, 'png');
        archive.append(pngBuf, { name: `Coupon-${ticketData.couponNumber}.png` });

        // Add official DOCX
        try {
          const docxBuf = await renderTicketDocx(ticketData);
          archive.append(docxBuf, { name: `Coupon-${ticketData.couponNumber}.docx` });
        } catch {
          // Ignore DOCX in zip if template cannot be zipped
        }
      }

      await archive.finalize();
    } catch (err) {
      reject(err);
    }
  });
}
