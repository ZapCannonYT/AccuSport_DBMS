// Login with email + password (NextAuth credentials provider).
// Passwords are checked against the bcrypt hash in users.password_hash;
// the user's role is stored in the signed session token.
import CredentialsModule from 'next-auth/providers/credentials';
import { getServerSession } from 'next-auth';
import bcrypt from 'bcryptjs';
import { query } from './db';

// next-auth v4 is CommonJS; in this ES-module project its default export can
// arrive wrapped as { default: fn }
const CredentialsProvider = CredentialsModule.default ?? CredentialsModule;

export const authOptions = {
  session: { strategy: 'jwt', maxAge: 8 * 60 * 60 },
  pages: { signIn: '/login' },
  providers: [
    CredentialsProvider({
      name: 'Email and password',
      credentials: { email: { label: 'Email' }, password: { label: 'Password', type: 'password' } },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null;
        const { rows: [user] } = await query(
          'SELECT user_id, email, password_hash, display_name, role FROM users WHERE lower(email) = lower($1)',
          [credentials.email]);
        if (!user || !(await bcrypt.compare(credentials.password, user.password_hash))) return null;
        return { id: String(user.user_id), email: user.email, name: user.display_name, role: user.role };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) token.role = user.role;
      return token;
    },
    async session({ session, token }) {
      session.user.id = Number(token.sub);
      session.user.role = token.role;
      return session;
    },
  },
};

export const getSession = () => getServerSession(authOptions);

// For API routes: returns the session, or null if the user lacks one of the roles
export async function requireRole(...roles) {
  const session = await getSession();
  if (!session || (roles.length && !roles.includes(session.user.role))) return null;
  return session;
}

export const forbidden = () => Response.json({ error: 'Forbidden' }, { status: 403 });
