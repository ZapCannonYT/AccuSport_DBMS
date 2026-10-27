import './globals.css';
import Link from 'next/link';
import { getSession } from '@/lib/auth';
import SignOutButton from '@/components/SignOutButton';

export const metadata = {
  title: 'AccuSports',
  description: 'Early warning of performance decline for VCT pro players',
};

export default async function RootLayout({ children }) {
  const session = await getSession();
  const role = session?.user?.role;
  return (
    <html lang="en">
      <body>
        {session && (
          <nav className="nav">
            <Link href="/" className="brand">Accu<span>Sports</span></Link>
            <Link href="/">Dashboard</Link>
            <Link href="/players">Players</Link>
            <Link href="/teams">Teams</Link>
            {(role === 'moderator' || role === 'admin') && <Link href="/alerts">Alerts</Link>}
            {role === 'admin' && <Link href="/admin">Admin</Link>}
            <span className="spacer" />
            <span className="who">{session.user.name} ({role})</span>
            <SignOutButton />
          </nav>
        )}
        <main>{children}</main>
      </body>
    </html>
  );
}
