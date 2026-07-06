import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY;
const MONTHLY_LIMIT = Number(process.env.RESEND_MONTHLY_LIMIT || 3000);

export default async function handler(req, res) {
  try {
    const authHeader = req.headers.authorization || "";
    const accessToken = authHeader.replace(/^Bearer\s+/i, "");
    if (!accessToken) return res.status(401).json({ error: "Missing auth token" });

    // Verify the caller is a signed-in admin — RLS on the admins table means
    // this query only returns a row if the token's own user is listed there.
    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
    });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return res.status(401).json({ error: "Invalid session" });

    const { data: adminRow } = await userClient.from("admins").select("id").eq("id", user.id).maybeSingle();
    if (!adminRow) return res.status(403).json({ error: "Not authorized" });

    // Count emails sent so far this calendar month via Resend's list endpoint.
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    let sentThisMonth = 0;
    let cursor = null;
    let pages = 0;
    let reachedOlderMonth = false;

    while (pages < 20 && !reachedOlderMonth) {
      const url = new URL("https://api.resend.com/emails");
      url.searchParams.set("limit", "100");
      if (cursor) url.searchParams.set("after", cursor);

      const resendRes = await fetch(url.toString(), {
        headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}` },
      });
      if (!resendRes.ok) break;
      const payload = await resendRes.json();
      const items = payload.data || payload.emails || [];
      if (items.length === 0) break;

      for (const item of items) {
        const created = new Date(item.created_at || item.createdAt);
        if (created >= monthStart) {
          sentThisMonth += 1;
        } else {
          reachedOlderMonth = true;
          break;
        }
      }

      cursor = items[items.length - 1]?.id;
      pages += 1;
      if (!cursor) break;
    }

    res.status(200).json({ sentThisMonth, limit: MONTHLY_LIMIT });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
