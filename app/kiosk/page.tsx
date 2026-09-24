"use client";

import Image from "next/image";
import { Soup, Users } from "lucide-react";
import { useEffect, useState } from "react";
import { OrderIntro } from "../components/order-intro";
import { supabase } from "../../lib/supabase";

type OrderType = "individual" | "group";

type Product = {
  id: string;
  name: string;
  description: string;
  category: "Drinks" | "Bread";
  price: number;
  image: string;
};

type BasketItem = Product & {
  quantity: number;
};

type Order = {
  queue: string;
  reference: string;
  name: string;
  status: string;
};

const products: Product[] = [
  {
    id: "dalina",
    name: "Dalina Coffee",
    description: "Dalgona Coffee in a rush",
    category: "Drinks",
    price: 0,
    image: "/menu-assets/Dalina-Coffee.png",
  },
  {
    id: "permika",
    name: "Permika Latte",
    description: "Spanish Latte with a splash of time",
    category: "Drinks",
    price: 0,
    image: "/menu-assets/Permika-Latte.png",
  },
  {
    id: "fruit",
    name: "Fruit of Knowledge Soda",
    description: "Knowledge-glazed Green Apple-flavored Fruit Soda",
    category: "Drinks",
    price: 0,
    image: "/menu-assets/Fruit-Of-Knowledge-Soda.png",
  },
  {
    id: "kofinoy",
    name: "KoFinoy",
    description: "Kapeng Barako para sa kapatid ko kay Kristo",
    category: "Drinks",
    price: 0,
    image: "/menu-assets/KoFinoy.png",
  },
  {
    id: "pankekayo",
    name: "Pankekayo",
    description: "OG Filipino Style Pancake. Okeh kaayoh!",
    category: "Bread",
    price: 0,
    image: "/menu-assets/Pankekayo.png",
  },
  {
    id: "pandasal",
    name: "Pandasal",
    description: "Classic Pandesal with prayers of blessings",
    category: "Bread",
    price: 0,
    image: "/menu-assets/Pandasal.png",
  },
];

const peso = new Intl.NumberFormat("en-PH", {
  style: "currency",
  currency: "PHP",
});

let fallbackOrderSequence = 0;

function PriceTag({ price }: { price: number }) {
  if (price === 0) {
    return (
      <span className="free-price-inline">
        <del>{peso.format(price)}</del>
        Free
      </span>
    );
  }

  return <>{peso.format(price)}</>;
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

export default function KioskPage() {
  const [orderType, setOrderType] = useState<OrderType | null>(null);
  const [basket, setBasket] = useState<BasketItem[]>([]);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [showBasket, setShowBasket] = useState(false);
  const [confirmOrder, setConfirmOrder] = useState(false);
  const [showNamePopup, setShowNamePopup] = useState(false);
  const [customerName, setCustomerName] = useState("");
  const [error, setError] = useState("");
  const [isPlacing, setIsPlacing] = useState(false);
  const [order, setOrder] = useState<Order | null>(null);

  // Countdown state
  const [redirectCountdown, setRedirectCountdown] = useState(10);

  // Kiosk password protection
  const [isKioskUnlocked, setIsKioskUnlocked] = useState(false);
  const [kioskPassword, setKioskPassword] = useState("");
  const [kioskPasswordError, setKioskPasswordError] = useState("");

  const maxItems = orderType === "group" ? 5 : 1;

  const total = basket.reduce(
    (sum, item) => sum + item.price * item.quantity,
    0
  );

  const totalItems = basket.reduce(
    (sum, item) => sum + item.quantity,
    0
  );

  function unlockKiosk() {
    if (kioskPassword === "toGodbetheglory") {
      sessionStorage.setItem("kiosk-unlocked", "true");
      setIsKioskUnlocked(true);
      setKioskPassword("");
      setKioskPasswordError("");
      return;
    }

    setKioskPasswordError("Incorrect kiosk password.");
  }

  function addToBasket() {
    if (!selectedProduct || !orderType) return;

    const categoryTotal = basket
      .filter((item) => item.category === selectedProduct.category)
      .reduce((sum, item) => sum + item.quantity, 0);

    if (categoryTotal + quantity > maxItems) {
      setError(
        orderType === "individual"
          ? "Individual orders allow 1 drink and 1 bread."
          : "Group orders allow up to 5 drinks and 5 bread items."
      );
      return;
    }

    setBasket((current) => {
      const existing = current.find(
        (item) => item.id === selectedProduct.id
      );

      return existing
        ? current.map((item) =>
            item.id === selectedProduct.id
              ? { ...item, quantity: item.quantity + quantity }
              : item
          )
        : [...current, { ...selectedProduct, quantity }];
    });

    setSelectedProduct(null);
    setQuantity(1);
    setError("");
  }

  function changeQuantity(id: string, amount: number) {
    const item = basket.find((entry) => entry.id === id);

    if (!item) return;

    const categoryTotal = basket
      .filter((entry) => entry.category === item.category)
      .reduce((sum, entry) => sum + entry.quantity, 0);

    if (amount > 0 && categoryTotal >= maxItems) {
      setError(
        orderType === "individual"
          ? "Individual orders allow 1 drink and 1 bread."
          : "Group orders allow up to 5 drinks and 5 bread items."
      );
      return;
    }

    setBasket((current) =>
      current.flatMap((entry) =>
        entry.id === id
          ? entry.quantity + amount > 0
            ? [{ ...entry, quantity: entry.quantity + amount }]
            : []
          : [entry]
      )
    );

    setError("");
  }

  function proceedToReview() {
    if (basket.length === 0) {
      setError("Add at least one item before continuing.");
      return;
    }

    setError("");
    setShowBasket(false);
    setConfirmOrder(true);
  }

  function proceedToName() {
    setConfirmOrder(false);
    setShowNamePopup(true);
  }

  async function placeOrder() {
    if (basket.length === 0) {
      setError("Your basket is empty.");
      setShowNamePopup(false);
      return;
    }

    if (!customerName.trim()) {
      setError("Please enter the customer name before placing the order.");
      return;
    }

    setIsPlacing(true);
    setError("");

    const token = createOrderToken();
    const orderNumber = parseInt(token.slice(0, 6), 16) || 1;
    const reference = `DK-${token.slice(0, 6)}`;

    const { error: insertError } = await supabase.from("orders").insert({
      order_archive: JSON.stringify({
        items: basket.map(({ id, name, quantity, price }) => ({
          id,
          name,
          quantity,
          price,
        })),
        total,
      }),
      customer_name: customerName.trim(),
      order_number: orderNumber,
      order_type: orderType,
      order_source: "kiosk",
      confirmed_by: "Kiosk Tablet",
      status: "Confirmed",
      reference_number: reference,
      total,
    });

    if (insertError) {
      setError(`We could not place the order: ${insertError.message}`);
      setIsPlacing(false);
      return;
    }

    setOrder({
      queue: `A-${String(orderNumber).padStart(6, "0")}`,
      reference,
      name: customerName.trim(),
      status: "Confirmed",
    });

    setShowNamePopup(false);
    setIsPlacing(false);
  }

  // Check whether this browser session has already unlocked the kiosk
  useEffect(() => {
    const unlocked = sessionStorage.getItem("kiosk-unlocked");

    if (unlocked === "true") {
      setIsKioskUnlocked(true);
    }
  }, []);

  // Existing Supabase realtime order status listener
  useEffect(() => {
    if (!order?.reference) return;

    const channel = supabase
      .channel(`kiosk-order-${order.reference}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "orders",
          filter: `reference_number=eq.${order.reference}`,
        },
        (payload) => {
          const updated = payload.new as { status?: string };

          setOrder((current) =>
            current
              ? {
                  ...current,
                  status: updated.status ?? current.status,
                }
              : current
          );
        }
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [order?.reference]);

  // 7-second automatic reset after an order is placed
  useEffect(() => {
    if (!order) return;

    setRedirectCountdown(10);

    const timer = setInterval(() => {
      setRedirectCountdown((current) => {
        if (current <= 1) {
          clearInterval(timer);

          // Reset the kiosk for the next customer.
          setOrder(null);
          setBasket([]);
          setCustomerName("");
          setOrderType(null);
          setSelectedProduct(null);
          setQuantity(1);
          setError("");
          setRedirectCountdown(10);

          return 0;
        }

        return current - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [order]);

  // Kiosk password screen
  if (!isKioskUnlocked) {
    return (
      <main className="order-page kiosk-lock-page">
        <section className="kiosk-lock-card">
          <div className="status-icon">🔒</div>

          <p className="eyebrow">DKnY Kape EL</p>

          <h1>Kiosk Access</h1>

          <p className="status-copy">
            Enter the kiosk password to continue.
          </p>

          <form
            onSubmit={(event) => {
              event.preventDefault();
              unlockKiosk();
            }}
          >
            <input
              type="password"
              value={kioskPassword}
              onChange={(event) => {
                setKioskPassword(event.target.value);
                setKioskPasswordError("");
              }}
              placeholder="Enter kiosk password"
              autoFocus
              autoComplete="off"
            />

            {kioskPasswordError && (
              <p className="order-error">{kioskPasswordError}</p>
            )}

            <button
              type="submit"
              className="primary-button"
              disabled={!kioskPassword}
            >
              Unlock Kiosk
            </button>
          </form>
        </section>
      </main>
    );
  }

  // Order confirmation screen
  if (order) {
    return (
      <main className="order-page status-page">
        <section className="status-card">
          <div className="status-icon">✓</div>

          <p className="eyebrow">Order placed</p>

          <h1>Thanks, {order.name}.</h1>

          <p className="status-copy">
            Please wait to be called when your order is ready.
          </p>

          <div className="order-numbers">
            <div>
              <span>Queue number</span>
              <strong>{order.queue}</strong>
            </div>

            <div>
              <span>Reference</span>
              <strong>{order.reference}</strong>
            </div>
          </div>

          <div className="tracking-row" >
            <center>
            <span className="pulse-dot" />

            <span>
              {order.status === "Processing"
                ? "Your order is being prepared."
                : order.status === "Completed"
                  ? "Your order is ready."
                  : "Order received."}
            </span>

            <b>{order.status.toUpperCase()}</b>
            </center>
          </div>

          {/* NEW: Redirect countdown */}
          <div className="redirect-countdown">
            <span>Returning to kiosk in</span>

            <strong>{redirectCountdown}</strong>

            <span>
              second{redirectCountdown !== 1 ? "s" : ""}
            </span>
          </div>

          <button
            className="primary-button m-top-20"
            onClick={() => {
              setRedirectCountdown(10);
              setOrder(null);
              setBasket([]);
              setCustomerName("");
              setOrderType(null);
            }}
          >
            Start a new order now
          </button>
        </section>
      </main>
    );
  }

  return (
    <main className="order-page">
      <OrderIntro />
      <header className="topbar">
        <div className="brand-mark">
          DKnY <span> Kape EL</span>
        </div>

        <div className="topbar-links">
          <strong>WOW FACTOR: KIOSK ORDERING</strong>
        </div>
      </header>

      <section className="welcome">
        <p className="eyebrow">WOW FACTOR: Self-service kiosk</p>

        <h1>Happy Sunday</h1>

        <p className="welcome-copy">
          Choose your order type, then select your drinks and bread.
        </p>
      </section>

      <div className="menu-heading">
        <div>
          <h2>Today&apos;s menu</h2>

          <p className="ordering-note">
            {orderType === "group"
              ? "Group: up to 5 drinks and 5 bread items."
              : "Individual: 1 drink and 1 bread."}
          </p>
        </div>

        <span>Tap an item to order</span>
      </div>

      {(["Drinks", "Bread"] as const).map((category) => (
        <section className="menu-section" key={category}>
          <div className="section-label">
            <span>{category === "Drinks" ? "01" : "02"}</span>

            <h3>{category}</h3>
          </div>

          <div className="product-grid">
            {products
              .filter((product) => product.category === category)
              .map((product) => (
                <button
                  type="button"
                  className="product-card"
                  key={product.id}
                  onClick={() => {
                    setSelectedProduct(product);
                    setError("");
                  }}
                >
                  <div className="product-image">
                    <Image
                      src={product.image}
                      alt={product.name}
                      fill
                      sizes="(max-width: 700px) 109px, 160px"
                    />
                  </div>

                  <div className="product-info">
                    <h4>{product.name}</h4>
                    <p>{product.description}</p>
                  </div>

                  <div className="product-card-footer">
                    <strong>
                      {product.price === 0
                        ? "Free"
                        : peso.format(product.price)}
                    </strong>

                    <span className="add-icon">+</span>
                  </div>
                </button>
              ))}
          </div>
        </section>
      ))}

      {!orderType && (
        <div className="overlay choice-overlay">
          <section
            className="choice-modal"
            role="dialog"
            aria-modal="true"
          >
            <p className="eyebrow">Before you order</p>

            <h2>Who are you ordering for?</h2>

            <p className="choice-copy">
              Choose a limit that fits your order.
            </p>

            <div className="choice-grid">
              <button
                type="button"
                className="choice-card"
                onClick={() => setOrderType("individual")}
              >
                <Soup aria-hidden="true" />

                <strong>Individual</strong>

                <span>1 drink and 1 bread</span>
              </button>

              <button
                type="button"
                className="choice-card"
                onClick={() => setOrderType("group")}
              >
                <Users aria-hidden="true" />

                <strong>Group</strong>

                <span>Up to 5 drinks and 5 bread</span>
              </button>
            </div>
            <a className="choice-status-link" href="/orders">Check order status</a>
          </section>
        </div>
      )}

      {selectedProduct && (
        <div
          className="overlay"
          onClick={() => setSelectedProduct(null)}
        >
          <section
            className="quantity-modal"
            onClick={(event) => event.stopPropagation()}
          >
            <button
              className="close-button"
              onClick={() => setSelectedProduct(null)}
              aria-label="Close"
            >
              ×
            </button>

            <div className="modal-image">
              <Image
                src={selectedProduct.image}
                alt={selectedProduct.name}
                fill
                sizes="140px"
              />
            </div>

            <p className="eyebrow">
              {selectedProduct.category}
            </p>

            <h2>{selectedProduct.name}</h2>

            <p>{selectedProduct.description}</p>

            <div className="quantity-control">
              <button
                onClick={() =>
                  setQuantity(Math.max(1, quantity - 1))
                }
              >
                −
              </button>

              <b>{quantity}</b>

              <button
                onClick={() =>
                  setQuantity(Math.min(maxItems, quantity + 1))
                }
              >
                +
              </button>
            </div>

            {error && <p className="order-error">{error}</p>}

            <button
              className="primary-button"
              onClick={addToBasket}
            >
              Add to basket
            </button>
          </section>
        </div>
      )}

      {showBasket && (
        <div
          className="overlay"
          onClick={() => setShowBasket(false)}
        >
          <aside
            className="basket-drawer"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="drawer-heading">
              <div>
                <p className="eyebrow">Order summary</p>

                <h2>Your basket</h2>
              </div>

              <button
                className="close-button"
                onClick={() => setShowBasket(false)}
                aria-label="Close basket"
              >
                ×
              </button>
            </div>

            <div className="basket-list">
              {basket.map((item) => (
                <div
                  className="basket-item"
                  key={item.id}
                >
                  <div className="basket-item-main">
                    <div className="basket-item-thumb">
                      <Image
                        src={item.image}
                        alt={item.name}
                        fill
                        sizes="52px"
                      />
                    </div>

                    <div>
                      <h4>{item.name}</h4>

                      <p>
                        {item.quantity} ×{" "}
                        <PriceTag price={item.price} />
                      </p>
                    </div>
                  </div>

                  <div className="mini-quantity">
                    <button
                      onClick={() =>
                        changeQuantity(item.id, -1)
                      }
                    >
                      −
                    </button>

                    <b>{item.quantity}</b>

                    <button
                      onClick={() =>
                        changeQuantity(item.id, 1)
                      }
                    >
                      +
                    </button>
                  </div>
                </div>
              ))}
            </div>

            <div className="basket-footer">
              <div className="basket-total">
                <span>Total</span>

                <strong>
                  <PriceTag price={total} />
                </strong>
              </div>

              {error && (
                <p className="order-error">{error}</p>
              )}

              <button
                type="button"
                className="primary-button"
                onClick={proceedToReview}
                disabled={basket.length === 0}
              >
                Place order
              </button>
            </div>
          </aside>
        </div>
      )}

      {confirmOrder && (
        <div
          className="overlay"
          onClick={() => setConfirmOrder(false)}
        >
          <section
            className="basket-drawer confirmation-drawer"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="drawer-heading">
              <div>
                <p className="eyebrow">Review order</p>

                <h2>Confirm purchase</h2>
              </div>
            </div>

            <p className="confirmation-note">
              Please review your items before continuing.
            </p>

            <div className="basket-list">
              {basket.map((item) => (
                <div
                  className="basket-item"
                  key={item.id}
                >
                  <div className="basket-item-main">
                    <div className="basket-item-thumb">
                      <Image
                        src={item.image}
                        alt={item.name}
                        fill
                        sizes="52px"
                      />
                    </div>

                    <div>
                      <h4>{item.name}</h4>

                      <p>
                        {item.quantity} item
                        {item.quantity > 1 ? "s" : ""}
                      </p>
                    </div>
                  </div>

                  <strong>
                    {item.price === 0
                      ? "Free"
                      : peso.format(
                          item.price * item.quantity
                        )}
                  </strong>
                </div>
              ))}
            </div>

            <div className="confirmation-footer">
              <div className="basket-total">
                <span>Total</span>

                <strong>
                  <PriceTag price={total} />
                </strong>
              </div>

              <div className="button-row">
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => {
                    setConfirmOrder(false);
                    setShowBasket(true);
                  }}
                >
                  Go back and edit
                </button>

                <button
                  type="button"
                  className="primary-button"
                  onClick={proceedToName}
                >
                  Continue
                </button>
              </div>
            </div>
          </section>
        </div>
      )}

      {showNamePopup && (
        <div
          className="overlay"
          onClick={() => setShowNamePopup(false)}
        >
          <section
            className="basket-drawer confirmation-drawer"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="drawer-heading">
              <div>
                <p className="eyebrow">Almost done</p>
              </div>

              <button
                className="close-button"
                onClick={() => setShowNamePopup(false)}
                aria-label="Close"
              >
                ×
              </button>
            </div>

            <div className="customer-name-field">
              <label htmlFor="kiosk-customer-name">
                What is your name?
              </label>

              <p>
                This name will be used to call you when your
                order is ready.
              </p>

              <input
                id="kiosk-customer-name"
                value={customerName}
                onChange={(event) =>
                  setCustomerName(event.target.value)
                }
                placeholder="Enter your name"
                autoComplete="name"
              />
            </div>

            {error && (
              <p className="order-error">{error}</p>
            )}

            <button
              type="button"
              className="primary-button"
              onClick={() => void placeOrder()}
              disabled={
                isPlacing || !customerName.trim()
              }
            >
              {isPlacing
                ? "Placing order..."
                : "Place order"}
            </button>
          </section>
        </div>
      )}

      {error &&
        !selectedProduct &&
        !showBasket &&
        !confirmOrder &&
        !showNamePopup && (
          <p className="order-error kiosk-error">
            {error}
          </p>
        )}

      <button
        type="button"
        className="basket-dock"
        onClick={() => setShowBasket(true)}
        disabled={basket.length === 0}
      >
        <span className="basket-dock-info">
          <strong>
            {totalItems} item
            {totalItems === 1 ? "" : "s"}
          </strong>

          <span>
            <PriceTag price={total} />
          </span>
        </span>

        <span className="basket-dock-cta">
          Proceed <b>→</b>
        </span>
      </button>
    </main>
  );
}