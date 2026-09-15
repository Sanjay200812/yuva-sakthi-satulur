/**
 * Secure Authorized File Download Helper
 * Downloads protected coupon artifacts (PDF, PNG, JPEG, DOCX, ZIP) using in-memory
 * Bearer download tokens or admin session cookies without leaking tokens in URLs or browser history.
 */

export interface DownloadResult {
  success: boolean;
  error?: string;
}

export async function downloadAuthorizedFile(
  url: string,
  token?: string,
  suggestedFilename?: string
): Promise<DownloadResult> {
  try {
    const headers: Record<string, string> = {};
    if (token && token.trim().length > 0) {
      headers['Authorization'] = `Bearer ${token.trim()}`;
      headers['x-booking-token'] = token.trim();
    }

    const response = await fetch(url, {
      method: 'GET',
      headers,
      credentials: 'include',
    });

    if (!response.ok) {
      if (response.status === 401) {
        return {
          success: false,
          error: 'Your secure download session is no longer available. Please reopen your confirmed booking.',
        };
      }
      if (response.status === 403) {
        return {
          success: false,
          error: 'This coupon is not available for download until payment verification is complete.',
        };
      }
      if (response.status === 404) {
        return {
          success: false,
          error: 'Coupon not found.',
        };
      }
      if (response.status >= 500) {
        return {
          success: false,
          error: 'Unable to generate coupon right now. Please try again.',
        };
      }

      const errText = await response.text().catch(() => '');
      return {
        success: false,
        error: errText || `Download failed (${response.status}).`,
      };
    }

    // Determine filename from Content-Disposition header if available
    let filename = suggestedFilename;
    const disposition = response.headers.get('content-disposition');
    if (disposition) {
      const match = disposition.match(/filename=["']?([^"';]+)["']?/i);
      if (match && match[1]) {
        filename = match[1].trim();
      }
    }

    if (!filename) {
      filename = 'coupon-pass';
    }

    const blob = await response.blob();
    const objectUrl = window.URL.createObjectURL(blob);
    const tempLink = document.createElement('a');
    tempLink.href = objectUrl;
    tempLink.download = filename;
    tempLink.style.display = 'none';
    document.body.appendChild(tempLink);
    tempLink.click();

    setTimeout(() => {
      document.body.removeChild(tempLink);
      window.URL.revokeObjectURL(objectUrl);
    }, 150);

    return { success: true };
  } catch (err: any) {
    console.error('Secure file download failed:', err);
    return {
      success: false,
      error: err?.message || 'Download failed due to a network issue. Please check your connection and try again.',
    };
  }
}
