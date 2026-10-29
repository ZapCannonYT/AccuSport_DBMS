import NextAuthModule from 'next-auth';
import { authOptions } from '@/lib/auth';

// next-auth v4 is CommonJS; unwrap its default export (see lib/auth.js)
const NextAuth = NextAuthModule.default ?? NextAuthModule;
const handler = NextAuth(authOptions);
export { handler as GET, handler as POST };
