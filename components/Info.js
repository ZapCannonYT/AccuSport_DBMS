'use client';
// Small "i" icon. Hover, focus or click opens a pop-up placed next to the icon
// (fixed position computed from the icon, kept inside the window).
import { useRef, useState } from 'react';

export default function Info({ children, label = 'More information' }) {
  const ref = useRef(null);
  const [pop, setPop] = useState(null);

  function open() {
    const r = ref.current.getBoundingClientRect();
    const width = Math.min(340, window.innerWidth - 24);
    const left = Math.min(Math.max(12, r.left + r.width / 2 - width / 2), window.innerWidth - width - 12);
    const above = r.bottom + 260 > window.innerHeight && r.top > 260;      // not enough room below: open upwards
    setPop({ left, width, ...(above ? { bottom: window.innerHeight - r.top + 8 } : { top: r.bottom + 8 }) });
  }
  const close = () => setPop(null);

  return (
    <span className="info" ref={ref} tabIndex={0} role="note" aria-label={label}
      onMouseEnter={open} onMouseLeave={close} onFocus={open} onBlur={close}
      onClick={() => (pop ? close() : open())} onKeyDown={(e) => e.key === 'Escape' && close()}>
      <span className="info-icon" aria-hidden="true">i</span>
      {pop && <span className="info-pop" style={pop}>{children}</span>}
    </span>
  );
}
