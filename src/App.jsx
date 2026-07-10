import React, { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "./supabaseClient";
import {
  Ticket, Users, Copy, Check, ArrowRight, ArrowLeft, PlusCircle,
  TrendingUp, Trophy, Clock, Share2, Loader2, ShieldCheck,
  AlertCircle, ChevronRight, Sparkles, ImagePlus, X, Images, Eye, RefreshCw,
  LogIn, Lock, MessageCircle, Send, UserCircle, CheckSquare, Square, Trash2, Landmark, Download, PlusSquare, Smartphone, Pencil, UserX, BookOpen, UserPlus
} from "lucide-react";

const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function genCode(len = 5) {
  let s = "";
  for (let i = 0; i < len; i++) s += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  return s;
}

function money(n) {
  if (n === null || n === undefined || isNaN(n)) return "$0.00";
  return Number(n).toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function pct(n) {
  if (n === null || n === undefined || isNaN(n)) return "0.00%";
  return n.toFixed(4) + "%";
}

function totals(pool) {
  const totalAmount = pool.participants.reduce((s, p) => s + Number(p.amount || 0), 0);
  const confirmed = pool.participants.filter((p) => p.paid).reduce((s, p) => s + Number(p.amount || 0), 0);
  return { totalAmount, confirmed };
}

function displayName(p) {
  return p.nickname ? `${p.name} ("${p.nickname}")` : p.name;
}

async function downloadSyndicatePdf(pool) {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF();
  const marginX = 14;
  const { totalAmount } = totals(pool);
  let y = 20;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.text(pool.name, marginX, y);
  y += 8;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(110);
  doc.text(`Syndicate code: ${pool.code}`, marginX, y);
  y += 5;
  doc.text(`Organised by ${pool.organiser}`, marginX, y);
  y += 5;
  if (pool.drawDate) {
    doc.text(`Draw date: ${pool.drawDate}`, marginX, y);
    y += 5;
  }
  y += 4;

  doc.setTextColor(20);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.text(pool.status === "drawn" ? `Actual winnings: ${money(pool.actualWinnings)}` : `Jackpot estimate: ${money(pool.jackpot)}`, marginX, y);
  y += 8;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(80);
  doc.text(`Total pool contributed: ${money(totalAmount)}`, marginX, y);
  y += 10;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(20);
  doc.text("Name", marginX, y);
  doc.text("Amount", 92, y);
  doc.text("Share %", 122, y);
  doc.text("Winnings", 150, y);
  doc.text("Status", 178, y);
  y += 2;
  doc.setDrawColor(200);
  doc.line(marginX, y, 196, y);
  y += 7;

  doc.setFont("helvetica", "normal");
  pool.participants.forEach((p) => {
    if (y > 275) { doc.addPage(); y = 20; }
    const share = totalAmount ? (Number(p.amount || 0) / totalAmount) * 100 : 0;
    const winnings = pool.status === "drawn" ? (share / 100) * pool.actualWinnings : (share / 100) * pool.jackpot;
    doc.text(displayName(p), marginX, y);
    doc.text(money(p.amount), 92, y);
    doc.text(`${share.toFixed(2)}%`, 122, y);
    doc.text(money(winnings), 150, y);
    doc.text(p.paid ? "Paid" : "Unpaid", 178, y);
    y += 7;
  });

  doc.setFontSize(8);
  doc.setTextColor(160);
  doc.text(`Generated ${new Date().toLocaleString()} · Syndicate app (bank/payment details intentionally excluded)`, marginX, 290);

  const safeName = pool.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
  doc.save(`${safeName}-${pool.code}.pdf`);
}

function compressImageToBlob(file, maxDim = 1400, quality = 0.72) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Couldn't read that file"));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("Couldn't read that image"));
      img.onload = () => {
        let { width, height } = img;
        if (width > height && width > maxDim) {
          height = Math.round((height * maxDim) / width);
          width = maxDim;
        } else if (height > maxDim) {
          width = Math.round((width * maxDim) / height);
          height = maxDim;
        }
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        canvas.getContext("2d").drawImage(img, 0, 0, width, height);
        canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Compression failed"))), "image/jpeg", quality);
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

/* ---------------------------------------------------------
   Auth
--------------------------------------------------------- */

async function sendMagicLink(email) {
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: window.location.origin },
  });
  if (error) throw error;
}

async function signOut() {
  await supabase.auth.signOut();
}

/* ---------------------------------------------------------
   Profiles
--------------------------------------------------------- */

async function loadProfile(userId) {
  const { data, error } = await supabase.from("profiles").select("*").eq("id", userId).maybeSingle();
  if (error || !data) return null;
  return data;
}

async function saveProfile(userId, { nickname, avatarUrl }) {
  const { error } = await supabase.from("profiles").upsert({ id: userId, nickname, avatar_url: avatarUrl });
  if (error) throw error;
}

async function uploadAvatar(userId, file) {
  const blob = await compressImageToBlob(file, 500, 0.8);
  const path = `${userId}/avatar.jpg`;
  const { error: upErr } = await supabase.storage.from("avatars").upload(path, blob, { contentType: "image/jpeg", upsert: true });
  if (upErr) throw upErr;
  const { data: pub } = supabase.storage.from("avatars").getPublicUrl(path);
  return `${pub.publicUrl}?t=${Date.now()}`;
}

/* ---------------------------------------------------------
   Data layer — Supabase
--------------------------------------------------------- */

async function createPool({ name, organiser, jackpot, drawDate, entryDeadline, ownerId }) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = genCode();
    const { error } = await supabase.from("syndicates").insert({
      code,
      name,
      organiser,
      jackpot,
      draw_date: drawDate || null,
      entry_deadline: entryDeadline || null,
      owner_id: ownerId,
    });
    if (!error) return code;
    if (error.code !== "23505") throw error;
  }
  throw new Error("Could not generate a unique code, try again.");
}

async function loadPool(code) {
  const { data: syn, error } = await supabase.from("syndicates").select("*").eq("code", code).is("deleted_at", null).maybeSingle();
  if (error || !syn) return null;
  const { data: parts } = await supabase.from("participants").select("*").eq("syndicate_code", code).order("paid_at", { ascending: true });

  const userIds = [...new Set((parts || []).map((p) => p.user_id).filter(Boolean))];
  let profileMap = {};
  if (userIds.length) {
    const { data: profs } = await supabase.from("profiles").select("id,nickname,avatar_url").in("id", userIds);
    (profs || []).forEach((pr) => { profileMap[pr.id] = pr; });
  }

  const partIds = (parts || []).map((p) => p.id);
  let receiptMap = {};
  if (partIds.length) {
    const { data: receipts } = await supabase.from("payment_receipts").select("participant_id,path,uploaded_at").in("participant_id", partIds).order("uploaded_at", { ascending: false });
    (receipts || []).forEach((r) => { if (!receiptMap[r.participant_id]) receiptMap[r.participant_id] = r.path; });
  }

  const { data: photos } = await supabase.from("ticket_photos").select("*").eq("syndicate_code", code).order("uploaded_at", { ascending: true });
  return {
    code: syn.code,
    name: syn.name,
    organiser: syn.organiser,
    ownerId: syn.owner_id,
    jackpot: Number(syn.jackpot),
    drawDate: syn.draw_date,
    entryDeadline: syn.entry_deadline,
    status: syn.status,
    actualWinnings: syn.actual_winnings !== null ? Number(syn.actual_winnings) : null,
    rolledOverFrom: syn.rolled_over_from,
    rolloverAmount: syn.rollover_amount !== null ? Number(syn.rollover_amount) : null,
    rolledForwardTo: syn.rolled_forward_to,
    participants: (parts || []).map((p) => ({
      id: p.id, name: p.name, amount: Number(p.amount || 0), paid: p.paid, paidAt: p.paid_at, userId: p.user_id,
      nickname: profileMap[p.user_id]?.nickname || null,
      avatarUrl: profileMap[p.user_id]?.avatar_url || null,
      receiptPath: receiptMap[p.id] || null,
    })),
    ticketPhotos: (photos || []).map((ph) => ({ id: ph.id, url: ph.url })),
  };
}

async function loadOwnedPools(ownerId) {
  const { data, error } = await supabase
    .from("syndicates")
    .select("code,name")
    .eq("owner_id", ownerId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false });
  if (error) return [];
  return data;
}

async function loadMemberships(userId) {
  const { data, error } = await supabase
    .from("participants")
    .select("amount, syndicate:syndicates!inner(code,name,jackpot,status,actual_winnings,deleted_at)")
    .eq("user_id", userId)
    .is("syndicate.deleted_at", null)
    .order("paid_at", { ascending: false });
  if (error || !data) return [];
  return data
    .filter((r) => r.syndicate)
    .map((r) => ({
      code: r.syndicate.code,
      name: r.syndicate.name,
      jackpot: Number(r.syndicate.jackpot),
      status: r.syndicate.status,
      actualWinnings: r.syndicate.actual_winnings !== null ? Number(r.syndicate.actual_winnings) : null,
      amount: Number(r.amount || 0),
    }));
}

async function addParticipant(code, { name, amount, userId, paid = false }) {
  const row = { syndicate_code: code, name, amount, fee: 0, paid, user_id: userId };
  if (paid) row.paid_at = new Date().toISOString(); // otherwise omitted, so the column's own default applies
  const { data, error } = await supabase
    .from("participants")
    .insert(row)
    .select()
    .single();
  if (error) throw error;
  return data.id;
}

async function loadIsAdmin(userId) {
  if (!userId) return false;
  const { data, error } = await supabase.from("admins").select("id").eq("id", userId).maybeSingle();
  if (error || !data) return false;
  return true;
}

async function loadVisitorStats() {
  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfWeek = new Date(startOfDay.getTime() - 6 * 86400000);
  const startOfMonth = new Date(startOfDay.getTime() - 29 * 86400000);

  async function countSince(sinceIso) {
    const { count } = await supabase.from("page_views").select("*", { count: "exact", head: true }).gte("created_at", sinceIso);
    return count || 0;
  }
  async function uniqueSince(sinceIso) {
    const { data } = await supabase.from("page_views").select("visitor_id").gte("created_at", sinceIso);
    return new Set((data || []).map((r) => r.visitor_id)).size;
  }

  const [dayViews, weekViews, monthViews, dayUnique, weekUnique, monthUnique] = await Promise.all([
    countSince(startOfDay.toISOString()),
    countSince(startOfWeek.toISOString()),
    countSince(startOfMonth.toISOString()),
    uniqueSince(startOfDay.toISOString()),
    uniqueSince(startOfWeek.toISOString()),
    uniqueSince(startOfMonth.toISOString()),
  ]);

  return {
    day: { views: dayViews, unique: dayUnique },
    week: { views: weekViews, unique: weekUnique },
    month: { views: monthViews, unique: monthUnique },
  };
}

async function loadAdminStats() {
  const [totalRes, activeRes, deletedRes, participantsRes, amountsRes, userCountRes] = await Promise.all([
    supabase.from("syndicates").select("*", { count: "exact", head: true }),
    supabase.from("syndicates").select("*", { count: "exact", head: true }).is("deleted_at", null),
    supabase.from("syndicates").select("*", { count: "exact", head: true }).not("deleted_at", "is", null),
    supabase.from("participants").select("*", { count: "exact", head: true }),
    supabase.from("participants").select("amount"),
    supabase.rpc("admin_user_count"),
  ]);
  const totalContributed = (amountsRes.data || []).reduce((s, r) => s + Number(r.amount || 0), 0);
  return {
    totalSyndicates: totalRes.count || 0,
    activeSyndicates: activeRes.count || 0,
    deletedSyndicates: deletedRes.count || 0,
    totalParticipants: participantsRes.count || 0,
    totalContributed,
    totalUsers: userCountRes.data ?? "—",
  };
}

async function loadAllSyndicates({ includeDeleted = false, limit = 50 } = {}) {
  let query = supabase
    .from("syndicates")
    .select("code,name,organiser,status,jackpot,actual_winnings,created_at,deleted_at,owner_id")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (!includeDeleted) query = query.is("deleted_at", null);
  const { data, error } = await query;
  if (error) return [];
  return data;
}

async function restoreSyndicate(code) {
  const { error } = await supabase.from("syndicates").update({ deleted_at: null }).eq("code", code);
  if (error) throw error;
}

async function deleteSyndicate(code) {
  const { error } = await supabase.from("syndicates").update({ deleted_at: new Date().toISOString() }).eq("code", code);
  if (error) throw error;
}

async function loadPaymentDetails(code) {
  const { data, error } = await supabase.from("payment_details").select("*").eq("syndicate_code", code).maybeSingle();
  if (error || !data) return null;
  return data;
}

async function savePaymentDetails(code, { bankName, accountName, bsb, accountNumber, payid }) {
  const { error } = await supabase.from("payment_details").upsert({
    syndicate_code: code, bank_name: bankName, account_name: accountName, bsb, account_number: accountNumber, payid,
    updated_at: new Date().toISOString(),
  });
  if (error) throw error;
}

async function uploadPaymentReceipt(participantId, file) {
  const blob = await compressImageToBlob(file, 1200, 0.7);
  const path = `${participantId}/${crypto.randomUUID()}.jpg`;
  const { error: upErr } = await supabase.storage.from("payment-receipts").upload(path, blob, { contentType: "image/jpeg" });
  if (upErr) throw upErr;
  const { error: dbErr } = await supabase.from("payment_receipts").insert({ participant_id: participantId, path });
  if (dbErr) throw dbErr;
}

async function getReceiptSignedUrl(path) {
  const { data, error } = await supabase.storage.from("payment-receipts").createSignedUrl(path, 3600);
  if (error) return null;
  return data.signedUrl;
}

async function setParticipantPaid(id, paid) {
  const { error } = await supabase.from("participants").update({ paid, paid_at: new Date().toISOString() }).eq("id", id);
  if (error) throw error;
}

async function updateParticipantAmount(id, amount) {
  const { error } = await supabase.from("participants").update({ amount }).eq("id", id);
  if (error) throw error;
}

async function removeParticipant(id) {
  const { error } = await supabase.from("participants").delete().eq("id", id);
  if (error) throw error;
}

async function updateJackpot(code, jackpot) {
  const { error } = await supabase.from("syndicates").update({ jackpot }).eq("code", code);
  if (error) throw error;
}

async function submitResults(code, actualWinnings) {
  const { error } = await supabase.from("syndicates").update({ status: "drawn", actual_winnings: actualWinnings }).eq("code", code);
  if (error) throw error;
}

async function uploadTicketPhoto(code, file) {
  const blob = await compressImageToBlob(file);
  const path = `${code}/${crypto.randomUUID()}.jpg`;
  const { error: upErr } = await supabase.storage.from("ticket-photos").upload(path, blob, { contentType: "image/jpeg" });
  if (upErr) throw upErr;
  const { data: pub } = supabase.storage.from("ticket-photos").getPublicUrl(path);
  const { error: dbErr } = await supabase.from("ticket_photos").insert({ syndicate_code: code, url: pub.publicUrl });
  if (dbErr) throw dbErr;
}

async function removeTicketPhoto(id) {
  const { error } = await supabase.from("ticket_photos").delete().eq("id", id);
  if (error) throw error;
}

async function rolloverSyndicate(oldPool, { jackpot, drawDate, entryDeadline, carryMembers, ownerId }) {
  const newCode = await createPool({
    name: oldPool.name,
    organiser: oldPool.organiser,
    jackpot,
    drawDate,
    entryDeadline,
    ownerId,
  });
  await supabase.from("syndicates").update({ rolled_over_from: oldPool.code, rollover_amount: oldPool.actualWinnings }).eq("code", newCode);
  await supabase.from("syndicates").update({ rolled_forward_to: newCode }).eq("code", oldPool.code);

  if (carryMembers) {
    const oldTotal = oldPool.participants.reduce((s, p) => s + Number(p.amount || 0), 0);
    const winnings = Number(oldPool.actualWinnings || 0);
    for (const p of oldPool.participants) {
      const share = oldTotal ? Number(p.amount || 0) / oldTotal : 0;
      const rolledAmount = Math.round(share * winnings * 100) / 100; // each person's proportional share of the actual winnings
      await supabase.from("participants").insert({
        syndicate_code: newCode, name: p.name, amount: rolledAmount, user_id: p.userId || null,
        fee: 0, paid: true, paid_at: new Date().toISOString(), // already "paid" — it's their own winnings, not new money owed
      });
    }
  }
  return newCode;
}

/* ---------------------------------------------------------
   Chat
--------------------------------------------------------- */

async function loadMessages(code) {
  const { data, error } = await supabase.from("messages").select("*").eq("syndicate_code", code).order("created_at", { ascending: true });
  if (error) return [];
  return data;
}

async function sendMessage(code, { userId, senderName, senderAvatar, body }) {
  const { data, error } = await supabase
    .from("messages")
    .insert({ syndicate_code: code, user_id: userId, sender_name: senderName, sender_avatar: senderAvatar, body })
    .select()
    .single();
  if (error) throw error;
  return data;
}

function subscribeToMessages(code, onInsert) {
  const channel = supabase
    .channel(`messages:${code}`)
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages", filter: `syndicate_code=eq.${code}` }, (payload) => onInsert(payload.new))
    .subscribe();
  return () => supabase.removeChannel(channel);
}

/* ---------------------------------------------------------
   Countdown
--------------------------------------------------------- */

function useCountdown(deadline) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!deadline) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [deadline]);
  if (!deadline) return null;
  return new Date(deadline).getTime() - now;
}

function formatCountdown(ms) {
  if (ms <= 0) return "Closed";
  const totalSec = Math.floor(ms / 1000);
  const d = Math.floor(totalSec / 86400);
  const h = Math.floor((totalSec % 86400) / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  return `${m}m ${s}s`;
}

function DeadlineBadge({ deadline, drawDate }) {
  const diff = useCountdown(deadline);
  if (diff === null) return null;
  const closed = diff <= 0;
  const formattedDrawDate = drawDate
    ? new Date(drawDate + "T00:00:00").toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" })
    : null;
  return (
    <div className="rounded-xl px-3.5 py-2.5 mb-4 bg-[#C1473A]/8">
      <div className="flex items-center gap-2">
        <Clock size={15} className="text-[#C1473A] shrink-0" />
        {closed ? (
          <span className="text-[16px] font-bold text-[#C1473A]">Entries are closed</span>
        ) : (
          <span className="text-[13px] text-[#8A6A15]">
            Entries close in <span className="text-[18px] font-bold text-[#C1473A]">{formatCountdown(diff)}</span>
          </span>
        )}
      </div>
      {formattedDrawDate && (
        <div className="flex items-center gap-2 mt-1.5 pt-1.5 border-t border-[#C1473A]/15">
          <Ticket size={14} className="text-[#8A6A15] shrink-0" />
          <span className="text-[13px] text-[#8A6A15]">Draw date: <span className="font-medium text-[#10201D]">{formattedDrawDate}</span></span>
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------
   Shared UI atoms
--------------------------------------------------------- */

function Screen({ children, dark }) {
  return (
    <div className={`min-h-[100dvh] w-full flex justify-center overflow-y-auto ${dark ? "bg-[#10201D]" : "bg-[#F7F2E7]"}`}>
      <div className="w-full max-w-[430px] min-h-[100dvh] relative flex flex-col pb-6">{children}</div>
    </div>
  );
}

function TopBar({ title, onBack, dark, right }) {
  return (
    <div className={`sticky top-0 z-20 flex items-center justify-between px-5 pt-6 pb-4 ${dark ? "bg-[#10201D] text-[#F7F2E7]" : "bg-[#F7F2E7] text-[#10201D]"}`}>
      <button onClick={onBack} className={`w-9 h-9 rounded-full flex items-center justify-center ${onBack ? "opacity-100" : "opacity-0 pointer-events-none"} ${dark ? "bg-white/10" : "bg-black/5"}`} aria-label="Back">
        <ArrowLeft size={18} />
      </button>
      <h1 className="font-[Fraunces] text-[17px] tracking-tight font-medium">{title}</h1>
      <div className="w-9 h-9 flex items-center justify-center">{right}</div>
    </div>
  );
}

function TicketCard({ children, stub, className = "" }) {
  return (
    <div className={`relative rounded-2xl bg-white shadow-[0_1px_2px_rgba(16,32,29,0.06),0_8px_24px_-12px_rgba(16,32,29,0.25)] ${className}`}>
      <div className="p-5">{children}</div>
      {stub && (
        <>
          <div className="relative h-0">
            <div className="absolute -left-[9px] -top-[9px] w-[18px] h-[18px] rounded-full bg-[#F7F2E7]" />
            <div className="absolute -right-[9px] -top-[9px] w-[18px] h-[18px] rounded-full bg-[#F7F2E7]" />
            <div className="mx-[14px] border-t border-dashed border-[#D8D0BC]" />
          </div>
          <div className="p-5 pt-4">{stub}</div>
        </>
      )}
    </div>
  );
}

function Button({ children, onClick, variant = "primary", disabled, full = true, icon: Icon, type = "button" }) {
  const base = "inline-flex items-center justify-center gap-2 rounded-xl font-medium text-[15px] px-5 py-3.5 transition active:scale-[0.98] disabled:opacity-40 disabled:active:scale-100";
  const styles = {
    primary: "bg-[#2F6F5E] text-white shadow-sm hover:bg-[#285f51]",
    gold: "bg-[#C9982E] text-[#10201D] shadow-sm hover:bg-[#bd8f28]",
    ghost: "bg-transparent text-[#2F6F5E] border border-[#2F6F5E]/30",
    dark: "bg-[#10201D] text-[#F7F2E7]",
  };
  return (
    <button type={type} onClick={onClick} disabled={disabled} className={`${base} ${styles[variant]} ${full ? "w-full" : ""}`}>
      {Icon && <Icon size={17} />}
      {children}
    </button>
  );
}

function Field({ label, children }) {
  return (
    <label className="block mb-4">
      <span className="block text-[12px] font-medium uppercase tracking-wide text-[#6B7A76] mb-1.5">{label}</span>
      {children}
    </label>
  );
}

const inputCls = "w-full rounded-xl border border-[#E1DAC6] bg-white px-4 py-3 text-[15px] text-[#10201D] placeholder-[#A8A08C] focus:outline-none focus:ring-2 focus:ring-[#2F6F5E]/40 focus:border-[#2F6F5E]";

function Stepper({ value, onChange, min = 1, max = 999 }) {
  return (
    <div className="flex items-center gap-4">
      <button onClick={() => onChange(Math.max(min, value - 1))} className="w-11 h-11 rounded-full bg-[#EFE9D8] text-[#10201D] text-xl font-medium flex items-center justify-center active:scale-95">−</button>
      <div className="flex-1 text-center">
        <div className="text-[32px] font-[Fraunces] font-medium text-[#10201D] leading-none">{value}</div>
        <div className="text-[11px] uppercase tracking-wide text-[#6B7A76] mt-1">share{value === 1 ? "" : "s"}</div>
      </div>
      <button onClick={() => onChange(Math.min(max, value + 1))} className="w-11 h-11 rounded-full bg-[#2F6F5E] text-white text-xl font-medium flex items-center justify-center active:scale-95">+</button>
    </div>
  );
}

function Avatar({ url, name, size = 32 }) {
  if (url) return <img src={url} alt={name || "avatar"} style={{ width: size, height: size }} className="rounded-full object-cover shrink-0" />;
  const initial = (name || "?").trim()[0]?.toUpperCase() || "?";
  return (
    <div style={{ width: size, height: size, fontSize: size * 0.4 }} className="rounded-full bg-[#2F6F5E] text-white flex items-center justify-center font-medium shrink-0">
      {initial}
    </div>
  );
}

function PhotoLightbox({ photos, index, onClose, onIndexChange }) {
  if (index === null) return null;
  const photo = photos[index];
  return (
    <div className="fixed inset-0 z-40 bg-black/90 flex flex-col" onClick={onClose}>
      <div className="flex items-center justify-between px-5 pt-6 pb-3">
        <span className="text-[#D8D0BC] text-[12.5px] font-[JetBrains_Mono]">{index + 1} / {photos.length}</span>
        <button onClick={onClose} className="w-9 h-9 rounded-full bg-white/10 flex items-center justify-center text-white"><X size={17} /></button>
      </div>
      <div className="flex-1 flex items-center justify-center px-4" onClick={(e) => e.stopPropagation()}>
        <img src={photo.url} alt="Lotto ticket" className="max-h-full max-w-full rounded-lg object-contain" />
      </div>
      {photos.length > 1 && (
        <div className="flex justify-center gap-2 pb-8 pt-3" onClick={(e) => e.stopPropagation()}>
          <button onClick={() => onIndexChange((index - 1 + photos.length) % photos.length)} className="px-4 py-2 rounded-full bg-white/10 text-white text-[13px]">Prev</button>
          <button onClick={() => onIndexChange((index + 1) % photos.length)} className="px-4 py-2 rounded-full bg-white/10 text-white text-[13px]">Next</button>
        </div>
      )}
    </div>
  );
}

function PhotoGallery({ photos, onRemove, editable, emptyHint }) {
  const [lightboxIndex, setLightboxIndex] = useState(null);
  if (!photos || photos.length === 0) {
    return (
      <div className="flex items-center gap-2.5 text-[13px] text-[#8A968F] bg-white rounded-xl px-4 py-5 justify-center text-center">
        <Images size={16} /> {emptyHint}
      </div>
    );
  }
  return (
    <>
      <div className="grid grid-cols-3 gap-2">
        {photos.map((p, i) => (
          <div key={p.id} className="relative aspect-square rounded-lg overflow-hidden bg-[#EFE9D8]">
            <button className="absolute inset-0" onClick={() => setLightboxIndex(i)}>
              <img src={p.url} alt="Ticket" className="w-full h-full object-cover" />
            </button>
            {editable && (
              <button onClick={() => onRemove(p.id)} className="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/60 flex items-center justify-center">
                <X size={11} className="text-white" />
              </button>
            )}
          </div>
        ))}
      </div>
      <PhotoLightbox photos={photos} index={lightboxIndex} onClose={() => setLightboxIndex(null)} onIndexChange={setLightboxIndex} />
    </>
  );
}

/* ---------------------------------------------------------
   Sign in
--------------------------------------------------------- */

function SignIn({ onBack }) {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");

  async function handleSend() {
    if (!email.trim()) return;
    setSending(true);
    setError("");
    try {
      await sendMagicLink(email.trim());
      setSent(true);
    } catch (e) {
      setError(e.message || "Couldn'''t send the link. Try again.");
    } finally {
      setSending(false);
    }
  }

  if (sent) {
    return (
      <Screen>
        <TopBar title="Check your email" onBack={onBack} />
        <div className="flex-1 px-6 pt-10 flex flex-col items-center text-center">
          <div className="w-14 h-14 rounded-full bg-[#2F6F5E] flex items-center justify-center mb-5"><Check size={26} className="text-white" /></div>
          <p className="text-[#3E5652] text-[15px] leading-relaxed">We sent a sign-in link to<br /><strong>{email}</strong></p>
          <p className="text-[#8A968F] text-[13px] mt-3">Open it on this device, then come back to this tab.</p>
          <div className="bg-white rounded-xl px-4 py-3 mt-6 text-[12.5px] text-[#6B7A76] leading-relaxed">
            The email will arrive from <strong className="text-[#3E5652]">"Syndicate"</strong>. If you don't see it in your inbox within a minute or two, check your spam or junk folder.
          </div>
        </div>
      </Screen>
    );
  }

  return (
    <Screen>
      <TopBar title="Sign in" onBack={onBack} />
      <div className="flex-1 px-6 pt-4">
        <p className="text-[#5B6B67] text-[14.5px] leading-relaxed mb-6">Enter your email — we'''ll send a link to sign in, no password needed. Use the same email each time to keep track of all your syndicates.</p>
        <Field label="Email">
          <input className={inputCls} type="email" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
        </Field>
        {error && <div className="flex items-center gap-2 text-[#C1473A] text-[13px] mb-4"><AlertCircle size={15} /> {error}</div>}
        <Button onClick={handleSend} disabled={!email.trim() || sending} icon={sending ? Loader2 : ArrowRight}>{sending ? "Sending…" : "Send sign-in link"}</Button>
      </div>
    </Screen>
  );
}

/* ---------------------------------------------------------
   Profile
--------------------------------------------------------- */

function ProfileScreen({ session, onBack }) {
  const [nickname, setNickname] = useState("");
  const [avatarUrl, setAvatarUrl] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const fileRef = useRef(null);

  useEffect(() => {
    loadProfile(session.user.id).then((p) => {
      if (p) { setNickname(p.nickname || ""); setAvatarUrl(p.avatar_url || null); }
      setLoading(false);
    });
  }, [session.user.id]);

  async function handleAvatarSelect(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setError("");
    try {
      const url = await uploadAvatar(session.user.id, file);
      setAvatarUrl(url);
    } catch (err) {
      setError("Couldn't upload that photo — try again.");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function handleSave() {
    setSaving(true);
    setError("");
    try {
      await saveProfile(session.user.id, { nickname: nickname.trim() || null, avatarUrl });
      setSaved(true);
      setTimeout(() => setSaved(false), 1800);
    } catch (err) {
      setError("Something went wrong saving your profile.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return (<Screen><TopBar title="Your profile" onBack={onBack} /><div className="flex-1 flex items-center justify-center"><Loader2 className="animate-spin text-[#2F6F5E]" size={22} /></div></Screen>);

  return (
    <Screen>
      <TopBar title="Your profile" onBack={onBack} />
      <div className="flex-1 px-6 pt-4">
        <div className="flex flex-col items-center mb-8">
          <button onClick={() => fileRef.current?.click()} className="relative">
            <Avatar url={avatarUrl} name={nickname || session.user.email} size={88} />
            <div className="absolute -bottom-1 -right-1 w-7 h-7 rounded-full bg-[#2F6F5E] flex items-center justify-center border-2 border-[#F7F2E7]">
              {uploading ? <Loader2 size={13} className="animate-spin text-white" /> : <ImagePlus size={13} className="text-white" />}
            </div>
          </button>
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleAvatarSelect} />
          <p className="text-[12px] text-[#8A968F] mt-3">Tap to add a photo</p>
        </div>
        <Field label="Nickname">
          <input className={inputCls} placeholder="e.g. Jonesy" value={nickname} onChange={(e) => setNickname(e.target.value)} />
        </Field>
        <p className="text-[12.5px] text-[#8A968F] mb-6">Shown alongside your name in syndicates and chat.</p>
        {error && <div className="flex items-center gap-2 text-[#C1473A] text-[13px] mb-4"><AlertCircle size={15} /> {error}</div>}
        <Button onClick={handleSave} disabled={saving} icon={saving ? Loader2 : saved ? Check : undefined}>{saving ? "Saving…" : saved ? "Saved" : "Save profile"}</Button>
      </div>
    </Screen>
  );
}

/* ---------------------------------------------------------
   Chat
--------------------------------------------------------- */

function ChatRoom({ session, code, poolName, onBack, onSignIn }) {
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [profile, setProfile] = useState(null);
  const bottomRef = useRef(null);

  function addMessage(msg) {
    setMessages((prev) => (prev.some((m) => m.id === msg.id) ? prev : [...prev, msg]));
  }

  useEffect(() => {
    loadMessages(code).then((m) => { setMessages(m); setLoading(false); });
    const unsub = subscribeToMessages(code, addMessage);
    return unsub;
  }, [code]);

  useEffect(() => {
    if (session) loadProfile(session.user.id).then(setProfile);
  }, [session]);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  async function handleSend() {
    if (!body.trim() || !session) return;
    setSending(true);
    setError("");
    try {
      const newMsg = await sendMessage(code, {
        userId: session.user.id,
        senderName: profile?.nickname || session.user.email.split("@")[0],
        senderAvatar: profile?.avatar_url || null,
        body: body.trim(),
      });
      addMessage(newMsg);
      setBody("");
    } catch (e) {
      setError(e.message || "Couldn't send that message. Try again.");
    } finally {
      setSending(false);
    }
  }

  return (
    <Screen>
      <TopBar title={`${poolName} chat`} onBack={onBack} />
      <div className="flex-1 px-4 pb-2 overflow-y-auto flex flex-col gap-3">
        {loading && <div className="flex justify-center py-8"><Loader2 className="animate-spin text-[#2F6F5E]" size={20} /></div>}
        {!loading && messages.length === 0 && <div className="text-[13px] text-[#8A968F] text-center py-8">No messages yet — say hi!</div>}
        {messages.map((m) => (
          <div key={m.id} className="flex items-start gap-2.5">
            <Avatar url={m.sender_avatar} name={m.sender_name} size={30} />
            <div className="bg-white rounded-2xl rounded-tl-sm px-3.5 py-2.5 max-w-[78%]">
              <div className="text-[11.5px] font-medium text-[#2F6F5E] mb-0.5">{m.sender_name}</div>
              <div className="text-[14px] text-[#10201D] break-words">{m.body}</div>
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
      <div className="px-4 pb-4 pt-2 sticky bottom-0 bg-[#F7F2E7]">
        {error && <div className="flex items-center gap-2 text-[#C1473A] text-[12.5px] mb-2"><AlertCircle size={13} />{error}</div>}
        {session ? (
          <form
            className="flex gap-2"
            onSubmit={(e) => { e.preventDefault(); handleSend(); }}
          >
            <input
              className={`${inputCls} flex-1`}
              placeholder="Message the group…"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              enterKeyHint="send"
            />
            <button type="submit" disabled={!body.trim() || sending} className="w-12 h-12 rounded-xl bg-[#2F6F5E] text-white flex items-center justify-center disabled:opacity-40 shrink-0">
              {sending ? <Loader2 size={18} className="animate-spin" /> : <Send size={18} />}
            </button>
          </form>
        ) : (
          <Button icon={LogIn} onClick={onSignIn}>Sign in to chat</Button>
        )}
      </div>
    </Screen>
  );
}

/* ---------------------------------------------------------
   Home
--------------------------------------------------------- */

const DEMO_SCENE_COUNT = 7;
const DEMO_HERO_INDEX = 3;
const DEMO_DUR = 3400;

function HowItWorksDemo() {
  const [idx, setIdx] = useState(0);
  const [amt, setAmt] = useState(0);
  const [pctVal, setPctVal] = useState(0);
  const [winVal, setWinVal] = useState(0);

  useEffect(() => {
    const t = setTimeout(() => setIdx((i) => (i + 1) % DEMO_SCENE_COUNT), DEMO_DUR);
    return () => clearTimeout(t);
  }, [idx]);

  useEffect(() => {
    if (idx !== DEMO_HERO_INDEX) { setAmt(0); setPctVal(0); setWinVal(0); return; }
    let raf, t0 = null;
    const targetAmt = 45, targetPct = 2.85, targetWin = 1140000;
    function tick(ts) {
      if (!t0) t0 = ts;
      const p = Math.min(1, (ts - t0) / 1300);
      const eased = 1 - Math.pow(1 - p, 3);
      setAmt(Math.round(targetAmt * eased));
      setPctVal(targetPct * eased);
      setWinVal(Math.round(targetWin * eased));
      if (p < 1) raf = requestAnimationFrame(tick);
    }
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [idx]);

  const eyebrowCls = "text-[10.5px] uppercase tracking-[0.14em] text-[#C9982E] font-bold mb-2.5";
  const h1Cls = "font-[Fraunces] text-[19px] leading-[1.18] text-[#F7F2E7] font-semibold mb-2";
  const subCls = "text-[12.5px] leading-relaxed text-[#9FB0AC]";
  const cardCls = "bg-white rounded-2xl p-3.5 shadow-[0_10px_24px_-10px_rgba(0,0,0,0.4)]";
  const labelCls = "text-[9.5px] uppercase tracking-wide text-[#6B7A76]";

  const scenes = [
    <div key="s0">
      <div className={eyebrowCls}>Sound familiar?</div>
      <div className={h1Cls}>Running the work<br />lotto pool again?</div>
      <p className={subCls}>The spreadsheet. The group chat. The "did everyone pay?" texts.</p>
    </div>,
    <div key="s1">
      <div className={eyebrowCls}>The old way</div>
      <div className={cardCls} style={{ opacity: .92 }}>
        <div className="font-[JetBrains_Mono] text-[9.5px] text-[#8A968F]">POOL_8_FINAL_v3(2).xlsx</div>
        <div className="h-px bg-[#EFE9D8] my-2" />
        <div className="text-[11.5px] text-[#5B6B67] leading-[1.9]">
          Josh — paid??<br />Sarah — did she pay<br /><span className="text-[#C1473A]">who has the ticket photo</span>
        </div>
      </div>
      <div className={h1Cls + " mt-3"}>One link.<br />Everyone's in.</div>
    </div>,
    <div key="s2">
      <div className={eyebrowCls}>Start a syndicate</div>
      <div className={h1Cls}>Set it up in<br />under a minute.</div>
      <div className={cardCls}>
        <div className={labelCls}>Invite code</div>
        <div className="font-[JetBrains_Mono] text-[22px] tracking-[0.12em] text-[#10201D] font-bold my-1">7XQ4K</div>
        <div className="flex gap-2 mt-1">
          <div className="px-2.5 py-1.5 rounded-lg bg-[#EFE9D8] text-[#2F6F5E] text-[11px] font-semibold">Copy</div>
          <div className="flex-1 text-center px-2.5 py-1.5 rounded-lg bg-[#2F6F5E] text-white text-[11px] font-semibold">Share invite</div>
        </div>
      </div>
    </div>,
    <div key="s3">
      <div className={eyebrowCls}>Any amount. Instant odds.</div>
      <div className={h1Cls}>Type in $45.<br />Watch your odds appear.</div>
      <div className={cardCls}>
        <div className="flex justify-between">
          <div><div className={labelCls}>Your share</div><div className="font-[Fraunces] text-[15px] font-semibold text-[#10201D]">{pctVal.toFixed(2)}%</div></div>
          <div className="text-right"><div className={labelCls}>If this wins</div><div className="font-[JetBrains_Mono] text-[13px] font-bold text-[#2F6F5E]">${winVal.toLocaleString()}</div></div>
        </div>
        <div className="mt-2.5 pt-2.5 border-t border-dashed border-[#D8D0BC] text-center">
          <div className={labelCls}>Your contribution</div>
          <div className="font-[Fraunces] text-[26px] font-semibold text-[#10201D]">${amt}</div>
        </div>
      </div>
    </div>,
    <div key="s4">
      <div className={eyebrowCls}>Everyone in the loop</div>
      <div className={h1Cls}>Chat, track payments,<br />split winnings.</div>
      <div className={cardCls + " flex items-center gap-2.5 mb-2"}>
        <div className="w-7 h-7 rounded-full bg-[#2F6F5E] text-white flex items-center justify-center text-[12px] font-bold shrink-0">J</div>
        <div className="bg-[#F7F2E7] rounded-xl rounded-tl-sm px-2.5 py-1.5 text-[11.5px] text-[#10201D]">Ticket's bought 🎟️ good luck!</div>
      </div>
      <div className={cardCls + " flex items-center gap-2.5"}>
        <span className="text-[#2F6F5E]">✔</span>
        <div className="flex-1 text-[12px] font-semibold text-[#2F6F5E]">Sarah — Paid entry</div>
        <div className="font-[JetBrains_Mono] text-[11.5px] text-[#10201D]">$25</div>
      </div>
    </div>,
    <div key="s5">
      <div className={eyebrowCls}>No late entries</div>
      <div className={h1Cls}>Set a deadline.<br />Entries close on time.</div>
      <div className="rounded-2xl px-3.5 py-3 bg-[#C1473A]/10 border border-[#C1473A]/25 flex items-center gap-2 text-[12px] text-[#8A6A15]">
        ⏰ Entries close in <span className="font-[JetBrains_Mono] text-[15px] font-bold text-[#C1473A]">2h 14m</span>
      </div>
    </div>,
    <div key="s6" className="text-center flex flex-col items-center justify-center h-full">
      <div className="text-[26px] mb-1">🎟️✨</div>
      <div className={h1Cls}>Split the ticket.<br />Track every share.</div>
      <p className={subCls + " mb-3"}>Free — with friends, family, or the office.</p>
      <div className="bg-[#C9982E] text-[#10201D] font-bold rounded-xl px-4 py-2.5 text-[13px]">Start your syndicate →</div>
    </div>,
  ];

  return (
    <div className="relative rounded-2xl overflow-hidden bg-[#0B1815] border border-white/10 mb-8" style={{ height: 300 }}>
      <style>{`@keyframes howitworksFill{from{width:0%}to{width:100%}}`}</style>
      <div className="absolute top-3 left-3 right-3 flex gap-1.5 z-20">
        {Array.from({ length: DEMO_SCENE_COUNT }).map((_, n) => (
          <button key={n} onClick={() => setIdx(n)} className="flex-1 h-[3px] rounded-full bg-white/20 overflow-hidden">
            <div
              key={n === idx ? `${n}-active` : `${n}-idle`}
              className="h-full bg-[#C9982E]"
              style={{
                width: n < idx ? "100%" : "0%",
                animation: n === idx ? `howitworksFill ${DEMO_DUR}ms linear forwards` : "none",
              }}
            />
          </button>
        ))}
      </div>
      <div className="absolute top-8 left-4 right-4 bottom-4 flex flex-col justify-center">
        {scenes[idx]}
      </div>
    </div>
  );
}

function InstallAppButton() {
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [isStandalone, setIsStandalone] = useState(false);
  const [isIOS, setIsIOS] = useState(false);
  const [showIOSHelp, setShowIOSHelp] = useState(false);

  useEffect(() => {
    const standalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      window.navigator.standalone === true;
    setIsStandalone(standalone);
    setIsIOS(/iphone|ipad|ipod/i.test(window.navigator.userAgent));

    function onBeforeInstall(e) {
      e.preventDefault();
      setDeferredPrompt(e);
    }
    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    return () => window.removeEventListener("beforeinstallprompt", onBeforeInstall);
  }, []);

  if (isStandalone) return null;

  async function handleClick() {
    if (isIOS) {
      setShowIOSHelp(true);
      return;
    }
    if (deferredPrompt) {
      deferredPrompt.prompt();
      await deferredPrompt.userChoice;
      setDeferredPrompt(null);
    } else {
      setShowIOSHelp(true); // fallback: show generic guidance
    }
  }

  return (
    <>
      <button onClick={handleClick} className="w-full flex items-center gap-3 bg-white/5 hover:bg-white/10 rounded-xl px-4 py-3.5 mb-6 text-left">
        <div className="w-9 h-9 rounded-lg bg-[#C9982E]/15 flex items-center justify-center shrink-0">
          <Smartphone size={17} className="text-[#C9982E]" />
        </div>
        <div className="flex-1">
          <div className="text-[#F7F2E7] text-[13.5px] font-medium">Add Syndicate to your home screen</div>
          <div className="text-[#7C8C88] text-[11.5px]">Opens like a regular app, one tap away</div>
        </div>
        <PlusSquare size={17} className="text-[#7C8C88]" />
      </button>

      {showIOSHelp && (
        <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/50" onClick={() => setShowIOSHelp(false)}>
          <div className="w-full max-w-[430px] bg-[#F7F2E7] rounded-t-3xl p-6 pb-8" onClick={(e) => e.stopPropagation()}>
            <div className="w-10 h-1 rounded-full bg-[#D8D0BC] mx-auto mb-5" />
            <h3 className="font-[Fraunces] text-[19px] text-[#10201D] font-medium mb-4">Add to Home Screen</h3>
            <div className="space-y-3 mb-6">
              <div className="flex items-center gap-3 bg-white rounded-xl px-4 py-3">
                <Share2 size={20} className="text-[#2F6F5E] shrink-0" />
                <span className="text-[14px] text-[#3E5652]">Tap the <strong>Share</strong> button in Safari's toolbar</span>
              </div>
              <div className="flex items-center gap-3 bg-white rounded-xl px-4 py-3">
                <PlusSquare size={20} className="text-[#2F6F5E] shrink-0" />
                <span className="text-[14px] text-[#3E5652]">Scroll down and tap <strong>Add to Home Screen</strong></span>
              </div>
              <div className="flex items-center gap-3 bg-white rounded-xl px-4 py-3">
                <Check size={20} className="text-[#2F6F5E] shrink-0" />
                <span className="text-[14px] text-[#3E5652]">Tap <strong>Add</strong> — the icon appears on your home screen</span>
              </div>
            </div>
            <Button variant="ghost" onClick={() => setShowIOSHelp(false)}>Got it</Button>
          </div>
        </div>
      )}
    </>
  );
}

const LEGAL_CONTENT = {
  privacy: {
    title: "Privacy Policy",
    sections: [
      {
        h: "Overview",
        p: [
          `Syndicate ("we", "us") respects your privacy. This policy explains what personal information we collect, how we use it, and your rights under the Privacy Act 1988 (Cth) and the Australian Privacy Principles.`,
        ],
      },
      {
        h: "What we collect",
        p: [
          "Your email address, used to sign you in.",
          "Profile details you choose to add — a nickname and a profile photo.",
          "Syndicate details you enter — syndicate names, contribution amounts, payment status, and optional payment screenshots you upload as a receipt.",
          "Payment details an organiser chooses to enter (bank name, BSB, account number, and/or PayID) so their syndicate's members know where to send money. This is visible only to members of that specific syndicate — never made public, and never used by us for any purpose.",
        ],
      },
      {
        h: "How we use it",
        p: [
          "To operate your account and the syndicates you organise or join.",
          "To show each syndicate's members the information relevant to that syndicate.",
          "To send you service emails, such as sign-in links.",
          "To charge the small service fee described in our Pricing & Refunds page, where applicable.",
        ],
      },
      {
        h: "Who can see your information",
        p: [
          "Only members of a syndicate can see that syndicate's details. Payment screenshots are visible only to the organiser and the member who uploaded them. We do not sell, rent, or share your personal information with third parties for marketing purposes.",
        ],
      },
      {
        h: "Third-party services",
        p: [
          "Syndicate is built on Supabase (database and authentication) and Vercel (website hosting). These providers may store data on servers located outside Australia. By using Syndicate, you consent to this overseas storage.",
        ],
      },
      {
        h: "Data retention",
        p: [
          "If an organiser deletes a syndicate, it is archived rather than immediately erased, and may be retained for a reasonable period for record-keeping and legal purposes.",
        ],
      },
      {
        h: "Security",
        p: [
          "We use reasonable technical measures, including access controls, to protect your information. No method of storage or transmission over the internet is completely secure.",
        ],
      },
      {
        h: "Your rights",
        p: [
          "Under the Privacy Act, you can request access to, or correction of, the personal information we hold about you. Contact us using the details below to make a request.",
        ],
      },
      { h: "Children", p: ["Syndicate is not intended for use by anyone under 18."] },
      { h: "Changes to this policy", p: ["We may update this policy from time to time. Continued use of Syndicate after changes means you accept the updated policy."] },
      { h: "Contact", p: ["info@lottosyndicate.app"] },
    ],
  },
  terms: {
    title: "Terms of Service",
    sections: [
      {
        h: "Acceptance of terms",
        p: ["By using Syndicate, you agree to these Terms of Service."],
      },
      {
        h: "What Syndicate is",
        p: [
          "Syndicate is a private coordination tool that helps groups of people who already know each other track contributions toward pooled lottery ticket purchases and record who is owed what.",
          "Syndicate does not sell lottery tickets, does not purchase lottery entries, and does not hold or transmit funds on behalf of any syndicate. Syndicate is not a gambling service, wagering operator, or lottery operator. All actual ticket purchases and prize distributions are handled personally between a syndicate's organiser and its members, entirely outside the app.",
        ],
      },
      {
        h: "Eligibility",
        p: ["You must be 18 or older to use Syndicate, and responsible for complying with the lottery and gambling laws that apply in your own location."],
      },
      {
        h: "Your responsibilities",
        p: [
          "You agree to provide accurate information, and to only invite or join syndicates with people you know personally.",
          "The organiser of a syndicate is solely responsible for actually purchasing lottery tickets and fairly distributing any winnings. We have no visibility or control over whether an organiser does either of these things.",
        ],
      },
      {
        h: "No guarantee of outcome",
        p: [
          "We do not guarantee that any syndicate will result in a ticket purchase, a winning outcome, or any payment. Potential-winnings figures shown in the app are illustrative estimates only, not promises of payment.",
        ],
      },
      { h: "Fees", p: ["See our Pricing & Refunds page for details of any fees that apply."] },
      {
        h: "Suspension and termination",
        p: ["We may suspend or remove accounts or syndicates that misuse the service or breach these terms."],
      },
      {
        h: "Limitation of liability",
        p: [
          "To the maximum extent permitted by law, Syndicate is provided \"as is,\" and we are not liable for losses arising from disputes between syndicate members, non-payment between members, or lottery outcomes. Nothing in these terms excludes, restricts, or modifies any right you have under the Australian Consumer Law that cannot lawfully be excluded.",
        ],
      },
      {
        h: "No affiliation",
        p: ["Syndicate is not affiliated with, endorsed by, or connected to The Lott, Tabcorp, Lotterywest, or any state or territory lottery operator."],
      },
      { h: "Governing law", p: ["These terms are governed by the laws of Western Australia, Australia."] },
      { h: "Changes to these terms", p: ["We may update these terms from time to time. Continued use of Syndicate after changes means you accept the updated terms."] },
      { h: "Contact", p: ["info@lottosyndicate.app"] },
    ],
  },
  pricing: {
    title: "Pricing & Refunds",
    sections: [
      {
        h: "Our fee",
        p: [
          "A flat service fee of $1 AUD (inclusive of GST where applicable) applies when an organiser creates a syndicate. This fee is charged for access to the Syndicate coordination tool, and is separate from — and never part of — any lottery ticket price or prize money.",
        ],
      },
      { h: "What the fee covers", p: ["Hosting, running, and maintaining the software tool for your syndicate."] },
      {
        h: "Payment method",
        p: ["Fees are processed securely through our payment provider. We do not store your full card details."],
      },
      {
        h: "Refunds",
        p: [
          "Because this fee grants immediate access to a digital service, it is generally non-refundable once your syndicate has been created.",
          "This does not limit any right you have under the Australian Consumer Law, including your right to a refund, replacement, or other remedy if the service has a major failure or is not provided with due care and skill. If you believe there's been an issue with the service you paid for, contact us using the details below and we'll review it.",
        ],
      },
      {
        h: "Price changes",
        p: ["We may change this fee for future syndicates. Changes will never affect a syndicate you've already paid for."],
      },
      { h: "Contact", p: ["info@lottosyndicate.app"] },
    ],
  },
};

const GUIDE_STEPS = [
  {
    eyebrow: "Built for people who trust each other",
    title: "Splitting a lotto ticket with friends, family, or workmates?",
    body: "Syndicate replaces the messy group chat and spreadsheet with one simple, shared place — so easy that anyone can pick it up in minutes.",
  },
  {
    eyebrow: "Step 1",
    title: "Start a syndicate in under a minute",
    body: "Give it a name, add the jackpot estimate, and you're done. No complicated setup — just the basics you already know off the top of your head.",
  },
  {
    eyebrow: "Step 2",
    title: "Share one code",
    body: "Text it, drop it in the group chat, or stick a QR code on the office fridge. Whoever has the code can join in seconds — no app download, no account creation hoops.",
  },
  {
    eyebrow: "Step 3",
    title: "Everyone chips in whatever they like",
    body: "No fixed share price — Sarah puts in $10, Josh puts in $50, it doesn't matter. The app works out everyone's exact percentage of the pool automatically as they type.",
  },
  {
    eyebrow: "Step 4",
    title: "Track it all in one place",
    body: "Who's paid, who hasn't, a photo of the actual tickets, and a group chat to sort out the details — all visible to everyone in the syndicate, all the time.",
  },
  {
    eyebrow: "Step 5",
    title: "Winnings split themselves out",
    body: "Enter the actual result once, and everyone instantly sees exactly what they're owed based on what they put in. No arguments, no maths, no spreadsheet.",
  },
  {
    eyebrow: "That's genuinely it",
    title: "Ready to try it with your group?",
    body: "Takes less time to set up than it does to explain to your mates why you need their bank details for the office Powerball pool.",
    isLast: true,
  },
];

function AdminScreen({ session, onBack, onOpenSyndicate }) {
  const [stats, setStats] = useState(null);
  const [syndicates, setSyndicates] = useState([]);
  const [showDeleted, setShowDeleted] = useState(false);
  const [loading, setLoading] = useState(true);
  const [searchCode, setSearchCode] = useState("");
  const [searchResult, setSearchResult] = useState(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [emailStats, setEmailStats] = useState(null);
  const [emailStatsError, setEmailStatsError] = useState("");
  const [emailStatsLoading, setEmailStatsLoading] = useState(true);
  const [visitorStats, setVisitorStats] = useState(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    const [s, list, v] = await Promise.all([loadAdminStats(), loadAllSyndicates({ includeDeleted: showDeleted }), loadVisitorStats()]);
    setStats(s);
    setSyndicates(list);
    setVisitorStats(v);
    setLoading(false);
  }, [showDeleted]);

  useEffect(() => { refresh(); }, [refresh]);

  useEffect(() => {
    async function loadEmailStats() {
      setEmailStatsLoading(true);
      setEmailStatsError("");
      try {
        const res = await fetch("/api/admin-email-stats", {
          headers: { Authorization: `Bearer ${session.access_token}` },
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Couldn't load email stats.");
        setEmailStats(data);
      } catch (e) {
        setEmailStatsError(e.message || "Couldn't load email stats.");
      } finally {
        setEmailStatsLoading(false);
      }
    }
    loadEmailStats();
  }, [session]);

  async function handleSearch() {
    const c = searchCode.trim().toUpperCase();
    if (!c) return;
    setSearching(true);
    setSearchError("");
    setSearchResult(null);
    const pool = await loadPool(c);
    setSearching(false);
    if (!pool) setSearchError("No syndicate found with that code.");
    else setSearchResult(pool);
  }

  async function handleRestore(code) {
    await restoreSyndicate(code);
    await refresh();
  }

  const [deletingCode, setDeletingCode] = useState(null);
  async function handleDirectDelete(code) {
    setDeletingCode(code);
    try {
      await deleteSyndicate(code);
      await refresh();
    } finally {
      setDeletingCode(null);
    }
  }

  return (
    <Screen>
      <TopBar title="Admin" onBack={onBack} right={<button onClick={refresh} className="text-[#6B7A76]"><RefreshCw size={16} className={loading ? "animate-spin" : ""} /></button>} />
      <div className="flex-1 px-6 pb-10">
        <div className="bg-white rounded-2xl p-4 mb-4">
          <div className="flex items-center gap-1.5 text-[#6B7A76] text-[11px] uppercase tracking-wide mb-3"><Users size={12} />Visitor traffic</div>
          {!visitorStats ? (
            <div className="flex items-center gap-2 text-[13px] text-[#8A968F]"><Loader2 size={14} className="animate-spin" />Loading…</div>
          ) : (
            <div className="grid grid-cols-3 gap-2">
              {[["Today", visitorStats.day], ["This week", visitorStats.week], ["This month", visitorStats.month]].map(([label, s]) => (
                <div key={label} className="bg-[#F7F2E7] rounded-xl p-3">
                  <div className="text-[10.5px] uppercase tracking-wide text-[#8A968F] mb-1">{label}</div>
                  <div className="font-[Fraunces] text-[19px] text-[#10201D] font-medium leading-none mb-1">{s.views}</div>
                  <div className="text-[10.5px] text-[#6B7A76]">{s.unique} unique</div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="bg-white rounded-2xl p-4 mb-4">
          <div className="flex items-center gap-1.5 text-[#6B7A76] text-[11px] uppercase tracking-wide mb-2"><Send size={12} />Emails sent this month (via Resend)</div>
          {emailStatsLoading ? (
            <div className="flex items-center gap-2 text-[13px] text-[#8A968F]"><Loader2 size={14} className="animate-spin" />Loading…</div>
          ) : emailStatsError ? (
            <div className="text-[13px] text-[#C1473A]">{emailStatsError}</div>
          ) : emailStats && (
            <>
              <div className="flex items-end justify-between mb-2">
                <div className="font-[Fraunces] text-[22px] font-medium text-[#10201D]">
                  {emailStats.sentThisMonth.toLocaleString()} <span className="text-[14px] text-[#8A968F] font-normal">/ {emailStats.limit.toLocaleString()}</span>
                </div>
                <div className={`text-[12px] font-medium ${emailStats.sentThisMonth / emailStats.limit > 0.8 ? "text-[#C1473A]" : "text-[#2F6F5E]"}`}>
                  {Math.round((emailStats.sentThisMonth / emailStats.limit) * 100)}%
                </div>
              </div>
              <div className="h-2 rounded-full bg-[#EFE9D8] overflow-hidden">
                <div
                  className={`h-full rounded-full ${emailStats.sentThisMonth / emailStats.limit > 0.8 ? "bg-[#C1473A]" : "bg-[#2F6F5E]"}`}
                  style={{ width: `${Math.min(100, (emailStats.sentThisMonth / emailStats.limit) * 100)}%` }}
                />
              </div>
              {emailStats.sentThisMonth / emailStats.limit > 0.8 && (
                <p className="text-[12px] text-[#C1473A] mt-2">Approaching your Resend plan limit — worth considering an upgrade soon.</p>
              )}
            </>
          )}
        </div>

        {loading && !stats ? (
          <div className="flex justify-center py-10"><Loader2 className="animate-spin text-[#2F6F5E]" size={22} /></div>
        ) : stats && (
          <div className="grid grid-cols-2 gap-3 mb-6">
            <div className="bg-white rounded-2xl p-4">
              <div className="text-[11px] uppercase tracking-wide text-[#6B7A76] mb-1">Active syndicates</div>
              <div className="font-[Fraunces] text-[22px] font-medium text-[#10201D]">{stats.activeSyndicates}</div>
            </div>
            <div className="bg-white rounded-2xl p-4">
              <div className="text-[11px] uppercase tracking-wide text-[#6B7A76] mb-1">Deleted (archived)</div>
              <div className="font-[Fraunces] text-[22px] font-medium text-[#10201D]">{stats.deletedSyndicates}</div>
            </div>
            <div className="bg-white rounded-2xl p-4">
              <div className="text-[11px] uppercase tracking-wide text-[#6B7A76] mb-1">Total members</div>
              <div className="font-[Fraunces] text-[22px] font-medium text-[#10201D]">{stats.totalParticipants}</div>
            </div>
            <div className="bg-white rounded-2xl p-4">
              <div className="text-[11px] uppercase tracking-wide text-[#6B7A76] mb-1">Registered accounts</div>
              <div className="font-[Fraunces] text-[22px] font-medium text-[#10201D]">{stats.totalUsers}</div>
            </div>
            <div className="bg-white rounded-2xl p-4 col-span-2">
              <div className="text-[11px] uppercase tracking-wide text-[#6B7A76] mb-1">Total ever contributed, all syndicates</div>
              <div className="font-[JetBrains_Mono] text-[19px] font-medium text-[#2F6F5E]">{money(stats.totalContributed)}</div>
            </div>
          </div>
        )}

        <div className="text-[12px] uppercase tracking-wide text-[#6B7A76] mb-2.5">Find a syndicate</div>
        <div className="flex gap-2 mb-2">
          <input className={`${inputCls} flex-1 font-[JetBrains_Mono] uppercase`} placeholder="CODE" value={searchCode} onChange={(e) => setSearchCode(e.target.value.toUpperCase())} />
          <Button full={false} onClick={handleSearch} disabled={searching} icon={searching ? Loader2 : undefined}>Find</Button>
        </div>
        {searchError && <div className="text-[#C1473A] text-[13px] mb-3">{searchError}</div>}
        {searchResult && (
          <button onClick={() => onOpenSyndicate(searchResult.code)} className="w-full bg-white rounded-xl px-4 py-3 flex items-center justify-between mb-6">
            <div>
              <div className="text-[14px] font-medium text-[#10201D]">{searchResult.name}</div>
              <div className="text-[12px] text-[#8A968F] font-[JetBrains_Mono]">{searchResult.code}</div>
            </div>
            <ChevronRight size={16} className="text-[#6B7A76]" />
          </button>
        )}

        <div className="flex items-center justify-between mb-2.5">
          <span className="text-[12px] uppercase tracking-wide text-[#6B7A76]">Recent syndicates</span>
          <button onClick={() => setShowDeleted((s) => !s)} className="text-[11px] text-[#2F6F5E] underline">{showDeleted ? "Hide deleted" : "Show deleted"}</button>
        </div>
        <div className="space-y-2">
          {syndicates.length === 0 && <div className="text-[13.5px] text-[#8A968F] bg-white rounded-xl px-4 py-6 text-center">Nothing here yet.</div>}
          {syndicates.map((s) => (
            <div key={s.code} className="bg-white rounded-xl px-4 py-3 flex items-center justify-between">
              <button onClick={() => onOpenSyndicate(s.code)} className="text-left flex-1 min-w-0">
                <div className={`text-[14px] font-medium truncate ${s.deleted_at ? "text-[#C1473A] line-through" : "text-[#10201D]"}`}>{s.name}</div>
                <div className="text-[12px] text-[#8A968F]">{s.code} · {s.organiser} · {new Date(s.created_at).toLocaleDateString()}</div>
              </button>
              {s.deleted_at ? (
                <button onClick={() => handleRestore(s.code)} className="text-[11px] text-[#2F6F5E] underline shrink-0 ml-2">Restore</button>
              ) : (
                <div className="flex items-center gap-3 shrink-0 ml-2">
                  <button onClick={() => handleDirectDelete(s.code)} disabled={deletingCode === s.code} className="text-[#C1473A]">
                    {deletingCode === s.code ? <Loader2 size={15} className="animate-spin" /> : <Trash2 size={15} />}
                  </button>
                  <ChevronRight size={16} className="text-[#6B7A76]" />
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </Screen>
  );
}

function GuideScreen({ onBack, onCreate, onJoin }) {
  const [step, setStep] = useState(0);
  const total = GUIDE_STEPS.length;
  const current = GUIDE_STEPS[step];

  return (
    <Screen dark>
      <TopBar title="How it works" onBack={onBack} dark />
      <div className="flex items-center gap-1.5 px-6 pt-1 pb-2">
        {GUIDE_STEPS.map((_, i) => (
          <button key={i} onClick={() => setStep(i)} className="flex-1 h-[3px] rounded-full overflow-hidden bg-white/15">
            <div className={`h-full ${i <= step ? "bg-[#C9982E]" : ""}`} style={{ width: i <= step ? "100%" : "0%" }} />
          </button>
        ))}
      </div>
      <div className="flex-1 flex flex-col justify-center px-7 pb-6">
        <div className="text-[11px] uppercase tracking-[0.14em] text-[#C9982E] font-bold mb-3">{current.eyebrow}</div>
        <h1 className="font-[Fraunces] text-[27px] leading-[1.2] text-[#F7F2E7] font-medium mb-4">{current.title}</h1>
        <p className="text-[#9FB0AC] text-[15px] leading-relaxed">{current.body}</p>

        {current.isLast && (
          <div className="space-y-3 mt-8">
            <Button variant="gold" icon={PlusCircle} onClick={onCreate}>Start a syndicate</Button>
            <Button variant="ghost" icon={ArrowRight} onClick={onJoin}><span className="text-[#F7F2E7]">Join with a code</span></Button>
          </div>
        )}
      </div>
      {!current.isLast && (
        <div className="flex gap-3 px-6 pb-8">
          {step > 0 && <Button variant="ghost" onClick={() => setStep(step - 1)} full={false}><span className="text-[#F7F2E7] px-2">Back</span></Button>}
          <Button variant="gold" icon={ArrowRight} onClick={() => setStep(Math.min(total - 1, step + 1))}>{step === 0 ? "Show me" : "Next"}</Button>
        </div>
      )}
    </Screen>
  );
}

function LegalScreen({ page, onBack }) {
  const content = LEGAL_CONTENT[page];
  return (
    <Screen>
      <TopBar title={content.title} onBack={onBack} />
      <div className="flex-1 px-6 pb-10">
        <p className="text-[12px] text-[#8A968F] mb-6">
          This is a general-purpose template, not a substitute for tailored legal advice. Review it with a professional before relying on it.
        </p>
        {content.sections.map((s, i) => (
          <div key={i} className="mb-5">
            <div className="font-[Fraunces] text-[15px] text-[#10201D] font-medium mb-1.5">{s.h}</div>
            {s.p.map((para, j) => (
              <p key={j} className="text-[13.5px] text-[#3E5652] leading-relaxed mb-1.5">{para}</p>
            ))}
          </div>
        ))}
      </div>
    </Screen>
  );
}

function Home({ session, onCreate, onJoin, onSignIn, onSignOut, onProfile, onLegal, onGuide, isAdmin, onAdmin }) {
  const [profile, setProfile] = useState(null);
  const [myPools, setMyPools] = useState([]);
  const [memberships, setMemberships] = useState([]);
  const [loading, setLoading] = useState(!!session);

  useEffect(() => {
    if (!session) { setMyPools([]); setMemberships([]); setProfile(null); return; }
    setLoading(true);
    Promise.all([loadOwnedPools(session.user.id), loadMemberships(session.user.id), loadProfile(session.user.id)]).then(
      ([owned, member, prof]) => { setMyPools(owned); setMemberships(member); setProfile(prof); setLoading(false); }
    );
  }, [session]);

  return (
    <Screen dark>
      {/* decorative background — kept subtle and confined to this screen */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-12 -right-16 w-56 h-56 rounded-full bg-[#C9982E]/10 blur-3xl" />
        <div className="absolute top-1/3 -left-20 w-44 h-44 rounded-full bg-[#2F6F5E]/25 blur-3xl" />
        <div className="absolute bottom-0 right-0 w-64 h-64 rounded-full bg-[#C9982E]/8 blur-3xl" />

        {/* scattered gold coins */}
        <div className="absolute rounded-full" style={{ width: 20, height: 20, top: "14%", right: "16%", background: "radial-gradient(circle at 35% 30%, #F3D08A, #C9982E 65%, #9C7420)", opacity: 0.4 }} />
        <div className="absolute rounded-full" style={{ width: 13, height: 13, top: "23%", right: "8%", background: "radial-gradient(circle at 35% 30%, #F3D08A, #C9982E 65%, #9C7420)", opacity: 0.3 }} />
        <div className="absolute rounded-full" style={{ width: 16, height: 16, top: "46%", left: "9%", background: "radial-gradient(circle at 35% 30%, #F3D08A, #C9982E 65%, #9C7420)", opacity: 0.28 }} />
        <div className="absolute rounded-full" style={{ width: 10, height: 10, top: "55%", left: "16%", background: "radial-gradient(circle at 35% 30%, #F3D08A, #C9982E 65%, #9C7420)", opacity: 0.22 }} />
        <div className="absolute rounded-full" style={{ width: 15, height: 15, bottom: "18%", right: "22%", background: "radial-gradient(circle at 35% 30%, #F3D08A, #C9982E 65%, #9C7420)", opacity: 0.32 }} />
        <div className="absolute rounded-full" style={{ width: 11, height: 11, bottom: "10%", right: "12%", background: "radial-gradient(circle at 35% 30%, #F3D08A, #C9982E 65%, #9C7420)", opacity: 0.24 }} />
        <div className="absolute rounded-full" style={{ width: 9, height: 9, top: "8%", left: "22%", background: "radial-gradient(circle at 35% 30%, #F3D08A, #C9982E 65%, #9C7420)", opacity: 0.2 }} />
        <div className="absolute rounded-full" style={{ width: 18, height: 18, bottom: "30%", left: "6%", background: "radial-gradient(circle at 35% 30%, #F3D08A, #C9982E 65%, #9C7420)", opacity: 0.26 }} />
      </div>

      <div className="flex-1 flex flex-col px-6 pt-16 pb-10 relative">
        <div className="flex items-center gap-2 text-[#C9982E] mb-3">
          <Ticket size={22} />
          <span className="text-[13px] font-medium tracking-[0.14em] uppercase">Syndicate</span>
        </div>
        <h1 className="font-[Fraunces] text-[38px] leading-[1.08] text-[#F7F2E7] font-medium mb-3">Split the ticket.<br />Track every share.</h1>
        <p className="text-[#9FB0AC] text-[15px] leading-relaxed mb-5 max-w-[320px]">
          Organise your work lotto pool, collect contributions by link, and know exactly who's owed what the moment the numbers drop.
        </p>

        <button onClick={onGuide} className="flex items-center gap-3 bg-[#C9982E]/12 hover:bg-[#C9982E]/18 border border-[#C9982E]/30 rounded-xl px-4 py-3.5 mb-6">
          <div className="w-9 h-9 rounded-lg bg-[#C9982E]/20 flex items-center justify-center shrink-0">
            <BookOpen size={17} className="text-[#C9982E]" />
          </div>
          <div className="flex-1 text-left">
            <div className="text-[#F7F2E7] text-[13.5px] font-medium">See how it works</div>
            <div className="text-[#C9C0A5] text-[11.5px]">A 1-minute guide — it's this easy</div>
          </div>
          <ChevronRight size={16} className="text-[#C9982E]" />
        </button>

        {session && (
          <button onClick={onProfile} className="flex items-center gap-3 bg-white/5 hover:bg-white/10 rounded-xl px-4 py-3 mb-6">
            <Avatar url={profile?.avatar_url} name={profile?.nickname || session.user.email} size={38} />
            <div className="text-left flex-1">
              <div className="text-[#F7F2E7] text-[14px] font-medium">{profile?.nickname || session.user.email}</div>
              <div className="text-[#7C8C88] text-[11.5px]">Edit your profile</div>
            </div>
            <ChevronRight size={16} className="text-[#7C8C88]" />
          </button>
        )}

        <InstallAppButton />

        <div className="space-y-3 mb-8">
          {session ? (
            <Button variant="gold" icon={PlusCircle} onClick={onCreate}>Start a syndicate</Button>
          ) : (
            <Button variant="gold" icon={LogIn} onClick={onSignIn}>Sign in to start a syndicate</Button>
          )}
          <Button variant="ghost" icon={ArrowRight} onClick={onJoin} full>
            <span className="text-[#F7F2E7]">Join with a code</span>
          </Button>
        </div>

        {!session && <HowItWorksDemo />}

        {session && loading && <div className="flex justify-center py-4"><Loader2 className="animate-spin text-[#C9982E]" size={18} /></div>}

        {session && !loading && (
          <div className="space-y-6">
            {myPools.length > 0 && (
              <div>
                <div className="text-[12px] uppercase tracking-wide text-[#6B7A76] mb-2.5">Syndicates you organise</div>
                <div className="space-y-2">
                  {myPools.map((p) => (
                    <a key={p.code} href={`#/dashboard/${p.code}`} className="w-full flex items-center justify-between bg-white/5 hover:bg-white/10 rounded-xl px-4 py-3.5 text-left">
                      <div>
                        <div className="text-[#F7F2E7] text-[14.5px] font-medium">{p.name}</div>
                        <div className="text-[#7C8C88] text-[12px] font-[JetBrains_Mono] tracking-wide mt-0.5">{p.code}</div>
                      </div>
                      <ChevronRight size={17} className="text-[#7C8C88]" />
                    </a>
                  ))}
                </div>
              </div>
            )}
            <div>
              <div className="text-[12px] uppercase tracking-wide text-[#6B7A76] mb-2.5">
                You're in {memberships.length} syndicate{memberships.length === 1 ? "" : "s"}
              </div>
              {memberships.length === 0 ? (
                <div className="text-[13px] text-[#7C8C88]">Join one with a code above.</div>
              ) : (
                <div className="space-y-2">
                  {memberships.map((m) => (
                    <a key={m.code} href={`#/j/${m.code}`} className="w-full flex items-center justify-between bg-white/5 hover:bg-white/10 rounded-xl px-4 py-3.5 text-left">
                      <div>
                        <div className="text-[#F7F2E7] text-[14.5px] font-medium">{m.name}</div>
                        <div className="text-[#7C8C88] text-[12px] mt-0.5">{money(m.amount)} · {m.status === "drawn" ? "Drawn" : "Open"}</div>
                      </div>
                      <ChevronRight size={17} className="text-[#7C8C88]" />
                    </a>
                  ))}
                </div>
              )}
            </div>
            <button onClick={onSignOut} className="text-[12px] text-[#7C8C88] underline">Sign out</button>
          </div>
        )}

        <div className="flex items-center justify-center gap-2.5 mt-10 pt-6 border-t border-white/10">
          <button onClick={() => onLegal("privacy")} className="text-[10.5px] text-[#5B6862] underline">Privacy</button>
          <span className="text-[#3A4744] text-[10.5px]">·</span>
          <button onClick={() => onLegal("terms")} className="text-[10.5px] text-[#5B6862] underline">Terms</button>
          <span className="text-[#3A4744] text-[10.5px]">·</span>
          <button onClick={() => onLegal("pricing")} className="text-[10.5px] text-[#5B6862] underline">Pricing &amp; Refunds</button>
        </div>

        {isAdmin && (
          <button onClick={onAdmin} className="flex items-center justify-center gap-2 mt-4 text-[11px] text-[#C9982E] underline">
            <Lock size={11} /> Admin dashboard
          </button>
        )}
      </div>
    </Screen>
  );
}

/* ---------------------------------------------------------
   Organiser — create
--------------------------------------------------------- */

function CreatePool({ session, onBack }) {
  const [name, setName] = useState("");
  const [jackpot, setJackpot] = useState("");
  const [drawDate, setDrawDate] = useState("");
  const [entryDeadline, setEntryDeadline] = useState("");
  const [organiser, setOrganiser] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    try {
      const draft = JSON.parse(localStorage.getItem("pendingSyndicate") || "null");
      if (draft) {
        setName(draft.name || "");
        setJackpot(draft.jackpot ? String(draft.jackpot) : "");
        setDrawDate(draft.drawDate || "");
        setOrganiser(draft.organiser || "");
      }
    } catch (e) {}
  }, []);

  const missing = [];
  if (!name.trim()) missing.push("syndicate name");
  if (!organiser.trim()) missing.push("your name");
  if (!jackpot || Number(jackpot) <= 0) missing.push("jackpot estimate");

  async function handlePayAndCreate() {
    if (missing.length > 0) {
      setError(`Add a ${missing.join(", ")} to continue.`);
      return;
    }
    setSaving(true);
    setError("");
    try {
      const draft = {
        name: name.trim(),
        organiser: organiser.trim(),
        jackpot: Number(jackpot),
        drawDate,
        entryDeadline: entryDeadline ? new Date(entryDeadline).toISOString() : null,
        ownerId: session.user.id,
      };
      localStorage.setItem("pendingSyndicate", JSON.stringify(draft));

      const res = await fetch("/api/create-checkout-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          successPath: "/#/create-success?session_id={CHECKOUT_SESSION_ID}",
          cancelPath: "/#/create-cancelled",
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.url) throw new Error(data.error || "Couldn't start payment.");
      window.location.href = data.url;
    } catch (e) {
      setError(e.message || "Something went wrong starting payment.");
      setSaving(false);
    }
  }

  return (
    <Screen>
      <TopBar title="New syndicate" onBack={onBack} />
      <div className="flex-1 px-6 pt-2 pb-10">
        <Field label="Syndicate name *"><input className={inputCls} placeholder="Pool 9 — Friday Powerball" value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="Your name (organiser) *"><input className={inputCls} placeholder="e.g. Sarah" value={organiser} onChange={(e) => setOrganiser(e.target.value)} /></Field>
        <Field label="Jackpot estimate *">
          <div className="relative"><span className="absolute left-4 top-1/2 -translate-y-1/2 text-[#A8A08C]">$</span>
            <input className={`${inputCls} pl-7`} inputMode="numeric" placeholder="40,000,000" value={jackpot} onChange={(e) => setJackpot(e.target.value.replace(/[^0-9.]/g, ""))} /></div>
        </Field>
        <Field label="Draw date (optional)"><input type="date" className={inputCls} value={drawDate} onChange={(e) => setDrawDate(e.target.value)} /></Field>
        <Field label="Entry deadline (optional)">
          <input type="datetime-local" className={inputCls} value={entryDeadline} onChange={(e) => setEntryDeadline(e.target.value)} />
        </Field>
        <div className="bg-[#2F6F5E]/8 rounded-xl px-4 py-3 text-[13px] text-[#3E5652] leading-relaxed mb-4 flex gap-2">
          <ShieldCheck size={16} className="mt-0.5 shrink-0 text-[#2F6F5E]" />
          <span>Members contribute any amount here, but payment happens between your group directly — you mark who's paid on your dashboard.</span>
        </div>
        <div className="bg-[#C9982E]/10 rounded-xl px-4 py-3 text-[13px] text-[#8A6A15] leading-relaxed mb-4 flex gap-2">
          <Lock size={16} className="mt-0.5 shrink-0 text-[#8A6A15]" />
          <span>Only share your invite code with people you know personally — friends, family, or workmates. Real money changes hands between your group.</span>
        </div>
        <div className="bg-[#10201D]/5 rounded-xl px-4 py-3 text-[13px] text-[#5B6B67] leading-relaxed mb-6 flex gap-2">
          <Landmark size={16} className="mt-0.5 shrink-0 text-[#5B6B67]" />
          <span>Creating a syndicate has a one-time $3.00 AUD service fee, paid securely via Stripe. This covers using the app only — never your ticket money.</span>
        </div>
        {error && <div className="flex items-center gap-2 text-[#C1473A] text-[13px] mb-4"><AlertCircle size={15} /> {error}</div>}
        <Button onClick={handlePayAndCreate} disabled={saving} icon={saving ? Loader2 : ArrowRight}>{saving ? "Redirecting to payment…" : "Pay $3 & create syndicate"}</Button>
      </div>
    </Screen>
  );
}

/* ---------------------------------------------------------
   Stripe return screens
--------------------------------------------------------- */

function CreateSuccessScreen({ session, sessionId, onDone, onError }) {
  const [status, setStatus] = useState("checking"); // checking | creating | done | error
  const [message, setMessage] = useState("");
  const [newCode, setNewCode] = useState(null);

  useEffect(() => {
    async function run() {
      if (!sessionId) {
        setStatus("error");
        setMessage("Missing payment confirmation. If you were charged, contact us and we'll sort it out.");
        return;
      }
      try {
        const res = await fetch(`/api/verify-payment?session_id=${encodeURIComponent(sessionId)}`);
        const data = await res.json();
        if (!res.ok || !data.paid) {
          setStatus("error");
          setMessage("We couldn't confirm this payment yet. If you were charged, contact us and we'll sort it out.");
          return;
        }
        setStatus("creating");
        const draft = JSON.parse(localStorage.getItem("pendingSyndicate") || "null");
        if (!draft) {
          setStatus("error");
          setMessage("Payment confirmed, but we lost track of your syndicate details. Contact us and we'll fix this manually.");
          return;
        }
        const code = await createPool(draft);
        localStorage.removeItem("pendingSyndicate");
        setNewCode(code);
        setStatus("done");
      } catch (e) {
        setStatus("error");
        setMessage(e.message || "Something went wrong finishing setup. If you were charged, check your home screen — your syndicate may have still been created.");
      }
    }
    run();
  }, [sessionId]);

  if (status === "error") {
    return (
      <Screen>
        <TopBar title="Payment issue" />
        <div className="flex-1 px-6 pt-10 flex flex-col items-center text-center">
          <div className="w-14 h-14 rounded-full bg-[#C1473A] flex items-center justify-center mb-5"><AlertCircle size={26} className="text-white" /></div>
          <p className="text-[#3E5652] text-[15px] leading-relaxed mb-6">{message}</p>
          <Button variant="ghost" onClick={onError}>Back to home</Button>
        </div>
      </Screen>
    );
  }

  if (status === "done") {
    return (
      <Screen>
        <TopBar title="All set" />
        <div className="flex-1 px-6 pt-10 flex flex-col items-center text-center">
          <div className="w-14 h-14 rounded-full bg-[#2F6F5E] flex items-center justify-center mb-5"><Check size={26} className="text-white" /></div>
          <p className="text-[#3E5652] text-[15px] leading-relaxed mb-2">Payment confirmed and your syndicate is ready.</p>
          <p className="text-[#8A968F] text-[13px] mb-6 font-[JetBrains_Mono]">{newCode}</p>
          <Button onClick={() => onDone(newCode)}>Go to your syndicate</Button>
        </div>
      </Screen>
    );
  }

  return (
    <Screen>
      <TopBar title="Finishing up" />
      <div className="flex-1 flex flex-col items-center justify-center px-6 text-center">
        <Loader2 className="animate-spin text-[#2F6F5E] mb-4" size={28} />
        <p className="text-[#3E5652] text-[15px]">{status === "checking" ? "Confirming your payment…" : "Setting up your syndicate…"}</p>
      </div>
    </Screen>
  );
}

function CreateCancelledScreen({ onBack }) {
  return (
    <Screen>
      <TopBar title="Payment cancelled" onBack={onBack} />
      <div className="flex-1 px-6 pt-10 flex flex-col items-center text-center">
        <div className="w-14 h-14 rounded-full bg-[#EFE9D8] flex items-center justify-center mb-5"><X size={26} className="text-[#10201D]" /></div>
        <p className="text-[#3E5652] text-[15px] leading-relaxed mb-2">No payment was made, and your syndicate wasn't created.</p>
        <p className="text-[#8A968F] text-[13px] mb-6">Your details are still saved — go back and you can pick up where you left off.</p>
        <Button variant="ghost" onClick={onBack}>Back to home</Button>
      </div>
    </Screen>
  );
}

function RolloverSuccessScreen({ sessionId, onDone, onError }) {
  const [status, setStatus] = useState("checking");
  const [message, setMessage] = useState("");
  const [newCode, setNewCode] = useState(null);

  useEffect(() => {
    async function run() {
      if (!sessionId) {
        setStatus("error");
        setMessage("Missing payment confirmation. If you were charged, contact us and we'll sort it out.");
        return;
      }
      try {
        const res = await fetch(`/api/verify-payment?session_id=${encodeURIComponent(sessionId)}`);
        const data = await res.json();
        if (!res.ok || !data.paid) {
          setStatus("error");
          setMessage("We couldn't confirm this payment yet. If you were charged, contact us and we'll sort it out.");
          return;
        }
        setStatus("creating");
        const draft = JSON.parse(localStorage.getItem("pendingRollover") || "null");
        if (!draft) {
          setStatus("error");
          setMessage("Payment confirmed, but we lost track of your rollover details. Contact us and we'll fix this manually.");
          return;
        }
        const code = await rolloverSyndicate(draft.oldPool, draft.options);
        localStorage.removeItem("pendingRollover");
        setNewCode(code);
        setStatus("done");
      } catch (e) {
        setStatus("error");
        setMessage(e.message || "Something went wrong finishing the rollover. If you were charged, check your home screen — the new syndicate may have still been created.");
      }
    }
    run();
  }, [sessionId]);

  if (status === "error") {
    return (
      <Screen>
        <TopBar title="Payment issue" />
        <div className="flex-1 px-6 pt-10 flex flex-col items-center text-center">
          <div className="w-14 h-14 rounded-full bg-[#C1473A] flex items-center justify-center mb-5"><AlertCircle size={26} className="text-white" /></div>
          <p className="text-[#3E5652] text-[15px] leading-relaxed mb-6">{message}</p>
          <Button variant="ghost" onClick={onError}>Back to home</Button>
        </div>
      </Screen>
    );
  }

  if (status === "done") {
    return (
      <Screen>
        <TopBar title="All set" />
        <div className="flex-1 px-6 pt-10 flex flex-col items-center text-center">
          <div className="w-14 h-14 rounded-full bg-[#2F6F5E] flex items-center justify-center mb-5"><Check size={26} className="text-white" /></div>
          <p className="text-[#3E5652] text-[15px] leading-relaxed mb-2">Payment confirmed and your syndicate has rolled forward.</p>
          <p className="text-[#8A968F] text-[13px] mb-6 font-[JetBrains_Mono]">{newCode}</p>
          <Button onClick={() => onDone(newCode)}>Go to your new syndicate</Button>
        </div>
      </Screen>
    );
  }

  return (
    <Screen>
      <TopBar title="Finishing up" />
      <div className="flex-1 flex flex-col items-center justify-center px-6 text-center">
        <Loader2 className="animate-spin text-[#2F6F5E] mb-4" size={28} />
        <p className="text-[#3E5652] text-[15px]">{status === "checking" ? "Confirming your payment…" : "Rolling your syndicate forward…"}</p>
      </div>
    </Screen>
  );
}

function RolloverCancelledScreen({ oldCode, onBack }) {
  return (
    <Screen>
      <TopBar title="Payment cancelled" onBack={onBack} />
      <div className="flex-1 px-6 pt-10 flex flex-col items-center text-center">
        <div className="w-14 h-14 rounded-full bg-[#EFE9D8] flex items-center justify-center mb-5"><X size={26} className="text-[#10201D]" /></div>
        <p className="text-[#3E5652] text-[15px] leading-relaxed mb-2">No payment was made, and nothing was rolled over.</p>
        <p className="text-[#8A968F] text-[13px] mb-6">Your original syndicate is untouched.</p>
        <Button variant="ghost" onClick={onBack}>Back to dashboard</Button>
      </div>
    </Screen>
  );
}

function EnterCode({ onBack, onFound }) {
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleContinue() {
    const c = code.trim().toUpperCase();
    if (!c) return;
    setLoading(true);
    setError("");
    try {
      const pool = await loadPool(c);
      if (!pool) {
        setError("No syndicate found with that code. Double-check it with your organiser.");
      } else {
        onFound(pool);
      }
    } catch (e) {
      setError("Couldn't reach the server. Try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Screen>
      <TopBar title="Join a syndicate" onBack={onBack} />
      <div className="flex-1 px-6 pt-4">
        <p className="text-[#5B6B67] text-[14.5px] leading-relaxed mb-6">Enter the code your organiser shared with you.</p>
        <Field label="Syndicate code">
          <input className={`${inputCls} font-[JetBrains_Mono] text-[20px] tracking-[0.25em] text-center uppercase`} placeholder="XXXXX" maxLength={8} value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} />
        </Field>
        <div className="bg-[#C9982E]/10 rounded-xl px-4 py-3 text-[12.5px] text-[#8A6A15] leading-relaxed mb-4 flex gap-2">
          <Lock size={15} className="mt-0.5 shrink-0 text-[#8A6A15]" />
          <span>Only join syndicates run by people you know personally — you'll be sending them money directly.</span>
        </div>
        {error && <div className="flex items-center gap-2 text-[#C1473A] text-[13px] mb-4"><AlertCircle size={15} /> {error}</div>}
        <Button onClick={handleContinue} disabled={!code.trim() || loading} icon={loading ? Loader2 : ArrowRight}>{loading ? "Looking up…" : "Continue"}</Button>
      </div>
    </Screen>
  );
}

function RolloverBanner({ pool }) {
  if (!pool.rolloverAmount) return null;
  return (
    <div className="flex items-center gap-2 bg-[#C9982E]/12 text-[#8A6A15] rounded-xl px-3.5 py-2.5 text-[13px] font-medium mb-4">
      <Sparkles size={14} className="shrink-0" /> Includes {money(pool.rolloverAmount)} rolled over from a previous {pool.name} win
    </div>
  );
}

function PoolLanding({ pool, onBack, onJoin, onView, onChat }) {
  const diff = useCountdown(pool.entryDeadline);
  const closed = pool.entryDeadline && diff !== null && diff <= 0;
  return (
    <Screen>
      <TopBar title={pool.name} onBack={onBack} />
      <div className="flex-1 px-6 pt-2 pb-10 flex flex-col">
        <div className="flex items-center gap-2 text-[#6B7A76] text-[13px] mb-1"><Trophy size={14} className="text-[#C9982E]" />Jackpot estimate</div>
        <div className="font-[Fraunces] text-[34px] text-[#10201D] font-medium mb-1">{money(pool.jackpot)}</div>
        <div className="text-[13.5px] text-[#6B7A76] mb-4">Organised by {pool.organiser}</div>
        <RolloverBanner pool={pool} />
        {pool.entryDeadline && <DeadlineBadge deadline={pool.entryDeadline} drawDate={pool.drawDate} />}
        <div className="space-y-3 mt-2">
          <Button icon={ArrowRight} onClick={onJoin} disabled={closed}>{closed ? "Entries closed" : "Contribute to this syndicate"}</Button>
          <Button variant="ghost" icon={Eye} onClick={onView}>View syndicate members, amounts and results</Button>
          <Button variant="ghost" icon={MessageCircle} onClick={onChat}>Syndicate chat</Button>
        </div>
      </div>
    </Screen>
  );
}

function JoinPool({ session, initialPool, onBack, onDone }) {
  const [pool, setPool] = useState(initialPool);
  const [step, setStep] = useState("amount");
  const [amount, setAmount] = useState(10);
  const [pname, setPname] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [myParticipantId, setMyParticipantId] = useState(null);
  const [paymentDetails, setPaymentDetails] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [uploaded, setUploaded] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const fileRef = useRef(null);

  const diff = useCountdown(pool.entryDeadline);
  const closed = pool.entryDeadline && diff !== null && diff <= 0;

  const { totalAmount } = totals(pool);
  const numericAmount = Number(amount) || 0;
  const projectedTotal = totalAmount + numericAmount;
  const myPct = projectedTotal > 0 ? (numericAmount / projectedTotal) * 100 : 0;
  const myWinnings = (myPct / 100) * pool.jackpot;

  function adjustAmount(delta) {
    setAmount((a) => Math.max(1, Math.round(((Number(a) || 0) + delta) * 100) / 100));
  }

  async function handleConfirm() {
    if (closed) {
      setError("Entries have closed for this syndicate — the deadline has passed.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const newId = await addParticipant(pool.code, { name: pname.trim(), amount: numericAmount, userId: session.user.id });
      setMyParticipantId(newId);
      const fresh = await loadPool(pool.code);
      setPool(fresh || pool);
      loadPaymentDetails(pool.code).then(setPaymentDetails);
      setStep("done");
    } catch (e) {
      console.error("Join failed:", e);
      if (pool.entryDeadline && new Date(pool.entryDeadline).getTime() <= Date.now()) {
        setError("Entries have closed for this syndicate — the deadline passed while you were filling this in.");
      } else {
        setError(`Something went wrong: ${e.message || "please try again"}.`);
      }
    } finally {
      setSaving(false);
    }
  }

  async function handleReceiptSelect(e) {
    const file = e.target.files?.[0];
    if (!file || !myParticipantId) return;
    setUploading(true);
    setUploadError("");
    try {
      await uploadPaymentReceipt(myParticipantId, file);
      setUploaded(true);
    } catch (err) {
      setUploadError("Couldn't upload that screenshot — try again.");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  if (step === "amount") {
    return (
      <Screen>
        <TopBar title={pool.name} onBack={onBack} />
        <div className="flex-1 px-6 pt-2 pb-8 flex flex-col">
          <div className="flex items-center gap-2 text-[#6B7A76] text-[13px] mb-1"><Trophy size={14} className="text-[#C9982E]" />Jackpot estimate</div>
          <div className="font-[Fraunces] text-[34px] text-[#10201D] font-medium mb-4">{money(pool.jackpot)}</div>
          <RolloverBanner pool={pool} />
          {pool.entryDeadline && <DeadlineBadge deadline={pool.entryDeadline} drawDate={pool.drawDate} />}
          <TicketCard stub={
            <div className="flex items-center justify-between">
              <div><div className="text-[11px] uppercase tracking-wide text-[#6B7A76]">Your share of the pool</div><div className="font-[Fraunces] text-[20px] text-[#10201D] font-medium">{pct(myPct)}</div></div>
              <div className="text-right"><div className="text-[11px] uppercase tracking-wide text-[#6B7A76]">If this ticket wins</div><div className="font-[JetBrains_Mono] text-[18px] text-[#2F6F5E] font-medium">{money(myWinnings)}</div></div>
            </div>
          }>
            <div className="text-[12px] uppercase tracking-wide text-[#6B7A76] mb-4">How much would you like to contribute?</div>
            <div className="flex items-center gap-3">
              <button onClick={() => adjustAmount(-5)} className="w-11 h-11 rounded-full bg-[#EFE9D8] text-[#10201D] text-xl font-medium flex items-center justify-center active:scale-95 shrink-0">−</button>
              <div className="flex-1 flex items-center justify-center gap-1 bg-white border border-[#D8D0BC] rounded-xl px-3 py-2.5">
                <span className="font-[Fraunces] text-[24px] text-[#10201D] font-medium">$</span>
                <input
                  type="text"
                  inputMode="decimal"
                  value={amount}
                  onChange={(e) => {
                    const raw = e.target.value.replace(/[^0-9.]/g, "");
                    setAmount(raw === "" ? "" : raw);
                  }}
                  onBlur={() => setAmount((a) => Math.max(1, Number(a) || 1))}
                  className="font-[Fraunces] text-[28px] font-medium text-[#10201D] leading-none w-full text-center bg-transparent focus:outline-none"
                />
              </div>
              <button onClick={() => adjustAmount(5)} className="w-11 h-11 rounded-full bg-[#2F6F5E] text-white text-xl font-medium flex items-center justify-center active:scale-95 shrink-0">+</button>
            </div>
            <div className="text-[11px] uppercase tracking-wide text-[#6B7A76] text-center mt-2">type any amount from $1, or use +/−</div>
          </TicketCard>
          <p className="text-[12px] text-[#8A968F] mt-3">Pay {pool.organiser} directly (cash, bank transfer, etc.) — this app just tracks it.</p>
          <div className="mt-6"><Button onClick={() => setStep("name")} icon={ArrowRight} disabled={closed}>{closed ? "Entries closed" : "Continue"}</Button></div>
        </div>
      </Screen>
    );
  }

  if (step === "name") {
    return (
      <Screen>
        <TopBar title="Your details" onBack={() => setStep("amount")} />
        <div className="flex-1 px-6 pt-2 pb-8">
          <Field label="Your name"><input className={inputCls} placeholder="e.g. Josh" value={pname} onChange={(e) => setPname(e.target.value)} autoFocus /></Field>
          <div className="bg-white rounded-xl px-4 py-3.5 text-[14px] text-[#3E5652] flex justify-between mb-4">
            <span>{pct(myPct)} of pool</span>
            <span className="font-[JetBrains_Mono] font-medium">{money(amount)}</span>
          </div>
          {error && <div className="flex items-center gap-2 text-[#C1473A] text-[13px] mb-4"><AlertCircle size={15} /> {error}</div>}
          <Button onClick={handleConfirm} disabled={!pname.trim() || saving || closed} icon={saving ? Loader2 : ArrowRight}>{saving ? "Saving…" : "Confirm my contribution"}</Button>
        </div>
      </Screen>
    );
  }

  return (
    <Screen>
      <TopBar title="" />
      <div className="flex-1 px-6 pt-6 pb-10 flex flex-col items-center">
        <div className="w-14 h-14 rounded-full bg-[#2F6F5E] flex items-center justify-center mb-5"><Check size={26} className="text-white" /></div>
        <h2 className="font-[Fraunces] text-[24px] text-[#10201D] font-medium mb-1 text-center">You're in the pool</h2>
        <p className="text-[#6B7A76] text-[14px] mb-7 text-center">{pool.name}</p>
        <TicketCard className="w-full" stub={
          <div className="flex items-center justify-between">
            <div><div className="text-[11px] uppercase tracking-wide text-[#6B7A76]">Your share</div><div className="font-[Fraunces] text-[20px] text-[#10201D] font-medium">{pct(myPct)}</div></div>
            <div className="text-right"><div className="text-[11px] uppercase tracking-wide text-[#6B7A76]">Potential winnings</div><div className="font-[JetBrains_Mono] text-[18px] text-[#2F6F5E] font-medium">{money(myWinnings)}</div></div>
          </div>
        }>
          <div className="flex justify-between items-center mb-3"><span className="text-[12px] uppercase tracking-wide text-[#6B7A76]">Ticket holder</span><span className="font-[JetBrains_Mono] text-[12px] text-[#6B7A76]">{pool.code}</span></div>
          <div className="text-[18px] text-[#10201D] font-medium mb-1">{pname}</div>
          <div className="text-[13.5px] text-[#5B6B67]">{money(amount)} owed to {pool.organiser}</div>
        </TicketCard>

        {paymentDetails && (paymentDetails.bank_name || paymentDetails.payid) && (
          <TicketCard className="w-full mt-4">
            <div className="flex items-center gap-2 text-[12px] uppercase tracking-wide text-[#6B7A76] mb-3"><Landmark size={14} />Send payment to</div>
            {paymentDetails.account_name && <div className="text-[14px] text-[#10201D] mb-1">{paymentDetails.account_name}</div>}
            {paymentDetails.bank_name && <div className="text-[13px] text-[#5B6B67]">{paymentDetails.bank_name}</div>}
            {paymentDetails.bsb && <div className="text-[13px] text-[#5B6B67] font-[JetBrains_Mono]">BSB {paymentDetails.bsb}</div>}
            {paymentDetails.account_number && <div className="text-[13px] text-[#5B6B67] font-[JetBrains_Mono]">Acc {paymentDetails.account_number}</div>}
            {paymentDetails.payid && <div className="text-[13px] text-[#5B6B67] mt-1">PayID: <span className="font-[JetBrains_Mono]">{paymentDetails.payid}</span></div>}
          </TicketCard>
        )}

        <div className="w-full mt-4">
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleReceiptSelect} />
          {uploadError && <div className="flex items-center gap-2 text-[#C1473A] text-[13px] mb-2"><AlertCircle size={14} />{uploadError}</div>}
          <Button variant="ghost" icon={uploading ? Loader2 : uploaded ? Check : ImagePlus} onClick={() => fileRef.current?.click()} disabled={uploading}>
            {uploading ? "Uploading…" : uploaded ? "Screenshot uploaded" : "Upload payment screenshot (optional)"}
          </Button>
        </div>
        <p className="text-[12.5px] text-[#8A968F] text-center mt-6 leading-relaxed">Keep your code — {pool.code} — to check back on the syndicate anytime.</p>
        <div className="w-full mt-8"><Button onClick={onDone} variant="ghost">Done</Button></div>
      </div>
    </Screen>
  );
}

/* ---------------------------------------------------------
   Read-only member view
--------------------------------------------------------- */

function ViewPool({ code, onBack, onChat }) {
  const [pool, setPool] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [shareCopied, setShareCopied] = useState(false);
  const refresh = useCallback(async () => {
    setRefreshing(true);
    setPool(await loadPool(code));
    setRefreshing(false);
  }, [code]);
  useEffect(() => { refresh(); }, [refresh]);

  async function handleShare() {
    const url = `${window.location.origin}/#/j/${code}`;
    const text = `Join my lotto syndicate${pool?.name ? ` "${pool.name}"` : ""} on Syndicate — use code ${code}`;
    if (navigator.share) {
      try {
        await navigator.share({ title: "Join my syndicate", text, url });
      } catch (e) {} // user cancelled the share sheet — not an error
    } else {
      try {
        await navigator.clipboard.writeText(`${text}\n${url}`);
        setShareCopied(true);
        setTimeout(() => setShareCopied(false), 2000);
      } catch (e) {}
    }
  }

  if (!pool) return (<Screen><TopBar title="Loading…" onBack={onBack} /><div className="flex-1 flex items-center justify-center"><Loader2 className="animate-spin text-[#2F6F5E]" size={22} /></div></Screen>);

  const { totalAmount } = totals(pool);
  return (
    <Screen>
      <TopBar title={pool.name} onBack={onBack} right={<button onClick={refresh} className="text-[#6B7A76]"><RefreshCw size={16} className={refreshing ? "animate-spin" : ""} /></button>} />
      <div className="flex-1 px-6 pb-10">
        {pool.status === "drawn" ? (
          <div className="bg-[#10201D] rounded-2xl px-5 py-4 mb-5">
            <div className="flex items-center gap-2 text-[#C9982E] text-[12px] uppercase tracking-wide mb-1"><Sparkles size={13} />Actual winnings</div>
            <div className="font-[Fraunces] text-[26px] text-[#F7F2E7] font-medium">{money(pool.actualWinnings)}</div>
          </div>
        ) : (
          <div className="bg-white rounded-2xl px-5 py-4 mb-5">
            <div className="flex items-center gap-2 text-[#6B7A76] text-[12px] uppercase tracking-wide mb-1"><Trophy size={13} className="text-[#C9982E]" />Jackpot estimate</div>
            <div className="font-[Fraunces] text-[24px] text-[#10201D] font-medium">{money(pool.jackpot)}</div>
          </div>
        )}
        <RolloverBanner pool={pool} />
        {pool.entryDeadline && <DeadlineBadge deadline={pool.entryDeadline} drawDate={pool.drawDate} />}
        <div className="space-y-2 mb-5">
          <Button variant="ghost" icon={shareCopied ? Check : Share2} onClick={handleShare}>{shareCopied ? "Link copied!" : "Share & invite others"}</Button>
          <Button variant="ghost" icon={MessageCircle} onClick={onChat}>Syndicate chat</Button>
          <Button variant="ghost" icon={Download} onClick={() => downloadSyndicatePdf(pool)}>Download syndicate as PDF</Button>
        </div>
        <div className="text-[12px] uppercase tracking-wide text-[#6B7A76] mb-2.5">Ticket photos</div>
        <div className="mb-6"><PhotoGallery photos={pool.ticketPhotos} editable={false} emptyHint="The organiser hasn't added ticket photos yet." /></div>
        <div className="flex items-center justify-between mb-2.5">
          <span className="text-[12px] uppercase tracking-wide text-[#6B7A76]">Members</span>
          <span className="text-[11px] uppercase tracking-wide text-[#6B7A76]">{pool.status === "drawn" ? "Actual winnings" : "Potential winnings"}</span>
        </div>
        <div className="space-y-2">
          {pool.participants.length === 0 && <div className="text-[13.5px] text-[#8A968F] bg-white rounded-xl px-4 py-6 text-center">No one has joined yet.</div>}
          {pool.participants.map((p) => {
            const share = totalAmount ? (Number(p.amount || 0) / totalAmount) * 100 : 0;
            const winnings = pool.status === "drawn" ? (share / 100) * pool.actualWinnings : (share / 100) * pool.jackpot;
            return (
              <div key={p.id} className="bg-white rounded-xl px-4 py-3.5 flex items-center gap-3">
                <Avatar url={p.avatarUrl} name={p.nickname || p.name} size={34} />
                <div className="flex-1">
                  <div className="text-[14.5px] text-[#10201D] font-medium">{displayName(p)}</div>
                  <div className="text-[12px] text-[#8A968F]">{money(p.amount)} · {pct(share)} · {money(winnings)} share</div>
                </div>
                <div className="font-[JetBrains_Mono] text-[14px] text-[#10201D] font-medium">{money(winnings)}</div>
              </div>
            );
          })}
        </div>
      </div>
    </Screen>
  );
}

/* ---------------------------------------------------------
   Organiser dashboard
--------------------------------------------------------- */

function Dashboard({ session, code, onBack, onSignIn, isAdmin }) {
  const [pool, setPool] = useState(null);
  const [copied, setCopied] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const [winningsInput, setWinningsInput] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [showChat, setShowChat] = useState(false);
  const [showRollover, setShowRollover] = useState(false);
  const [rolloverJackpot, setRolloverJackpot] = useState("");
  const [rolloverDrawDate, setRolloverDrawDate] = useState("");
  const [rolloverDeadline, setRolloverDeadline] = useState("");
  const [rolloverCarry, setRolloverCarry] = useState(false);
  const [rolloverSaving, setRolloverSaving] = useState(false);
  const [rolloverError, setRolloverError] = useState("");
  const fileInputRef = useRef(null);

  const [paymentDetails, setPaymentDetails] = useState(null);
  const [bankName, setBankName] = useState("");
  const [accountName, setAccountName] = useState("");
  const [bsb, setBsb] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [payid, setPayid] = useState("");
  const [paymentSaving, setPaymentSaving] = useState(false);
  const [paymentSaved, setPaymentSaved] = useState(false);
  const [paymentError, setPaymentError] = useState("");

  const [viewingReceiptUrl, setViewingReceiptUrl] = useState(null);
  const [receiptLoading, setReceiptLoading] = useState(false);

  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [editingJackpot, setEditingJackpot] = useState(false);
  const [jackpotValue, setJackpotValue] = useState("");
  const [jackpotSaving, setJackpotSaving] = useState(false);
  function openEditJackpot() { setJackpotValue(String(pool.jackpot)); setEditingJackpot(true); }
  async function saveJackpot() {
    const amt = Number(jackpotValue);
    if (!amt || amt <= 0) return;
    setJackpotSaving(true);
    try {
      await updateJackpot(pool.code, amt);
      setEditingJackpot(false);
      await refresh();
    } finally {
      setJackpotSaving(false);
    }
  }

  const [editingParticipant, setEditingParticipant] = useState(null);
  const [editAmountValue, setEditAmountValue] = useState("");
  const [editSaving, setEditSaving] = useState(false);
  const [removingParticipant, setRemovingParticipant] = useState(null);
  const [removeSaving, setRemoveSaving] = useState(false);

  const [addParticipantMode, setAddParticipantMode] = useState(null); // "self" | "manual" | null
  const [newPName, setNewPName] = useState("");
  const [newPAmount, setNewPAmount] = useState("");
  const [newPPaid, setNewPPaid] = useState(true);
  const [addPSaving, setAddPSaving] = useState(false);
  const [addPError, setAddPError] = useState("");

  function openAddParticipant(isSelf) {
    setAddParticipantMode(isSelf ? "self" : "manual");
    setNewPName("");
    setNewPAmount("");
    setNewPPaid(true);
    setAddPError("");
  }

  async function saveNewParticipant() {
    const amt = Number(newPAmount);
    if (!newPName.trim() || !amt || amt <= 0) {
      setAddPError("Add a name and an amount to continue.");
      return;
    }
    setAddPSaving(true);
    setAddPError("");
    try {
      await addParticipant(pool.code, {
        name: newPName.trim(),
        amount: amt,
        userId: addParticipantMode === "self" ? session.user.id : null,
        paid: newPPaid,
      });
      setAddParticipantMode(null);
      await refresh();
    } catch (e) {
      setAddPError(e.message || "Something went wrong adding them.");
    } finally {
      setAddPSaving(false);
    }
  }

  const refresh = useCallback(async () => {
    setRefreshing(true);
    setLoadError("");
    try {
      const p = await loadPool(code);
      setPool(p);
      if (p) {
        const pd = await loadPaymentDetails(code);
        if (pd) {
          setPaymentDetails(pd);
          setBankName(pd.bank_name || "");
          setAccountName(pd.account_name || "");
          setBsb(pd.bsb || "");
          setAccountNumber(pd.account_number || "");
          setPayid(pd.payid || "");
        }
      }
    } catch (e) {
      setLoadError(e.message || "Something went wrong loading this syndicate.");
    } finally {
      setLoaded(true);
      setRefreshing(false);
    }
  }, [code]);
  useEffect(() => { refresh(); }, [refresh]);

  if (!loaded) return (<Screen><TopBar title="Loading…" onBack={onBack} /><div className="flex-1 flex items-center justify-center"><Loader2 className="animate-spin text-[#2F6F5E]" size={22} /></div></Screen>);

  if (loadError) {
    return (
      <Screen>
        <TopBar title="Couldn't load" onBack={onBack} />
        <div className="flex-1 px-6 pt-10 flex flex-col items-center text-center">
          <div className="w-14 h-14 rounded-full bg-[#C1473A] flex items-center justify-center mb-5"><AlertCircle size={26} className="text-white" /></div>
          <p className="text-[#3E5652] text-[15px] leading-relaxed mb-2">This syndicate couldn't be loaded.</p>
          <p className="text-[#8A968F] text-[13px] mb-6">{loadError}</p>
          <Button variant="ghost" onClick={refresh}>Try again</Button>
        </div>
      </Screen>
    );
  }

  if (!pool) {
    return (
      <Screen>
        <TopBar title="Not found" onBack={onBack} />
        <div className="flex-1 px-6 pt-10 flex flex-col items-center text-center">
          <div className="w-14 h-14 rounded-full bg-[#EFE9D8] flex items-center justify-center mb-5"><AlertCircle size={26} className="text-[#10201D]" /></div>
          <p className="text-[#3E5652] text-[15px] leading-relaxed mb-2">This syndicate wasn't found.</p>
          <p className="text-[#8A968F] text-[13px] mb-6">It may have already been deleted. {isAdmin ? "Use the Admin dashboard's \"Show deleted\" toggle to find and restore it." : ""}</p>
          <Button variant="ghost" onClick={onBack}>Back to home</Button>
        </div>
      </Screen>
    );
  }

  const isOwner = session && (session.user.id === pool.ownerId || isAdmin);
  if (!isOwner) {
    return (
      <Screen>
        <TopBar title={pool.name} onBack={onBack} />
        <div className="flex-1 px-6 pt-10 flex flex-col items-center text-center">
          <div className="w-14 h-14 rounded-full bg-[#10201D] flex items-center justify-center mb-5"><Lock size={22} className="text-[#F7F2E7]" /></div>
          <h2 className="font-[Fraunces] text-[19px] text-[#10201D] font-medium mb-2">This dashboard belongs to another organiser</h2>
          <p className="text-[#6B7A76] text-[14px] leading-relaxed mb-6">Sign in with the email used to create "{pool.name}" to manage it, or view the public syndicate page instead.</p>
          {!session && <Button icon={LogIn} onClick={onSignIn}>Sign in</Button>}
        </div>
      </Screen>
    );
  }

  if (showChat) {
    return <ChatRoom session={session} code={pool.code} poolName={pool.name} onBack={() => setShowChat(false)} onSignIn={onSignIn} />;
  }

  const { totalAmount, confirmed } = totals(pool);

  async function handleCopy() {
    try { await navigator.clipboard.writeText(pool.code); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch (e) {}
  }
  async function handleShare() {
    const text = `Join "${pool.name}" — use code ${pool.code} in the Syndicate app: ${window.location.origin}${window.location.pathname}#/j/${pool.code}`;
    if (navigator.share) { try { await navigator.share({ text }); } catch (e) {} } else { handleCopy(); }
  }
  async function handlePhotoSelect(e) {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    setUploading(true);
    setUploadError("");
    try {
      for (const file of files) await uploadTicketPhoto(code, file);
      await refresh();
    } catch (e) {
      setUploadError("Couldn't upload one of those photos — try again.");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }
  async function handlePhotoRemove(id) { await removeTicketPhoto(id); await refresh(); }
  async function togglePaid(p) { await setParticipantPaid(p.id, !p.paid); await refresh(); }

  function openEditAmount(p) { setEditingParticipant(p); setEditAmountValue(String(p.amount)); }
  async function saveEditedAmount() {
    if (!editingParticipant) return;
    const amt = Number(editAmountValue);
    if (!amt || amt <= 0) return;
    setEditSaving(true);
    try {
      await updateParticipantAmount(editingParticipant.id, amt);
      setEditingParticipant(null);
      await refresh();
    } finally {
      setEditSaving(false);
    }
  }

  async function confirmRemoveParticipant() {
    if (!removingParticipant) return;
    setRemoveSaving(true);
    try {
      await removeParticipant(removingParticipant.id);
      setRemovingParticipant(null);
      await refresh();
    } finally {
      setRemoveSaving(false);
    }
  }

  async function handleSubmitResults() {
    const amt = Number(winningsInput);
    if (!amt || amt < 0) return;
    await submitResults(code, amt);
    setShowResults(false);
    await refresh();
  }
  async function handleRollover() {
    setRolloverSaving(true);
    setRolloverError("");
    try {
      const draft = {
        oldPool: {
          code: pool.code,
          name: pool.name,
          organiser: pool.organiser,
          actualWinnings: pool.actualWinnings,
          participants: pool.participants.map((p) => ({ name: p.name, amount: p.amount, userId: p.userId })),
        },
        options: {
          jackpot: Number(rolloverJackpot),
          drawDate: rolloverDrawDate,
          entryDeadline: rolloverDeadline ? new Date(rolloverDeadline).toISOString() : null,
          carryMembers: rolloverCarry,
          ownerId: session.user.id,
        },
      };
      localStorage.setItem("pendingRollover", JSON.stringify(draft));

      const res = await fetch("/api/create-checkout-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          successPath: "/#/rollover-success?session_id={CHECKOUT_SESSION_ID}",
          cancelPath: `/#/rollover-cancelled?code=${pool.code}`,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.url) throw new Error(data.error || "Couldn't start payment.");
      window.location.href = data.url;
    } catch (e) {
      setRolloverError(e.message || "Something went wrong starting payment.");
      setRolloverSaving(false);
    }
  }

  async function handleSavePaymentDetails() {
    setPaymentSaving(true);
    setPaymentError("");
    try {
      await savePaymentDetails(code, { bankName, accountName, bsb, accountNumber, payid });
      setPaymentSaved(true);
      setTimeout(() => setPaymentSaved(false), 1800);
    } catch (e) {
      setPaymentError("Couldn't save payment details. Try again.");
    } finally {
      setPaymentSaving(false);
    }
  }
  async function handleViewReceipt(path) {
    setReceiptLoading(true);
    const url = await getReceiptSignedUrl(path);
    setReceiptLoading(false);
    if (url) setViewingReceiptUrl(url);
  }
  async function handleDeleteSyndicate() {
    setDeleting(true);
    try {
      await deleteSyndicate(code);
      onBack();
    } catch (e) {
      setDeleting(false);
    }
  }


  return (
    <Screen>
      <TopBar title={pool.name} onBack={onBack} right={<button onClick={refresh} className="text-[#6B7A76]"><RefreshCw size={16} className={refreshing ? "animate-spin" : ""} /></button>} />
      <div className="flex-1 px-6 pb-10">
        <TicketCard className="mb-5">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[12px] uppercase tracking-wide text-[#6B7A76]">Invite code</span>
            <span className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${pool.status === "open" ? "bg-[#2F6F5E]/10 text-[#2F6F5E]" : "bg-[#C9982E]/15 text-[#8A6A15]"}`}>{pool.status === "open" ? "Open" : "Drawn"}</span>
          </div>
          <div className="font-[JetBrains_Mono] text-[30px] tracking-[0.15em] text-[#10201D] font-medium mb-3">{pool.code}</div>
          <div className="flex gap-2">
            <Button variant="ghost" full={false} icon={copied ? Check : Copy} onClick={handleCopy}><span className="hidden sm:inline">{copied ? "Copied" : "Copy"}</span></Button>
            <Button variant="primary" icon={Share2} onClick={handleShare}>Share invite</Button>
          </div>
        </TicketCard>

        <Button variant="ghost" icon={Download} onClick={() => downloadSyndicatePdf(pool)}>Download syndicate as PDF</Button>
        <div className="mb-5" />

        <RolloverBanner pool={pool} />
        {pool.entryDeadline && <DeadlineBadge deadline={pool.entryDeadline} drawDate={pool.drawDate} />}

        <Button variant="ghost" icon={MessageCircle} onClick={() => setShowChat(true)}>Syndicate chat</Button>

        <div className="flex items-center justify-between mb-2.5 mt-5">
          <span className="text-[12px] uppercase tracking-wide text-[#6B7A76]">Ticket photos</span>
          <button onClick={() => fileInputRef.current?.click()} disabled={uploading} className="flex items-center gap-1.5 text-[#2F6F5E] text-[13px] font-medium disabled:opacity-50">
            {uploading ? <Loader2 size={14} className="animate-spin" /> : <ImagePlus size={14} />} {uploading ? "Uploading…" : "Add photos"}
          </button>
          <input ref={fileInputRef} type="file" accept="image/*" multiple className="hidden" onChange={handlePhotoSelect} />
        </div>
        {uploadError && <div className="flex items-center gap-2 text-[#C1473A] text-[13px] mb-2"><AlertCircle size={14} />{uploadError}</div>}
        <div className="mb-5"><PhotoGallery photos={pool.ticketPhotos} editable onRemove={handlePhotoRemove} emptyHint="Snap a photo of the purchased tickets so everyone can see them here." /></div>

        <div className="grid grid-cols-2 gap-3 mb-5">
          <div className="bg-white rounded-2xl p-4">
            <div className="flex items-center justify-between mb-1">
              <div className="flex items-center gap-1.5 text-[#6B7A76] text-[11px] uppercase tracking-wide"><Trophy size={12} className="text-[#C9982E]" />Jackpot</div>
              <button onClick={openEditJackpot} className="text-[#6B7A76]"><Pencil size={13} /></button>
            </div>
            <div className="font-[Fraunces] text-[19px] text-[#10201D] font-medium">{money(pool.jackpot)}</div>
          </div>
          <div className="bg-white rounded-2xl p-4">
            <div className="flex items-center gap-1.5 text-[#6B7A76] text-[11px] uppercase tracking-wide mb-1"><Users size={12} />Participants</div>
            <div className="font-[Fraunces] text-[19px] text-[#10201D] font-medium">{pool.participants.length}</div>
          </div>
          <div className="bg-white rounded-2xl p-4">
            <div className="flex items-center gap-1.5 text-[#6B7A76] text-[11px] uppercase tracking-wide mb-1"><Ticket size={12} />Total pool</div>
            <div className="font-[JetBrains_Mono] text-[17px] text-[#10201D] font-medium">{money(totalAmount)}</div>
          </div>
          <div className="bg-white rounded-2xl p-4">
            <div className="flex items-center gap-1.5 text-[#6B7A76] text-[11px] uppercase tracking-wide mb-1"><TrendingUp size={12} />Confirmed received</div>
            <div className="font-[JetBrains_Mono] text-[17px] text-[#2F6F5E] font-medium">{money(confirmed)}</div>
          </div>
        </div>

        {pool.status !== "drawn" ? (
          <button onClick={() => setShowResults(true)} className="w-full flex items-center justify-between bg-[#10201D] text-[#F7F2E7] rounded-2xl px-5 py-4 mb-3">
            <span className="flex items-center gap-2 text-[14.5px] font-medium"><Clock size={16} className="text-[#C9982E]" />Enter draw results</span>
            <ChevronRight size={17} className="text-[#9FB0AC]" />
          </button>
        ) : (
          <>
            <div className="bg-[#10201D] rounded-2xl px-5 py-4 mb-3">
              <div className="flex items-center gap-2 text-[#C9982E] text-[12px] uppercase tracking-wide mb-1"><Sparkles size={13} />Actual winnings</div>
              <div className="font-[Fraunces] text-[26px] text-[#F7F2E7] font-medium">{money(pool.actualWinnings)}</div>
            </div>
            {pool.rolledForwardTo ? (
              <a href={`#/dashboard/${pool.rolledForwardTo}`} className="w-full flex items-center justify-between bg-[#2F6F5E]/10 text-[#2F6F5E] rounded-2xl px-5 py-4 mb-5">
                <span className="flex items-center gap-2 text-[14.5px] font-medium"><Sparkles size={16} />Rolled into new syndicate: {pool.rolledForwardTo}</span>
                <ChevronRight size={17} />
              </a>
            ) : (
              <button onClick={() => setShowRollover(true)} className="w-full flex items-center justify-between bg-[#C9982E]/12 text-[#8A6A15] rounded-2xl px-5 py-4 mb-5 border border-[#C9982E]/30">
                <span className="flex items-center gap-2 text-[14.5px] font-medium"><Sparkles size={16} />Roll winnings into a new syndicate</span>
                <ChevronRight size={17} />
              </button>
            )}
          </>
        )}

        <div className="flex gap-2 mb-4">
          {!pool.participants.some((p) => p.userId === session.user.id) && (
            <Button full={false} variant="ghost" icon={PlusCircle} onClick={() => openAddParticipant(true)}>
              <span className="text-[13px]">Join as a contributor</span>
            </Button>
          )}
          <Button full={false} variant="ghost" icon={UserPlus} onClick={() => openAddParticipant(false)}>
            <span className="text-[13px]">Add a participant</span>
          </Button>
        </div>

        <div className="flex items-center justify-between mb-2.5">
          <span className="text-[12px] uppercase tracking-wide text-[#6B7A76]">Who owes what</span>
          <span className="text-[11px] uppercase tracking-wide text-[#6B7A76]">{pool.status === "drawn" ? "Actual winnings" : "Potential winnings"}</span>
        </div>
        <div className="space-y-2 mb-6">
          {pool.participants.length === 0 && <div className="text-[13.5px] text-[#8A968F] bg-white rounded-xl px-4 py-6 text-center">No one has joined yet — share your code to get started.</div>}
          {pool.participants.map((p) => {
            const share = totalAmount ? (Number(p.amount || 0) / totalAmount) * 100 : 0;
            const winnings = pool.status === "drawn" ? (share / 100) * pool.actualWinnings : (share / 100) * pool.jackpot;
            return (
              <div key={p.id} className="bg-white rounded-xl px-4 py-3.5 flex items-center gap-3">
                <button onClick={() => togglePaid(p)} className="shrink-0">
                  {p.paid ? <CheckSquare size={22} className="text-[#2F6F5E]" /> : <Square size={22} className="text-[#C1473A]" />}
                </button>
                <Avatar url={p.avatarUrl} name={p.nickname || p.name} size={34} />
                <div className="flex-1 min-w-0">
                  <div className={`text-[14.5px] font-medium ${p.paid ? "text-[#2F6F5E]" : "text-[#C1473A]"}`}>{displayName(p)}</div>
                  <div className="text-[12px] text-[#8A968F]">{money(p.amount)} · {pct(share)} · {money(winnings)} share</div>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className={`text-[11px] font-medium ${p.paid ? "text-[#2F6F5E]" : "text-[#C1473A]"}`}>{p.paid ? "Paid entry" : "Unpaid entry"}</span>
                    {p.receiptPath && (
                      <button onClick={() => handleViewReceipt(p.receiptPath)} className="text-[11px] text-[#6B7A76] underline">
                        {receiptLoading ? "Loading…" : "View screenshot"}
                      </button>
                    )}
                  </div>
                </div>
                <div className="flex flex-col items-end gap-1 shrink-0">
                  <div className="font-[JetBrains_Mono] text-[14px] text-[#10201D] font-medium">{money(winnings)}</div>
                  <div className="flex items-center gap-2">
                    <button onClick={() => openEditAmount(p)} className="text-[#6B7A76]"><Pencil size={13} /></button>
                    <button onClick={() => setRemovingParticipant(p)} className="text-[#C1473A]"><UserX size={14} /></button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <div className="text-[12px] uppercase tracking-wide text-[#6B7A76] mb-2.5 flex items-center gap-2"><Landmark size={13} />Your payment details</div>
        <TicketCard className="mb-6">
          <p className="text-[12.5px] text-[#8A968F] mb-4">Only visible to people who've joined this syndicate.</p>
          <Field label="Bank name"><input className={inputCls} placeholder="e.g. Commonwealth Bank" value={bankName} onChange={(e) => setBankName(e.target.value)} /></Field>
          <Field label="Account name"><input className={inputCls} placeholder="e.g. Gavin Davies" value={accountName} onChange={(e) => setAccountName(e.target.value)} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="BSB"><input className={inputCls} placeholder="000-000" value={bsb} onChange={(e) => setBsb(e.target.value)} /></Field>
            <Field label="Account number"><input className={inputCls} value={accountNumber} onChange={(e) => setAccountNumber(e.target.value)} /></Field>
          </div>
          <Field label="PayID (optional)"><input className={inputCls} placeholder="phone, email, or ABN" value={payid} onChange={(e) => setPayid(e.target.value)} /></Field>
          {paymentError && <div className="flex items-center gap-2 text-[#C1473A] text-[13px] mb-3"><AlertCircle size={14} />{paymentError}</div>}
          <Button onClick={handleSavePaymentDetails} disabled={paymentSaving} icon={paymentSaving ? Loader2 : paymentSaved ? Check : undefined}>
            {paymentSaving ? "Saving…" : paymentSaved ? "Saved" : "Save payment details"}
          </Button>
        </TicketCard>

        <button onClick={() => setShowDeleteConfirm(true)} className="w-full flex items-center justify-center gap-2 text-[#C1473A] text-[13.5px] font-medium py-3 mb-2">
          <Trash2 size={15} /> Delete this syndicate
        </button>
      </div>

      {showResults && (
        <div className="fixed inset-0 z-30 flex items-end justify-center bg-black/40" onClick={() => setShowResults(false)}>
          <div className="w-full max-w-[430px] bg-[#F7F2E7] rounded-t-3xl p-6 pb-8" onClick={(e) => e.stopPropagation()}>
            <div className="w-10 h-1 rounded-full bg-[#D8D0BC] mx-auto mb-5" />
            <h3 className="font-[Fraunces] text-[19px] text-[#10201D] font-medium mb-1">Enter draw results</h3>
            <p className="text-[13px] text-[#6B7A76] mb-4">This recalculates every participant's payout automatically.</p>
            <Field label="Total winnings ($)"><input className={inputCls} inputMode="numeric" placeholder="0" value={winningsInput} onChange={(e) => setWinningsInput(e.target.value.replace(/[^0-9.]/g, ""))} autoFocus /></Field>
            <div className="flex gap-3"><Button variant="ghost" onClick={() => setShowResults(false)}>Cancel</Button><Button onClick={handleSubmitResults} disabled={!winningsInput}>Save results</Button></div>
          </div>
        </div>
      )}

      {showRollover && (
        <div className="fixed inset-0 z-30 flex items-end justify-center bg-black/40" onClick={() => setShowRollover(false)}>
          <div className="w-full max-w-[430px] bg-[#F7F2E7] rounded-t-3xl p-6 pb-8 max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="w-10 h-1 rounded-full bg-[#D8D0BC] mx-auto mb-5" />
            <h3 className="font-[Fraunces] text-[19px] text-[#10201D] font-medium mb-1">Roll winnings forward</h3>
            <p className="text-[13px] text-[#6B7A76] mb-4">Starts a new "{pool.name}" syndicate with {money(pool.actualWinnings)} noted as rolled over. A $3.00 AUD service fee applies, same as creating any syndicate.</p>
            <Field label="Jackpot estimate for next draw *"><input className={inputCls} inputMode="numeric" placeholder="40,000,000" value={rolloverJackpot} onChange={(e) => setRolloverJackpot(e.target.value.replace(/[^0-9.]/g, ""))} /></Field>
            <Field label="Draw date (optional)"><input type="date" className={inputCls} value={rolloverDrawDate} onChange={(e) => setRolloverDrawDate(e.target.value)} /></Field>
            <Field label="Entry deadline (optional)"><input type="datetime-local" className={inputCls} value={rolloverDeadline} onChange={(e) => setRolloverDeadline(e.target.value)} /></Field>
            <label className="flex items-center gap-2.5 mb-5 bg-white rounded-xl px-4 py-3">
              <input type="checkbox" checked={rolloverCarry} onChange={(e) => setRolloverCarry(e.target.checked)} className="w-4 h-4" />
              <span className="text-[13.5px] text-[#3E5652]">Carry over the same members and share percentages</span>
            </label>
            {rolloverError && <div className="flex items-center gap-2 text-[#C1473A] text-[13px] mb-4"><AlertCircle size={15} />{rolloverError}</div>}
            <div className="flex gap-3">
              <Button variant="ghost" onClick={() => setShowRollover(false)}>Cancel</Button>
              <Button onClick={handleRollover} disabled={!rolloverJackpot || rolloverSaving} icon={rolloverSaving ? Loader2 : ArrowRight}>{rolloverSaving ? "Redirecting…" : "Pay $3 & roll over"}</Button>
            </div>
          </div>
        </div>
      )}

      {viewingReceiptUrl && (
        <div className="fixed inset-0 z-40 bg-black/90 flex flex-col" onClick={() => setViewingReceiptUrl(null)}>
          <div className="flex justify-end px-5 pt-6">
            <button onClick={() => setViewingReceiptUrl(null)} className="w-9 h-9 rounded-full bg-white/10 flex items-center justify-center text-white"><X size={17} /></button>
          </div>
          <div className="flex-1 flex items-center justify-center px-4" onClick={(e) => e.stopPropagation()}>
            <img src={viewingReceiptUrl} alt="Payment screenshot" className="max-h-full max-w-full rounded-lg object-contain" />
          </div>
        </div>
      )}

      {addParticipantMode && (
        <div className="fixed inset-0 z-30 flex items-end justify-center bg-black/40" onClick={() => setAddParticipantMode(null)}>
          <div className="w-full max-w-[430px] bg-[#F7F2E7] rounded-t-3xl p-6 pb-8" onClick={(e) => e.stopPropagation()}>
            <div className="w-10 h-1 rounded-full bg-[#D8D0BC] mx-auto mb-5" />
            <h3 className="font-[Fraunces] text-[19px] text-[#10201D] font-medium mb-1">
              {addParticipantMode === "self" ? "Join as a contributor" : "Add a participant"}
            </h3>
            <p className="text-[13px] text-[#6B7A76] mb-4">
              {addParticipantMode === "self"
                ? "Add your own contribution to this syndicate's pool."
                : "Good for anyone paying cash or who'd rather not join with a code themselves."}
            </p>
            <Field label="Name"><input className={inputCls} placeholder="e.g. Sarah" value={newPName} onChange={(e) => setNewPName(e.target.value)} autoFocus /></Field>
            <Field label="Amount ($)">
              <input className={inputCls} inputMode="decimal" placeholder="20" value={newPAmount} onChange={(e) => setNewPAmount(e.target.value.replace(/[^0-9.]/g, ""))} />
            </Field>
            <label className="flex items-center gap-2.5 mb-5 bg-white rounded-xl px-4 py-3">
              <input type="checkbox" checked={newPPaid} onChange={(e) => setNewPPaid(e.target.checked)} className="w-4 h-4" />
              <span className="text-[13.5px] text-[#3E5652]">Already paid</span>
            </label>
            {addPError && <div className="flex items-center gap-2 text-[#C1473A] text-[13px] mb-4"><AlertCircle size={15} /> {addPError}</div>}
            <div className="flex gap-3">
              <Button variant="ghost" onClick={() => setAddParticipantMode(null)}>Cancel</Button>
              <Button onClick={saveNewParticipant} disabled={addPSaving} icon={addPSaving ? Loader2 : Check}>{addPSaving ? "Saving…" : "Add"}</Button>
            </div>
          </div>
        </div>
      )}

      {editingJackpot && (
        <div className="fixed inset-0 z-30 flex items-end justify-center bg-black/40" onClick={() => setEditingJackpot(false)}>
          <div className="w-full max-w-[430px] bg-[#F7F2E7] rounded-t-3xl p-6 pb-8" onClick={(e) => e.stopPropagation()}>
            <div className="w-10 h-1 rounded-full bg-[#D8D0BC] mx-auto mb-5" />
            <h3 className="font-[Fraunces] text-[19px] text-[#10201D] font-medium mb-1">Edit jackpot estimate</h3>
            <p className="text-[13px] text-[#6B7A76] mb-4">Update this any time before the draw — potential winnings recalculate automatically.</p>
            <Field label="Jackpot estimate ($)">
              <input className={inputCls} inputMode="numeric" value={jackpotValue} onChange={(e) => setJackpotValue(e.target.value.replace(/[^0-9.]/g, ""))} autoFocus />
            </Field>
            <div className="flex gap-3">
              <Button variant="ghost" onClick={() => setEditingJackpot(false)}>Cancel</Button>
              <Button onClick={saveJackpot} disabled={!jackpotValue || jackpotSaving} icon={jackpotSaving ? Loader2 : Check}>{jackpotSaving ? "Saving…" : "Save"}</Button>
            </div>
          </div>
        </div>
      )}

      {editingParticipant && (
        <div className="fixed inset-0 z-30 flex items-end justify-center bg-black/40" onClick={() => setEditingParticipant(null)}>
          <div className="w-full max-w-[430px] bg-[#F7F2E7] rounded-t-3xl p-6 pb-8" onClick={(e) => e.stopPropagation()}>
            <div className="w-10 h-1 rounded-full bg-[#D8D0BC] mx-auto mb-5" />
            <h3 className="font-[Fraunces] text-[19px] text-[#10201D] font-medium mb-1">Edit {editingParticipant.name}'s amount</h3>
            <p className="text-[13px] text-[#6B7A76] mb-4">Use this to fix a discrepancy — this changes their share of the pool.</p>
            <Field label="Amount ($)">
              <input className={inputCls} inputMode="decimal" value={editAmountValue} onChange={(e) => setEditAmountValue(e.target.value.replace(/[^0-9.]/g, ""))} autoFocus />
            </Field>
            <div className="flex gap-3">
              <Button variant="ghost" onClick={() => setEditingParticipant(null)}>Cancel</Button>
              <Button onClick={saveEditedAmount} disabled={!editAmountValue || editSaving} icon={editSaving ? Loader2 : Check}>{editSaving ? "Saving…" : "Save"}</Button>
            </div>
          </div>
        </div>
      )}

      {removingParticipant && (
        <div className="fixed inset-0 z-30 flex items-end justify-center bg-black/40" onClick={() => setRemovingParticipant(null)}>
          <div className="w-full max-w-[430px] bg-[#F7F2E7] rounded-t-3xl p-6 pb-8" onClick={(e) => e.stopPropagation()}>
            <div className="w-10 h-1 rounded-full bg-[#D8D0BC] mx-auto mb-5" />
            <h3 className="font-[Fraunces] text-[19px] text-[#10201D] font-medium mb-1">Remove {removingParticipant.name}?</h3>
            <p className="text-[13px] text-[#6B7A76] mb-6 leading-relaxed">They'll no longer be part of this syndicate, and everyone else's share percentages will recalculate. This can't be undone.</p>
            <div className="flex gap-3">
              <Button variant="ghost" onClick={() => setRemovingParticipant(null)}>Cancel</Button>
              <Button onClick={confirmRemoveParticipant} disabled={removeSaving} icon={removeSaving ? Loader2 : UserX}>{removeSaving ? "Removing…" : "Remove"}</Button>
            </div>
          </div>
        </div>
      )}

      {showDeleteConfirm && (
        <div className="fixed inset-0 z-30 flex items-end justify-center bg-black/40" onClick={() => setShowDeleteConfirm(false)}>
          <div className="w-full max-w-[430px] bg-[#F7F2E7] rounded-t-3xl p-6 pb-8" onClick={(e) => e.stopPropagation()}>
            <div className="w-10 h-1 rounded-full bg-[#D8D0BC] mx-auto mb-5" />
            <h3 className="font-[Fraunces] text-[19px] text-[#10201D] font-medium mb-1">Delete "{pool.name}"?</h3>
            <p className="text-[13px] text-[#6B7A76] mb-6 leading-relaxed">This removes it from your syndicates and everyone's view. This can't be undone from the app — a record is retained for legal purposes.</p>
            <div className="flex gap-3">
              <Button variant="ghost" onClick={() => setShowDeleteConfirm(false)}>Cancel</Button>
              <Button onClick={handleDeleteSyndicate} disabled={deleting} icon={deleting ? Loader2 : Trash2}>{deleting ? "Deleting…" : "Yes, delete it"}</Button>
            </div>
          </div>
        </div>
      )}
    </Screen>
  );
}

/* ---------------------------------------------------------
   Root — auth + hash router
--------------------------------------------------------- */

export default function App() {
  const [session, setSession] = useState(null);
  const [authReady, setAuthReady] = useState(false);
  const [subRoute, setSubRoute] = useState(null);
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setAuthReady(true);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
    });
    return () => listener.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (session) loadIsAdmin(session.user.id).then(setIsAdmin);
    else setIsAdmin(false);
  }, [session]);

  useEffect(() => {
    try {
      let visitorId = localStorage.getItem("syndicateVisitorId");
      if (!visitorId) {
        visitorId = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
        localStorage.setItem("syndicateVisitorId", visitorId);
      }
      supabase.from("page_views").insert({ visitor_id: visitorId }).then(() => {});
    } catch (e) {}
  }, []);

  const [route, setRoute] = useState({ name: "home" });
  useEffect(() => {
    function parseHash() {
      const raw = window.location.hash.replace(/^#\/?/, "");
      const [pathPart, queryPart] = raw.split("?");
      const parts = pathPart.split("/").filter(Boolean);
      if (parts[0] === "j" && parts[1]) return { name: "code-landing", code: parts[1] };
      if (parts[0] === "dashboard" && parts[1]) return { name: "dashboard", code: parts[1] };
      if (parts[0] === "create-success") {
        const params = new URLSearchParams(queryPart || "");
        return { name: "create-success", sessionId: params.get("session_id") };
      }
      if (parts[0] === "create-cancelled") return { name: "create-cancelled" };
      if (parts[0] === "rollover-success") {
        const params = new URLSearchParams(queryPart || "");
        return { name: "rollover-success", sessionId: params.get("session_id") };
      }
      if (parts[0] === "rollover-cancelled") {
        const params = new URLSearchParams(queryPart || "");
        return { name: "rollover-cancelled", oldCode: params.get("code") };
      }
      if (parts[0] === "guide") return { name: "guide" };
      return { name: "home" };
    }
    setRoute(parseHash());
    const onHashChange = () => setRoute(parseHash());
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  function goHome() { window.location.hash = ""; setRoute({ name: "home" }); }
  function goDashboard(code) { window.location.hash = `/dashboard/${code}`; setRoute({ name: "dashboard", code }); }

  const [foundPool, setFoundPool] = useState(null);

  useEffect(() => {
    if (route.name === "code-landing") {
      loadPool(route.code).then((p) => {
        if (p) { setFoundPool(p); setSubRoute("landing"); } else { setSubRoute("code"); }
      });
    }
  }, [route]);

  const requestSignIn = () => setSubRoute("signin");

  if (!authReady) {
    return (<Screen dark><div className="flex-1 flex items-center justify-center"><Loader2 className="animate-spin text-[#C9982E]" size={22} /></div></Screen>);
  }

  if (route.name === "dashboard") {
    return <Dashboard key={route.code} session={session} code={route.code} onBack={goHome} onSignIn={requestSignIn} isAdmin={isAdmin} />;
  }

  if (route.name === "create-success") {
    return (
      <CreateSuccessScreen
        session={session}
        sessionId={route.sessionId}
        onDone={(code) => goDashboard(code)}
        onError={goHome}
      />
    );
  }

  if (route.name === "create-cancelled") {
    return <CreateCancelledScreen onBack={() => { window.location.hash = ""; setSubRoute("create"); }} />;
  }

  if (route.name === "rollover-success") {
    return (
      <RolloverSuccessScreen
        sessionId={route.sessionId}
        onDone={(code) => goDashboard(code)}
        onError={goHome}
      />
    );
  }

  if (route.name === "rollover-cancelled") {
    return (
      <RolloverCancelledScreen
        oldCode={route.oldCode}
        onBack={() => { if (route.oldCode) goDashboard(route.oldCode); else goHome(); }}
      />
    );
  }

  if (route.name === "guide" || subRoute === "guide") {
    return (
      <GuideScreen
        onBack={() => { window.location.hash = ""; setSubRoute(null); }}
        onCreate={() => { window.location.hash = ""; setSubRoute("create"); }}
        onJoin={() => { window.location.hash = ""; setSubRoute("code"); }}
      />
    );
  }

  if (subRoute === "admin" && isAdmin) {
    return <AdminScreen session={session} onBack={() => setSubRoute(null)} onOpenSyndicate={(code) => goDashboard(code)} />;
  }

  if (subRoute === "signin") {
    return <SignIn onBack={() => setSubRoute(null)} />;
  }

  if (subRoute === "profile" && session) {
    return <ProfileScreen session={session} onBack={() => setSubRoute(null)} />;
  }

  if (subRoute === "privacy" || subRoute === "terms" || subRoute === "pricing") {
    return <LegalScreen page={subRoute} onBack={() => setSubRoute(null)} />;
  }

  if (route.name === "code-landing") {
    if (subRoute === "landing" && foundPool) {
      return <PoolLanding pool={foundPool} onBack={goHome} onJoin={() => setSubRoute("join")} onView={() => setSubRoute("view")} onChat={() => setSubRoute("chat")} />;
    }
    if (subRoute === "join" && foundPool) {
      if (!session) return <SignIn onBack={() => setSubRoute("landing")} />;
      return <JoinPool session={session} initialPool={foundPool} onBack={() => setSubRoute("landing")} onDone={goHome} />;
    }
    if (subRoute === "view" && foundPool) {
      return <ViewPool key={foundPool.code} code={foundPool.code} onBack={() => setSubRoute("landing")} onChat={() => setSubRoute("chat")} />;
    }
    if (subRoute === "chat" && foundPool) {
      return <ChatRoom key={foundPool.code} session={session} code={foundPool.code} poolName={foundPool.name} onBack={() => setSubRoute("landing")} onSignIn={requestSignIn} />;
    }
    return (
      <Screen><TopBar title="Loading…" onBack={goHome} /><div className="flex-1 flex items-center justify-center"><Loader2 className="animate-spin text-[#2F6F5E]" size={22} /></div></Screen>
    );
  }

  if (subRoute === "code") {
    return <EnterCode onBack={() => setSubRoute(null)} onFound={(pool) => { setFoundPool(pool); setSubRoute("landing"); window.location.hash = `/j/${pool.code}`; }} />;
  }
  if (subRoute === "create") {
    if (!session) return <SignIn onBack={() => setSubRoute(null)} />;
    return <CreatePool session={session} onBack={() => setSubRoute(null)} />;
  }
  return (
    <Home
      session={session}
      onCreate={() => setSubRoute("create")}
      onJoin={() => setSubRoute("code")}
      onSignIn={requestSignIn}
      onSignOut={async () => { await signOut(); }}
      onProfile={() => setSubRoute("profile")}
      onLegal={(page) => setSubRoute(page)}
      onGuide={() => setSubRoute("guide")}
      isAdmin={isAdmin}
      onAdmin={() => setSubRoute("admin")}
    />
  );
}
