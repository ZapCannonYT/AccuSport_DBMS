import './globals.css';
import { getSession } from '@/lib/auth';
import Sidebar from '@/components/NavLinks';

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
        <div className={session ? 'shell' : ''}>
          {session && (
            <Sidebar name={session.user.name} role={role} links={[
              ['/', 'Dashboard'], ['/players', 'Players'], ['/teams', 'Teams'],
              ...(role === 'moderator' || role === 'admin' ? [['/alerts', 'Alerts']] : []),
              ...(role === 'admin' ? [['/admin', 'Admin']] : []),
            ]} />
          )}
          <main>{children}</main>
        </div>
      </body>
    </html>
  );
}
