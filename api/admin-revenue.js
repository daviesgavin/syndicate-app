// Admin-only: totals of what the app has earned from Stripe payments, broken into
// weeks, months, years and all time (Perth time). Reads straight from Stripe, so the
// figures always match your Stripe account — including Stripe's fees and any refunds.
//
// Only completed, paid Checkout sessions count (abandoned checkouts and free/comped
// syndicates don't). No new env vars needed: uses STRIPE_SECRET_KEY and the same
// admin check as the email stats.

import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY;
const TZ = "Australia/Perth";

function perthParts(unixSeconds) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", weekday: "short" })
      .formatToParts(new Date(unixSeconds * 1000))
      .map((x) => [x.type, x.value])
  );
  return { y: +p.year, m: +p.month, d: +p.day, wd: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(p.weekday) };
}

const pad = (n) => String(n).padStart(2, "0");

// Bucket keys: week = the Monday it starts on, month = YYYY-MM, year = YYYY.
function keysFor(unixSeconds) {
  const { y, m, d, wd } = perthParts(unixSeconds);
  const monday = new Date(Date.UTC(y, m - 1, d - wd));
  return {
    week: `${monday.getUTCFullYear()}-${pad(monday.getUTCMonth() + 1)}-${pad(monday.getUTCDate())}`,
    month: `${y}-${pad(m)}`,
    year: String(y),
  };
}

function emptyBucket() {
  return { payments: 0, payers: new Set(), gross: 0, fees: 0, refunds: 0 };
}

function add(bucket, p) {
  bucket.payments += 1;
  if (p.payer) bucket.payers.add(p.payer);
  bucket.gross += p.gross;
  bucket.fees += p.fee;
  bucket.refunds += p.refunded;
}

// Amounts come from Stripe in cents; send dollars.
function finish(bucket) {
  return {
    payments: bucket.payments,
    payers: bucket.payers.size,
    gross: bucket.gross / 100,
    fees: bucket.fees / 100,
    refunds: bucket.refunds / 100,
    net: (bucket.gross - bucket.fees - bucket.refunds) / 100,
  };
}

export default async function handler(req, res) {
  try {
    // Same admin check as /api/admin-email-stats.
    const accessToken = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
    if (!accessToken) return res.status(401).json({ error: "Missing auth token" });
    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
    });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return res.status(401).json({ error: "Invalid session" });
    const { data: adminRow } = await userClient.from("admins").select("id").eq("id", user.id).maybeSingle();
    if (!adminRow) return res.status(403).json({ error: "Not authorized" });

    // Every paid Checkout session, with the charge and its Stripe fee.
    const payments = [];
    const currencies = new Set();
    const list = stripe.checkout.sessions.list({
      limit: 100,
      status: "complete",
      expand: ["data.payment_intent.latest_charge.balance_transaction"],
    });
    for await (const s of list) {
      if (s.payment_status !== "paid" || !s.amount_total) continue;
      const charge = s.payment_intent?.latest_charge;
      const bt = charge?.balance_transaction;
      currencies.add((s.currency || "aud").toUpperCase());
      payments.push({
        created: s.created,
        gross: s.amount_total,
        fee: bt && typeof bt === "object" ? bt.fee : 0,
        refunded: charge?.amount_refunded || 0,
        payer: (s.customer_details?.email || s.customer || s.id).toLowerCase(),
      });
      if (payments.length >= 10000) break; // safety cap
    }

    const all = emptyBucket();
    const by = { week: {}, month: {}, year: {} };
    for (const p of payments) {
      add(all, p);
      const k = keysFor(p.created);
      for (const period of ["week", "month", "year"]) {
        by[period][k[period]] ||= emptyBucket();
        add(by[period][k[period]], p);
      }
    }

    const nowKeys = keysFor(Math.floor(Date.now() / 1000));
    const series = (period, count) =>
      Object.keys(by[period]).sort().reverse().slice(0, count).map((key) => ({ key, ...finish(by[period][key]) }));

    res.status(200).json({
      currency: [...currencies][0] || "AUD",
      mixedCurrencies: currencies.size > 1,
      allTime: finish(all),
      thisWeek: finish(by.week[nowKeys.week] || emptyBucket()),
      thisMonth: finish(by.month[nowKeys.month] || emptyBucket()),
      thisYear: finish(by.year[nowKeys.year] || emptyBucket()),
      weeks: series("week", 12),
      months: series("month", 12),
      years: series("year", 10),
      firstPayment: payments.length ? new Date(Math.min(...payments.map((p) => p.created)) * 1000).toISOString() : null,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
