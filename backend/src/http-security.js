import { HttpError } from './domain.js';

export const localHosts = ['localhost', '127.0.0.1', '[::1]'];

export function protectRequests(config) {
  const allowedOrigins = new Set([config.origin]);
  if (config.demo) {
    for (const host of localHosts) {
      allowedOrigins.add(`http://${host}:5173`);
      allowedOrigins.add(`http://${host}:${config.port}`);
    }
  }
  return (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      const origin = req.get('Origin');
      if (req.get('Sec-Fetch-Site') === 'cross-site' || (origin && !allowedOrigins.has(origin))) {
        return next(new HttpError(403, 'Yêu cầu từ nguồn không hợp lệ.'));
      }
    }
    next();
  };
}

export function securityHeaders(config) {
  return (req, res, next) => {
    res.set({
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'Permissions-Policy': 'geolocation=(self), camera=(), microphone=()',
      'Content-Security-Policy': ["default-src 'self'", "script-src 'self'", "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
        "font-src 'self' https://fonts.gstatic.com", "img-src 'self' data: https://tile.openstreetmap.org", "object-src 'none'",
        "frame-ancestors 'none'", "base-uri 'none'", "form-action 'self'"].join('; '),
    });
    if (config.secure) res.set('Strict-Transport-Security', 'max-age=31536000');
    if (config.demo && !localHosts.includes(req.hostname)) {
      return next(new HttpError(403, 'Chế độ thử chỉ mở trên máy này.'));
    }
    next();
  };
}
