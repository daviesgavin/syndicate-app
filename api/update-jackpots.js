// Daily job: finds this week's biggest lottery jackpots around the world and saves
// them for the "This week's big draws" card on the Home screen.
//
// Runs on Vercel Cron (see vercel.json). Each run asks Claude, with live web search,
// to look up current jackpots from official lottery sites, checks every entry, and
// stores the list as one new row in Supabase (table: big_draws_snapshots).
// If a run fails or returns too little, nothing is written and yesterday's list stays.
//
// Env vars needed in Vercel:
//   ANTHROPIC_API_KEY          — from console.anthropic.com
//   SUPABASE_SERVICE_ROLE_KEY  — Supabase > Project Settings > API (keep secret, server only)
//   CRON_SECRET                — any long random string; Vercel sends it with cron calls
//   VITE_SUPABASE_URL          — already set

const MODEL = "claude-sonnet-5-5";
const MIN_DRAWS = 3; // fewer valid draws than this = treat the run as failed, keep the old list
const MAX_DRAWS = 8;

function buildPrompt(now) {
  const today = now.toISOString().slice(0, 10);
  const weekOut = new Date(now.getTime() + 7 * 864e5).toISOString().slice(0, 10);
  return `Today is ${today} (UTC). Find the biggest lottery jackpots in the world with a draw between now and ${weekOut}.

Check the major draws that matter to players in Australia, the USA, Canada, the UK, Ireland, Europe, New Zealand and South Africa — for example Powerball (US), Mega Millions (US), Powerball (AU), Oz Lotto, Saturday Lotto, EuroMillions, EuroJackpot, UK Lotto, Irish Lotto, Lotto Max, Lotto 6/49, NZ Powerball, SA Powerball, SuperEnalotto, La Primitiva — plus any other unusually large jackpot you come across.

Rules:
- Use the official lottery operator's website as the source wherever possible. Only fall back to a major news or results site if the official one has no figure.
- Use the CURRENT advertised jackpot for the NEXT draw only. Never use a past draw's jackpot.
- Skip anything you can't confirm with a source dated within the last 4 days.
- Give the next draw time in UTC as ISO 8601 (e.g. 2026-10-28T03:59:00Z). If only the date is known, use 12:00 local time on that date converted to UTC.
- jackpot is the full number in the lottery's own currency (977000000, not "977 million").
- jackpot_aud is your rough conversion to Australian dollars, used only for sorting.
- country is the 2-letter code of the country running the draw (use "EU" for multi-country European draws, "UK" for the United Kingdom).

Return the ${MAX_DRAWS} biggest by jackpot_aud, largest first. Your final answer must be ONLY a JSON array inside <draws></draws> tags, no other text:
<draws>[{"lottery":"Powerball","country":"US","jackpot":977000000,"currency":"USD","jackpot_aud":1490000000,"draw_time_utc":"2026-10-28T03:59:00Z","source_url":"https://www.powerball.com/"}]</draws>`;
}

async function askClaude(prompt) {
  const messages = [{ role: "user", content: prompt }];
  let searches = 0;

  // Long searches can come back with stop_reason "pause_turn"; send the turn back
  // unchanged to let Claude carry on.
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 4000,
        messages,
        tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 15 }],
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(`Anthropic API ${res.status}: ${data?.error?.message || JSON.stringify(data)}`);

    searches += data.usage?.server_tool_use?.web_search_requests || 0;

    if (data.stop_reason === "pause_turn") {
      messages.push({ role: "assistant", content: data.content });
      continue;
    }

    const text = (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("");
    return { text, searches };
  }
  throw new Error("Claude didn't finish after several continuations");
}

function parseDraws(text, now) {
  const match = text.match(/<draws>([\s\S]*?)<\/draws>/);
  if (!match) throw new Error("No <draws> block in Claude's answer");
  const raw = JSON.parse(match[1]);
  if (!Array.isArray(raw)) throw new Error("<draws> was not a list");

  const nowMs = now.getTime();
  const weekMs = nowMs + 8 * 864e5; // a day of slack for time zones
  const seen = new Set();

  const clean = [];
  for (const d of raw) {
    const lottery = typeof d.lottery === "string" ? d.lottery.trim().slice(0, 60) : "";
    const country = typeof d.country === "string" ? d.country.trim().toUpperCase().slice(0, 3) : "";
    const currency = typeof d.currency === "string" ? d.currency.trim().toUpperCase() : "";
    const jackpot = Number(d.jackpot);
    const jackpotAud = Number(d.jackpot_aud);
    const drawMs = Date.parse(d.draw_time_utc);
    const sourceUrl = typeof d.source_url === "string" && /^https:\/\//.test(d.source_url) ? d.source_url : null;

    // Drop anything incomplete, implausible, already drawn, or more than a week away.
    if (!lottery || !/^[A-Z]{3}$/.test(currency) || !sourceUrl) continue;
    if (!Number.isFinite(jackpot) || jackpot < 100000 || jackpot > 1e11) continue;
    if (!Number.isFinite(drawMs) || drawMs < nowMs || drawMs > weekMs) continue;

    const key = `${lottery.toLowerCase()}|${country}`;
    if (seen.has(key)) continue;
    seen.add(key);

    clean.push({
      lottery,
      country,
      jackpot: Math.round(jackpot),
      currency,
      jackpot_aud: Number.isFinite(jackpotAud) && jackpotAud > 0 ? Math.round(jackpotAud) : null,
      draw_time_utc: new Date(drawMs).toISOString(),
      source_url: sourceUrl,
    });
  }

  clean.sort((a, b) => (b.jackpot_aud || 0) - (a.jackpot_aud || 0));
  return clean.slice(0, MAX_DRAWS);
}

async function supabaseRequest(path, init) {
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
}

export default async function handler(req, res) {
  // Only Vercel Cron (or someone holding the secret) may trigger a run.
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.authorization !== `Bearer ${secret}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  for (const name of ["ANTHROPIC_API_KEY", "SUPABASE_SERVICE_ROLE_KEY", "VITE_SUPABASE_URL"]) {
    if (!process.env[name]) return res.status(500).json({ error: `Missing env var ${name}` });
  }

  try {
    const now = new Date();
    const { text, searches } = await askClaude(buildPrompt(now));
    const draws = parseDraws(text, now);

    if (draws.length < MIN_DRAWS) {
      // Keep yesterday's list rather than replacing it with a thin one.
      return res.status(502).json({ error: `Only ${draws.length} valid draws found; kept the previous list`, searches });
    }

    await supabaseRequest("big_draws_snapshots", {
      method: "POST",
      body: JSON.stringify({ draws, search_count: searches }),
    });

    // Keep a month of history, drop the rest.
    const cutoff = new Date(now.getTime() - 30 * 864e5).toISOString();
    await supabaseRequest(`big_draws_snapshots?fetched_at=lt.${encodeURIComponent(cutoff)}`, { method: "DELETE" }).catch(() => {});

    return res.status(200).json({ ok: true, count: draws.length, searches, draws });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
