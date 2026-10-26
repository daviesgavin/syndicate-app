// Daily job (free version — no AI, no paid APIs): reads the current jackpots for the
// world's big lotteries straight from public lottery sites and data feeds, and saves
// them for the "This week's big draws" card on the Home screen.
//
// Runs on Vercel Cron (see vercel.json). Each lottery is read independently: if one
// site changes its layout or is down, only that lottery is affected, and yesterday's
// figure for it is kept as long as its draw is still upcoming. Nothing is written if
// fewer than 2 draws are available, so the card never shows a broken list.
//
// Env vars needed in Vercel:
//   SUPABASE_SERVICE_ROLE_KEY  — Supabase > Project Settings > API (server only)
//   CRON_SECRET                — any long random string; Vercel sends it with cron calls
//   VITE_SUPABASE_URL          — already set
//
// To see what each source returned, open the job's run in Vercel Logs — the response
// lists every lottery as "ok" or with the reason it was skipped.

const UA = "Mozilla/5.0 (compatible; LottoSyndicateBot/1.0; +https://lottosyndicate.app)";
const MIN_DRAWS = 2;

/* ---------------- time helpers (no libraries) ---------------- */

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function zoneParts(utcMs, tz) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hourCycle: "h23", weekday: "short",
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(new Date(utcMs));
  const p = Object.fromEntries(parts.map((x) => [x.type, x.value]));
  return { y: +p.year, mo: +p.month, d: +p.day, h: +p.hour, mi: +p.minute, s: +p.second, weekday: WEEKDAYS.indexOf(p.weekday) };
}

function offsetMs(utcMs, tz) {
  const p = zoneParts(utcMs, tz);
  return Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s) - utcMs;
}

// Wall-clock time in a time zone -> UTC milliseconds (handles daylight saving).
function zonedToUtc(y, mo, d, h, mi, tz) {
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  const first = guess - offsetMs(guess, tz);
  return guess - offsetMs(first, tz);
}

// Next scheduled draw after `now`. schedule = { tz, days: [weekday numbers], time: "HH:MM" }
function nextDraw(schedule, nowMs) {
  const [h, mi] = schedule.time.split(":").map(Number);
  for (let i = 0; i < 9; i++) {
    const p = zoneParts(nowMs + i * 864e5, schedule.tz);
    if (!schedule.days.includes(p.weekday)) continue;
    const t = zonedToUtc(p.y, p.mo, p.d, h, mi, schedule.tz);
    if (t > nowMs) return t;
  }
  return null;
}

/* ---------------- parsing helpers ---------------- */

async function fetchText(url, init = {}) {
  const res = await fetch(url, {
    ...init,
    headers: { "User-Agent": UA, Accept: "text/html,application/json,*/*", ...(init.headers || {}) },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

// HTML -> plain text, so small markup changes don't break the patterns below.
function pageText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&euro;|&#8364;/gi, "€")
    .replace(/&pound;|&#163;/gi, "£")
    .replace(/&#36;|&dollar;/gi, "$")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&#39;|&#x27;|&rsquo;|&apos;/gi, "'")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ");
}

// "687", "Million" -> 687000000 ; "1.25", "Billion" -> 1250000000 ; "17.000.000" -> 17000000
function parseAmount(num, unit) {
  let n = String(num).trim();
  if (/^\d{1,3}(\.\d{3})+$/.test(n)) n = n.replace(/\./g, ""); // European thousands dots
  n = Number(n.replace(/,/g, ""));
  const u = (unit || "").toLowerCase();
  if (u.startsWith("b")) n *= 1e9;
  else if (u.startsWith("m")) n *= 1e6;
  return Number.isFinite(n) ? Math.round(n) : NaN;
}

function weekdayIndex(word) {
  if (!word) return -1;
  return WEEKDAYS.indexOf(word.slice(0, 1).toUpperCase() + word.slice(1, 3).toLowerCase());
}

// Recursively find the first value for a key anywhere in a JSON object.
function findKey(obj, key) {
  if (!obj || typeof obj !== "object") return undefined;
  if (key in obj) return obj[key];
  for (const v of Object.values(obj)) {
    const found = findKey(v, key);
    if (found !== undefined) return found;
  }
  return undefined;
}

/* ---------------- sources ---------------- */
// Each returns an array of draws: { lottery, country, jackpot, currency, draw_time_utc, source_url }

// Reads one jackpot from a page's text and pairs it with the next scheduled draw.
// If the page names the draw's weekday and it doesn't match the next scheduled draw,
// the page hasn't been updated since the last draw, so it's skipped rather than shown wrong.
function pageSource({ lottery, country, currency, url, schedule, pattern, amountGroup, unitGroup, dayGroup, dayPattern }) {
  return async (nowMs) => {
    const text = pageText(await fetchText(url));
    const m = text.match(pattern);
    if (!m) throw new Error("jackpot text not found (page layout may have changed)");
    const jackpot = parseAmount(m[amountGroup], unitGroup ? m[unitGroup] : "");
    const drawMs = nextDraw(schedule, nowMs);
    let pageDay = dayGroup ? weekdayIndex(m[dayGroup]) : -1;
    if (pageDay < 0 && dayPattern) pageDay = weekdayIndex(text.match(dayPattern)?.[1]);
    if (pageDay >= 0 && drawMs && zoneParts(drawMs, schedule.tz).weekday !== pageDay) {
      throw new Error("page still shows the previous draw");
    }
    return [{ lottery, country, jackpot, currency, draw_time_utc: drawMs && new Date(drawMs).toISOString(), source_url: url }];
  };
}

const SOURCES = {
  "Powerball (US)": pageSource({
    lottery: "Powerball", country: "US", currency: "USD",
    url: "https://www.powerball.com/",
    schedule: { tz: "America/New_York", days: [1, 3, 6], time: "22:59" },
    pattern: /Estimated Jackpot:?\s*\$\s*([\d.,]+)\s*(Million|Billion)/i, amountGroup: 1, unitGroup: 2,
  }),

  // Mega Millions publishes a JSON feed (wrapped in XML).
  "Mega Millions": async (nowMs) => {
    const url = "https://www.megamillions.com/cmspages/utilservice.asmx/GetLatestDrawData";
    const raw = await fetchText(url, {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: "{}",
    });
    const unwrapped = raw.replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
    let data = JSON.parse(unwrapped.slice(unwrapped.indexOf("{"), unwrapped.lastIndexOf("}") + 1));
    if (typeof data.d === "string") data = JSON.parse(data.d);
    const jackpot = Number(findKey(data, "NextPrizePool"));
    const next = String(findKey(data, "NextDrawingDate") || "");
    const m = next.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
    if (!jackpot || !m) throw new Error("feed missing NextPrizePool / NextDrawingDate");
    const drawMs = zonedToUtc(+m[1], +m[2], +m[3], +m[4], +m[5], "America/New_York");
    return [{ lottery: "Mega Millions", country: "US", jackpot, currency: "USD", draw_time_utc: new Date(drawMs).toISOString(), source_url: "https://www.megamillions.com/" }];
  },

  // The Lott (Australia) data feed: Powerball, Oz Lotto, Saturday Lotto.
  "The Lott (AU)": async () => {
    const products = [
      { id: "Powerball", lottery: "Powerball", time: "20:30" },
      { id: "OzLotto", lottery: "Oz Lotto", time: "20:30" },
      { id: "TattsLotto", lottery: "Saturday Lotto", time: "19:30" },
    ];
    const endpoints = [
      "https://data.api.thelott.com/sales/vmax/web/data/lotto/opendraws",
      "https://api.thelott.com/svc/sales/vmax/web/data/lotto/opendraws",
    ];
    async function openDraw(productId) {
      let lastErr;
      for (const url of endpoints) {
        try {
          const raw = await fetchText(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ CompanyId: "GoldenCasket", MaxDrawCount: 1, OptionalProductFilter: [productId] }),
          });
          const draw = (JSON.parse(raw).Draws || []).find((d) => d.ProductId === productId);
          if (draw) return draw;
          lastErr = new Error("no open draw listed");
        } catch (e) { lastErr = e; }
      }
      throw lastErr;
    }
    const results = await Promise.allSettled(products.map((p) => openDraw(p.id)));
    const draws = [];
    const errors = [];
    results.forEach((r, i) => {
      const p = products[i];
      if (r.status === "rejected") return errors.push(`${p.lottery}: ${r.reason?.message}`);
      const d = r.value;
      const m = String(d.DrawDate || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
      if (!m || d.IsDiv1Unknown || !(d.Div1Amount > 0)) return errors.push(`${p.lottery}: no jackpot figure yet`);
      const [h, mi] = p.time.split(":").map(Number);
      const drawMs = zonedToUtc(+m[1], +m[2], +m[3], h, mi, "Australia/Melbourne");
      draws.push({ lottery: p.lottery, country: "AU", jackpot: Math.round(d.Div1Amount), currency: "AUD", draw_time_utc: new Date(drawMs).toISOString(), source_url: "https://www.thelott.com/" });
    });
    if (!draws.length) throw new Error(errors.join("; ") || "no draws");
    return draws;
  },

  "EuroMillions": pageSource({
    lottery: "EuroMillions", country: "EU", currency: "EUR",
    url: "https://www.euro-millions.com/",
    schedule: { tz: "Europe/Paris", days: [2, 5], time: "20:45" },
    // e.g. "Tuesday's estimated EuroMillions jackpot: €79 Million"
    pattern: /(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)'?s?\s+estimated EuroMillions jackpot:?\s*€\s*([\d.,]+)\s*(Million|Billion)/i,
    amountGroup: 2, unitGroup: 3, dayGroup: 1,
  }),

  "UK Lotto": pageSource({
    lottery: "UK Lotto", country: "UK", currency: "GBP",
    url: "https://www.national-lottery.co.uk/games/lotto",
    schedule: { tz: "Europe/London", days: [3, 6], time: "20:00" },
    // e.g. "Don't miss Wednesday 's £9 Million* jackpot"
    pattern: /(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\s*'?\s*s?\s*£\s*([\d.,]+)\s*(Million|Billion)\*?\s*jackpot/i,
    amountGroup: 2, unitGroup: 3, dayGroup: 1,
  }),

  "EuroJackpot": pageSource({
    lottery: "EuroJackpot", country: "EU", currency: "EUR",
    url: "https://www.eurojackpot.org/en/",
    schedule: { tz: "Europe/Berlin", days: [2, 5], time: "20:00" },
    // e.g. "NEXT JACKPOT 17.000.000 €"  (or "17 Mio. €")
    pattern: /NEXT JACKPOT\s*€?\s*([\d.,]+)\s*(Mio\.?|Million|Billion)?\s*€?/i,
    amountGroup: 1, unitGroup: 2,
    dayPattern: /Next official draw:?\s*(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)/i,
  }),
};

/* ---------------- currency conversion (for sorting only) ---------------- */

const FALLBACK_AUD_PER_UNIT = { AUD: 1, USD: 1.52, EUR: 1.65, GBP: 1.95 };

async function audRates() {
  try {
    // Free European Central Bank rates, no key needed.
    const data = JSON.parse(await fetchText("https://api.frankfurter.app/latest?from=AUD&to=USD,EUR,GBP"));
    const rates = { AUD: 1 };
    for (const [cur, perAud] of Object.entries(data.rates || {})) if (perAud > 0) rates[cur] = 1 / perAud;
    return { ...FALLBACK_AUD_PER_UNIT, ...rates };
  } catch (e) {
    return FALLBACK_AUD_PER_UNIT;
  }
}

/* ---------------- Supabase ---------------- */

async function supabaseRequest(path, init = {}) {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const res = await fetch(`${process.env.VITE_SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      apikey: key,
      Authorization: `Bearer ${key}`,
      Prefer: "return=minimal",
      ...(init.headers || {}),
    },
  });
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${await res.text()}`);
  return res;
}

async function previousDraws() {
  try {
    const res = await supabaseRequest("big_draws_snapshots?select=draws&order=fetched_at.desc&limit=1", { headers: { Prefer: "" } });
    const rows = await res.json();
    return rows?.[0]?.draws || [];
  } catch (e) {
    return [];
  }
}

/* ---------------- handler ---------------- */

function isValid(d, nowMs) {
  const t = Date.parse(d.draw_time_utc);
  return d.lottery && d.currency && Number.isFinite(d.jackpot) && d.jackpot >= 100000 && d.jackpot < 1e11
    && Number.isFinite(t) && t > nowMs && t < nowMs + 9 * 864e5;
}

export default async function handler(req, res) {
  // Only Vercel Cron (or someone holding the secret) may trigger a run.
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.authorization !== `Bearer ${secret}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  for (const name of ["SUPABASE_SERVICE_ROLE_KEY", "VITE_SUPABASE_URL"]) {
    if (!process.env[name]) return res.status(500).json({ error: `Missing env var ${name}` });
  }

  try {
    const nowMs = Date.now();
    const names = Object.keys(SOURCES);
    const [results, rates, previous] = await Promise.all([
      Promise.allSettled(names.map((n) => SOURCES[n](nowMs))),
      audRates(),
      previousDraws(),
    ]);

    const status = {};
    const fresh = [];
    results.forEach((r, i) => {
      if (r.status === "fulfilled") {
        const good = r.value.filter((d) => isValid(d, nowMs));
        fresh.push(...good);
        status[names[i]] = good.length ? `ok (${good.map((d) => d.lottery).join(", ")})` : "skipped: figures looked wrong";
      } else {
        status[names[i]] = `skipped: ${r.reason?.message || r.reason}`;
      }
    });

    // Keep yesterday's entry for any lottery that couldn't be read today, if its draw hasn't happened yet.
    const key = (d) => `${d.lottery}|${d.country}`;
    const freshKeys = new Set(fresh.map(key));
    const carried = previous.filter((d) => !freshKeys.has(key(d)) && isValid(d, nowMs));

    const draws = [...fresh, ...carried]
      .map((d) => ({ ...d, jackpot_aud: Math.round(d.jackpot * (rates[d.currency] || 1)) }))
      .sort((a, b) => b.jackpot_aud - a.jackpot_aud);

    if (draws.length < MIN_DRAWS) {
      return res.status(502).json({ error: `Only ${draws.length} draws available; kept the previous list`, status });
    }

    await supabaseRequest("big_draws_snapshots", {
      method: "POST",
      body: JSON.stringify({ draws, search_count: 0 }),
    });

    // Keep a month of history, drop the rest.
    const cutoff = new Date(nowMs - 30 * 864e5).toISOString();
    await supabaseRequest(`big_draws_snapshots?fetched_at=lt.${encodeURIComponent(cutoff)}`, { method: "DELETE" }).catch(() => {});

    return res.status(200).json({ ok: true, count: draws.length, carriedOver: carried.map((d) => d.lottery), status, draws });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
