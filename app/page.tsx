"use client";

import Image from "next/image";
import { QRCodeSVG } from "qrcode.react";
import { Soup, Users } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { supabase } from "../lib/supabase";

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
let fallbackOrderSequence = 0;

function createOrderToken() {
  const values = new Uint32Array(2);
  if (typeof globalThis.crypto?.getRandomValues === "function") {
    globalThis.crypto.getRandomValues(values);
    return `${values[0].toString(16)}${values[1].toString(16)}`.toUpperCase();
  }
  fallbackOrderSequence += 1;
  return `ORDER${String(fallbackOrderSequence).padStart(6, "0")}`;
}

function getOrderErrorMessage(message?: string) {
  if (!message) return "We could not place your order. Please try again.";
  if (message.toLowerCase().includes("network")) return "Connection problem. Check your internet and try again.";
  if (message.toLowerCase().includes("duplicate")) return "This order was already submitted. Please check your order reference.";
  return "We could not place your order right now. Please try again.";
}

export default function HomePage() {
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
  const [showBarcodePopup, setShowBarcodePopup] = useState(false);
  const [barcodeReference, setBarcodeReference] = useState<string | null>(null);
  const [showScanConfirmation, setShowScanConfirmation] = useState(false);
  const notifiedReference = useRef("");
  const [orderType, setOrderType] = useState<OrderType | null>(null);

  const totalItems = basket.reduce((sum, item) => sum + item.quantity, 0);
  const total = basket.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const selectedCategoryTotal = selectedProduct
    ? basket
      .filter((item) => item.category === selectedProduct.category)
      .reduce((sum, item) => sum + item.quantity, 0)
    : 0;
  const maxItemsPerCategory = orderType === "group" ? 5 : 1;

  function addToBasket() {
    if (!selectedProduct) return;
    const categoryTotal = basket
      .filter((item) => item.category === selectedProduct.category)
      .reduce((sum, item) => sum + item.quantity, 0);

    if (!orderType) return;
    if (categoryTotal + quantity > maxItemsPerCategory) {
      setBasketError(`Limit reached: ${orderType === "individual" ? "individual orders allow 1 drink and 1 bread" : "group orders allow up to 5 drinks and 5 bread items"}.`);
      return;
    }

    setBasket((current) => {
      const existingItem = current.find((item) => item.id === selectedProduct.id);
      if (existingItem) {
        return current.map((item) => item.id === selectedProduct.id
          ? { ...item, quantity: item.quantity + quantity }
          : item);
      }
      return [...current, { ...selectedProduct, quantity }];
    });
    setSelectedProduct(null);
    setQuantity(1);
    setBasketError("");
  }

  function changeQuantity(id: string, amount: number) {
    const selectedItem = basket.find((item) => item.id === id);
    if (!selectedItem) return;

    const categoryTotal = basket
      .filter((item) => item.category === selectedItem.category)
      .reduce((sum, item) => sum + item.quantity, 0);

    if (amount > 0 && categoryTotal >= maxItemsPerCategory) {
      setBasketError(`Limit reached: ${orderType === "individual" ? "individual orders allow 1 drink and 1 bread" : "group orders allow up to 5 drinks and 5 bread items"}.`);
      return;
    }

    setBasket((current) => current.flatMap((item) => item.id === id
      ? item.quantity + amount > 0 ? [{ ...item, quantity: item.quantity + amount }] : []
      : [item]));
    setBasketError("");
  }

  function proceedToOrder(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (basket.length === 0) {
      setOrderError("Add at least one item before continuing.");
      return;
    }
    if (!customerName.trim()) {
      setOrderError("Please enter your name so the staff can identify your order.");
      return;
    }
    setOrderError("");
    setConfirmOrder(true);
  }

  async function placeOrder() {
    if (basket.length === 0) {
      setOrderError("Your basket is empty. Add an item before placing the order.");
      return;
    }
    if (!customerName.trim()) {
      setOrderError("Please enter your name before placing the order.");
      return;
    }

    setIsPlacingOrder(true);
    setOrderError("");

    const orderToken = createOrderToken();
    const orderNumber = parseInt(orderToken.slice(0, 6), 16) || 1;
    const reference = `DK-${orderToken.slice(0, 6)}`;

    const { error } = await supabase.from("orders").insert({
      order_archive: JSON.stringify({
        items: basket.map(({ id, name, quantity, price }) => ({ id, name, quantity, price })),
        total,
      }),
      customer_name: customerName.trim(),
      order_number: orderNumber,
      status: "New",
      reference_number: reference,
      order_type: orderType,
      total,
    });

    if (error) {
      setOrderError(getOrderErrorMessage(error.message));
      setIsPlacingOrder(false);
      return;
    }

    setOrder({ queue: `A-${String(orderNumber).padStart(6, "0")}`, reference, name: customerName.trim(), status: "New" });
    setBarcodeReference(reference);
    setShowBarcodePopup(true);
    setConfirmOrder(false);
    setShowBasket(false);
    setIsPlacingOrder(false);
    setBasket([]);
    setCustomerName("");
  }

  useEffect(() => {
    if (!order?.reference) return;
    let active = true;
    const applyStatus = (status?: string) => {
      if (!active || !status) return;
      if (status === "Processing" && notifiedReference.current !== order.reference) {
        notifiedReference.current = order.reference;
        setShowBarcodePopup(false);
        setShowScanConfirmation(true);
      }
      setOrder((current) => current ? { ...current, status } : current);
    };

    const channel = supabase
      .channel(`customer-order-${order.reference}`)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "orders", filter: `reference_number=eq.${order.reference}` }, (payload) => {
        const updated = payload.new as { status?: string };
        applyStatus(updated.status);
      })
      .subscribe();

    const interval = window.setInterval(async () => {
      const { data } = await supabase.from("orders").select("status").eq("reference_number", order.reference).maybeSingle();
      applyStatus(data?.status);
    }, 3000);

    return () => {
      active = false;
      window.clearInterval(interval);
      void supabase.removeChannel(channel);
    };
  }, [order?.reference]);

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
              <button type="button" className="product-card" key={product.id} onClick={() => { setSelectedProduct(product); setBasketError(""); }}>
                <div className="product-image"><Image src={product.image} alt={product.name} fill sizes="(max-width: 700px) 109px, 160px" /></div>
                <div className="product-info">
                  <h4>{product.name}</h4>
                  <p>{product.description}</p>
                  {product.price === 0 ? (
                    <span className="free-price"><del>{peso.format(product.price)}</del> <strong>Free</strong></span>
                  ) : (
                    <strong>{peso.format(product.price)}</strong>
                  )}
                </div>
                <span className="add-icon">+</span>
              </button>
            ))}
          </div>
        </section>
      ))}

      {!orderType && (
        <div className="overlay choice-overlay">
          <section className="choice-modal" role="dialog" aria-modal="true" aria-labelledby="order-type-title">
            <p className="eyebrow">Before you order</p>
            <h2 id="order-type-title">Who are you ordering for?</h2>
            <p className="choice-copy">Choose a limit that fits your order.</p>
            <div className="choice-grid">
              <button type="button" className="choice-card" onClick={() => setOrderType("individual")}>
                <Soup aria-hidden="true" /><strong>Individual</strong><span>1 drink and 1 bread</span>
              </button>
              <button type="button" className="choice-card" onClick={() => setOrderType("group")}>
                <Users aria-hidden="true" /><strong>Group</strong><span>Up to 5 drinks and 5 bread</span>
              </button>
            </div>
          </section>
        </div>
      )}

      {selectedProduct && (
        <div className="overlay" onClick={() => setSelectedProduct(null)}>
          <div className="quantity-modal" onClick={(event) => event.stopPropagation()}>
            <button type="button" className="close-button" onClick={() => setSelectedProduct(null)} aria-label="Close">×</button>
            <div className="modal-image"><Image src={selectedProduct.image} alt={selectedProduct.name} fill sizes="140px" /></div>
            <p className="eyebrow">{selectedProduct.category}</p>
            <h2>{selectedProduct.name}</h2>
            <p>{selectedProduct.description}</p>
            <p className="category-limit">{selectedProduct.category}: {selectedCategoryTotal} / {maxItemsPerCategory} in basket</p>
            <span className="modal-price">{peso.format(selectedProduct.price)}</span>
            <div className="quantity-control">
              <button type="button" onClick={() => setQuantity((current) => Math.max(1, current - 1))}>−</button>
              <b>{quantity}</b>
              <button type="button" onClick={() => setQuantity((current) => Math.min(maxItemsPerCategory, current + 1))}>+</button>
            </div>
            {basketError && <p className="order-error modal-error" role="alert">{basketError}</p>}
            <button type="button" className="primary-button" onClick={addToBasket}>Add to basket</button>
          </div>
        </div>
      )}

      {showBasket && (
        <div className="overlay" onClick={() => setShowBasket(false)}>
          <div className="basket-drawer" onClick={(event) => event.stopPropagation()}>
            <div className="drawer-heading">
              <div>
                <p className="eyebrow">Order summary</p>
                <h2>Your basket</h2>
              </div>
              <button type="button" className="close-button" onClick={() => setShowBasket(false)} aria-label="Close">×</button>
            </div>

            <div className="basket-list">
              {basket.length === 0 ? (
                <p className="empty-basket">Your basket is empty.</p>
              ) : basket.map((item) => (
                <div className="basket-item" key={item.id}>
                  <div>
                    <h4>{item.name}</h4>
                    <p>{peso.format(item.price)} each</p>
                  </div>
                  <div className="mini-quantity">
                    <button type="button" onClick={() => changeQuantity(item.id, -1)}>-</button>
                    <b>{item.quantity}</b>
                    <button type="button" onClick={() => changeQuantity(item.id, 1)}>+</button>
                  </div>
                </div>
              ))}
            </div>

            {basketError && <p className="order-error" role="alert">{basketError}</p>}

            <div className="basket-footer">
              <div className="basket-total"><span>Total</span><strong>{peso.format(total)}</strong></div>
              <form onSubmit={proceedToOrder}>
                <div className="customer-name-field">
                  <label htmlFor="customer-name">Customer name</label>
                  <p>Use the name the cashier will call.</p>
                  <input id="customer-name" value={customerName} onChange={(event) => setCustomerName(event.target.value)} placeholder="Enter your name" autoComplete="name" required />
                </div>
                {orderError && <p className="order-error" role="alert">{orderError}</p>}
                <button type="submit" className="primary-button" disabled={basket.length === 0 || !customerName.trim()}>Proceed to order</button>
              </form>
            </div>
          </div>
        </div>
      )}

      {confirmOrder && (
        <div className="overlay" onClick={() => setConfirmOrder(false)}>
          <div className="basket-drawer confirmation-drawer" onClick={(event) => event.stopPropagation()}>
            <div className="drawer-heading">
              <div>
                <p className="eyebrow">Review order</p>
                <h2>Confirm purchase</h2>
              </div>
              <button type="button" className="close-button" onClick={() => setConfirmOrder(false)} aria-label="Close">×</button>
            </div>
            <p className="confirmation">You are ordering for <strong>{customerName.trim()}</strong>.</p>
            <p className="confirmation-note">Items will be confirmed at the front desk using the barcode below.</p>
            <div className="basket-list">
              {basket.map((item) => (
                <div className="basket-item" key={item.id}>
                  <div>
                    <h4>{item.name}</h4>
                    <p>{item.quantity} item{item.quantity > 1 ? "s" : ""}</p>
                  </div>
                  <strong>{peso.format(item.price * item.quantity)}</strong>
                </div>
              ))}
            </div>
            <div className="basket-total"><span>Total</span><strong>{peso.format(total)}</strong></div>
            <button type="button" className="primary-button" onClick={() => void placeOrder()} disabled={isPlacingOrder}>{isPlacingOrder ? "Placing order..." : "Confirm order"}</button>
          </div>
        </div>
      )}

      {showBarcodePopup && barcodeReference && (
        <div className="overlay barcode-overlay" onClick={() => setShowBarcodePopup(false)}>
          <div className="barcode-modal" onClick={(event) => event.stopPropagation()}>
            <button type="button" className="close-button" onClick={() => setShowBarcodePopup(false)} aria-label="Close">×</button>
            <div className="barcode-kicker"><span className="scan-dot" /> Ready for scan</div>
            <p className="eyebrow">Your order pass</p>
            <h2>Show this code at the front desk</h2>
            <p className="barcode-instruction">Your order stays unconfirmed until the staff scans this code.</p>
            <div className="barcode-box" aria-label={`QR code for order ${barcodeReference}`}>
              <QRCodeSVG value={`${window.location.origin}/scanner?reference=${encodeURIComponent(barcodeReference)}`} size={232} bgColor="#ffffff" fgColor="#172622" level="H" includeMargin={true} />
            </div>
            <p className="barcode-reference">{barcodeReference}</p>
            <p className="barcode-note">Keep this screen open until the code has been scanned.</p>
            <button type="button" className="secondary-button" onClick={() => setShowBarcodePopup(false)}>Cancel and edit</button>
          </div>
        </div>
      )}

      {showScanConfirmation && (
          <div className="overlay scan-confirmation-overlay">
          <section className="scan-confirmation-popup" role="dialog" aria-modal="true" aria-labelledby="root-scan-confirmation-title" onClick={(event) => event.stopPropagation()}>
            <div className="scan-confirmation-icon">✓</div>
            <p className="eyebrow">Order confirmed</p>
            <h2 id="root-scan-confirmation-title">Please wait to be called</h2>
            <p>The staff scanned your order. It has been sent to the kitchen and will be prepared shortly.</p>
            <button type="button" className="primary-button" onClick={() => window.location.reload()}>Complete order</button>
          </section>
        </div>
      )}

      <button type="button" className="basket-dock" onClick={() => setShowBasket(true)} disabled={basket.length === 0}>
        <span>Basket <strong>{totalItems} item{totalItems === 1 ? "" : "s"}</strong></span>
        <strong>{peso.format(total)}</strong>
      </button>
    </main>
  );
}
