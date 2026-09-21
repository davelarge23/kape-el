"use client";

import Image from "next/image";
import { Soup, Users } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { supabase } from "../../lib/supabase";

type Product = {
  id: string;
  name: string;
  description: string;
  category: "Drinks" | "Bread";
  price: number;
  image: string;
};

type BasketItem = Product & { quantity: number };
type OrderType = "individual" | "group";

const products: Product[] = [
  { id: "dalina", name: "Dalina Coffee", description: "Dalgona Coffee", category: "Drinks", price: 0, image: "/menu-assets/Dalina-Coffee.png" },
  { id: "permika", name: "Permika Latte", description: "Spanish Latte", category: "Drinks", price: 0, image: "/menu-assets/Permika-Latte.png" },
  { id: "fruit", name: "Fruit of Knowledge Soda", description: "Green Apple Fruit Soda", category: "Drinks", price: 0, image: "/menu-assets/Fruit-Of-Knowledge-Soda.png" },
  { id: "kofinoy", name: "KoFinoy", description: "Cafe Filipino", category: "Drinks", price: 0, image: "/menu-assets/KoFinoy.png" },
  { id: "pankekayo", name: "Pankekayo", description: "OG Filipino Style Pancake", category: "Bread", price: 0, image: "/menu-assets/Pankekayo.png" },
  { id: "pandasal", name: "Pandesal", description: "Classic Pandesal", category: "Bread", price: 0, image: "/menu-assets/Pandasal.png" },
];

const peso = new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" });
const ORDER_COOLDOWN_MS = 15000;
let fallbackOrderSequence = 0;

function getNow() {
  return Date.now();
}

function isSessionCoolingDown() {
  if (typeof window === "undefined") return false;
  const lastOrderAt = Number(window.localStorage.getItem("dkny-last-order-at") ?? "0");
  return getNow() - lastOrderAt < ORDER_COOLDOWN_MS;
}

function markSessionAsOrdered() {
  if (typeof window === "undefined") return;
  window.localStorage.setItem("dkny-last-order-at", String(getNow()));
}

function createSessionId() {
  const values = new Uint32Array(4);
  if (typeof globalThis.crypto?.getRandomValues === "function") {
    globalThis.crypto.getRandomValues(values);
    return Array.from(values, (value) => value.toString(36).padStart(2, "0")).join("").slice(0, 12).toUpperCase();
  }
  return `SESSION-${String(Date.now()).slice(-8)}`;
}

function getOrCreateSessionId() {
  if (typeof window === "undefined") return "SERVER-SESSION";

  const params = new URLSearchParams(window.location.search);
  const qrSession = params.get("session");
  const key = "dkny-session-id";

  if (qrSession) {
    window.localStorage.setItem(key, qrSession);
    return qrSession;
  }

  const existing = window.localStorage.getItem(key);
  if (existing) return existing;

  const next = createSessionId();
  window.localStorage.setItem(key, next);
  return next;
}

function createOrderToken() {
  const values = new Uint32Array(2);
  if (typeof globalThis.crypto?.getRandomValues === "function") {
    globalThis.crypto.getRandomValues(values);
    return `${values[0].toString(16)}${values[1].toString(16)}`.toUpperCase();
  }
  fallbackOrderSequence += 1;
  return `ORDER${String(fallbackOrderSequence).padStart(6, "0")}`;
}

export default function OrderPage() {
  const [basket, setBasket] = useState<BasketItem[]>([]);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [showBasket, setShowBasket] = useState(false);
  const [customerName, setCustomerName] = useState("");
  const [confirmOrder, setConfirmOrder] = useState(false);
  const [isPlacingOrder, setIsPlacingOrder] = useState(false);
  const [orderError, setOrderError] = useState("");
  const [basketError, setBasketError] = useState("");
  const [order, setOrder] = useState<{ queue: string; reference: string; name: string; status: string } | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [showScanConfirmation, setShowScanConfirmation] = useState(false);
  const notifiedReference = useRef("");
  const [orderType, setOrderType] = useState<OrderType | null>(null);

  const totalItems = basket.reduce((sum, item) => sum + item.quantity, 0);
  const total = basket.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const orderReference = order?.reference;
  const maxItemsPerCategory = orderType === "group" ? 5 : 1;

  function addToBasket() {
    if (!selectedProduct) return;
    const categoryTotal = basket.filter((item) => item.category === selectedProduct.category).reduce((sum, item) => sum + item.quantity, 0);
    if (!orderType) return;
    if (categoryTotal + quantity > maxItemsPerCategory) {
      setBasketError(`Limit reached: ${orderType === "individual" ? "individual orders allow 1 drink and 1 bread" : "group orders allow up to 5 drinks and 5 bread items"}.`);
      return;
    }

    setBasket((current) => {
      const existing = current.find((item) => item.id === selectedProduct.id);
      return existing
        ? current.map((item) => item.id === selectedProduct.id ? { ...item, quantity: item.quantity + quantity } : item)
        : [...current, { ...selectedProduct, quantity }];
    });
    setSelectedProduct(null);
    setQuantity(1);
    setBasketError("");
  }

  function changeQuantity(id: string, amount: number) {
    const selectedItem = basket.find((item) => item.id === id);
    if (!selectedItem) return;

    if (amount > 0 && selectedItem && selectedItem.quantity >= maxItemsPerCategory) {
      setBasketError(`Limit reached: ${orderType === "individual" ? "individual orders allow 1 drink and 1 bread" : "group orders allow up to 5 drinks and 5 bread items"}.`);
      return;
    }
    setBasket((current) => current.flatMap((item) => item.id === id
      ? item.quantity + amount > 0 ? [{ ...item, quantity: item.quantity + amount }] : []
      : [item]));
  }

  function proceedToOrder(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!customerName.trim() || basket.length === 0) return;
    setOrderError("");
    setConfirmOrder(true);
  }

  async function placeOrder() {
    if (!customerName.trim() || basket.length === 0) return;
    const sessionId = getOrCreateSessionId();

    if (isSessionCoolingDown()) {
      setOrderError("Please wait a moment before placing another order from this session.");
      setIsPlacingOrder(false);
      return;
    }

    setIsPlacingOrder(true);
    setOrderError("");

    const recentCheck = await supabase
      .from("orders")
      .select("id")
      .eq("session_id", sessionId)
      .gte("created_at", new Date(getNow() - ORDER_COOLDOWN_MS).toISOString())
      .limit(1);

    if (recentCheck.error) {
      setOrderError(recentCheck.error.message ?? "We could not verify your session.");
      setIsPlacingOrder(false);
      return;
    }

    if ((recentCheck.data ?? []).length > 0) {
      setOrderError("This session already submitted an order recently. Please wait before ordering again.");
      setIsPlacingOrder(false);
      return;
    }

    const orderToken = createOrderToken();
    const orderNumber = parseInt(orderToken.slice(0, 6), 16) || 1;
    const queue = `A-${String(orderNumber).padStart(6, "0")}`;
    const reference = `DK-${orderToken.slice(0, 6)}`;

    const { error } = await supabase.from("orders").insert({
      order_archive: JSON.stringify({
        items: basket.map(({ id, name, quantity, price }) => ({ id, name, quantity, price })),
        total,
      }),
      session_id: sessionId,
      customer_name: customerName.trim(),
      order_number: orderNumber,
      status: "New",
      reference_number: reference,
      order_type: orderType,
      total,
    });

    if (error) {
      setOrderError(error.message ?? "We could not save your order. Please try again.");
      setIsPlacingOrder(false);
      return;
    }

    markSessionAsOrdered();

    setOrder({ queue, reference, name: customerName.trim(), status: "New" });
    setSubmitted(true);
    setShowBasket(false);
    setConfirmOrder(false);
    setIsPlacingOrder(false);
  }

  useEffect(() => {
    if (!submitted || !orderReference) return;
    let active = true;
    const applyStatus = (status?: string) => {
      if (!active || !status) return;
      if (status === "Processing" && notifiedReference.current !== orderReference) {
        notifiedReference.current = orderReference;
        setShowScanConfirmation(true);
      }
      setOrder((current) => current ? { ...current, status } : current);
    };

    const channel = supabase
      .channel(`customer-order-${orderReference}`)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "orders", filter: `reference_number=eq.${orderReference}` }, (payload) => {
        const updated = payload.new as { status?: string };
        applyStatus(updated.status);
      })
      .subscribe();

    const interval = window.setInterval(async () => {
      const { data } = await supabase.from("orders").select("status").eq("reference_number", orderReference).maybeSingle();
      applyStatus(data?.status);
    }, 3000);

    return () => {
      active = false;
      window.clearInterval(interval);
      void supabase.removeChannel(channel);
    };
  }, [submitted, orderReference]);

  if (submitted && order) {
    return (
      <main className="order-page status-page">
        <div className="brand-mark">DknY <span>Kape EL</span></div>
        <section className="status-card" id="order-status" aria-live="polite">
          <div className="status-icon">✓</div>
          <p className="eyebrow">Order received</p>
          <h1>Thanks, {order.name}.</h1>
          <p className="status-copy">We&apos;ll call your queue number when your order is ready.</p>
          <div className="order-numbers">
            <div><span>Queue number</span><strong>{order.queue}</strong></div>
            <div><span>Reference</span><strong>{order.reference}</strong></div>
          </div>
          <div className={`tracking-row tracking-${order.status.toLowerCase()}`}><span className="pulse-dot" /> <span>{order.status === "Completed" ? "Your order is ready! Please proceed to the counter." : order.status === "Processing" ? "Your order is being prepared." : order.status === "Cancelled" ? "This order was cancelled." : "Order received"}</span><b>{order.status.toUpperCase()}</b></div>
          <p className="counter-note">{order.status === "Completed" ? "Thanks for ordering with us!" : "Please keep this screen open and proceed to the counter when notified."}</p>
          <button className="text-button" onClick={() => { setSubmitted(false); setOrder(null); setBasket([]); setCustomerName(""); }}>Start a new order</button>
        </section>
        {showScanConfirmation && (
          <div className="overlay scan-confirmation-overlay">
            <section className="scan-confirmation-popup" role="dialog" aria-modal="true" aria-labelledby="scan-confirmation-title" onClick={(event) => event.stopPropagation()}>
              <div className="scan-confirmation-icon">✓</div>
              <p className="eyebrow">Order confirmed</p>
              <h2 id="scan-confirmation-title">Please wait to be called</h2>
              <p>The staff scanned your order. It has been sent to the kitchen and will be prepared shortly.</p>
              <button className="primary-button" onClick={() => window.location.reload()}>Complete order</button>
            </section>
          </div>
        )}
      </main>
    );
  }

  return (
    <main className="order-page">
      <header className="topbar">
        <div className="brand-mark">DknY <span>Kape EL</span></div>
        <div className="topbar-links"><strong>EVLWM WOW FACTOR</strong></div>
      </header>

      <section className="welcome">
        <p className="eyebrow">WOW FACTOR: Order Kiosk</p>
        <h1>Happy Sunday</h1>
        <p className="welcome-copy">Start your morning with our delicious offerings!</p>
      </section>

      <div className="menu-heading"><div><h2>Today&apos;s menu</h2><p className="ordering-note">Solo: 1 drink and 1 bread. Group orders: up to 5 drinks and 5 bread items.</p></div><span>Tap an item to order</span></div>
      {(["Drinks", "Bread"] as const).map((category) => (
        <section className="menu-section" key={category}>
          <div className="section-label"><span>{category === "Drinks" ? "01" : "02"}</span><h3>{category}</h3></div>
          <div className="product-grid">
            {products.filter((product) => product.category === category).map((product) => (
              <button className="product-card" key={product.id} onClick={() => setSelectedProduct(product)}>
                <div className="product-image"><Image src={product.image} alt="" fill sizes="(max-width: 700px) 42vw, 220px" /></div>
                <div className="product-info"><h4>{product.name}</h4><p>{product.description}</p><strong>{peso.format(product.price)}</strong></div>
                <span className="add-icon">+</span>
              </button>
            ))}
          </div>
        </section>
      ))}

      {!orderType && <div className="overlay choice-overlay"><section className="choice-modal" role="dialog" aria-modal="true" aria-labelledby="order-type-title"><p className="eyebrow">Before you order</p><h2 id="order-type-title">Who are you ordering for?</h2><p className="choice-copy">Choose a limit that fits your order.</p><div className="choice-grid"><button type="button" className="choice-card" onClick={() => setOrderType("individual")}><Soup aria-hidden="true" /><strong>Individual</strong><span>1 drink and 1 bread</span></button><button type="button" className="choice-card" onClick={() => setOrderType("group")}><Users aria-hidden="true" /><strong>Group</strong><span>Up to 5 drinks and 5 bread</span></button></div></section></div>}

      {selectedProduct && <div className="overlay" onClick={() => setSelectedProduct(null)}>
        <section className="quantity-modal" role="dialog" aria-modal="true" aria-labelledby="quantity-title" onClick={(event) => event.stopPropagation()}>
          <button className="close-button" onClick={() => setSelectedProduct(null)} aria-label="Close">×</button>
          <div className="modal-image"><Image src={selectedProduct.image} alt="" fill sizes="160px" /></div>
          <p className="eyebrow">{selectedProduct.category}</p><h2 id="quantity-title">{selectedProduct.name}</h2><p>{selectedProduct.description}</p>
          <strong className="modal-price">{peso.format(selectedProduct.price * quantity)}</strong>
          <div className="quantity-control"><button onClick={() => setQuantity(Math.max(1, quantity - 1))} aria-label="Decrease quantity">−</button><b>{quantity}</b><button onClick={() => setQuantity(Math.min(maxItemsPerCategory, quantity + 1))} aria-label="Increase quantity">+</button></div>
          {basketError && <p className="order-error" role="alert">{basketError}</p>}
          <button className="primary-button" onClick={addToBasket}>Add to basket</button>
          <button className="cancel-button" onClick={() => setSelectedProduct(null)}>Cancel</button>
        </section>
      </div>}

      <button className="basket-dock" onClick={() => setShowBasket(true)} disabled={basket.length === 0}>
        <span>{totalItems > 0 ? `${totalItems} ${totalItems === 1 ? "item" : "items"} in your basket` : "Your basket is empty"}</span><strong>{totalItems > 0 ? "Review basket" : "Choose an item"} <b>→</b></strong>
      </button>

      {showBasket && <div className="overlay" onClick={() => setShowBasket(false)}>
        <aside className="basket-drawer" onClick={(event) => event.stopPropagation()}>
          <div className="drawer-heading"><div><p className="eyebrow">Your selection</p><h2>{confirmOrder ? "Confirm order" : "Your basket"}</h2></div><button className="close-button" onClick={() => setShowBasket(false)} aria-label="Close basket">×</button></div>
          {basket.length === 0 ? <p className="empty-basket">Your basket is waiting for something delicious.</p> : <>
            <div className="basket-list">{basket.map((item) => <div className="basket-item" key={item.id}><div><h4>{item.name}</h4><p>{peso.format(item.price)} each</p></div><div className="mini-quantity"><button onClick={() => changeQuantity(item.id, -1)} aria-label={`Remove one ${item.name}`}>−</button><b>{item.quantity}</b><button onClick={() => changeQuantity(item.id, 1)} aria-label={`Add one ${item.name}`}>+</button></div></div>)}</div>
            <div className="basket-total"><span>Total</span><strong>{peso.format(total)}</strong></div>
            {basketError && <p className="order-error" role="alert">{basketError}</p>}
            {confirmOrder ? <div className="confirmation"><p>Ready to place this order for <strong>{customerName}</strong>?</p><p className="confirmation-note">Your order will be sent to the counter and cannot be edited afterward.</p>{orderError && <p className="order-error">{orderError}</p>}<button className="primary-button" onClick={placeOrder} disabled={isPlacingOrder}>{isPlacingOrder ? "Saving order..." : "Confirm and place order"}</button><button className="cancel-button" onClick={() => setConfirmOrder(false)}>Back to basket</button></div> : <form onSubmit={proceedToOrder}><div className="customer-name-field"><label htmlFor="customer-name">Customer name</label><p>Use the name the cashier will call.</p><input id="customer-name" value={customerName} onChange={(event) => setCustomerName(event.target.value)} placeholder="Enter your name" autoComplete="name" required /></div><button className="primary-button" type="submit">Proceed to order</button></form>}
          </>}
        </aside>
      </div>}
    </main>
  );
}
