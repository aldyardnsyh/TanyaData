/**
 * CORS + preflight untuk split deploy (P6-FIX / SP-3 / DECISION-029).
 *
 * Frontend Vercel memanggil backend VPS lintas origin. Allow-list berasal dari
 * `CORS_ALLOWED_ORIGINS` (fallback `APP_ORIGIN`) — bukan `*`, tanpa credentials.
 * `content-disposition` diekspos agar download PDF/XLSX/CSV via blob()
 * tetap bisa membaca nama file.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getCorsOrigins } from '@/lib/config/origin';

const ALLOW_METHODS = 'GET, POST, PUT, DELETE, OPTIONS';
const ALLOW_HEADERS = 'content-type, authorization, x-request-id';
const EXPOSE_HEADERS = 'content-disposition';

export function middleware(request: NextRequest) {
  const origin = request.headers.get('origin');
  const allowed = getCorsOrigins();
  const isAllowed = Boolean(origin && allowed.includes(origin));

  if (request.method === 'OPTIONS') {
    const response = new NextResponse(null, { status: 204 });
    response.headers.set('Vary', 'Origin');
    if (isAllowed && origin) {
      response.headers.set('Access-Control-Allow-Origin', origin);
      response.headers.set('Access-Control-Allow-Methods', ALLOW_METHODS);
      response.headers.set('Access-Control-Allow-Headers', ALLOW_HEADERS);
      response.headers.set('Access-Control-Expose-Headers', EXPOSE_HEADERS);
      response.headers.set('Access-Control-Max-Age', '600');
    }
    return response;
  }

  const response = NextResponse.next();
  response.headers.set('Vary', 'Origin');
  if (isAllowed && origin) {
    response.headers.set('Access-Control-Allow-Origin', origin);
    response.headers.set('Access-Control-Expose-Headers', EXPOSE_HEADERS);
  }
  return response;
}

export const config = {
  matcher: ['/api/:path*'],
};
