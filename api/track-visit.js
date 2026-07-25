// Logs a page view along with approximate location, using Vercel's
// automatically-provided geo headers (derived from IP, no GPS/permission needed).
export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { visitorId } = req.body || {};
    if (!visitorId) return res.status(400).json({ error: "Missing visitorId" });

    const country = req.headers["x-vercel-ip-country"] || null;
    const region = req.headers["x-vercel-ip-country-region"] || null;
    const cityRaw = req.headers["x-vercel-ip-city"];
    const city = cityRaw ? decodeURIComponent(cityRaw) : null;

    const supabaseUrl = process.env.VITE_SUPABASE_URL;
    const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY;

    const response = await fetch(`${supabaseUrl}/rest/v1/page_views`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: supabaseKey,
        Authorization: `Bearer ${supabaseKey}`,
      },
      body: JSON.stringify({ visitor_id: visitorId, country, region, city }),
    });

    if (!response.ok) {
      const text = await response.text();
      return res.status(500).json({ error: "Failed to log visit", detail: text });
    }

    return res.status(200).json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
