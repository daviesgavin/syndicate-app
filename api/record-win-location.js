// Captures approximate location (via Vercel's automatic geo headers, derived
// from IP — no GPS/permission needed) at the exact moment draw results are
// entered, and records it against that syndicate for the winners ticker.
export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { code } = req.body || {};
    if (!code) return res.status(400).json({ error: "Missing code" });

    const country = req.headers["x-vercel-ip-country"] || null;
    const region = req.headers["x-vercel-ip-country-region"] || null;
    const cityRaw = req.headers["x-vercel-ip-city"];
    const city = cityRaw ? decodeURIComponent(cityRaw) : null;

    const supabaseUrl = process.env.VITE_SUPABASE_URL;
    const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY;

    const response = await fetch(`${supabaseUrl}/rest/v1/rpc/record_win_location`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: supabaseKey,
        Authorization: `Bearer ${supabaseKey}`,
      },
      body: JSON.stringify({ p_code: code, p_city: city, p_region: region, p_country: country }),
    });

    if (!response.ok) {
      const text = await response.text();
      return res.status(500).json({ error: "Failed to record location", detail: text });
    }

    return res.status(200).json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
