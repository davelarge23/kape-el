"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { Monitor, Smartphone, Soup, Users } from "lucide-react";
import { supabase } from "../../lib/supabase";

type OrderStatus = "New" | "For Confirmation" | "Confirmed" | "Processing" | "Completed" | "Cancelled" | "Expired";
type Order = {
  id: number;
  customer_name: string | null;
  order_number: number;
  status: OrderStatus;
  reference_number: string;
  total: number | null;
  order_archive: string;
  order_type: "individual" | "group" | null;
  order_source: "mobile" | "kiosk" | null;
  confirmed_by: string | null;
  created_at: string;
};
type ArchiveItem = { name: string; quantity: number; price: number };

const CONFIRMATION_EXPIRY_MS = 7 * 60 * 1000;
const EXPIRY_CHECK_MS = 60_000;

const columns: { status: OrderStatus; label: string; note: string }[] = [
  { status: "New", label: "New Orders", note: "Waiting to be prepared" },
  { status: "Processing", label: "Processing", note: "Currently in the kitchen" },
  { status: "Completed", label: "Finished", note: "Ready for pickup" },
  { status: "Cancelled", label: "Cancelled", note: "Removed from active workflow" },
];

function getItems(order: Order): ArchiveItem[] {
  try {
    return JSON.parse(order.order_archive).items ?? [];
  } catch {
    return [];
  }
}

function getConfirmationBadge(order: Order) {
  if (order.status === "Expired") return { label: "Expired", className: "confirmation-badge-expired" };
  if (order.status === "For Confirmation") return { label: "For Confirmation", className: "confirmation-badge-pending" };
  if (order.confirmed_by) return { label: "Confirmed", className: "confirmation-badge-confirmed" };
  if (order.status === "New") return { label: "New", className: "confirmation-badge-new" };
  const ageMs = Date.now() - new Date(order.created_at).getTime();
  if (ageMs >= CONFIRMATION_EXPIRY_MS) return { label: "Expired", className: "confirmation-badge-expired" };
  return { label: "For Confirmation", className: "confirmation-badge-pending" };
}

function isFreshOrder(createdAt: string) {
  return Date.now() - new Date(createdAt).getTime() <= 60_000;
}

export default function ManagerPage() {
  const [sessionReady, setSessionReady] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [orders, setOrders] = useState<Order[]>([]);
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [loginError, setLoginError] = useState("");
  const [actionError, setActionError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [newOrderNotice, setNewOrderNotice] = useState("");
  const noticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const notificationAudioRef = useRef<HTMLAudioElement | null>(null);
  const knownOrderIdsRef = useRef<Set<number> | null>(null);
  const [soundEnabled, setSoundEnabled] = useState(false);
  const [showExpired, setShowExpired] = useState(false);
  const [confirmLogout, setConfirmLogout] = useState(false);

  const expirePendingOrders = useCallback(async () => {
    const cutoff = new Date(Date.now() - CONFIRMATION_EXPIRY_MS).toISOString();
    await supabase.from("orders")
      .update({ status: "Expired", updated_at: new Date().toISOString() })
      .eq("status", "For Confirmation")
      .lt("created_at", cutoff);
  }, []);

  const announceNewOrder = useCallback((order: { order_number?: number; customer_name?: string | null }) => {
    const notificationAudio = notificationAudioRef.current;
    if (notificationAudio) {
      notificationAudio.currentTime = 0;
      void notificationAudio.play().catch(() => undefined);
    }
    setNewOrderNotice(`New order #${order.order_number ?? ""} from ${order.customer_name || "Guest"}`);
    if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current);
    noticeTimerRef.current = setTimeout(() => setNewOrderNotice(""), 5000);
  }, []);

  const loadOrders = useCallback(async () => {
    const { data, error } = await supabase.from("orders").select("*").order("created_at", { ascending: false });
    if (error) {
      setActionError(error.message);
      return;
    }
    const nextOrders = (data ?? []) as Order[];
    const nextIds = new Set(nextOrders.map((order) => order.id));
    if (knownOrderIdsRef.current) {
      const newOrder = nextOrders.find((order) => !knownOrderIdsRef.current?.has(order.id));
      if (newOrder) announceNewOrder(newOrder);
    }
    knownOrderIdsRef.current = nextIds;
    setOrders(nextOrders);
  }, [announceNewOrder]);

  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => {
      setAuthenticated(Boolean(data.session));
      setSessionReady(true);
      if (data.session) void loadOrders();
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      setAuthenticated(Boolean(session));
      if (session) void loadOrders();
    });
    return () => listener.subscription.unsubscribe();
  }, [loadOrders]);

  useEffect(() => {
    if (!authenticated) return;
    void expirePendingOrders();
    const channel = supabase.channel("manager-orders")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "orders" }, (payload) => {
        const newOrder = payload.new as { order_number?: number; customer_name?: string | null };
        announceNewOrder(newOrder);
        void loadOrders();
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "orders" }, () => void loadOrders())
      .subscribe();
    const refreshTimer = window.setInterval(() => void loadOrders(), 3000);
    const expiryTimer = window.setInterval(() => { void expirePendingOrders(); void loadOrders(); }, EXPIRY_CHECK_MS);
    return () => {
      if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current);
      window.clearInterval(refreshTimer);
      window.clearInterval(expiryTimer);
      void supabase.removeChannel(channel);
    };
  }, [authenticated, announceNewOrder, expirePendingOrders, loadOrders]);

  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsLoading(true);
    setLoginError("");
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) setLoginError(error.message);
    else await enableNotificationSound();
    setIsLoading(false);
  }

  async function enableNotificationSound() {
    const notificationAudio = notificationAudioRef.current;
    if (!notificationAudio) return;
    notificationAudio.volume = 0;
    await notificationAudio.play().catch(() => undefined);
    notificationAudio.pause();
    notificationAudio.currentTime = 0;
    notificationAudio.volume = 1;
    setSoundEnabled(true);
  }

  async function updateOrder(status: OrderStatus) {
    if (!selectedOrder) return;
    setIsLoading(true);
    setActionError("");
    const { error } = await supabase.from("orders").update({ status, updated_at: new Date().toISOString() }).eq("id", selectedOrder.id);
    if (error) {
      setActionError(error.message);
      setIsLoading(false);
      return;
    }
    setSelectedOrder(null);
    await loadOrders();
    setIsLoading(false);
  }

  if (!sessionReady) return <main className="manager-page manager-loading">Loading manager dashboard...</main>;

  if (!authenticated) {
    return (
      <main className="manager-page login-page">
        <audio ref={notificationAudioRef} preload="auto" src="/hanguots-notification.mp3" />
        <div className="manager-login">
          <div className="brand-mark">DknY <span>Kape EL</span></div>
          <p className="eyebrow">Manager access</p>
          <h1>Order board</h1>
          <p className="manager-copy">Sign in to receive and process customer orders.</p>
          <form onSubmit={signIn}>
            <label htmlFor="manager-email">Email</label>
            <input id="manager-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} required />
            <label htmlFor="manager-password">Password</label>
            <input id="manager-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} required />
            {loginError && <p className="order-error" role="alert">We could not sign you in. Check your credentials and try again.</p>}
            <button className="primary-button" disabled={isLoading}>{isLoading ? "Signing in..." : "Sign in"}</button>
          </form>
        </div>
      </main>
    );
  }

  return (
    <main className="manager-page">
      <audio ref={notificationAudioRef} preload="auto" src="/hanguots-notification.mp3" />
      <header className="manager-header">
        <div><p className="eyebrow">EVLWM WOW FACTOR</p><h1>Order board</h1></div>
        <div className="manager-header-actions">
          {!soundEnabled && <button className="sound-button" onClick={() => void enableNotificationSound()}>Enable sound</button>}
          <button type="button" className="expired-toggle" onClick={() => setShowExpired(true)}>Show expired orders</button>
          <button className="manager-logout" onClick={() => setConfirmLogout(true)}>Sign out</button>
        </div>
      </header>
      {actionError && <p className="order-error manager-alert" role="alert">{actionError}</p>}
      {newOrderNotice && <div className="manager-toast" role="status"><span className="manager-toast-dot" />{newOrderNotice}</div>}
      <div className="order-columns">
        {columns.map((column) => {
          const columnOrders = orders.filter((order) => column.status === "New"
            ? order.status === "New" || order.status === "For Confirmation" || order.status === "Confirmed"
            : order.status === column.status);
          return (
            <section className={`order-column order-column-${column.status.toLowerCase()}`} key={column.status}>
              <div className="column-heading"><div><h2>{column.label}</h2><p>{column.note}</p></div><b>{columnOrders.length}</b></div>
              <div className="manager-order-list">
                {columnOrders.map((order) => {
                  const confirmationBadge = column.status === "New" ? getConfirmationBadge(order) : null;
                  return (
                  <button className={`manager-order-card ${isFreshOrder(order.created_at) && order.status === "New" ? "fresh-order" : ""}`} key={order.id} onClick={() => setSelectedOrder(order)}>
                    <div className="order-card-top">
                      <strong className="order-card-id">#{order.order_number}</strong>
                      <span>{new Date(order.created_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</span>
                    </div>
                    {confirmationBadge && <span className={`confirmation-badge ${confirmationBadge.className}`}>{confirmationBadge.label}</span>}
                    <h3>{order.customer_name || "Guest"}</h3>
                    <div className="manager-card-items">{getItems(order).map((item) => <span key={item.name}>{item.quantity} × {item.name}</span>)}</div>
                    <div className="badge-row">
                      <span className={`badge-pill ${order.order_type === "group" ? "badge-group" : "badge-individual"}`}>{order.order_type === "group" ? <Users aria-hidden="true" /> : <Soup aria-hidden="true" />}{order.order_type === "group" ? "Group" : "Individual"}</span>
                      <span className={`badge-pill ${order.order_source === "kiosk" ? "badge-kiosk" : "badge-mobile"}`}>{order.order_source === "kiosk" ? <Monitor aria-hidden="true" /> : <Smartphone aria-hidden="true" />}{order.order_source === "kiosk" ? "Kiosk" : "Mobile"}</span>
                    </div>
                  </button>
                  );
                })}
                {columnOrders.length === 0 && <p className="column-empty">No orders here yet.</p>}
              </div>
            </section>
          );
        })}
      </div>
      {showExpired && <div className="overlay" onClick={() => setShowExpired(false)}><section className="expired-modal" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}><div className="drawer-heading"><div><p className="eyebrow">Order history</p><h2>Expired orders</h2></div><button className="close-button" onClick={() => setShowExpired(false)} aria-label="Close expired orders">×</button></div><div className="expired-list">{orders.filter((order) => order.status === "Expired").map((order) => <button className="manager-order-card" key={order.id} onClick={() => { setSelectedOrder(order); setShowExpired(false); }}><div className="order-card-top"><strong className="order-card-id">#{order.order_number}</strong><span>{new Date(order.created_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</span></div><span className="confirmation-badge confirmation-badge-expired">Expired</span><h3>{order.customer_name || "Guest"}</h3><div className="manager-card-items">{getItems(order).map((item) => <span key={item.name}>{item.quantity} × {item.name}</span>)}</div></button>)}{orders.filter((order) => order.status === "Expired").length === 0 && <p className="column-empty">No expired orders.</p>}</div></section></div>}
      {confirmLogout && <div className="overlay" onClick={() => setConfirmLogout(false)}><section className="logout-modal" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}><p className="eyebrow">Manager session</p><h2>Sign out?</h2><p>Are you sure you want to leave the order board?</p><div className="button-row"><button className="secondary-button" onClick={() => setConfirmLogout(false)}>Stay signed in</button><button className="danger-button" onClick={() => void supabase.auth.signOut()}>Sign out</button></div></section></div>}
      {selectedOrder && (
        <div className="overlay" onClick={() => setSelectedOrder(null)}>
          <section className="manager-detail" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
            <button className="close-button" onClick={() => setSelectedOrder(null)} aria-label="Close">×</button>
            <p className="eyebrow">Order #{selectedOrder.order_number}</p>
            <h2>{selectedOrder.customer_name || "Guest"}</h2>
            <p className="detail-reference">{selectedOrder.reference_number}</p>
            <div className="badge-row">
              <span className={`badge-pill ${selectedOrder.order_type === "group" ? "badge-group" : "badge-individual"}`}>{selectedOrder.order_type === "group" ? <Users aria-hidden="true" /> : <Soup aria-hidden="true" />}{selectedOrder.order_type === "group" ? "Group" : "Individual"}</span>
              <span className={`badge-pill ${selectedOrder.order_source === "kiosk" ? "badge-kiosk" : "badge-mobile"}`}>{selectedOrder.order_source === "kiosk" ? <Monitor aria-hidden="true" /> : <Smartphone aria-hidden="true" />}{selectedOrder.order_source === "kiosk" ? "Kiosk" : "Mobile"}</span>
            </div>
            {(selectedOrder.status === "New" || selectedOrder.status === "Confirmed") && (() => { const badge = getConfirmationBadge(selectedOrder); return <span className={`confirmation-badge ${badge.className}`}>{badge.label}</span>; })()}
            {selectedOrder.confirmed_by && <p className="detail-confirmed-by">Confirmed by {selectedOrder.confirmed_by}</p>}
            <div className="detail-items">{getItems(selectedOrder).map((item) => <div key={item.name}><span>{item.quantity} × {item.name}</span><strong>PHP {Number(item.price * item.quantity).toFixed(2)}</strong></div>)}</div>
            <div className="detail-total"><span>Total</span><strong>PHP {Number(selectedOrder.total ?? 0).toFixed(2)}</strong></div>
            {(selectedOrder.status === "New" || selectedOrder.status === "Confirmed") && <div className="detail-actions"><button className="danger-button" onClick={() => void updateOrder("Cancelled")} disabled={isLoading}>Cancel</button><button className="primary-button" onClick={() => void updateOrder("Processing")} disabled={isLoading}>Prepare</button></div>}
            {selectedOrder.status === "Processing" && <button className="primary-button" onClick={() => void updateOrder("Completed")} disabled={isLoading}>{isLoading ? "Updating..." : "Complete & Notify"}</button>}
            {selectedOrder.status === "Completed" && <p className="completed-note">Completed and customer notified.</p>}
            {selectedOrder.status === "Cancelled" && <p className="cancelled-note">This order is in the cancelled tab.</p>}
          </section>
        </div>
      )}
    </main>
  );
}
