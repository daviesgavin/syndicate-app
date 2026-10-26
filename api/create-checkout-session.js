import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const origin = req.headers.origin || `https://${req.headers.host}`;
    let body = {};
    try {
      body = req.body && typeof req.body === "object" ? req.body : JSON.parse(req.body || "{}");
    } catch (e) {}

    const successPath = body.successPath || "/#/create-success?session_id={CHECKOUT_SESSION_ID}";
    const cancelPath = body.cancelPath || "/#/create-cancelled";

    // Approximate location of the payer (from Vercel's IP-based geo headers, no GPS or
    // permission needed), saved on the Stripe payment for the admin revenue breakdown.
    const cityRaw = req.headers["x-vercel-ip-city"];
    let city = "";
    try { city = cityRaw ? decodeURIComponent(cityRaw) : ""; } catch (e) { city = String(cityRaw || ""); }
    const metadata = {
      ip_city: city.slice(0, 100),
      ip_region: String(req.headers["x-vercel-ip-country-region"] || "").slice(0, 20),
      ip_country: String(req.headers["x-vercel-ip-country"] || "").slice(0, 2),
    };

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      metadata,
      line_items: [{ price: process.env.STRIPE_PRICE_ID, quantity: 1 }],
      success_url: `${origin}${successPath}`,
      cancel_url: `${origin}${cancelPath}`,
    });

    res.status(200).json({ url: session.url });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
