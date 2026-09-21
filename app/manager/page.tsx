"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { Soup, Users } from "lucide-react";
import { supabase } from "../../lib/supabase";

type OrderStatus = "New" | "Processing" | "Completed" | "Cancelled";
type Order = {
  id: number;
  customer_name: string | null;
  order_number: number;
  status: OrderStatus;
  reference_number: string;
  total: number | null;
  order_archive: string;
  order_type: "individual" | "group" | null;
  created_at: string;
};
type ArchiveItem = { name: string; quantity: number; price: number };

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

  async function loadOrders() {
    const { data, error } = await supabase.from("orders").select("*").order("created_at", { ascending: false });
    if (error) {
      setActionError(error.message);
      return;
    }
    setOrders((data ?? []) as Order[]);
  }

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
  }, []);

  useEffect(() => {
    if (!authenticated) return;
    const channel = supabase.channel("manager-orders")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "orders" }, (payload) => {
        const newOrder = payload.new as { order_number?: number; customer_name?: string | null };
        const notificationAudio = notificationAudioRef.current;
        if (notificationAudio) {
          notificationAudio.currentTime = 0;
          void notificationAudio.play().catch(() => undefined);
        }
        setNewOrderNotice(`New order #${newOrder.order_number ?? ""} from ${newOrder.customer_name || "Guest"}`);
        if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current);
        noticeTimerRef.current = setTimeout(() => setNewOrderNotice(""), 5000);
        void loadOrders();
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "orders" }, () => void loadOrders())
      .subscribe();
    const refreshTimer = window.setInterval(() => void loadOrders(), 3000);
    return () => {
      if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current);
      window.clearInterval(refreshTimer);
      void supabase.removeChannel(channel);
    };
  }, [authenticated]);

  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsLoading(true);
    setLoginError("");
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) setLoginError(error.message);
    setIsLoading(false);
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
        <button className="manager-logout" onClick={() => void supabase.auth.signOut()}>Sign out</button>
      </header>
      {actionError && <p className="order-error manager-alert" role="alert">{actionError}</p>}
      {newOrderNotice && <div className="manager-toast" role="status"><span className="manager-toast-dot" />{newOrderNotice}</div>}
      <div className="order-columns">
        {columns.map((column) => {
          const columnOrders = orders.filter((order) => order.status === column.status);
          return (
            <section className={`order-column order-column-${column.status.toLowerCase()}`} key={column.status}>
              <div className="column-heading"><div><h2>{column.label}</h2><p>{column.note}</p></div><b>{columnOrders.length}</b></div>
              <div className="manager-order-list">
                {columnOrders.map((order) => (
                  <button className={`manager-order-card ${isFreshOrder(order.created_at) && order.status === "New" ? "fresh-order" : ""}`} key={order.id} onClick={() => setSelectedOrder(order)}>
                    <div className="order-card-top"><strong>#{order.order_number}</strong><span className="order-type-icon" title={order.order_type === "group" ? "Group order" : "Individual order"}>{order.order_type === "group" ? <Users aria-hidden="true" /> : <Soup aria-hidden="true" />}</span><span>{new Date(order.created_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</span></div>
                    <h3>{order.customer_name || "Guest"}</h3>
                    <p>{order.reference_number}</p>
                    <strong className="card-total">PHP {Number(order.total ?? 0).toFixed(2)}</strong>
                  </button>
                ))}
                {columnOrders.length === 0 && <p className="column-empty">No orders here yet.</p>}
              </div>
            </section>
          );
        })}
      </div>
      {selectedOrder && (
        <div className="overlay" onClick={() => setSelectedOrder(null)}>
          <section className="manager-detail" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
            <button className="close-button" onClick={() => setSelectedOrder(null)} aria-label="Close">×</button>
            <p className="eyebrow">Order #{selectedOrder.order_number}</p>
            <h2>{selectedOrder.customer_name || "Guest"}</h2>
            <p className="detail-reference">{selectedOrder.reference_number}</p>
            <p className="detail-order-type">{selectedOrder.order_type === "group" ? <Users aria-hidden="true" /> : <Soup aria-hidden="true" />} {selectedOrder.order_type === "group" ? "Group order" : "Individual order"}</p>
            <div className="detail-items">{getItems(selectedOrder).map((item) => <div key={item.name}><span>{item.quantity} × {item.name}</span><strong>PHP {Number(item.price * item.quantity).toFixed(2)}</strong></div>)}</div>
            <div className="detail-total"><span>Total</span><strong>PHP {Number(selectedOrder.total ?? 0).toFixed(2)}</strong></div>
            {selectedOrder.status === "New" && <div className="detail-actions"><button className="danger-button" onClick={() => void updateOrder("Cancelled")} disabled={isLoading}>Cancel</button><button className="primary-button" onClick={() => void updateOrder("Processing")} disabled={isLoading}>Prepare</button></div>}
            {selectedOrder.status === "Processing" && <button className="primary-button" onClick={() => void updateOrder("Completed")} disabled={isLoading}>{isLoading ? "Updating..." : "Complete & Notify"}</button>}
            {selectedOrder.status === "Completed" && <p className="completed-note">Completed and customer notified.</p>}
            {selectedOrder.status === "Cancelled" && <p className="cancelled-note">This order is in the cancelled tab.</p>}
          </section>
        </div>
      )}
    </main>
  );
}
