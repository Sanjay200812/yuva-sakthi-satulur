/**
 * Safe API Client for Yuva Shakti Portal
 * Protects against hosting error pages, 404s, and unexpected non-JSON responses
 * without throwing "Unexpected token '<' / 'T'" errors in production.
 */

export interface SafeApiResponse<T = any> {
  response: Response;
  data: T;
}

export async function safeFetchJson<T = any>(
  input: RequestInfo | URL,
  init?: RequestInit,
  serviceContext: string = 'Service'
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(input, init);
  } catch (netErr: any) {
    console.error(`[Network Error] Failed to reach ${String(input)}:`, netErr);
    throw new Error(`${serviceContext} is currently unreachable. Please check your internet connection and try again.`);
  }

  const contentType = response.headers.get('content-type') || '';

  // If server returned non-JSON (e.g., hosting 404 HTML, 502 Bad Gateway, SPA index.html)
  if (!contentType.includes('application/json')) {
    const rawText = await response.text().catch(() => '');
    console.error(
      `[API Error] Expected JSON from ${String(input)}, received status ${response.status} with content-type "${contentType}":`,
      rawText.slice(0, 300)
    );

    if (response.status === 404) {
      throw new Error(`${serviceContext} endpoint was not found or deployment routing is incorrect (HTTP 404).`);
    }

    if (response.status >= 500) {
      throw new Error(`${serviceContext} is temporarily unavailable. Please try again in a few moments (HTTP ${response.status}).`);
    }

    throw new Error(`${serviceContext} is temporarily unavailable. Please try again.`);
  }

  let parsed: any;
  try {
    parsed = await response.json();
  } catch (jsonErr: any) {
    console.error(`[JSON Parse Error] Invalid JSON payload received from ${String(input)}:`, jsonErr);
    throw new Error(`${serviceContext} returned an unreadable response format.`);
  }

  if (!response.ok) {
    const serverMessage =
      parsed?.error?.message ||
      parsed?.message ||
      `${serviceContext} returned an error (HTTP ${response.status}).`;
    const error = new Error(serverMessage);
    (error as any).status = response.status;
    (error as any).code = parsed?.error?.code || 'API_ERROR';
    (error as any).payload = parsed;
    throw error;
  }

  return parsed;
}
