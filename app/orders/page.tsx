"use client";

import Link from "next/link";
import { Lottie } from "lottie-react";
import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";
import coffeeAnimation from "../../public/Coffee.json";
import butterAnimation from "../../public/Spreading_butter.json";

type Order = {
  id: number;
  order_number: number;
  customer_name: string | null;
  status: string;
  updated_at: string;
};

function displayOrders(orders: Order[], statuses: string[]) {
  return orders.filter((order) => statuses.includes(order.status));
}

function displayReadyOrders(orders: Order[]) {
  const readyCutoff = Date.now() - 3 * 60 * 1000;
  return orders.filter((order) => order.status === "Completed" && new Date(order.updated_at).getTime() >= readyCutoff);
}

export default function OrdersBoardPage() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [error, setError] = useState("");
  const [animationIndex, setAnimationIndex] = useState(0);

  async function loadOrders() {
    const { data, error: fetchError } = await supabase
      .from("orders")
      .select("id, order_number, customer_name, status, updated_at")
      .in("status", ["Confirmed", "Processing", "Completed"])
      .order("created_at", { ascending: true });

    if (fetchError) {
      setError("We could not load the order board right now.");
      return;
    }

    setOrders((data ?? []) as Order[]);
    setError("");
  }

  useEffect(() => {
    const initialLoad = window.setTimeout(() => void loadOrders(), 0);
    const interval = window.setInterval(() => void loadOrders(), 60_000);
    const channel = supabase
      .channel("customer-order-board")
      .on("postgres_changes", { event: "*", schema: "public", table: "orders" }, () => void loadOrders())
      .subscribe();

    return () => {
      window.clearTimeout(initialLoad);
      window.clearInterval(interval);
      void supabase.removeChannel(channel);
    };
  }, []);

  useEffect(() => {
    const animationTimer = window.setInterval(() => {
      setAnimationIndex((current) => (current + 1) % 2);
    }, 5000);
    return () => window.clearInterval(animationTimer);
  }, []);

  const preparingOrders = displayOrders(orders, ["Confirmed", "Processing"]);
  const readyOrders = displayReadyOrders(orders);

  return (
    <main className="customer-board-page">
      <header className="customer-board-header">
        <Link className="brand-mark" href="/">DknY <span>Kape EL</span></Link>
        <div><p className="eyebrow">Customer order board</p><h1>Order status</h1></div>
      </header>
      {error && <p className="order-error customer-board-error">{error}</p>}
      <div className="customer-board-layout">
        <section className="customer-board-statuses">
          <div className="customer-status-column preparing-column">
            <div className="customer-status-heading"><div><p className="eyebrow">Now preparing</p><h2>Preparing</h2></div><b>{preparingOrders.length}</b></div>
            <div className="customer-status-list">
              {preparingOrders.map((order) => <article className="customer-order-card" key={order.id}><span>#{order.order_number}</span><strong>{order.customer_name || "Guest"}</strong></article>)}
              {preparingOrders.length === 0 && <p className="customer-board-empty">No orders preparing.</p>}
            </div>
          </div>
          <div className="customer-status-column ready-column">
            <div className="customer-status-heading"><div><p className="eyebrow">Ready to collect</p><h2>Ready</h2></div><b>{readyOrders.length}</b></div>
            <div className="customer-status-list">
              {readyOrders.map((order) => <article className="customer-order-card" key={order.id}><span>#{order.order_number}</span><strong>{order.customer_name || "Guest"}</strong></article>)}
              {readyOrders.length === 0 && <p className="customer-board-empty">No orders ready yet.</p>}
            </div>
          </div>
        </section>
        <aside className="customer-board-art" aria-hidden="true">
          {animationIndex === 0 ? <Lottie key="coffee" src={coffeeAnimation} loop autoplay /> : <Lottie key="butter" src={butterAnimation} loop autoplay />}
        </aside>
      </div>
    </main>
  );
}
