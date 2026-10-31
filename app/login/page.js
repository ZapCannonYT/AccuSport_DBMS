'use client';
import { useState } from 'react';
import { signIn } from 'next-auth/react';

// One-click demo logins. These are the seeded accounts from scripts/seed.mjs.
const DEMO_PASSWORD = 'password123';
const DEMO_ACCOUNTS = [
  { role: 'Admin', email: 'admin@accusports.test' },
  { role: 'Moderator', email: 'mod1@accusports.test' },
  { role: 'Analyst', email: 'analyst1@accusports.test' },
];

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function login(em, pw) {
    setBusy(true);
    setError('');
    const res = await signIn('credentials', { email: em, password: pw, redirect: false });
    setBusy(false);
    if (res?.ok) window.location.href = '/';
    else setError('Wrong email or password.');
  }

  function onSubmit(e) {
    e.preventDefault();
    login(email, password);
  }

  return (
    <div className="login card">
      <h1>Accu<span style={{ color: 'var(--accent)' }}>Sports</span></h1>
      <p className="sub">Early warning of performance decline for VCT pro players</p>
      <form onSubmit={onSubmit}>
        <input type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        <input type="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        <button type="submit" disabled={busy}>{busy ? 'Signing in...' : 'Sign in'}</button>
        {error && <p className="error">{error}</p>}
      </form>
      <p className="sub" style={{ margin: '18px 0 8px' }}>Quick demo login</p>
      <div style={{ display: 'flex', gap: '8px' }}>
        {DEMO_ACCOUNTS.map((a) => (
          <button key={a.role} type="button" className="secondary" style={{ flex: 1 }} disabled={busy}
            onClick={() => login(a.email, DEMO_PASSWORD)}>{a.role}</button>
        ))}
      </div>
    </div>
  );
}
