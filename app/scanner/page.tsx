"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { supabase } from "../../lib/supabase";

type ScanState = "idle" | "starting" | "scanning" | "confirming" | "success" | "error";

function getReferenceFromScan(value: string) {
  try {
    const url = new URL(value);
    return url.searchParams.get("reference")?.trim().toUpperCase() ?? "";
  } catch {
    return value.trim().toUpperCase();
  }
}

export default function ScannerPage() {
  const scannerRef = useRef<{ stop: () => Promise<void>; clear: () => void } | null>(null);
  const permissionRequestedRef = useRef(false);
  const [sessionReady, setSessionReady] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authError, setAuthError] = useState("");
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [scanState, setScanState] = useState<ScanState>("idle");
  const [reference, setReference] = useState("");
  const [message, setMessage] = useState("Tap start scanner and allow camera access.");

  useEffect(() => () => {
    if (scannerRef.current) void scannerRef.current.stop().catch(() => undefined);
  }, []);

  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => {
      setAuthenticated(Boolean(data.session));
      setSessionReady(true);
    });
  }, []);

  async function signIn(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSigningIn(true);
    setAuthError("");
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) setAuthError(error.message);
    else setAuthenticated(true);
    setIsSigningIn(false);
  }

  async function stopScanner() {
    if (!scannerRef.current) return;
    await scannerRef.current.stop().catch(() => undefined);
    scannerRef.current.clear();
    scannerRef.current = null;
  }

  async function confirmReference(nextReference: string) {
    const cleanReference = getReferenceFromScan(nextReference);
    if (!cleanReference) {
      setScanState("error");
      setMessage("That QR code does not contain a valid order reference.");
      return;
    }

    setReference(cleanReference);
    setScanState("confirming");
    setMessage("Checking order...");
    await stopScanner();

    const { data, error } = await supabase
      .from("orders")
      .select("id, status")
      .eq("reference_number", cleanReference)
      .maybeSingle();

    if (error) {
      setScanState("error");
      setMessage(error.message.includes("JWT") ? "Please sign in as staff before confirming an order." : "We could not check that order. Please try again.");
      return;
    }

    if (!data) {
      setScanState("error");
      setMessage("No order was found for this QR code.");
      return;
    }

    if (data.status !== "New") {
      setScanState("error");
      setMessage(`This order is already marked as ${data.status}.`);
      return;
    }

    const { error: updateError } = await supabase
      .from("orders")
      .update({ status: "Processing", updated_at: new Date().toISOString() })
      .eq("id", data.id);

    if (updateError) {
      setScanState("error");
      setMessage(updateError.message.includes("row-level security")
        ? "Staff sign-in is required before confirming orders."
        : "We could not confirm that order. Please try again.");
      return;
    }

    setScanState("success");
    setMessage("Order confirmed and sent to the kitchen.");
  }

  async function startScanner() {
    setScanState("starting");
    setMessage(permissionRequestedRef.current ? "Starting camera..." : "Requesting camera access one time...");

    try {
      if (navigator.permissions?.query) {
        const permission = await navigator.permissions.query({ name: "camera" as PermissionName });
        if (permission.state === "denied") {
          throw new Error("camera-permission-denied");
        }
      }

      permissionRequestedRef.current = true;
      const { Html5Qrcode } = await import("html5-qrcode");
      const scanner = new Html5Qrcode("order-qr-reader");
      scannerRef.current = scanner;
      await scanner.start(
        { facingMode: "environment" },
        { fps: 10, qrbox: { width: 240, height: 240 } },
        (decodedText) => { void confirmReference(decodedText); },
        () => undefined,
      );
      setScanState("scanning");
      setMessage("Point the phone camera at the customer QR code.");
    } catch (error) {
      scannerRef.current = null;
      setScanState("error");
      setMessage(error instanceof Error && error.message === "camera-permission-denied"
        ? "Camera access is blocked. Open your phone browser site settings and set Camera to Allow, then reload this page."
        : "Camera access was requested once but is unavailable. Use HTTPS and allow Camera in your phone browser settings.");
    }
  }

  function resetScanner() {
    setReference("");
    setScanState("idle");
    setMessage("Tap start scanner and allow camera access.");
  }

  if (!sessionReady) {
    return <main className="scanner-page"><div className="scanner-shell"><p className="scanner-message">Checking staff access...</p></div></main>;
  }

  if (!authenticated) {
    return (
      <main className="scanner-page">
        <div className="scanner-shell">
          <Link className="brand-mark" href="/">DknY <span>Kape EL</span></Link>
          <section className="scanner-card scanner-login">
            <p className="eyebrow">Staff scanner</p>
            <h1>Staff sign in</h1>
            <p className="scanner-copy">Sign in before scanning so the order can be safely moved to Processing.</p>
            <form onSubmit={signIn} className="scanner-login-form">
              <label htmlFor="scanner-email">Email</label>
              <input id="scanner-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} required />
              <label htmlFor="scanner-password">Password</label>
              <input id="scanner-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} required />
              {authError && <p className="order-error" role="alert">We could not sign you in. Check your staff credentials and try again.</p>}
              <button type="submit" className="primary-button" disabled={isSigningIn}>{isSigningIn ? "Signing in..." : "Sign in to scan"}</button>
            </form>
          </section>
        </div>
      </main>
    );
  }

  return (
    <main className="scanner-page">
      <div className="scanner-shell">
        <Link className="brand-mark" href="/">DknY <span>Kape EL</span></Link>
        <section className="scanner-card">
          <p className="eyebrow">Staff scanner</p>
          <h1>Scan an order</h1>
          <p className="scanner-copy">Camera permission is requested once. Scan the customer&apos;s QR code inside the frame to send it to the kitchen.</p>
          <div className="scanner-frame" id="order-qr-reader" aria-label="Order QR scanner" />
          <p className={`scanner-message scanner-${scanState}`} role="status">{message}</p>
          {reference && <p className="scanner-reference">{reference}</p>}
          <div className="scanner-actions">
            {(scanState === "idle" || scanState === "error") && <button type="button" className="primary-button" onClick={() => void startScanner()}>Start scanner</button>}
            {(scanState === "success" || scanState === "error") && <button type="button" className="secondary-button" onClick={resetScanner}>Scan another order</button>}
          </div>
        </section>
      </div>
    </main>
  );
}