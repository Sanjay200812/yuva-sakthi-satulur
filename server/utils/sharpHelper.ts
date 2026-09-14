/**
 * Lazy Sharp Loader
 * Prevents module-level crashes on serverless environments (e.g. AWS Lambda / Vercel)
 * where pre-compiled native Linux binaries might be missing or fail to initialize on container boot.
 */

let sharpInstance: any = null;
let sharpLoadAttempted = false;

export async function getSharp(): Promise<any | null> {
  if (sharpInstance) {
    return sharpInstance;
  }
  if (sharpLoadAttempted) {
    return null;
  }
  sharpLoadAttempted = true;

  try {
    const mod = await import('sharp');
    sharpInstance = mod.default || mod;
    return sharpInstance;
  } catch (err: any) {
    console.warn('⚠️ Sharp native image library is not available in this environment:', err?.message || err);
    return null;
  }
}
