"use client";

import { useEffect, useState } from "react";

export function OrderIntro() {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const timer = window.setTimeout(() => setVisible(false), 1700);
    return () => window.clearTimeout(timer);
  }, []);

  if (!visible) return null;

  return (
    <div className="order-intro" aria-hidden="true">
      <div className="order-intro-lockup">
        <p className="order-intro-eyebrow">DKnY <span>Kape EL</span></p>
        <strong>WOW FACTOR</strong>
        <span className="order-intro-line" />
      </div>
    </div>
  );
}
