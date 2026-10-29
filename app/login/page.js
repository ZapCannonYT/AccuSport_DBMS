'use client';
import { useState } from 'react';
import { signIn } from 'next-auth/react';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function onSubmit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    const res = await signIn('credentials', { email, password, redirect: false });
    setBusy(false);
    if (res?.ok) window.location.href = '/';
    else setError('Wrong email or password.');
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
    </div>
  );
}
