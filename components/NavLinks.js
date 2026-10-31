'use client';
// The left sidebar: brand, page links (current one highlighted), user and sign-out.
// A button collapses it to a thin strip; the choice is remembered in this browser.
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { signOut } from 'next-auth/react';

// 24x24 line icons, one per page
const ICONS = {
  '/': <><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></>,
  '/players': <><circle cx="12" cy="8" r="4" /><path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7" /></>,
  '/teams': <><circle cx="9" cy="8" r="3.5" /><path d="M2 20c0-3.6 3-6 7-6s7 2.4 7 6" /><circle cx="17.5" cy="9" r="2.5" /><path d="M18 14c2.5.4 4 2.2 4 5" /></>,
  '/alerts': <><path d="M6 9a6 6 0 1 1 12 0c0 6 2.5 7.5 2.5 7.5h-17S6 15 6 9z" /><path d="M10 20a2 2 0 0 0 4 0" /></>,
  '/admin': <path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z" />,
  out: <><path d="M9 4H5v16h4" /><path d="M16 8l4 4-4 4M20 12H9" /></>,
};
const Icon = ({ name }) => (
  <svg className="icon" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{ICONS[name]}</svg>
);

export default function Sidebar({ links, name, role }) {
  const path = usePathname();
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    try { setCollapsed(localStorage.getItem('nav-collapsed') === '1'); } catch { /* storage blocked: stay expanded */ }
  }, []);
  function toggle() {
    setCollapsed((c) => {
      try { localStorage.setItem('nav-collapsed', c ? '0' : '1'); } catch { /* ignore */ }
      return !c;
    });
  }

  return (
    <nav className={`nav${collapsed ? ' collapsed' : ''}`}>
      <div className="nav-top">
        <Link href="/" className="brand" title="AccuSports"><span className="mark">A</span><span className="lbl">Accu<b>Sports</b></span></Link>
        <button type="button" className="nav-toggle" onClick={toggle}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d={collapsed ? 'M9 6l6 6-6 6' : 'M15 6l-6 6 6 6'} />
          </svg>
        </button>
      </div>
      {links.map(([href, label]) => {
        const active = href === '/' ? path === '/' : path.startsWith(href);
        return (
          <Link key={href} href={href} className={active ? 'active' : ''} title={label}>
            <Icon name={href} /><span className="lbl">{label}</span>
          </Link>
        );
      })}
      <span className="spacer" />
      <span className="who lbl">{name}<br /><i>{role}</i></span>
      <button type="button" className="signout" title="Sign out" onClick={() => signOut({ callbackUrl: '/login' })}>
        <Icon name="out" /><span className="lbl">Sign out</span>
      </button>
    </nav>
  );
}
