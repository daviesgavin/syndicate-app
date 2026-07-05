import React, { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "./supabaseClient";
import {
  Ticket, Users, Copy, Check, ArrowRight, ArrowLeft, PlusCircle,
  TrendingUp, Trophy, Clock, Share2, Loader2, ShieldCheck,
  AlertCircle, ChevronRight, Sparkles, ImagePlus, X, Images, Eye, RefreshCw, LogIn, Lock
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
  const totalShares = pool.participants.reduce((s, p) => s + p.shares, 0);
  const ticketCost = totalShares * pool.pricePerShare;
  const confirmed = pool.participants.filter((p) => p.paid).reduce((s, p) => s + p.shares * pool.pricePerShare, 0);
  return { totalShares, ticketCost, confirmed };
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
   Data layer — Supabase
--------------------------------------------------------- */

async function createPool({ name, organiser, pricePerShare, jackpot, drawDate, entryDeadline, ownerId }) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = genCode();
    const { error } = await supabase.from("syndicates").insert({
      code,
      name,
      organiser,
      price_per_share: pricePerShare,
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
  const { data: syn, error } = await supabase.from("syndicates").select("*").eq("code", code).maybeSingle();
  if (error || !syn) return null;
  const { data: parts } = await supabase.from("participants").select("*").eq("syndicate_code", code).order("paid_at", { ascending: true });
  const { data: photos } = await supabase.from("ticket_photos").select("*").eq("syndicate_code", code).order("uploaded_at", { ascending: true });
  return {
    code: syn.code,
    name: syn.name,
    organiser: syn.organiser,
    ownerId: syn.owner_id,
    pricePerShare: Number(syn.price_per_share),
    jackpot: Number(syn.jackpot),
    drawDate: syn.draw_date,
    entryDeadline: syn.entry_deadline,
    status: syn.status,
    actualWinnings: syn.actual_winnings !== null ? Number(syn.actual_winnings) : null,
    participants: (parts || []).map((p) => ({ id: p.id, name: p.name, shares: p.shares, paid: p.paid, paidAt: p.paid_at })),
    ticketPhotos: (photos || []).map((ph) => ({ id: ph.id, url: ph.url })),
  };
}

async function loadOwnedPools(ownerId) {
  const { data, error } = await supabase
    .from("syndicates")
    .select("code,name")
    .eq("owner_id", ownerId)
    .order("created_at", { ascending: false });
  if (error) return [];
  return data;
}

async function addParticipant(code, { name, shares }) {
  const { error } = await supabase.from("participants").insert({ syndicate_code: code, name, shares, amount: 0, fee: 0, paid: false });
  if (error) throw error;
}

async function setParticipantPaid(id, paid) {
  const { error } = await supabase.from("participants").update({ paid, paid_at: new Date().toISOString() }).eq("id", id);
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

function DeadlineBadge({ deadline }) {
  const diff = useCountdown(deadline);
  if (diff === null) return null;
  const closed = diff <= 0;
  return (
    <div className={`flex items-center gap-2 rounded-xl px-3.5 py-2.5 text-[13px] font-medium mb-4 ${closed ? "bg-[#C1473A]/10 text-[#C1473A]" : "bg-[#C9982E]/12 text-[#8A6A15]"}`}>
      <Clock size={14} />
      {closed ? "Entries are closed for this syndicate" : `Entries close in ${formatCountdown(diff)}`}
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
      setError(e.message || "Couldn't send the link. Try again.");
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
          <p className="text-[#8A968F] text-[13px] mt-3">Open it on this device to continue.</p>
        </div>
      </Screen>
    );
  }

  return (
    <Screen>
      <TopBar title="Organiser sign in" onBack={onBack} />
      <div className="flex-1 px-6 pt-4">
        <p className="text-[#5B6B67] text-[14.5px] leading-relaxed mb-6">Enter your email — we'll send a link to sign in, no password needed. Use the same email each time to see all your syndicates.</p>
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
   Home
--------------------------------------------------------- */

function Home({ session, onCreate, onJoin, onSignIn, onSignOut, myPools }) {
  return (
    <Screen dark>
      <div className="flex-1 flex flex-col px-6 pt-16 pb-10">
        <div className="flex items-center gap-2 text-[#C9982E] mb-3">
          <Ticket size={22} />
          <span className="text-[13px] font-medium tracking-[0.14em] uppercase">Syndicate</span>
        </div>
        <h1 className="font-[Fraunces] text-[38px] leading-[1.08] text-[#F7F2E7] font-medium mb-3">Split the ticket.<br />Track every share.</h1>
        <p className="text-[#9FB0AC] text-[15px] leading-relaxed mb-10 max-w-[320px]">
          Organise your work lotto pool, collect shares by link, and know exactly who's owed what the moment the numbers drop.
        </p>
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
        {session && (
          <div className="mt-auto">
            <div className="flex items-center justify-between mb-2.5">
              <span className="text-[12px] uppercase tracking-wide text-[#6B7A76]">Your syndicates</span>
              <button onClick={onSignOut} className="text-[11px] text-[#7C8C88] underline">Sign out</button>
            </div>
            <div className="space-y-2">
              {myPools.length === 0 && <div className="text-[13px] text-[#7C8C88]">No syndicates yet — start one above.</div>}
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
      </div>
    </Screen>
  );
}

/* ---------------------------------------------------------
   Organiser — create
--------------------------------------------------------- */

function CreatePool({ session, onBack, onCreated }) {
  const [name, setName] = useState("");
  const [jackpot, setJackpot] = useState("");
  const [price, setPrice] = useState("5");
  const [drawDate, setDrawDate] = useState("");
  const [entryDeadline, setEntryDeadline] = useState("");
  const [organiser, setOrganiser] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const missing = [];
  if (!name.trim()) missing.push("syndicate name");
  if (!organiser.trim()) missing.push("your name");
  if (!price || Number(price) <= 0) missing.push("price per share");
  if (!jackpot || Number(jackpot) <= 0) missing.push("jackpot estimate");

  async function handleCreate() {
    if (missing.length > 0) {
      setError(`Add a ${missing.join(", ")} to continue.`);
      return;
    }
    setSaving(true);
    setError("");
    try {
      const code = await createPool({
        name: name.trim(),
        organiser: organiser.trim(),
        pricePerShare: Number(price),
        jackpot: Number(jackpot),
        drawDate,
        entryDeadline: entryDeadline ? new Date(entryDeadline).toISOString() : null,
        ownerId: session.user.id,
      });
      onCreated(code);
    } catch (e) {
      setError(`Error: ${e.message || JSON.stringify(e)}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Screen>
      <TopBar title="New syndicate" onBack={onBack} />
      <div className="flex-1 px-6 pt-2 pb-10">
        <Field label="Syndicate name *"><input className={inputCls} placeholder="Pool 9 — Friday Powerball" value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="Your name (organiser) *"><input className={inputCls} placeholder="e.g. Sarah" value={organiser} onChange={(e) => setOrganiser(e.target.value)} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Price per share *">
            <div className="relative"><span className="absolute left-4 top-1/2 -translate-y-1/2 text-[#A8A08C]">$</span>
              <input className={`${inputCls} pl-7`} inputMode="decimal" placeholder="5" value={price} onChange={(e) => setPrice(e.target.value.replace(/[^0-9.]/g, ""))} /></div>
          </Field>
          <Field label="Jackpot estimate *">
            <div className="relative"><span className="absolute left-4 top-1/2 -translate-y-1/2 text-[#A8A08C]">$</span>
              <input className={`${inputCls} pl-7`} inputMode="numeric" placeholder="40,000,000" value={jackpot} onChange={(e) => setJackpot(e.target.value.replace(/[^0-9.]/g, ""))} /></div>
          </Field>
        </div>
        <Field label="Draw date (optional)"><input type="date" className={inputCls} value={drawDate} onChange={(e) => setDrawDate(e.target.value)} /></Field>
        <Field label="Entry deadline (optional)">
          <input type="datetime-local" className={inputCls} value={entryDeadline} onChange={(e) => setEntryDeadline(e.target.value)} />
        </Field>
        <div className="bg-[#2F6F5E]/8 rounded-xl px-4 py-3 text-[13px] text-[#3E5652] leading-relaxed mb-6 flex gap-2">
          <ShieldCheck size={16} className="mt-0.5 shrink-0 text-[#2F6F5E]" />
          <span>Members reserve shares here, but payment happens between your group directly — you mark who's paid on your dashboard.</span>
        </div>
        {error && <div className="flex items-center gap-2 text-[#C1473A] text-[13px] mb-4"><AlertCircle size={15} /> {error}</div>}
        <Button onClick={handleCreate} disabled={saving} icon={saving ? Loader2 : ArrowRight}>{saving ? "Creating…" : "Create syndicate"}</Button>
      </div>
    </Screen>
  );
}

/* ---------------------------------------------------------
   Join — enter code, landing, shares
--------------------------------------------------------- */

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
        {error && <div className="flex items-center gap-2 text-[#C1473A] text-[13px] mb-4"><AlertCircle size={15} /> {error}</div>}
        <Button onClick={handleContinue} disabled={!code.trim() || loading} icon={loading ? Loader2 : ArrowRight}>{loading ? "Looking up…" : "Continue"}</Button>
      </div>
    </Screen>
  );
}

function PoolLanding({ pool, onBack, onJoin, onView }) {
  const diff = useCountdown(pool.entryDeadline);
  const closed = pool.entryDeadline && diff !== null && diff <= 0;
  return (
    <Screen>
      <TopBar title={pool.name} onBack={onBack} />
      <div className="flex-1 px-6 pt-2 pb-10 flex flex-col">
        <div className="flex items-center gap-2 text-[#6B7A76] text-[13px] mb-1"><Trophy size={14} className="text-[#C9982E]" />Jackpot estimate</div>
        <div className="font-[Fraunces] text-[34px] text-[#10201D] font-medium mb-1">{money(pool.jackpot)}</div>
        <div className="text-[13.5px] text-[#6B7A76] mb-4">Organised by {pool.organiser} · {money(pool.pricePerShare)} per share</div>
        {pool.entryDeadline && <DeadlineBadge deadline={pool.entryDeadline} />}
        <div className="space-y-3 mt-2">
          <Button icon={ArrowRight} onClick={onJoin} disabled={closed}>{closed ? "Entries closed" : "Reserve my shares"}</Button>
          <Button variant="ghost" icon={Eye} onClick={onView}>View syndicate members, shares and results</Button>
        </div>
      </div>
    </Screen>
  );
}

function JoinPool({ initialPool, onBack, onDone }) {
  const [pool, setPool] = useState(initialPool);
  const [step, setStep] = useState("shares");
  const [shares, setShares] = useState(1);
  const [pname, setPname] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const diff = useCountdown(pool.entryDeadline);
  const closed = pool.entryDeadline && diff !== null && diff <= 0;

  const { totalShares } = totals(pool);
  const projectedTotalShares = totalShares + shares;
  const myPct = (shares / projectedTotalShares) * 100;
  const myWinnings = (myPct / 100) * pool.jackpot;
  const owed = shares * pool.pricePerShare;

  async function handleConfirm() {
    setSaving(true);
    setError("");
    try {
      await addParticipant(pool.code, { name: pname.trim(), shares });
      const fresh = await loadPool(pool.code);
      setPool(fresh || pool);
      setStep("done");
    } catch (e) {
      setError("Entries may have just closed, or something went wrong. Try again.");
    } finally {
      setSaving(false);
    }
  }

  if (step === "shares") {
    return (
      <Screen>
        <TopBar title={pool.name} onBack={onBack} />
        <div className="flex-1 px-6 pt-2 pb-8 flex flex-col">
          <div className="flex items-center gap-2 text-[#6B7A76] text-[13px] mb-1"><Trophy size={14} className="text-[#C9982E]" />Jackpot estimate</div>
          <div className="font-[Fraunces] text-[34px] text-[#10201D] font-medium mb-4">{money(pool.jackpot)}</div>
          {pool.entryDeadline && <DeadlineBadge deadline={pool.entryDeadline} />}
          <TicketCard stub={
            <div className="flex items-center justify-between">
              <div><div className="text-[11px] uppercase tracking-wide text-[#6B7A76]">Your share of the pool</div><div className="font-[Fraunces] text-[20px] text-[#10201D] font-medium">{pct(myPct)}</div></div>
              <div className="text-right"><div className="text-[11px] uppercase tracking-wide text-[#6B7A76]">If this ticket wins</div><div className="font-[JetBrains_Mono] text-[18px] text-[#2F6F5E] font-medium">{money(myWinnings)}</div></div>
            </div>
          }>
            <div className="text-[12px] uppercase tracking-wide text-[#6B7A76] mb-4">How many shares?</div>
            <Stepper value={shares} onChange={setShares} />
            <div className="flex justify-between text-[15px] text-[#10201D] font-medium mt-5 pt-4 border-t border-[#EFE9D8]">
              <span>You'll owe {pool.organiser}</span>
              <span className="font-[JetBrains_Mono]">{money(owed)}</span>
            </div>
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
        <TopBar title="Your details" onBack={() => setStep("shares")} />
        <div className="flex-1 px-6 pt-2 pb-8">
          <Field label="Your name"><input className={inputCls} placeholder="e.g. Josh" value={pname} onChange={(e) => setPname(e.target.value)} autoFocus /></Field>
          <div className="bg-white rounded-xl px-4 py-3.5 text-[14px] text-[#3E5652] flex justify-between mb-4">
            <span>{shares} share{shares === 1 ? "" : "s"} · {pct(myPct)} of pool</span>
            <span className="font-[JetBrains_Mono] font-medium">{money(owed)} owed</span>
          </div>
          {error && <div className="flex items-center gap-2 text-[#C1473A] text-[13px] mb-4"><AlertCircle size={15} /> {error}</div>}
          <Button onClick={handleConfirm} disabled={!pname.trim() || saving || closed} icon={saving ? Loader2 : ArrowRight}>{saving ? "Saving…" : "Confirm my shares"}</Button>
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
          <div className="text-[13.5px] text-[#5B6B67]">{shares} share{shares === 1 ? "" : "s"} · {money(owed)} owed to {pool.organiser}</div>
        </TicketCard>
        <p className="text-[12.5px] text-[#8A968F] text-center mt-6 leading-relaxed">Keep your code — {pool.code} — to check back on the syndicate anytime.</p>
        <div className="w-full mt-8"><Button onClick={onDone} variant="ghost">Done</Button></div>
      </div>
    </Screen>
  );
}

/* ---------------------------------------------------------
   Read-only member view
--------------------------------------------------------- */

function ViewPool({ code, onBack }) {
  const [pool, setPool] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const refresh = useCallback(async () => {
    setRefreshing(true);
    setPool(await loadPool(code));
    setRefreshing(false);
  }, [code]);
  useEffect(() => { refresh(); }, [refresh]);

  if (!pool) return (<Screen><TopBar title="Loading…" onBack={onBack} /><div className="flex-1 flex items-center justify-center"><Loader2 className="animate-spin text-[#2F6F5E]" size={22} /></div></Screen>);

  const { totalShares } = totals(pool);
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
        {pool.entryDeadline && <DeadlineBadge deadline={pool.entryDeadline} />}
        <div className="text-[12px] uppercase tracking-wide text-[#6B7A76] mb-2.5 mt-1">Ticket photos</div>
        <div className="mb-6"><PhotoGallery photos={pool.ticketPhotos} editable={false} emptyHint="The organiser hasn't added ticket photos yet." /></div>
        <div className="text-[12px] uppercase tracking-wide text-[#6B7A76] mb-2.5">Members &amp; shares</div>
        <div className="space-y-2">
          {pool.participants.length === 0 && <div className="text-[13.5px] text-[#8A968F] bg-white rounded-xl px-4 py-6 text-center">No one has joined yet.</div>}
          {pool.participants.map((p) => {
            const share = totalShares ? (p.shares / totalShares) * 100 : 0;
            const winnings = pool.status === "drawn" ? (share / 100) * pool.actualWinnings : (share / 100) * pool.jackpot;
            return (
              <div key={p.id} className="bg-white rounded-xl px-4 py-3.5 flex items-center justify-between">
                <div><div className="text-[14.5px] text-[#10201D] font-medium">{p.name}</div><div className="text-[12px] text-[#8A968F]">{p.shares} share{p.shares === 1 ? "" : "s"} · {pct(share)}</div></div>
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

function Dashboard({ session, code, onBack, onSignIn }) {
  const [pool, setPool] = useState(null);
  const [copied, setCopied] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const [winningsInput, setWinningsInput] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const fileInputRef = useRef(null);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    setPool(await loadPool(code));
    setRefreshing(false);
  }, [code]);
  useEffect(() => { refresh(); }, [refresh]);

  if (!pool) return (<Screen><TopBar title="Loading…" onBack={onBack} /><div className="flex-1 flex items-center justify-center"><Loader2 className="animate-spin text-[#2F6F5E]" size={22} /></div></Screen>);

  const isOwner = session && session.user.id === pool.ownerId;
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

  const { totalShares, ticketCost, confirmed } = totals(pool);

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
  async function handleSubmitResults() {
    const amt = Number(winningsInput);
    if (!amt || amt < 0) return;
    await submitResults(code, amt);
    setShowResults(false);
    await refresh();
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

        {pool.entryDeadline && <DeadlineBadge deadline={pool.entryDeadline} />}

        <div className="flex items-center justify-between mb-2.5">
          <span className="text-[12px] uppercase tracking-wide text-[#6B7A76]">Ticket photos</span>
          <button onClick={() => fileInputRef.current?.click()} disabled={uploading} className="flex items-center gap-1.5 text-[#2F6F5E] text-[13px] font-medium disabled:opacity-50">
            {uploading ? <Loader2 size={14} className="animate-spin" /> : <ImagePlus size={14} />} {uploading ? "Uploading…" : "Add photos"}
          </button>
          <input ref={fileInputRef} type="file" accept="image/*" multiple capture="environment" className="hidden" onChange={handlePhotoSelect} />
        </div>
        {uploadError && <div className="flex items-center gap-2 text-[#C1473A] text-[13px] mb-2"><AlertCircle size={14} />{uploadError}</div>}
        <div className="mb-5"><PhotoGallery photos={pool.ticketPhotos} editable onRemove={handlePhotoRemove} emptyHint="Snap a photo of the purchased tickets so everyone can see them here." /></div>

        <div className="grid grid-cols-2 gap-3 mb-5">
          <div className="bg-white rounded-2xl p-4">
            <div className="flex items-center gap-1.5 text-[#6B7A76] text-[11px] uppercase tracking-wide mb-1"><Trophy size={12} className="text-[#C9982E]" />Jackpot</div>
            <div className="font-[Fraunces] text-[19px] text-[#10201D] font-medium">{money(pool.jackpot)}</div>
          </div>
          <div className="bg-white rounded-2xl p-4">
            <div className="flex items-center gap-1.5 text-[#6B7A76] text-[11px] uppercase tracking-wide mb-1"><Users size={12} />Participants</div>
            <div className="font-[Fraunces] text-[19px] text-[#10201D] font-medium">{pool.participants.length}</div>
          </div>
          <div className="bg-white rounded-2xl p-4">
            <div className="flex items-center gap-1.5 text-[#6B7A76] text-[11px] uppercase tracking-wide mb-1"><Ticket size={12} />Ticket cost</div>
            <div className="font-[JetBrains_Mono] text-[17px] text-[#10201D] font-medium">{money(ticketCost)}</div>
            <div className="text-[11px] text-[#8A968F] mt-0.5">{totalShares} shares × {money(pool.pricePerShare)}</div>
          </div>
          <div className="bg-white rounded-2xl p-4">
            <div className="flex items-center gap-1.5 text-[#6B7A76] text-[11px] uppercase tracking-wide mb-1"><TrendingUp size={12} />Confirmed received</div>
            <div className="font-[JetBrains_Mono] text-[17px] text-[#2F6F5E] font-medium">{money(confirmed)}</div>
          </div>
        </div>

        {pool.status !== "drawn" ? (
          <button onClick={() => setShowResults(true)} className="w-full flex items-center justify-between bg-[#10201D] text-[#F7F2E7] rounded-2xl px-5 py-4 mb-5">
            <span className="flex items-center gap-2 text-[14.5px] font-medium"><Clock size={16} className="text-[#C9982E]" />Enter draw results</span>
            <ChevronRight size={17} className="text-[#9FB0AC]" />
          </button>
        ) : (
          <div className="bg-[#10201D] rounded-2xl px-5 py-4 mb-5">
            <div className="flex items-center gap-2 text-[#C9982E] text-[12px] uppercase tracking-wide mb-1"><Sparkles size={13} />Actual winnings</div>
            <div className="font-[Fraunces] text-[26px] text-[#F7F2E7] font-medium">{money(pool.actualWinnings)}</div>
          </div>
        )}

        <div className="text-[12px] uppercase tracking-wide text-[#6B7A76] mb-2.5">Who owes what</div>
        <div className="space-y-2 mb-6">
          {pool.participants.length === 0 && <div className="text-[13.5px] text-[#8A968F] bg-white rounded-xl px-4 py-6 text-center">No one has joined yet — share your code to get started.</div>}
          {pool.participants.map((p) => {
            const share = totalShares ? (p.shares / totalShares) * 100 : 0;
            const winnings = pool.status === "drawn" ? (share / 100) * pool.actualWinnings : (share / 100) * pool.jackpot;
            return (
              <div key={p.id} className="bg-white rounded-xl px-4 py-3.5 flex items-center justify-between">
                <div><div className="text-[14.5px] text-[#10201D] font-medium">{p.name}</div><div className="text-[12px] text-[#8A968F]">{p.shares} share{p.shares === 1 ? "" : "s"} · {pct(share)}</div></div>
                <div className="text-right flex items-center gap-3">
                  <div><div className="font-[JetBrains_Mono] text-[14px] text-[#10201D] font-medium">{money(winnings)}</div></div>
                  <button onClick={() => togglePaid(p)} className={`text-[11px] px-2.5 py-1 rounded-full font-medium ${p.paid ? "bg-[#2F6F5E]/10 text-[#2F6F5E]" : "bg-[#C1473A]/10 text-[#C1473A]"}`}>{p.paid ? "Paid" : "Unpaid"}</button>
                </div>
              </div>
            );
          })}
        </div>
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
    </Screen>
  );
}

/* ---------------------------------------------------------
   Root — auth + hash router
--------------------------------------------------------- */

export default function App() {
  const [session, setSession] = useState(null);
  const [authReady, setAuthReady] = useState(false);
  const [myPools, setMyPools] = useState([]);

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
    if (session) loadOwnedPools(session.user.id).then(setMyPools);
    else setMyPools([]);
  }, [session]);

  const [route, setRoute] = useState({ name: "home" });
  useEffect(() => {
    function parseHash() {
      const h = window.location.hash.replace(/^#\/?/, "");
      const parts = h.split("/").filter(Boolean);
      if (parts[0] === "j" && parts[1]) return { name: "code-landing", code: parts[1] };
      if (parts[0] === "dashboard" && parts[1]) return { name: "dashboard", code: parts[1] };
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
  const [subRoute, setSubRoute] = useState(null);

  useEffect(() => {
    if (route.name === "code-landing") {
      loadPool(route.code).then((p) => {
        if (p) { setFoundPool(p); setSubRoute("landing"); } else { setSubRoute("code"); }
      });
    }
  }, [route]);

  if (!authReady) {
    return (<Screen dark><div className="flex-1 flex items-center justify-center"><Loader2 className="animate-spin text-[#C9982E]" size={22} /></div></Screen>);
  }

  if (route.name === "dashboard") {
    return <Dashboard session={session} code={route.code} onBack={goHome} onSignIn={() => { setSubRoute("signin"); window.location.hash = ""; }} />;
  }

  if (subRoute === "signin") {
    return <SignIn onBack={() => setSubRoute(null)} />;
  }

  if (route.name === "code-landing") {
    if (subRoute === "landing" && foundPool) {
      return <PoolLanding pool={foundPool} onBack={goHome} onJoin={() => setSubRoute("join")} onView={() => setSubRoute("view")} />;
    }
    if (subRoute === "join" && foundPool) {
      return <JoinPool initialPool={foundPool} onBack={() => setSubRoute("landing")} onDone={goHome} />;
    }
    if (subRoute === "view" && foundPool) {
      return <ViewPool code={foundPool.code} onBack={() => setSubRoute("landing")} />;
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
    return <CreatePool session={session} onBack={() => setSubRoute(null)} onCreated={(code) => goDashboard(code)} />;
  }
  return (
    <Home
      session={session}
      onCreate={() => setSubRoute("create")}
      onJoin={() => setSubRoute("code")}
      onSignIn={() => setSubRoute("signin")}
      onSignOut={async () => { await signOut(); setMyPools([]); }}
      myPools={myPools}
    />
  );
}
