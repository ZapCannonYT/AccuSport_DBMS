// Role-based access: every page needs a login; some need a specific role.
// API routes check the role again on the server (lib/auth.js requireRole).
import { withAuth } from 'next-auth/middleware';
import { NextResponse } from 'next/server';

const RULES = [
  { prefix: '/admin', roles: ['admin'] },
  { prefix: '/api/admin', roles: ['admin'] },
  { prefix: '/alerts', roles: ['admin', 'moderator'] },
];

export default withAuth(
  function middleware(req) {
    const role = req.nextauth.token?.role;
    const rule = RULES.find((r) => req.nextUrl.pathname.startsWith(r.prefix));
    if (rule && !rule.roles.includes(role)) {
      if (req.nextUrl.pathname.startsWith('/api/')) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }
      return NextResponse.redirect(new URL('/?denied=1', req.url));
    }
    return NextResponse.next();
  },
  { pages: { signIn: '/login' } },
);

// Everything except the login page, NextAuth's own routes and static files
export const config = {
  matcher: ['/((?!login|api/auth|_next/static|_next/image|favicon.ico).*)'],
};
