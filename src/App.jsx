import React, { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "./supabaseClient";
import { Capacitor } from "@capacitor/core";
import { App as CapacitorApp } from "@capacitor/app";
import {
  Ticket, Users, Copy, Check, ArrowRight, ArrowLeft, PlusCircle, ImageOff, LogOut, HardDrive, MapPin, Mail, Star, Globe,
  TrendingUp, Trophy, Clock, Share2, Loader2, ShieldCheck,
  AlertCircle, ChevronRight, Sparkles, ImagePlus, X, Images, Eye, RefreshCw,
  LogIn, Lock, MessageCircle, Send, UserCircle, CheckSquare, Square, Trash2, Landmark, Download, PlusSquare, Smartphone, Pencil, UserX, BookOpen, UserPlus
} from "lucide-react";

// Custom URL scheme registered in Xcode (Target -> Info -> URL Types) so magic-link
// emails can hand control back to the native app instead of failing in Safari.
const NATIVE_AUTH_REDIRECT = "app.lottosyndicate://auth-callback";

// Your real hosted web address. Used for "invite a friend" share links instead of
// window.location.origin, because inside the native app that resolves to
// capacitor://localhost — a link nobody outside the app could ever open.
// TODO: double-check this matches your actual live domain.
const PROD_WEB_ORIGIN = "https://lottosyndicate.app";
function shareOrigin() {
  return Capacitor.isNativePlatform() ? PROD_WEB_ORIGIN : window.location.origin;
}

const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function genCode(len = 5) {
  let s = "";
  for (let i = 0; i < len; i++) s += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  return s;
}

function formatBytes(bytes) {
  if (!bytes) return "0 MB";
  const mb = bytes / (1024 * 1024);
  if (mb < 1000) return `${mb.toFixed(1)} MB`;
  return `${(mb / 1024).toFixed(2)} GB`;
}

const COUNTRIES = {
  AU: { name: "Australia", flag: "🇦🇺", currency: "AUD", symbol: "$", routingLabel: "BSB", quickLabel: "PayID" },
  UK: { name: "United Kingdom", flag: "🇬🇧", currency: "GBP", symbol: "£", routingLabel: "Sort code", quickLabel: null },
  US: { name: "United States", flag: "🇺🇸", currency: "USD", symbol: "US$", routingLabel: "Routing number", quickLabel: "Venmo / Zelle / Cash App" },
  NZ: { name: "New Zealand", flag: "🇳🇿", currency: "NZD", symbol: "NZ$", routingLabel: null, quickLabel: null },
  CA: { name: "Canada", flag: "🇨🇦", currency: "CAD", symbol: "CA$", routingLabel: "Institution / transit no.", quickLabel: "Interac e-Transfer" },
  IE: { name: "Ireland", flag: "🇮🇪", currency: "EUR", symbol: "€", routingLabel: null, quickLabel: null, usesIban: true },
};

function money(n, currency = "AUD") {
  if (n === null || n === undefined || isNaN(n)) n = 0;
  const symbol = Object.values(COUNTRIES).find((c) => c.currency === currency)?.symbol || "$";
  return `${symbol}${Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
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

function parseNameParts(name) {
  const match = name.match(/^(.*?)\s*[\("']["']?(.*?)["']?[\)"']?\s*$/);
  if (match && match[2]) {
    return { base: match[1].trim().toLowerCase(), nick: match[2].trim().toLowerCase() };
  }
  return { base: name.trim().toLowerCase(), nick: null };
}

function findPossibleDuplicates(participants, excludeIds) {
  const candidates = participants.filter((p) => !excludeIds.has(p.id));
  const keyToParticipants = {};
  candidates.forEach((p) => {
    const { base, nick } = parseNameParts(p.name);
    const keys = [base];
    if (nick) keys.push(nick);
    keys.forEach((k) => {
      if (!k) return;
      if (!keyToParticipants[k]) keyToParticipants[k] = [];
      keyToParticipants[k].push(p);
    });
  });
  const parent = {};
  function find(id) { if (parent[id] !== id) parent[id] = find(parent[id]); return parent[id]; }
  function union(a, b) { const ra = find(a), rb = find(b); if (ra !== rb) parent[ra] = rb; }
  candidates.forEach((p) => { parent[p.id] = p.id; });
  Object.values(keyToParticipants).forEach((group) => {
    if (group.length > 1) {
      for (let i = 1; i < group.length; i++) union(group[0].id, group[i].id);
    }
  });
  const groups = {};
  candidates.forEach((p) => {
    const root = find(p.id);
    if (!groups[root]) groups[root] = [];
    groups[root].push(p);
  });
  return Object.values(groups).filter((g) => g.length > 1);
}

function displayName(p) {
  return p.nickname ? `${p.name} ("${p.nickname}")` : p.name;
}

async function urlToImageData(url) {
  const response = await fetch(url);
  const blob = await response.blob();
  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
  const dims = await new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = reject;
    img.src = dataUrl;
  });
  return { dataUrl, ...dims };
}

function fitDimensions(pxW, pxH, maxW, maxH) {
  const ratio = pxW / pxH;
  let w = maxW, h = maxW / ratio;
  if (h > maxH) { h = maxH; w = maxH * ratio; }
  return { w, h };
}

async function addPhotoSectionToPdf(doc, photos, title, marginX) {
  if (!photos || photos.length === 0) return;
  doc.addPage();
  let y = 20;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.setTextColor(20);
  doc.text(title, marginX, y);
  y += 10;

  for (const photo of photos) {
    try {
      const { dataUrl, width, height } = await urlToImageData(photo.url);
      const { w, h } = fitDimensions(width, height, 180, 220);
      if (y + h > 280) { doc.addPage(); y = 20; }
      const format = dataUrl.includes("image/png") ? "PNG" : "JPEG";
      doc.addImage(dataUrl, format, marginX, y, w, h);
      y += h + 8;
    } catch (e) {
      // skip a photo that fails to load rather than breaking the whole PDF
      continue;
    }
  }
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
  doc.text(pool.status === "drawn" ? `Actual winnings: ${money(pool.actualWinnings, COUNTRIES[pool.country]?.currency)}` : `Jackpot estimate: ${money(pool.jackpot, COUNTRIES[pool.country]?.currency)}`, marginX, y);
  y += 8;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(80);
  doc.text(`Total pool contributed: ${money(totalAmount, COUNTRIES[pool.country]?.currency)}`, marginX, y);
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

  await addPhotoSectionToPdf(doc, pool.ticketPhotos, "Ticket Photos", marginX);
  await addPhotoSectionToPdf(doc, pool.resultPhotos, "Results & Winnings", marginX);

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
  const redirectTo = Capacitor.isNativePlatform() ? NATIVE_AUTH_REDIRECT : window.location.origin;
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: redirectTo },
  });
  if (error) throw error;
}

async function signInWithPassword(email, password) {
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
}

async function setAccountPassword(password) {
  const { error } = await supabase.auth.updateUser({ password });
  if (error) throw error;
}

async function signOut() {
  await supabase.auth.signOut();
}

// Permanently deletes the signed-in user's account. The actual deletion (removing the
// auth user, anonymising their participant records, dropping their profile) happens
// server-side in the "delete-account" Supabase Edge Function — the browser/app can't do
// this directly since it requires the service-role key. See supabase/functions/delete-account.
// The function will refuse (and return a descriptive error) if the user still organises
// any active syndicates, so they aren't left orphaned.
async function deleteMyAccount() {
  const { error } = await supabase.functions.invoke("delete-account", { method: "POST" });
  if (error) {
    // supabase-js surfaces the Edge Function's JSON error body on FunctionsHttpError.context
    let message = "Couldn't delete your account — try again, or contact support.";
    try {
      const body = await error.context?.json?.();
      if (body?.error) message = body.error;
    } catch (_e) {
      // ignore — fall back to the generic message above
    }
    throw new Error(message);
  }
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

async function createPool({ name, organiser, jackpot, drawDate, entryDeadline, ownerId, country = "AU" }) {
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
      country,
    });
    if (!error) return code;
    if (error.code !== "23505") throw error;
  }
  throw new Error("Could not generate a unique code, try again.");
}

async function requestPayout(participantId, code) {
  const { data: syn } = await supabase.from("syndicates").select("rolled_forward_to, status, entry_deadline, actual_winnings").eq("code", code).single();
  if (syn?.rolled_forward_to) {
    throw new Error("This syndicate has rolled forward — cash out from the new syndicate instead.");
  }
  if (syn?.status === "drawn") {
    // fine — this is the intended cash-out window, once the result is locked in
  } else if (syn?.entry_deadline && new Date(syn.entry_deadline).getTime() <= Date.now()) {
    throw new Error("Cash-out isn't available once entries have closed — it reopens once the draw result is entered.");
  }

  // lock in the fair amount now: contribution pre-draw, proportional winnings share once drawn
  const { data: allParticipants } = await supabase.from("participants").select("id, amount").eq("syndicate_code", code);
  const totalAmount = (allParticipants || []).reduce((s, p) => s + Number(p.amount || 0), 0);
  const mine = (allParticipants || []).find((p) => p.id === participantId);
  const myContribution = Number(mine?.amount || 0);
  const payoutAmount = syn?.status === "drawn" && totalAmount
    ? Math.round((myContribution / totalAmount) * Number(syn.actual_winnings || 0) * 100) / 100
    : myContribution;

  const { data: existing } = await supabase.from("payout_requests").select("id").eq("participant_id", participantId).is("paid", false).maybeSingle();
  if (existing) return existing.id;
  const { data, error } = await supabase.from("payout_requests").insert({ participant_id: participantId, syndicate_code: code, amount: payoutAmount }).select().single();
  if (error) throw error;
  await logActivity(code, `A participant requested a cash-out payout of ${money(payoutAmount)}.`);
  return data.id;
}

async function cancelPayoutRequest(requestId, code) {
  const { error } = await supabase.from("payout_requests").delete().eq("id", requestId).eq("paid", false);
  if (error) throw error;
  await logActivity(code, `A cash-out request was cancelled.`);
}

async function submitPayoutBankDetails(requestId, { bankName, accountName, bsb, accountNumber, payid }) {
  const { error } = await supabase.from("payout_requests").update({
    bank_name: bankName, account_name: accountName, bsb, account_number: accountNumber, payid,
  }).eq("id", requestId);
  if (error) throw error;
}

async function loadMyPayoutRequest(participantId) {
  const { data } = await supabase.from("payout_requests").select("*").eq("participant_id", participantId).order("requested_at", { ascending: false }).limit(1).maybeSingle();
  return data;
}

async function loadPayoutRequests(code) {
  const { data, error } = await supabase
    .from("payout_requests")
    .select("*, participant:participants!inner(id, name, amount, user_id)")
    .eq("syndicate_code", code)
    .eq("paid", false)
    .order("requested_at", { ascending: true });
  if (error || !data) return [];
  return data;
}

async function uploadPayoutProof(requestId, file) {
  const blob = await compressImageToBlob(file, 1200, 0.7);
  const path = `${requestId}-${Date.now()}.jpg`;
  const { error: uploadError } = await supabase.storage.from("payout-proofs").upload(path, blob, { contentType: "image/jpeg" });
  if (uploadError) throw uploadError;
  const { error } = await supabase.from("payout_requests").update({ proof_path: path }).eq("id", requestId);
  if (error) throw error;
  return path;
}

async function getSignedPayoutProofUrl(path) {
  const { data, error } = await supabase.storage.from("payout-proofs").createSignedUrl(path, 3600);
  if (error) throw error;
  return data.signedUrl;
}

async function markPayoutPaid(requestId, participantId, code) {
  const { data: p } = await supabase.from("participants").select("name").eq("id", participantId).single();
  const { data: req } = await supabase.from("payout_requests").select("amount").eq("id", requestId).single();
  const { error } = await supabase.from("payout_requests").update({ paid: true, paid_at: new Date().toISOString() }).eq("id", requestId);
  if (error) throw error;
  const { error: removeError } = await supabase.from("participants").delete().eq("id", participantId);
  if (removeError) throw removeError;
  await logActivity(code, `${p?.name || "A participant"} was paid out ${money(req?.amount || 0)} and left the syndicate.`);
}

async function submitContactMessage(name, email, message) {
  const { error } = await supabase.from("contact_messages").insert({ name, email, message });
  if (error) throw error;
}

async function loadContactMessages() {
  const { data, error } = await supabase.from("contact_messages").select("*").order("created_at", { ascending: false });
  if (error || !data) return [];
  return data;
}

async function markContactMessageRead(id) {
  const { error } = await supabase.from("contact_messages").update({ read: true }).eq("id", id);
  if (error) throw error;
}

async function deleteContactMessage(id) {
  const { error } = await supabase.from("contact_messages").delete().eq("id", id);
  if (error) throw error;
}

async function submitReview(userId, name, rating, body) {
  const { error } = await supabase.from("reviews").insert({ user_id: userId, name, rating, body });
  if (error) throw error;
}

async function loadRecentWinners(limit = 12) {
  const { data, error } = await supabase
    .from("syndicates")
    .select("name, actual_winnings, draw_date, country, win_city, win_region, win_country")
    .eq("status", "drawn")
    .gt("actual_winnings", 0)
    .is("deleted_at", null)
    .order("draw_date", { ascending: false })
    .limit(limit);
  if (error || !data) return [];
  return data;
}

async function loadApprovedReviews(limit = 20) {
  const { data, error } = await supabase.from("reviews").select("*").eq("approved", true).order("created_at", { ascending: false }).limit(limit);
  if (error || !data) return [];
  return data;
}

async function loadPendingReviews() {
  const { data, error } = await supabase.from("reviews").select("*").eq("approved", false).order("created_at", { ascending: false });
  if (error || !data) return [];
  return data;
}

async function approveReview(id) {
  const { error } = await supabase.from("reviews").update({ approved: true }).eq("id", id);
  if (error) throw error;
}

async function deleteReview(id) {
  const { error } = await supabase.from("reviews").delete().eq("id", id);
  if (error) throw error;
}

async function logActivity(code, message) {
  try {
    await supabase.from("activity_log").insert({ syndicate_code: code, message });
  } catch (e) {
    console.error("Activity log failed (non-fatal):", e);
  }
}

async function loadActivityLog(code) {
  const { data, error } = await supabase
    .from("activity_log")
    .select("id, message, created_at")
    .eq("syndicate_code", code)
    .order("created_at", { ascending: false });
  if (error) return [];
  return data;
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
  const { data: resultPhotos } = await supabase.from("result_photos").select("*").eq("syndicate_code", code).order("uploaded_at", { ascending: true });
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
    country: syn.country || "AU",
    participants: (parts || []).map((p) => ({
      id: p.id, name: p.name, amount: Number(p.amount || 0), paid: p.paid, paidAt: p.paid_at, userId: p.user_id,
      nickname: profileMap[p.user_id]?.nickname || null,
      avatarUrl: profileMap[p.user_id]?.avatar_url || null,
      receiptPath: receiptMap[p.id] || null,
    })),
    ticketPhotos: (photos || []).map((ph) => ({ id: ph.id, url: ph.url })),
    resultPhotos: (resultPhotos || []).map((ph) => ({ id: ph.id, url: ph.url })),
  };
}

async function loadOwnedPools(ownerId) {
  const { data, error } = await supabase
    .from("syndicates")
    .select("code,name,rolled_forward_to,entry_deadline,status,actual_winnings,country")
    .eq("owner_id", ownerId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false });
  if (error) return [];
  return data.map((s) => ({
    code: s.code,
    name: s.name,
    rolledForwardTo: s.rolled_forward_to,
    entryDeadline: s.entry_deadline,
    status: s.status,
    actualWinnings: s.actual_winnings !== null ? Number(s.actual_winnings) : null,
    country: s.country || "AU",
  }));
}

// Per syndicate code: how many participants remain (used to tell whether a drawn syndicate
// has had every member paid out and closed off) and their combined contributions (used to
// show a pool-size total on the syndicate list).
async function loadParticipantAggregates(codes) {
  if (!codes || codes.length === 0) return {};
  const { data, error } = await supabase.from("participants").select("syndicate_code, amount").in("syndicate_code", codes);
  if (error || !data) return {};
  const aggregates = {};
  data.forEach((r) => {
    if (!aggregates[r.syndicate_code]) aggregates[r.syndicate_code] = { count: 0, total: 0 };
    aggregates[r.syndicate_code].count += 1;
    aggregates[r.syndicate_code].total += Number(r.amount || 0);
  });
  return aggregates;
}

async function loadMemberships(userId) {
  const { data, error } = await supabase
    .from("participants")
    .select("amount, syndicate:syndicates!inner(code,name,jackpot,status,actual_winnings,deleted_at,rolled_forward_to,entry_deadline,country)")
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
      rolledForwardTo: r.syndicate.rolled_forward_to,
      entryDeadline: r.syndicate.entry_deadline,
      country: r.syndicate.country || "AU",
    }));
}

async function mergeParticipantGroup(code, ids, keepId, keepName) {
  const { data, error } = await supabase.from("participants").select("id, name, amount").in("id", ids);
  if (error) throw error;
  const total = data.reduce((s, p) => s + Number(p.amount || 0), 0);
  const otherIds = ids.filter((id) => id !== keepId);
  const { error: updateError } = await supabase.from("participants").update({ amount: total, name: keepName, paid: false }).eq("id", keepId);
  if (updateError) throw updateError;
  if (otherIds.length > 0) {
    const { error: deleteError } = await supabase.from("participants").delete().in("id", otherIds);
    if (deleteError) throw deleteError;
  }
  const names = data.map((p) => `${p.name} (${money(p.amount)})`).join(" + ");
  await logActivity(code, `Merged duplicate entries into "${keepName}": ${names} → total ${money(total)}.`);
}

async function mergeParticipantAmount(code, participantId, additionalAmount) {
  const { data, error } = await supabase.from("participants").select("name, amount").eq("id", participantId).single();
  if (error) throw error;
  const oldAmount = Number(data.amount || 0);
  const newAmount = oldAmount + additionalAmount;
  // paid resets to false: the new portion hasn't been confirmed received yet,
  // even though the earlier (e.g. rolled-over) portion may have been.
  const { data: updated, error: updateError } = await supabase
    .from("participants")
    .update({ amount: newAmount, paid: false })
    .eq("id", participantId)
    .select();
  if (updateError) throw updateError;
  if (!updated || updated.length === 0) {
    throw new Error("Couldn't update your contribution — please contact the organiser.");
  }
  await logActivity(code, `${data.name} topped up: ${money(oldAmount)} + ${money(additionalAmount)} = ${money(newAmount)}.`);
  return participantId;
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
  await logActivity(code, `${name} joined and contributed ${money(amount)}${paid ? " (marked paid)" : ""}.`);
  return data.id;
}

async function loadIsAdmin(userId) {
  if (!userId) return false;
  const { data, error } = await supabase.from("admins").select("id").eq("id", userId).maybeSingle();
  if (error || !data) return false;
  return true;
}

/* ---------------------------------------------------------
   Comped (free-access) emails — admin can grant specific email
   addresses free access that bypasses the Stripe fee entirely.
--------------------------------------------------------- */

async function isEmailComped(email) {
  if (!email) return false;
  const { data, error } = await supabase.from("comped_emails").select("email").eq("email", email.toLowerCase().trim()).maybeSingle();
  if (error || !data) return false;
  return true;
}

async function loadCompedEmails() {
  const { data, error } = await supabase.from("comped_emails").select("email, added_at").order("added_at", { ascending: false });
  if (error || !data) return [];
  return data;
}

// Accepts a raw block of pasted text and adds every valid-looking email found in it
// (comma, space, newline, or semicolon separated). Returns how many were added.
async function addCompedEmails(rawText) {
  const found = (rawText.match(/[^\s,;]+@[^\s,;]+\.[^\s,;]+/g) || []).map((e) => e.toLowerCase().trim());
  const unique = [...new Set(found)];
  if (unique.length === 0) return 0;
  const { error } = await supabase.from("comped_emails").upsert(unique.map((email) => ({ email })), { onConflict: "email" });
  if (error) throw error;
  return unique.length;
}

async function removeCompedEmail(email) {
  const { error } = await supabase.from("comped_emails").delete().eq("email", email);
  if (error) throw error;
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
  async function countAllTime() {
    const { count } = await supabase.from("page_views").select("*", { count: "exact", head: true });
    return count || 0;
  }
  async function uniqueAllTime() {
    const { data } = await supabase.from("page_views").select("visitor_id");
    return new Set((data || []).map((r) => r.visitor_id)).size;
  }

  const [dayViews, weekViews, monthViews, allTimeViews, dayUnique, weekUnique, monthUnique, allTimeUnique] = await Promise.all([
    countSince(startOfDay.toISOString()),
    countSince(startOfWeek.toISOString()),
    countSince(startOfMonth.toISOString()),
    countAllTime(),
    uniqueSince(startOfDay.toISOString()),
    uniqueSince(startOfWeek.toISOString()),
    uniqueSince(startOfMonth.toISOString()),
    uniqueAllTime(),
  ]);

  return {
    day: { views: dayViews, unique: dayUnique },
    week: { views: weekViews, unique: weekUnique },
    month: { views: monthViews, unique: monthUnique },
    allTime: { views: allTimeViews, unique: allTimeUnique },
  };
}

async function loadVisitorLocations() {
  const { data, error } = await supabase.from("page_views").select("country, region, city").not("country", "is", null);
  if (error || !data) return { countries: [], cities: [] };

  const countryCounts = {};
  const cityCounts = {};
  data.forEach((row) => {
    if (row.country) countryCounts[row.country] = (countryCounts[row.country] || 0) + 1;
    if (row.city && row.country) {
      const key = `${row.city}, ${row.region ? row.region + ", " : ""}${row.country}`;
      cityCounts[key] = (cityCounts[key] || 0) + 1;
    }
  });

  const countries = Object.entries(countryCounts).sort((a, b) => b[1] - a[1]).map(([name, count]) => ({ name, count }));
  const cities = Object.entries(cityCounts).sort((a, b) => b[1] - a[1]).slice(0, 15).map(([name, count]) => ({ name, count }));
  return { countries, cities };
}

async function getBucketUsage(bucketName) {
  let totalBytes = 0;
  let fileCount = 0;

  async function scanFolder(prefix) {
    const { data, error } = await supabase.storage.from(bucketName).list(prefix, { limit: 1000 });
    if (error || !data) return;
    for (const item of data) {
      if (item.id === null) {
        // no id means this is a folder, not a file — recurse into it
        const subPrefix = prefix ? `${prefix}/${item.name}` : item.name;
        await scanFolder(subPrefix);
      } else {
        totalBytes += item.metadata?.size || 0;
        fileCount++;
      }
    }
  }

  await scanFolder("");
  return { bytes: totalBytes, count: fileCount };
}

async function getAllStorageUsage() {
  const buckets = ["ticket-photos", "avatars", "payment-receipts", "payout-proofs"];
  const results = await Promise.all(buckets.map((b) => getBucketUsage(b)));
  const byBucket = {};
  let totalBytes = 0, totalCount = 0;
  buckets.forEach((b, i) => {
    byBucket[b] = results[i];
    totalBytes += results[i].bytes;
    totalCount += results[i].count;
  });
  return { byBucket, totalBytes, totalCount };
}

async function loadAllUserEmails() {
  const { data, error } = await supabase.rpc("admin_list_user_emails");
  if (error || !data) return [];
  return data;
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

async function savePaymentDetails(code, { bankName, accountName, bsb, accountNumber, payid, iban, bic }) {
  const { error } = await supabase.from("payment_details").upsert({
    syndicate_code: code, bank_name: bankName, account_name: accountName, bsb, account_number: accountNumber, payid, iban, bic,
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

async function updateParticipantAmount(code, id, amount) {
  const { data: before } = await supabase.from("participants").select("name, amount").eq("id", id).single();
  const { error } = await supabase.from("participants").update({ amount }).eq("id", id);
  if (error) throw error;
  const name = before?.name || "Someone";
  await logActivity(code, `Organiser changed ${name}'s amount from ${money(before?.amount || 0)} to ${money(amount)}.`);
}

async function removeParticipant(code, id) {
  const { data: before } = await supabase.from("participants").select("name, amount").eq("id", id).single();
  const { error } = await supabase.from("participants").delete().eq("id", id);
  if (error) throw error;
  await logActivity(code, `Organiser removed ${before?.name || "a participant"} (${money(before?.amount || 0)}).`);
}

async function updateSyndicateName(code, name) {
  const { error } = await supabase.from("syndicates").update({ name }).eq("code", code);
  if (error) throw error;
}

async function updateEntryDeadline(code, entryDeadlineIso) {
  const { error } = await supabase.from("syndicates").update({ entry_deadline: entryDeadlineIso }).eq("code", code);
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
  await logActivity(code, "A ticket photo was added.");
}

async function removeTicketPhoto(id) {
  const { data: before } = await supabase.from("ticket_photos").select("syndicate_code").eq("id", id).single();
  const { error } = await supabase.from("ticket_photos").delete().eq("id", id);
  if (error) throw error;
  if (before?.syndicate_code) await logActivity(before.syndicate_code, "A ticket photo was removed.");
}

async function uploadResultPhoto(code, file) {
  const blob = await compressImageToBlob(file);
  const path = `${code}/${crypto.randomUUID()}.jpg`;
  const { error: upErr } = await supabase.storage.from("result-photos").upload(path, blob, { contentType: "image/jpeg" });
  if (upErr) throw upErr;
  const { data: pub } = supabase.storage.from("result-photos").getPublicUrl(path);
  const { error: dbErr } = await supabase.from("result_photos").insert({ syndicate_code: code, url: pub.publicUrl });
  if (dbErr) throw dbErr;
  await logActivity(code, "A results/winnings photo was added.");
}

async function removeResultPhoto(id) {
  const { data: before } = await supabase.from("result_photos").select("syndicate_code").eq("id", id).single();
  const { error } = await supabase.from("result_photos").delete().eq("id", id);
  if (error) throw error;
  if (before?.syndicate_code) await logActivity(before.syndicate_code, "A results/winnings photo was removed.");
}

async function rolloverSyndicate(oldPool, { jackpot, drawDate, entryDeadline, carryMembers, carryPaymentDetails, ownerId }) {
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

  if (carryPaymentDetails) {
    const oldDetails = await loadPaymentDetails(oldPool.code);
    if (oldDetails) {
      await savePaymentDetails(newCode, {
        bankName: oldDetails.bank_name, accountName: oldDetails.account_name,
        bsb: oldDetails.bsb, accountNumber: oldDetails.account_number, payid: oldDetails.payid,
      });
      await logActivity(newCode, `Payment details carried over from ${oldPool.code}.`);
    }
  }

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
      await logActivity(newCode, `${p.name} rolled over ${money(rolledAmount)} from ${oldPool.code} (${oldPool.name}).`);
    }
  }
  await logActivity(newCode, `Syndicate rolled over from ${oldPool.code} — ${money(oldPool.actualWinnings || 0)} total winnings carried in.`);
  await logActivity(oldPool.code, `Rolled forward into new syndicate ${newCode}.`);
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

function formatCompactCountdown(ms) {
  if (ms <= 0) return "Closed";
  const totalMin = Math.floor(ms / 60000);
  const d = Math.floor(totalMin / 1440);
  const h = Math.floor((totalMin % 1440) / 60);
  const m = totalMin % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function MiniCountdown({ deadline }) {
  const diff = useCountdown(deadline);
  if (diff === null) return null;
  const urgent = diff > 0 && diff < 60 * 60 * 1000; // under 60 minutes left
  const closed = diff <= 0;
  return (
    <span className={`text-[11px] font-[JetBrains_Mono] shrink-0 ${
      closed || urgent ? "font-bold text-[#C1473A]" : "font-medium text-[#3F9E72]"
    } ${urgent ? "animate-pulse" : ""}`}>
      {!closed && "Open "}{formatCompactCountdown(diff)}
    </span>
  );
}

// Decides what status badge (if any) a syndicate should show in the "syndicates you
// organise / are in" lists, in place of the live entry countdown. Returns null when the
// syndicate is still open for entries — callers should fall back to <MiniCountdown /> then.
function getPoolBadge(p) {
  if (p.rolledForwardTo) return { text: "Rolled Over", className: "text-[#C1473A]" };
  if (p.status === "drawn") {
    if (!p.actualWinnings) return { text: "Closed No Winnings", className: "text-[#C1473A]" };
    if ((p.participantCount || 0) === 0) return { text: "Paid Out Closed", className: "text-[#C1473A]" };
    return null;
  }
  if (p.entryDeadline && new Date(p.entryDeadline).getTime() <= Date.now()) {
    return { text: "Awaiting Results", className: "text-[#C9982E]" };
  }
  return null;
}

// True once a syndicate is "done" — rolled into a new one, drawn with no winnings, or
// drawn and fully paid out — meaning it belongs in the collapsed "completed" list rather
// than the main active list.
function isPoolClosed(p) {
  if (p.rolledForwardTo) return true;
  if (p.status === "drawn" && (!p.actualWinnings || (p.participantCount || 0) === 0)) return true;
  return false;
}

function DeadlineBadge({ deadline, drawDate }) {
  const diff = useCountdown(deadline);
  if (diff === null) return null;
  const closed = diff <= 0;
  const urgent = !closed && diff < 60 * 60 * 1000;
  const accent = closed || urgent ? "#C1473A" : "#3F9E72";
  const formattedDrawDate = drawDate
    ? new Date(drawDate + "T00:00:00").toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" })
    : null;
  return (
    <div className="rounded-xl px-3.5 py-2.5 mb-4" style={{ background: `${accent}14` }}>
      <div className="flex items-center gap-2">
        <Clock size={15} className="shrink-0" style={{ color: accent }} />
        {closed ? (
          <span className="text-[16px] font-bold" style={{ color: accent }}>Entries are closed</span>
        ) : (
          <span className="text-[13px] text-[#8A6A15]">
            Entries close in <span className={`text-[18px] font-bold ${urgent ? "animate-pulse" : ""}`} style={{ color: accent }}>{formatCountdown(diff)}</span>
          </span>
        )}
      </div>
      {formattedDrawDate && (
        <div className="flex items-center gap-2 mt-1.5 pt-1.5 border-t" style={{ borderColor: `${accent}26` }}>
          <Ticket size={14} className="shrink-0" style={{ color: accent }} />
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
    <div
      className={`sticky top-0 z-20 flex items-center justify-between px-5 pb-4 ${dark ? "bg-[#10201D] text-[#F7F2E7]" : "bg-[#F7F2E7] text-[#10201D]"}`}
      style={{ paddingTop: "calc(1.5rem + env(safe-area-inset-top, 0px))" }}
    >
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

function ThumbnailImage({ src, alt }) {
  const [attempt, setAttempt] = useState(0);
  const [failed, setFailed] = useState(false);

  function handleError() {
    if (attempt < 3) {
      // retry with a brief delay and a cache-busting param — handles the case
      // where the image genuinely just stalled loading amid several at once
      setTimeout(() => setAttempt((a) => a + 1), 600 * (attempt + 1));
    } else {
      setFailed(true);
    }
  }

  if (failed) {
    return (
      <div className="w-full h-full flex items-center justify-center">
        <ImageOff size={18} className="text-[#8A968F]" />
      </div>
    );
  }

  const retrySrc = attempt === 0 ? src : `${src}${src.includes("?") ? "&" : "?"}retry=${attempt}`;
  return <img key={attempt} src={retrySrc} alt={alt} className="w-full h-full object-cover" onError={handleError} />;
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
              <ThumbnailImage src={p.url} alt="Ticket" />
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
  const [mode, setMode] = useState("link"); // "link" | "password"
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [sent, setSent] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");

  async function handleSend() {
    if (!email.trim()) return;
    // Release the keyboard/text-input session before this field disappears from the
    // screen — on iOS WKWebView, swapping screens while a field is still focused can
    // leave the native text-input session stuck, which can swallow taps afterwards
    // (including the "Check your email" screen's back button).
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
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

  async function handlePasswordSignIn() {
    if (!email.trim() || !password) return;
    setSending(true);
    setError("");
    try {
      await signInWithPassword(email.trim(), password);
      onBack();
    } catch (e) {
      setError(
        e.message && e.message.toLowerCase().includes("invalid")
          ? "Incorrect email or password — or you haven'''t set a password yet. Try the email link instead, then set one from your profile."
          : (e.message || "Couldn'''t sign in. Try again.")
      );
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
        <div className="flex bg-white rounded-xl p-1 mb-5">
          <button onClick={() => { setMode("link"); setError(""); }} className={`flex-1 text-[13px] font-medium py-2 rounded-lg ${mode === "link" ? "bg-[#2F6F5E] text-white" : "text-[#6B7A76]"}`}>Email link</button>
          <button onClick={() => { setMode("password"); setError(""); }} className={`flex-1 text-[13px] font-medium py-2 rounded-lg ${mode === "password" ? "bg-[#2F6F5E] text-white" : "text-[#6B7A76]"}`}>Password</button>
        </div>

        {mode === "link" ? (
          <>
            <p className="text-[#5B6B67] text-[14.5px] leading-relaxed mb-6">Enter your email — we'll send a link to sign in, no password needed. Use the same email each time to keep track of all your syndicates.</p>
            <Field label="Email">
              <input className={inputCls} type="email" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
            </Field>
            {error && <div className="flex items-center gap-2 text-[#C1473A] text-[13px] mb-4"><AlertCircle size={15} /> {error}</div>}
            <Button onClick={handleSend} disabled={!email.trim() || sending} icon={sending ? Loader2 : ArrowRight}>{sending ? "Sending…" : "Send sign-in link"}</Button>
          </>
        ) : (
          <>
            <p className="text-[#5B6B67] text-[14.5px] leading-relaxed mb-6">Sign in with your email and password. Haven't set a password yet? Use the email link once, then set one from your profile.</p>
            <Field label="Email">
              <input className={inputCls} type="email" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
            </Field>
            <Field label="Password">
              <input className={inputCls} type="password" placeholder="••••••••" value={password} onChange={(e) => setPassword(e.target.value)} />
            </Field>
            {error && <div className="flex items-center gap-2 text-[#C1473A] text-[13px] mb-4"><AlertCircle size={15} /> {error}</div>}
            <Button onClick={handlePasswordSignIn} disabled={!email.trim() || !password || sending} icon={sending ? Loader2 : ArrowRight}>{sending ? "Signing in…" : "Sign in"}</Button>
          </>
        )}
      </div>
    </Screen>
  );
}

/* ---------------------------------------------------------
   Profile
--------------------------------------------------------- */

function ProfileScreen({ session, onBack, onAccountDeleted }) {
  const [nickname, setNickname] = useState("");
  const [avatarUrl, setAvatarUrl] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const fileRef = useRef(null);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [passwordSaved, setPasswordSaved] = useState(false);
  const [passwordError, setPasswordError] = useState("");
  const [showDeleteAccountConfirm, setShowDeleteAccountConfirm] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const [deletingAccount, setDeletingAccount] = useState(false);
  const [deleteAccountError, setDeleteAccountError] = useState("");

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

  async function handleSetPassword() {
    setPasswordError("");
    if (newPassword.length < 6) {
      setPasswordError("Password should be at least 6 characters.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError("Passwords don't match.");
      return;
    }
    setPasswordSaving(true);
    try {
      await setAccountPassword(newPassword);
      setNewPassword("");
      setConfirmPassword("");
      setPasswordSaved(true);
      setTimeout(() => setPasswordSaved(false), 2200);
    } catch (e) {
      setPasswordError(e.message || "Couldn't set your password — try again.");
    } finally {
      setPasswordSaving(false);
    }
  }

  async function handleDeleteAccount() {
    setDeletingAccount(true);
    setDeleteAccountError("");
    try {
      await deleteMyAccount();
      await signOut();
      setShowDeleteAccountConfirm(false);
      onAccountDeleted?.();
    } catch (err) {
      setDeleteAccountError(err.message || "Couldn't delete your account — try again, or contact support.");
    } finally {
      setDeletingAccount(false);
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

        <div className="mt-8 pt-6 border-t border-[#EFE9D8]">
          <div className="text-[12px] uppercase tracking-wide text-[#6B7A76] mb-2">Password sign-in</div>
          <p className="text-[12.5px] text-[#8A968F] mb-4">Optional — set a password if you'd rather not wait for an email link every time. Your email link will still always work too.</p>
          <Field label="New password"><input className={inputCls} type="password" placeholder="At least 6 characters" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} /></Field>
          <Field label="Confirm password"><input className={inputCls} type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} /></Field>
          {passwordError && <div className="flex items-center gap-2 text-[#C1473A] text-[13px] mb-4"><AlertCircle size={15} /> {passwordError}</div>}
          <Button variant="ghost" onClick={handleSetPassword} disabled={!newPassword || passwordSaving} icon={passwordSaving ? Loader2 : passwordSaved ? Check : undefined}>
            {passwordSaving ? "Saving…" : passwordSaved ? "Password set" : "Set password"}
          </Button>
        </div>

        <div className="mt-8 pt-6 border-t border-[#EFE9D8]">
          <div className="text-[12px] uppercase tracking-wide text-[#C1473A] mb-2">Danger zone</div>
          <p className="text-[12.5px] text-[#8A968F] mb-4 leading-relaxed">
            Permanently deletes your login and profile. Contributions you've already made stay visible to other members of syndicates you're part of, but are no longer linked to your account.
          </p>
          {deleteAccountError && <div className="flex items-center gap-2 text-[#C1473A] text-[13px] mb-4"><AlertCircle size={15} /> {deleteAccountError}</div>}
          <button
            onClick={() => { setDeleteAccountError(""); setDeleteConfirmText(""); setShowDeleteAccountConfirm(true); }}
            className="flex items-center gap-2 text-[#C1473A] text-[13.5px] font-medium"
          >
            <Trash2 size={15} /> Delete my account
          </button>
        </div>
      </div>

      {showDeleteAccountConfirm && (
        <div className="fixed inset-0 z-30 flex items-end justify-center bg-black/40" onClick={() => !deletingAccount && setShowDeleteAccountConfirm(false)}>
          <div className="w-full max-w-[430px] bg-[#F7F2E7] rounded-t-3xl p-6 pb-8" onClick={(e) => e.stopPropagation()}>
            <div className="w-10 h-1 rounded-full bg-[#D8D0BC] mx-auto mb-5" />
            <h3 className="font-[Fraunces] text-[19px] text-[#10201D] font-medium mb-1">Delete your account?</h3>
            <p className="text-[13px] text-[#6B7A76] mb-4 leading-relaxed">
              This can't be undone. If you still organise any active syndicates, delete or hand those over first — this won't go through until you do.
            </p>
            <Field label="Type DELETE to confirm">
              <input
                className={inputCls}
                value={deleteConfirmText}
                onChange={(e) => setDeleteConfirmText(e.target.value)}
                placeholder="DELETE"
                autoCapitalize="characters"
                autoCorrect="off"
              />
            </Field>
            {deleteAccountError && <div className="flex items-center gap-2 text-[#C1473A] text-[13px] mb-4"><AlertCircle size={15} /> {deleteAccountError}</div>}
            <div className="flex gap-3">
              <Button variant="ghost" onClick={() => setShowDeleteAccountConfirm(false)} disabled={deletingAccount}>Cancel</Button>
              <Button
                onClick={handleDeleteAccount}
                disabled={deleteConfirmText.trim().toUpperCase() !== "DELETE" || deletingAccount}
                icon={deletingAccount ? Loader2 : Trash2}
              >
                {deletingAccount ? "Deleting…" : "Permanently delete"}
              </Button>
            </div>
          </div>
        </div>
      )}
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
      <div className="px-4 pt-2 sticky bottom-0 bg-[#F7F2E7]" style={{ paddingBottom: "calc(1rem + env(safe-area-inset-bottom, 0px))" }}>
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
          "Syndicate details you enter — syndicate names, contribution amounts, payment status, and any photos you upload, such as ticket photos, result photos, or payment screenshots used as a receipt.",
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
          "Syndicate is built on Supabase (database and authentication), Vercel (website hosting), and Stripe (payment processing for the service fee described in our Pricing & Refunds page). These providers may store data on servers located outside Australia. By using Syndicate, you consent to this overseas storage. Stripe processes your payment card details directly during checkout — we do not receive or store your full card number.",
        ],
      },
      {
        h: "Data retention",
        p: [
          "If an organiser deletes a syndicate, it is archived rather than immediately erased, and may be retained for a reasonable period for record-keeping and legal purposes.",
        ],
      },
      {
        h: "Deleting your account",
        p: [
          "You can permanently delete your account at any time from your profile screen. This removes your login and profile, including your nickname and photo. Contribution and chat records you've left in syndicates you belong to are kept so other members retain an accurate history of who paid what, but are no longer linked to your identity once your account is deleted.",
          "You can't delete your account while you still organise an active syndicate — delete or complete that syndicate first, so the people relying on it aren't left without an organiser.",
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
        h: "Fair use — one syndicate per draw",
        p: [
          "Each syndicate is intended to cover a single lottery draw. Once a syndicate's result has been recorded, it is closed to new entries — starting a new draw requires creating a new syndicate or using the paid roll-over feature, each of which carries the service fee described in our Pricing & Refunds page.",
          "Reusing or extending a single syndicate to cover multiple draws without creating a new syndicate or rolling over — including repeatedly changing its entry deadline to avoid the applicable fee — is not permitted and is treated as a breach of these terms.",
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
          "A flat service fee of $3 AUD (inclusive of GST where applicable) applies when an organiser creates a syndicate. This fee is charged for access to the Syndicate coordination tool, and is separate from — and never part of — any lottery ticket price or prize money.",
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
  const [visitorLocations, setVisitorLocations] = useState(null);
  const [storageUsage, setStorageUsage] = useState(null);
  const [storageLoading, setStorageLoading] = useState(false);
  const [pendingReviews, setPendingReviews] = useState([]);
  const [reviewActionLoading, setReviewActionLoading] = useState(null);
  const [contactMessages, setContactMessages] = useState([]);
  const [contactActionLoading, setContactActionLoading] = useState(null);

  async function refreshContactMessages() {
    setContactMessages(await loadContactMessages());
  }

  async function handleMarkContactRead(id) {
    setContactActionLoading(id);
    try {
      await markContactMessageRead(id);
      await refreshContactMessages();
    } finally {
      setContactActionLoading(null);
    }
  }

  async function handleDeleteContact(id) {
    setContactActionLoading(id);
    try {
      await deleteContactMessage(id);
      await refreshContactMessages();
    } finally {
      setContactActionLoading(null);
    }
  }

  async function refreshPendingReviews() {
    setPendingReviews(await loadPendingReviews());
  }

  async function handleApproveReview(id) {
    setReviewActionLoading(id);
    try {
      await approveReview(id);
      await refreshPendingReviews();
    } finally {
      setReviewActionLoading(null);
    }
  }

  async function handleDeleteReview(id) {
    setReviewActionLoading(id);
    try {
      await deleteReview(id);
      await refreshPendingReviews();
    } finally {
      setReviewActionLoading(null);
    }
  }

  const [userEmails, setUserEmails] = useState(null);
  const [emailsLoading, setEmailsLoading] = useState(false);
  const [emailsCopied, setEmailsCopied] = useState(false);

  async function loadEmailsList() {
    setEmailsLoading(true);
    try {
      setUserEmails(await loadAllUserEmails());
    } finally {
      setEmailsLoading(false);
    }
  }

  async function copyAllEmails() {
    if (!userEmails || userEmails.length === 0) return;
    const text = userEmails.map((u) => u.email).join(", ");
    await navigator.clipboard.writeText(text);
    setEmailsCopied(true);
    setTimeout(() => setEmailsCopied(false), 2000);
  }

  const [compedEmails, setCompedEmails] = useState([]);
  const [compedLoading, setCompedLoading] = useState(true);
  const [compedInput, setCompedInput] = useState("");
  const [compedSaving, setCompedSaving] = useState(false);
  const [compedError, setCompedError] = useState("");
  const [compedRemoving, setCompedRemoving] = useState(null);

  async function refreshCompedEmails() {
    setCompedLoading(true);
    try {
      setCompedEmails(await loadCompedEmails());
    } finally {
      setCompedLoading(false);
    }
  }

  useEffect(() => { refreshCompedEmails(); }, []);

  async function handleGrantFreeAccess() {
    setCompedSaving(true);
    setCompedError("");
    try {
      const added = await addCompedEmails(compedInput);
      if (added === 0) {
        setCompedError("Couldn't find any valid email addresses in that text.");
      } else {
        setCompedInput("");
        await refreshCompedEmails();
      }
    } catch (e) {
      setCompedError(e.message || "Something went wrong granting free access.");
    } finally {
      setCompedSaving(false);
    }
  }

  async function handleRevokeFreeAccess(email) {
    setCompedRemoving(email);
    try {
      await removeCompedEmail(email);
      await refreshCompedEmails();
    } finally {
      setCompedRemoving(null);
    }
  }


  async function checkStorageUsage() {
    setStorageLoading(true);
    try {
      setStorageUsage(await getAllStorageUsage());
    } finally {
      setStorageLoading(false);
    }
  }

  const refresh = useCallback(async () => {
    setLoading(true);
    const [s, list, v, loc, reviews, contacts] = await Promise.all([loadAdminStats(), loadAllSyndicates({ includeDeleted: showDeleted }), loadVisitorStats(), loadVisitorLocations(), loadPendingReviews(), loadContactMessages()]);
    setStats(s);
    setVisitorLocations(loc);
    setSyndicates(list);
    setVisitorStats(v);
    setPendingReviews(reviews);
    setContactMessages(contacts);
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
            <>
              <div className="bg-[#10201D] rounded-xl p-3 mb-2">
                <div className="text-[10.5px] uppercase tracking-wide text-[#C9982E] mb-1">All time</div>
                <div className="font-[Fraunces] text-[22px] text-white font-medium leading-none mb-1">{visitorStats.allTime.views}</div>
                <div className="text-[10.5px] text-[#A8A08C]">{visitorStats.allTime.unique} unique visitors</div>
              </div>
              <div className="grid grid-cols-3 gap-2">
                {[["Today", visitorStats.day], ["This week", visitorStats.week], ["This month", visitorStats.month]].map(([label, s]) => (
                  <div key={label} className="bg-[#F7F2E7] rounded-xl p-3">
                    <div className="text-[10.5px] uppercase tracking-wide text-[#8A968F] mb-1">{label}</div>
                    <div className="font-[Fraunces] text-[19px] text-[#10201D] font-medium leading-none mb-1">{s.views}</div>
                    <div className="text-[10.5px] text-[#6B7A76]">{s.unique} unique</div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        <div className="bg-white rounded-2xl p-4 mb-4">
          <div className="flex items-center gap-1.5 text-[#6B7A76] text-[11px] uppercase tracking-wide mb-3"><MapPin size={12} />Visitor locations</div>
          {!visitorLocations ? (
            <div className="flex items-center gap-2 text-[13px] text-[#8A968F]"><Loader2 size={14} className="animate-spin" />Loading…</div>
          ) : visitorLocations.countries.length === 0 ? (
            <p className="text-[12.5px] text-[#8A968F]">No location data yet — this starts collecting from the next visit onward.</p>
          ) : (
            <>
              <div className="text-[10.5px] uppercase tracking-wide text-[#8A968F] mb-1.5">By country</div>
              <div className="space-y-1 mb-3">
                {visitorLocations.countries.map((c) => (
                  <div key={c.name} className="flex items-center justify-between text-[13px]">
                    <span className="text-[#10201D] font-medium">{c.name}</span>
                    <span className="text-[#6B7A76] font-[JetBrains_Mono]">{c.count}</span>
                  </div>
                ))}
              </div>
              {visitorLocations.cities.length > 0 && (
                <>
                  <div className="text-[10.5px] uppercase tracking-wide text-[#8A968F] mb-1.5 pt-2 border-t border-[#F0EBDC]">Top cities</div>
                  <div className="space-y-1">
                    {visitorLocations.cities.map((c) => (
                      <div key={c.name} className="flex items-center justify-between text-[12.5px]">
                        <span className="text-[#3E5652]">{c.name}</span>
                        <span className="text-[#8A968F] font-[JetBrains_Mono]">{c.count}</span>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </>
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

        <div className="bg-white rounded-2xl p-4 mb-4">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-1.5 text-[#6B7A76] text-[11px] uppercase tracking-wide"><HardDrive size={12} />Storage usage</div>
            <button onClick={checkStorageUsage} disabled={storageLoading} className="text-[11px] text-[#2F6F5E] font-medium">
              {storageLoading ? "Checking…" : storageUsage ? "Recheck" : "Check now"}
            </button>
          </div>
          {!storageUsage && !storageLoading && (
            <p className="text-[12.5px] text-[#8A968F]">Scans every uploaded file across all syndicates — not run automatically, tap to check.</p>
          )}
          {storageLoading && (
            <div className="flex items-center gap-2 text-[13px] text-[#8A968F]"><Loader2 size={14} className="animate-spin" />Scanning every file, this can take a moment…</div>
          )}
          {storageUsage && !storageLoading && (
            <>
              <div className="flex items-end justify-between mb-2">
                <div className="font-[Fraunces] text-[22px] font-medium text-[#10201D]">
                  {formatBytes(storageUsage.totalBytes)} <span className="text-[14px] text-[#8A968F] font-normal">/ 1 GB free tier</span>
                </div>
                <div className={`text-[12px] font-medium ${storageUsage.totalBytes / 1073741824 > 0.8 ? "text-[#C1473A]" : "text-[#2F6F5E]"}`}>
                  {Math.round((storageUsage.totalBytes / 1073741824) * 100)}%
                </div>
              </div>
              <div className="h-2 rounded-full bg-[#EFE9D8] overflow-hidden mb-3">
                <div
                  className={`h-full rounded-full ${storageUsage.totalBytes / 1073741824 > 0.8 ? "bg-[#C1473A]" : "bg-[#2F6F5E]"}`}
                  style={{ width: `${Math.min(100, (storageUsage.totalBytes / 1073741824) * 100)}%` }}
                />
              </div>
              <div className="space-y-1">
                {Object.entries(storageUsage.byBucket).map(([bucket, usage]) => (
                  <div key={bucket} className="flex items-center justify-between text-[12px] text-[#6B7A76]">
                    <span>{bucket} ({usage.count} files)</span>
                    <span className="font-[JetBrains_Mono]">{formatBytes(usage.bytes)}</span>
                  </div>
                ))}
              </div>
              {storageUsage.totalBytes / 1073741824 > 0.8 && (
                <p className="text-[12px] text-[#C1473A] mt-2">Approaching the free tier's 1GB storage limit — worth considering the Pro plan (100GB) soon.</p>
              )}
            </>
          )}
        </div>

        <div className="bg-white rounded-2xl p-4 mb-4">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-1.5 text-[#6B7A76] text-[11px] uppercase tracking-wide"><Mail size={12} />Registered account emails</div>
            {userEmails && !emailsLoading && (
              <button onClick={copyAllEmails} className="text-[11px] text-[#2F6F5E] font-medium">{emailsCopied ? "Copied!" : "Copy all"}</button>
            )}
          </div>
          {!userEmails && !emailsLoading && (
            <button onClick={loadEmailsList} className="text-[12.5px] text-[#2F6F5E] font-medium">Load emails</button>
          )}
          {emailsLoading && (
            <div className="flex items-center gap-2 text-[13px] text-[#8A968F]"><Loader2 size={14} className="animate-spin" />Loading…</div>
          )}
          {userEmails && !emailsLoading && (
            <>
              <p className="text-[12px] text-[#8A968F] mb-2">{userEmails.length} registered {userEmails.length === 1 ? "account" : "accounts"}</p>
              <div className="max-h-40 overflow-y-auto space-y-1">
                {userEmails.map((u) => (
                  <div key={u.email} className="text-[12.5px] text-[#3E5652] font-[JetBrains_Mono]">{u.email}</div>
                ))}
              </div>
            </>
          )}
        </div>

        <div className="bg-white rounded-2xl p-4 mb-4">
          <div className="flex items-center gap-1.5 text-[#6B7A76] text-[11px] uppercase tracking-wide mb-2"><ShieldCheck size={12} />Free access (bypass Stripe)</div>
          <p className="text-[12px] text-[#8A968F] mb-3">Paste one or more registered email addresses (comma, space, or newline separated). Anyone on this list skips the $3 fee entirely, for every syndicate they create or roll over.</p>
          <textarea
            className="w-full text-[13px] rounded-xl border border-[#E5E0D0] px-3 py-2 mb-2 min-h-[70px] font-[JetBrains_Mono]"
            placeholder="friend@example.com, another@example.com"
            value={compedInput}
            onChange={(e) => setCompedInput(e.target.value)}
          />
          {compedError && <div className="flex items-center gap-2 text-[#C1473A] text-[12px] mb-2"><AlertCircle size={13} />{compedError}</div>}
          <Button onClick={handleGrantFreeAccess} disabled={compedSaving || !compedInput.trim()} icon={compedSaving ? Loader2 : PlusCircle}>{compedSaving ? "Adding…" : "Grant free access"}</Button>

          <div className="mt-4 pt-4 border-t border-[#F0EBDC]">
            {compedLoading ? (
              <div className="flex items-center gap-2 text-[13px] text-[#8A968F]"><Loader2 size={14} className="animate-spin" />Loading…</div>
            ) : compedEmails.length === 0 ? (
              <p className="text-[12.5px] text-[#8A968F]">No one has free access yet.</p>
            ) : (
              <>
                <p className="text-[11px] uppercase tracking-wide text-[#8A968F] mb-2">{compedEmails.length} with free access</p>
                <div className="max-h-48 overflow-y-auto space-y-1.5">
                  {compedEmails.map((c) => (
                    <div key={c.email} className="flex items-center justify-between bg-[#F7F2E7] rounded-lg px-3 py-2">
                      <span className="text-[12.5px] text-[#3E5652] font-[JetBrains_Mono] truncate mr-2">{c.email}</span>
                      <button
                        onClick={() => handleRevokeFreeAccess(c.email)}
                        disabled={compedRemoving === c.email}
                        className="text-[#C1473A] shrink-0"
                      >
                        {compedRemoving === c.email ? <Loader2 size={14} className="animate-spin" /> : <X size={14} />}
                      </button>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>

        <div className="bg-white rounded-2xl p-4 mb-4">
          <div className="flex items-center gap-1.5 text-[#6B7A76] text-[11px] uppercase tracking-wide mb-3"><Star size={12} />Pending reviews {pendingReviews.length > 0 && `(${pendingReviews.length})`}</div>
          {pendingReviews.length === 0 ? (
            <p className="text-[12.5px] text-[#8A968F]">Nothing waiting on approval.</p>
          ) : (
            <div className="space-y-3">
              {pendingReviews.map((r) => (
                <div key={r.id} className="bg-[#F7F2E7] rounded-xl p-3">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[13.5px] font-medium text-[#10201D]">{r.name}</span>
                    <div className="flex items-center gap-0.5">
                      {[1, 2, 3, 4, 5].map((n) => (
                        <Star key={n} size={12} className={n <= r.rating ? "text-[#C9982E] fill-[#C9982E]" : "text-[#D8D0BC]"} />
                      ))}
                    </div>
                  </div>
                  <p className="text-[13px] text-[#3E5652] mb-2">{r.body}</p>
                  <div className="flex gap-2">
                    <Button full={false} onClick={() => handleApproveReview(r.id)} disabled={reviewActionLoading === r.id} icon={reviewActionLoading === r.id ? Loader2 : Check}>Approve</Button>
                    <Button full={false} variant="ghost" onClick={() => handleDeleteReview(r.id)} disabled={reviewActionLoading === r.id} icon={Trash2}>Delete</Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="bg-white rounded-2xl p-4 mb-4">
          <div className="flex items-center gap-1.5 text-[#6B7A76] text-[11px] uppercase tracking-wide mb-3">
            <Mail size={12} />Contact messages {contactMessages.filter((m) => !m.read).length > 0 && `(${contactMessages.filter((m) => !m.read).length} unread)`}
          </div>
          {contactMessages.length === 0 ? (
            <p className="text-[12.5px] text-[#8A968F]">No messages yet.</p>
          ) : (
            <div className="space-y-3">
              {contactMessages.map((m) => (
                <div key={m.id} className={`rounded-xl p-3 ${m.read ? "bg-[#F7F2E7]" : "bg-[#C9982E]/10 border border-[#C9982E]/25"}`}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[13.5px] font-medium text-[#10201D]">{m.name}</span>
                    <span className="text-[10.5px] text-[#8A968F]">{new Date(m.created_at).toLocaleDateString(undefined, { day: "numeric", month: "short" })}</span>
                  </div>
                  <div className="text-[11.5px] text-[#6B7A76] mb-1.5">{m.email}</div>
                  <p className="text-[13px] text-[#3E5652] mb-2">{m.message}</p>
                  <div className="flex gap-2">
                    {!m.read && (
                      <Button full={false} onClick={() => handleMarkContactRead(m.id)} disabled={contactActionLoading === m.id} icon={contactActionLoading === m.id ? Loader2 : Check}>Mark read</Button>
                    )}
                    <Button full={false} variant="ghost" onClick={() => handleDeleteContact(m.id)} disabled={contactActionLoading === m.id} icon={Trash2}>Delete</Button>
                  </div>
                </div>
              ))}
            </div>
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

const ISO_COUNTRY_NAMES = {
  AU: "Australia", GB: "United Kingdom", US: "United States",
  NZ: "New Zealand", CA: "Canada", IE: "Ireland",
};

function WinnersTicker({ winners }) {
  if (!winners || winners.length === 0) return null;

  function formatEntry(w) {
    let location;
    if (w.win_city) {
      const countryName = ISO_COUNTRY_NAMES[w.win_country] || w.win_country || "";
      location = [w.win_city, w.win_region, countryName].filter(Boolean).join(", ");
    } else {
      location = COUNTRIES[w.country]?.name || "Australia";
    }
    const date = w.draw_date ? new Date(w.draw_date).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "";
    return `🎉 ${w.name} won ${money(w.actual_winnings, COUNTRIES[w.country]?.currency)} — ${date} · ${location}`;
  }

  const items = winners.map(formatEntry);
  // duplicate the list so the scroll loops seamlessly
  const trackText = [...items, ...items].join("   ★   ");

  return (
    <div className="relative rounded-2xl overflow-hidden mb-6" style={{ background: "#0B1512" }}>
      <style>{`
        @keyframes winnerScroll { from { transform: translateX(0); } to { transform: translateX(-50%); } }
        @keyframes winnerBulb { 0%, 100% { opacity: 0.25; } 50% { opacity: 1; } }
        .winner-track { display: inline-block; white-space: nowrap; animation: winnerScroll 32s linear infinite; }
        .winner-bulb { animation: winnerBulb 1.2s ease-in-out infinite; }
      `}</style>

      {/* flashing bulb border, top */}
      <div className="flex items-center justify-between px-2 pt-2">
        {Array.from({ length: 14 }).map((_, i) => (
          <div
            key={i}
            className="winner-bulb rounded-full"
            style={{ width: 5, height: 5, background: i % 2 === 0 ? "#C9982E" : "#F3D08A", animationDelay: `${i * 0.09}s` }}
          />
        ))}
      </div>

      <div className="py-3 overflow-hidden">
        <div className="winner-track text-[13.5px] font-medium text-[#F3D08A]">{trackText}</div>
      </div>

      {/* flashing bulb border, bottom */}
      <div className="flex items-center justify-between px-2 pb-2">
        {Array.from({ length: 14 }).map((_, i) => (
          <div
            key={i}
            className="winner-bulb rounded-full"
            style={{ width: 5, height: 5, background: i % 2 === 0 ? "#F3D08A" : "#C9982E", animationDelay: `${i * 0.09 + 0.5}s` }}
          />
        ))}
      </div>
    </div>
  );
}

function ContactModal({ onClose }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit() {
    if (!name.trim() || !email.trim() || !message.trim()) {
      setError("Fill in your name, email, and a message to continue.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await submitContactMessage(name.trim(), email.trim(), message.trim());
      setDone(true);
    } catch (e) {
      setError(e.message || "Something went wrong, please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-30 flex items-end justify-center bg-black/40" onClick={onClose}>
      <div className="w-full max-w-[430px] bg-[#F7F2E7] rounded-t-3xl p-6 pb-8" onClick={(e) => e.stopPropagation()}>
        <div className="w-10 h-1 rounded-full bg-[#D8D0BC] mx-auto mb-5" />
        {done ? (
          <>
            <h3 className="font-[Fraunces] text-[19px] text-[#10201D] font-medium mb-1">Thanks for reaching out!</h3>
            <p className="text-[13px] text-[#6B7A76] mb-5">We'll get back to you as soon as we can.</p>
            <Button onClick={onClose}>Done</Button>
          </>
        ) : (
          <>
            <h3 className="font-[Fraunces] text-[19px] text-[#10201D] font-medium mb-1">Contact us</h3>
            <p className="text-[13px] text-[#6B7A76] mb-4">Questions, feedback, or something not working right — let us know.</p>
            <Field label="Your name"><input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} /></Field>
            <Field label="Your email"><input className={inputCls} type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
            <Field label="Message">
              <textarea className={`${inputCls} min-h-[90px]`} value={message} onChange={(e) => setMessage(e.target.value)} />
            </Field>
            {error && <div className="flex items-center gap-2 text-[#C1473A] text-[13px] mb-4"><AlertCircle size={15} /> {error}</div>}
            <div className="flex gap-3">
              <Button variant="ghost" onClick={onClose}>Cancel</Button>
              <Button onClick={handleSubmit} disabled={saving} icon={saving ? Loader2 : Check}>{saving ? "Sending…" : "Send message"}</Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function ReviewModal({ session, profile, onClose }) {
  const [name, setName] = useState(profile?.nickname || "");
  const [rating, setRating] = useState(5);
  const [body, setBody] = useState("");
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit() {
    if (!name.trim() || !body.trim()) {
      setError("Add your name and a quick review to continue.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await submitReview(session.user.id, name.trim(), rating, body.trim());
      setDone(true);
    } catch (e) {
      setError(e.message || "Something went wrong, please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-30 flex items-end justify-center bg-black/40" onClick={onClose}>
      <div className="w-full max-w-[430px] bg-[#F7F2E7] rounded-t-3xl p-6 pb-8" onClick={(e) => e.stopPropagation()}>
        <div className="w-10 h-1 rounded-full bg-[#D8D0BC] mx-auto mb-5" />
        {done ? (
          <>
            <h3 className="font-[Fraunces] text-[19px] text-[#10201D] font-medium mb-1">Thanks for the feedback!</h3>
            <p className="text-[13px] text-[#6B7A76] mb-5">Your review will appear on the site once it's been reviewed.</p>
            <Button onClick={onClose}>Done</Button>
          </>
        ) : (
          <>
            <h3 className="font-[Fraunces] text-[19px] text-[#10201D] font-medium mb-1">Leave a review</h3>
            <p className="text-[13px] text-[#6B7A76] mb-4">Organiser or player, we'd love to hear how it's going — approved reviews get featured on the home page.</p>
            <div className="flex items-center gap-2 mb-4">
              {[1, 2, 3, 4, 5].map((n) => (
                <button key={n} onClick={() => setRating(n)}>
                  <Star size={28} className={n <= rating ? "text-[#C9982E] fill-[#C9982E]" : "text-[#D8D0BC]"} />
                </button>
              ))}
            </div>
            <Field label="Your name"><input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} /></Field>
            <Field label="Your review">
              <textarea className={`${inputCls} min-h-[90px]`} placeholder="What's it been like running or joining a syndicate?" value={body} onChange={(e) => setBody(e.target.value)} />
            </Field>
            {error && <div className="flex items-center gap-2 text-[#C1473A] text-[13px] mb-4"><AlertCircle size={15} /> {error}</div>}
            <div className="flex gap-3">
              <Button variant="ghost" onClick={onClose}>Cancel</Button>
              <Button onClick={handleSubmit} disabled={saving} icon={saving ? Loader2 : Check}>{saving ? "Submitting…" : "Submit review"}</Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function ActivityLogScreen({ code, onBack }) {
  const [entries, setEntries] = useState(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    setEntries(await loadActivityLog(code));
    setLoading(false);
  }, [code]);

  useEffect(() => { refresh(); }, [refresh]);

  function formatTime(iso) {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, { day: "numeric", month: "short" }) + " · " + d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  }

  return (
    <Screen>
      <TopBar title="Activity log" onBack={onBack} right={<button onClick={refresh} className="text-[#6B7A76]"><RefreshCw size={16} className={loading ? "animate-spin" : ""} /></button>} />
      <div className="flex-1 px-6 pb-10">
        <p className="text-[12.5px] text-[#8A968F] mb-5">A running record of joins, top-ups, edits, and removals for this syndicate — visible to everyone in it.</p>
        {loading && !entries ? (
          <div className="flex justify-center py-10"><Loader2 className="animate-spin text-[#2F6F5E]" size={22} /></div>
        ) : entries && entries.length === 0 ? (
          <div className="text-[13.5px] text-[#8A968F] bg-white rounded-xl px-4 py-8 text-center">Nothing logged yet.</div>
        ) : (
          <div className="space-y-2.5">
            {entries.map((e) => (
              <div key={e.id} className="bg-white rounded-xl px-4 py-3">
                <div className="text-[13.5px] text-[#10201D] leading-relaxed">{e.message}</div>
                <div className="text-[11px] text-[#8A968F] mt-1 font-[JetBrains_Mono]">{formatTime(e.created_at)}</div>
              </div>
            ))}
          </div>
        )}
      </div>
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
        <div className="text-center text-[11px] text-[#8A968F] mt-6 pt-4 border-t border-[#EFE9D8]">© 2026 lottosyndicate.app</div>
      </div>
    </Screen>
  );
}

function Home({ session, onCreate, onJoin, onSignIn, onSignOut, onProfile, onLegal, onGuide, isAdmin, onAdmin }) {
  const [profile, setProfile] = useState(null);
  const [myPools, setMyPools] = useState([]);
  const [memberships, setMemberships] = useState([]);
  const [loading, setLoading] = useState(!!session);
  const [approvedReviews, setApprovedReviews] = useState([]);
  const [recentWinners, setRecentWinners] = useState([]);
  const [showContactModal, setShowContactModal] = useState(false);

  useEffect(() => {
    loadApprovedReviews(6).then(setApprovedReviews);
    loadRecentWinners(12).then(setRecentWinners);
  }, []);

  useEffect(() => {
    if (!session) { setMyPools([]); setMemberships([]); setProfile(null); return; }
    setLoading(true);
    Promise.all([loadOwnedPools(session.user.id), loadMemberships(session.user.id), loadProfile(session.user.id)]).then(
      async ([owned, member, prof]) => {
        // Fetch remaining-participant counts (so drawn syndicates that have paid out
        // everyone can be flagged as closed) and pool-size totals (shown on each row) in
        // one pass.
        const codes = [...new Set([...owned.map((p) => p.code), ...member.map((m) => m.code)])];
        const aggregates = await loadParticipantAggregates(codes);
        setMyPools(owned.map((p) => ({
          ...p,
          participantCount: aggregates[p.code]?.count || 0,
          poolTotal: aggregates[p.code]?.total || 0,
        })));
        setMemberships(member.map((m) => ({
          ...m,
          participantCount: aggregates[m.code]?.count || 0,
          poolTotal: aggregates[m.code]?.total || 0,
        })));
        setProfile(prof);
        setLoading(false);
      }
    );
  }, [session]);

  return (
    <>
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

        <WinnersTicker winners={recentWinners} />

        <div className="flex items-center gap-2 text-[12px] text-[#8FA09B] mb-6">
          <Globe size={13} className="text-[#C9982E] shrink-0" />
          <span>Now used by groups across Australia, the USA, Canada, England, Scotland, Wales &amp; Ireland</span>
        </div>

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
            <Button variant="gold" icon={LogIn} onClick={onSignIn}>Login or Register</Button>
          )}
          <Button variant="ghost" icon={ArrowRight} onClick={onJoin} full>
            <span className="text-[#F7F2E7]">Join with a code</span>
          </Button>
        </div>

        {!session && <HowItWorksDemo />}

        {session && loading && <div className="flex justify-center py-4"><Loader2 className="animate-spin text-[#C9982E]" size={18} /></div>}

        {session && !loading && (
          <div className="space-y-6">
            {myPools.length > 0 && (() => {
              const activePools = myPools.filter((p) => !isPoolClosed(p));
              const completedPools = myPools.filter((p) => isPoolClosed(p));
              return (
                <div>
                  <div className="text-[12px] uppercase tracking-wide text-[#6B7A76] mb-2.5">Syndicates you organise</div>
                  <div className="space-y-2">
                    {activePools.map((p) => {
                      const badge = getPoolBadge(p);
                      return (
                        <a key={p.code} href={`#/dashboard/${p.code}`} className="w-full flex items-center justify-between bg-white/5 hover:bg-white/10 rounded-xl px-4 py-3.5 text-left">
                          <div>
                            <div className="text-[#F7F2E7] text-[14.5px] font-medium">{p.name}</div>
                            <div className="text-[#7C8C88] text-[12px] font-[JetBrains_Mono] tracking-wide mt-0.5">
                              {p.code} · {money(p.poolTotal, COUNTRIES[p.country]?.currency)} pool
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            {badge ? (
                              <span className={`text-[11px] font-bold shrink-0 ${badge.className}`}>{badge.text}</span>
                            ) : (
                              <MiniCountdown deadline={p.entryDeadline} />
                            )}
                            <ChevronRight size={17} className="text-[#7C8C88]" />
                          </div>
                        </a>
                      );
                    })}
                  </div>
                  {completedPools.length > 0 && (
                    <details className="mt-3">
                      <summary className="text-[11.5px] uppercase tracking-wide text-[#6B7A76] cursor-pointer select-none py-1">
                        {completedPools.length} completed / rolled over
                      </summary>
                      <div className="space-y-2 mt-2">
                        {completedPools.map((p) => {
                          const badge = getPoolBadge(p);
                          return (
                            <a key={p.code} href={`#/dashboard/${p.code}`} className="w-full flex items-center justify-between bg-white/5 hover:bg-white/10 rounded-xl px-4 py-3.5 text-left opacity-60">
                              <div>
                                <div className="text-[#F7F2E7] text-[14.5px] font-medium">{p.name}</div>
                                <div className="text-[#7C8C88] text-[12px] font-[JetBrains_Mono] tracking-wide mt-0.5">{p.code}</div>
                              </div>
                              <div className="flex items-center gap-2">
                                {badge && <span className={`text-[11px] font-bold shrink-0 ${badge.className}`}>{badge.text}</span>}
                                <ChevronRight size={17} className="text-[#7C8C88]" />
                              </div>
                            </a>
                          );
                        })}
                      </div>
                    </details>
                  )}
                </div>
              );
            })()}
            <div>
              <div className="text-[12px] uppercase tracking-wide text-[#6B7A76] mb-2.5">
                You're in {memberships.length} syndicate{memberships.length === 1 ? "" : "s"}
              </div>
              {memberships.length === 0 ? (
                <div className="text-[13px] text-[#7C8C88]">Join one with a code above.</div>
              ) : (() => {
                const activeMemberships = memberships.filter((m) => !isPoolClosed(m));
                const completedMemberships = memberships.filter((m) => isPoolClosed(m));
                return (
                  <>
                    <div className="space-y-2">
                      {activeMemberships.map((m) => {
                        const badge = getPoolBadge(m);
                        return (
                          <a key={m.code} href={`#/j/${m.code}`} className="w-full flex items-center justify-between bg-white/5 hover:bg-white/10 rounded-xl px-4 py-3.5 text-left">
                            <div>
                              <div className="text-[#F7F2E7] text-[14.5px] font-medium">{m.name}</div>
                              <div className="text-[#7C8C88] text-[12px] mt-0.5">{money(m.amount)} · {m.status === "drawn" ? "Drawn" : "Open"}</div>
                            </div>
                            <div className="flex items-center gap-2">
                              {badge ? (
                                <span className={`text-[11px] font-bold shrink-0 ${badge.className}`}>{badge.text}</span>
                              ) : (
                                <MiniCountdown deadline={m.entryDeadline} />
                              )}
                              <ChevronRight size={17} className="text-[#7C8C88]" />
                            </div>
                          </a>
                        );
                      })}
                    </div>
                    {completedMemberships.length > 0 && (
                      <details className="mt-3">
                        <summary className="text-[11.5px] uppercase tracking-wide text-[#6B7A76] cursor-pointer select-none py-1">
                          {completedMemberships.length} completed / rolled over
                        </summary>
                        <div className="space-y-2 mt-2">
                          {completedMemberships.map((m) => {
                            const badge = getPoolBadge(m);
                            return (
                              <a key={m.code} href={`#/j/${m.code}`} className="w-full flex items-center justify-between bg-white/5 hover:bg-white/10 rounded-xl px-4 py-3.5 text-left opacity-60">
                                <div>
                                  <div className="text-[#F7F2E7] text-[14.5px] font-medium">{m.name}</div>
                                  <div className="text-[#7C8C88] text-[12px] mt-0.5">{money(m.amount)} · {m.status === "drawn" ? "Drawn" : "Open"}</div>
                                </div>
                                <div className="flex items-center gap-2">
                                  {badge && <span className={`text-[11px] font-bold shrink-0 ${badge.className}`}>{badge.text}</span>}
                                  <ChevronRight size={17} className="text-[#7C8C88]" />
                                </div>
                              </a>
                            );
                          })}
                        </div>
                      </details>
                    )}
                  </>
                );
              })()}
            </div>
            <button onClick={onSignOut} className="text-[12px] text-[#7C8C88] underline">Sign out</button>
          </div>
        )}

        {approvedReviews.length > 0 && (
          <div className="mt-10 pt-6 border-t border-white/10">
            <div className="text-[12px] uppercase tracking-wide text-[#6B7A76] mb-3">What people are saying</div>
            <div className="space-y-3">
              {approvedReviews.map((r) => (
                <div key={r.id} className="bg-white/5 rounded-xl px-4 py-3.5">
                  <div className="flex items-center gap-0.5 mb-1.5">
                    {[1, 2, 3, 4, 5].map((n) => (
                      <Star key={n} size={12} className={n <= r.rating ? "text-[#C9982E] fill-[#C9982E]" : "text-[#4A5854]"} />
                    ))}
                  </div>
                  <p className="text-[13.5px] text-[#D8D8CC] leading-relaxed mb-1.5">"{r.body}"</p>
                  <div className="text-[11.5px] text-[#7C8C88]">— {r.name}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="flex items-center justify-center gap-2.5 mt-10 pt-6 border-t border-white/10">
          <button onClick={() => onLegal("privacy")} className="text-[10.5px] text-[#5B6862] underline">Privacy</button>
          <span className="text-[#3A4744] text-[10.5px]">·</span>
          <button onClick={() => onLegal("terms")} className="text-[10.5px] text-[#5B6862] underline">Terms</button>
          <span className="text-[#3A4744] text-[10.5px]">·</span>
          <button onClick={() => onLegal("pricing")} className="text-[10.5px] text-[#5B6862] underline">Pricing &amp; Refunds</button>
          <span className="text-[#3A4744] text-[10.5px]">·</span>
          <button onClick={() => setShowContactModal(true)} className="text-[10.5px] text-[#5B6862] underline">Contact us</button>
        </div>
        <div className="text-center text-[10px] text-[#4A5854] mt-3">© 2026 lottosyndicate.app</div>

        {isAdmin && (
          <button onClick={onAdmin} className="flex items-center justify-center gap-2 mt-4 text-[11px] text-[#C9982E] underline">
            <Lock size={11} /> Admin dashboard
          </button>
        )}
      </div>
    </Screen>
    {showContactModal && <ContactModal onClose={() => setShowContactModal(false)} />}
    </>
  );
}

/* ---------------------------------------------------------
   Organiser — create
--------------------------------------------------------- */

function CreatePool({ session, onBack, onCreated }) {
  const [name, setName] = useState("");
  const [jackpot, setJackpot] = useState("");
  const [drawDate, setDrawDate] = useState("");
  const [entryDeadline, setEntryDeadline] = useState("");
  const [organiser, setOrganiser] = useState("");
  const [country, setCountry] = useState("AU");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [comped, setComped] = useState(false); // true once we've confirmed this account has free access

  useEffect(() => {
    try {
      const draft = JSON.parse(localStorage.getItem("pendingSyndicate") || "null");
      if (draft) {
        setName(draft.name || "");
        setJackpot(draft.jackpot ? String(draft.jackpot) : "");
        setDrawDate(draft.drawDate || "");
        setOrganiser(draft.organiser || "");
        setCountry(draft.country || "AU");
      }
    } catch (e) {}
  }, []);

  useEffect(() => {
    let cancelled = false;
    isEmailComped(session.user.email).then((v) => { if (!cancelled) setComped(v); });
    return () => { cancelled = true; };
  }, [session.user.email]);

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
        country,
      };

      // Accounts an admin has granted free access to skip Stripe entirely and get
      // created immediately — re-check live (not just the on-mount value) so this
      // can't be stale if access was granted/revoked in another tab.
      const isComped = await isEmailComped(session.user.email);
      if (isComped) {
        const code = await createPool(draft);
        onCreated(code);
        return;
      }

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
        <Field label="Country / currency">
          <select className={inputCls} value={country} onChange={(e) => setCountry(e.target.value)}>
            {Object.entries(COUNTRIES).map(([code, c]) => (
              <option key={code} value={code}>{c.flag} {c.name} ({c.currency})</option>
            ))}
          </select>
        </Field>
        <Field label="Jackpot estimate *">
          <div className="relative"><span className="absolute left-4 top-1/2 -translate-y-1/2 text-[#A8A08C]">{COUNTRIES[country].symbol}</span>
            <input className={`${inputCls} pl-7`} inputMode="decimal" placeholder="40,000,000" value={jackpot} onChange={(e) => setJackpot(e.target.value.replace(/[^0-9.]/g, ""))} /></div>
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
        {comped ? (
          <div className="bg-[#2F6F5E]/8 rounded-xl px-4 py-3 text-[13px] text-[#2F6F5E] leading-relaxed mb-6 flex gap-2">
            <ShieldCheck size={16} className="mt-0.5 shrink-0 text-[#2F6F5E]" />
            <span>Your account has free access — no payment needed to create this syndicate.</span>
          </div>
        ) : (
          <div className="bg-[#10201D]/5 rounded-xl px-4 py-3 text-[13px] text-[#5B6B67] leading-relaxed mb-6 flex gap-2">
            <Landmark size={16} className="mt-0.5 shrink-0 text-[#5B6B67]" />
            <span>Creating a syndicate has a one-time $3.00 AUD service fee, paid securely via Stripe. This covers using the app only — never your ticket money.</span>
          </div>
        )}
        {error && <div className="flex items-center gap-2 text-[#C1473A] text-[13px] mb-4"><AlertCircle size={15} /> {error}</div>}
        <Button onClick={handlePayAndCreate} disabled={saving} icon={saving ? Loader2 : ArrowRight}>
          {saving ? (comped ? "Creating…" : "Redirecting to payment…") : (comped ? "Create syndicate (free access)" : "Pay $3 & create syndicate")}
        </Button>
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
        <div className="font-[Fraunces] text-[34px] text-[#10201D] font-medium mb-1">{money(pool.jackpot, COUNTRIES[pool.country]?.currency)}</div>
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
    setAmount((a) => Math.max(0.5, Math.round(((Number(a) || 0) + delta) * 100) / 100));
  }

  async function handleConfirm() {
    if (closed) {
      setError("Entries have closed for this syndicate — the deadline has passed.");
      return;
    }
    if (pool.status === "drawn") {
      setError("This syndicate has already been drawn — entries are closed.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      // re-check against the LATEST state in case it changed since this page was opened
      const latest = await loadPool(pool.code);
      if (latest && (latest.status === "drawn" || (latest.entryDeadline && new Date(latest.entryDeadline).getTime() <= Date.now()))) {
        setPool(latest);
        setError(latest.status === "drawn" ? "This syndicate has just been drawn — entries are closed." : "Entries have just closed for this syndicate.");
        setSaving(false);
        return;
      }

      const existing = pool.participants.find((p) => p.userId === session.user.id);
      const newId = existing
        ? await mergeParticipantAmount(pool.code, existing.id, numericAmount)
        : await addParticipant(pool.code, { name: pname.trim(), amount: numericAmount, userId: session.user.id });
      setMyParticipantId(newId);
      const fresh = await loadPool(pool.code);
      setPool(fresh || pool);
      loadPaymentDetails(pool.code).then(setPaymentDetails);
      setStep("done");
    } catch (e) {
      console.error("Join failed:", e);
      const isRlsError = e.code === "42501" || (e.message && e.message.includes("row-level security"));
      if (isRlsError) {
        setError("This couldn't be completed — the syndicate may have just closed or been drawn. Try going back and checking, then try again.");
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
          <div className="font-[Fraunces] text-[34px] text-[#10201D] font-medium mb-4">{money(pool.jackpot, COUNTRIES[pool.country]?.currency)}</div>
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
                  onBlur={() => setAmount((a) => Math.max(0.5, Number(a) || 0.5))}
                  className="font-[Fraunces] text-[28px] font-medium text-[#10201D] leading-none w-full text-center bg-transparent focus:outline-none"
                />
              </div>
              <button onClick={() => adjustAmount(5)} className="w-11 h-11 rounded-full bg-[#2F6F5E] text-white text-xl font-medium flex items-center justify-center active:scale-95 shrink-0">+</button>
            </div>
            <div className="text-[11px] uppercase tracking-wide text-[#6B7A76] text-center mt-2">type any amount from 50¢, or use +/−</div>
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

function ViewPool({ code, session, onBack, onChat }) {
  const [pool, setPool] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [shareCopied, setShareCopied] = useState(false);
  const [showActivityLog, setShowActivityLog] = useState(false);
  const [showReviewModal, setShowReviewModal] = useState(false);
  const [myPayoutRequest, setMyPayoutRequest] = useState(undefined); // undefined = not checked yet, null = none
  const [showCashOut, setShowCashOut] = useState(false);
  const [bankName, setBankName] = useState("");
  const [accountName, setAccountName] = useState("");
  const [bsb, setBsb] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [payid, setPayid] = useState("");
  const [iban, setIban] = useState("");
  const [bic, setBic] = useState("");
  const [cashOutSaving, setCashOutSaving] = useState(false);
  const [cashOutError, setCashOutError] = useState("");

  const refresh = useCallback(async () => {
    setRefreshing(true);
    const p = await loadPool(code);
    setPool(p);
    setRefreshing(false);
    const mine = p?.participants.find((x) => x.userId === session?.user?.id);
    if (mine) setMyPayoutRequest(await loadMyPayoutRequest(mine.id));
    else setMyPayoutRequest(null);
  }, [code, session]);
  useEffect(() => { refresh(); }, [refresh]);

  const deadlineDiff = useCountdown(pool?.entryDeadline);

  if (showActivityLog) {
    return <ActivityLogScreen code={code} onBack={() => setShowActivityLog(false)} />;
  }

  const myParticipant = pool?.participants.find((x) => x.userId === session?.user?.id);
  const entriesClosed = pool?.entryDeadline && deadlineDiff !== null && deadlineDiff <= 0;
  const drawEntered = pool?.status === "drawn";
  const canCashOut = !pool?.rolledForwardTo && (!entriesClosed || drawEntered);
  const poolTotalAmount = pool ? pool.participants.reduce((s, p) => s + Number(p.amount || 0), 0) : 0;
  const myPayoutAmount = myParticipant
    ? drawEntered && poolTotalAmount
      ? (Number(myParticipant.amount || 0) / poolTotalAmount) * Number(pool.actualWinnings || 0)
      : Number(myParticipant.amount || 0)
    : 0;

  async function handleRequestCashOut() {
    if (!myParticipant) return;
    setCashOutSaving(true);
    setCashOutError("");
    try {
      const id = await requestPayout(myParticipant.id, code);
      if (bankName || accountName || bsb || accountNumber || payid) {
        await submitPayoutBankDetails(id, { bankName, accountName, bsb, accountNumber, payid });
      }
      setMyPayoutRequest(await loadMyPayoutRequest(myParticipant.id));
      setShowCashOut(false);
    } catch (e) {
      setCashOutError(e.message || "Something went wrong, please try again.");
    } finally {
      setCashOutSaving(false);
    }
  }

  async function handleCancelCashOut() {
    if (!myPayoutRequest) return;
    setCashOutSaving(true);
    try {
      await cancelPayoutRequest(myPayoutRequest.id, code);
      setMyPayoutRequest(null);
    } finally {
      setCashOutSaving(false);
    }
  }

  async function handleShare() {
    const url = `${shareOrigin()}/#/j/${code}`;
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
    <>
    <Screen>
      <TopBar title={pool.name} onBack={onBack} right={<button onClick={refresh} className="text-[#6B7A76]"><RefreshCw size={16} className={refreshing ? "animate-spin" : ""} /></button>} />
      <div className="flex-1 px-6 pb-10">
        <button onClick={() => setShowReviewModal(true)} className="flex items-center gap-1.5 text-[12.5px] text-[#2F6F5E] font-medium mb-4">
          <Star size={13} />Leave a review
        </button>
        {pool.status === "drawn" ? (
          <div className="bg-[#10201D] rounded-2xl px-5 py-4 mb-5">
            <div className="flex items-center gap-2 text-[#C9982E] text-[12px] uppercase tracking-wide mb-1"><Sparkles size={13} />Actual winnings</div>
            <div className="font-[Fraunces] text-[26px] text-[#F7F2E7] font-medium">{money(pool.actualWinnings, COUNTRIES[pool.country]?.currency)}</div>
          </div>
        ) : (
          <div className="bg-white rounded-2xl px-5 py-4 mb-5">
            <div className="flex items-center gap-2 text-[#6B7A76] text-[12px] uppercase tracking-wide mb-1"><Trophy size={13} className="text-[#C9982E]" />Jackpot estimate</div>
            <div className="font-[Fraunces] text-[24px] text-[#10201D] font-medium">{money(pool.jackpot, COUNTRIES[pool.country]?.currency)}</div>
          </div>
        )}
        <RolloverBanner pool={pool} />
        {pool.entryDeadline && <DeadlineBadge deadline={pool.entryDeadline} drawDate={pool.drawDate} />}
        <div className="space-y-2 mb-5">
          <Button variant="ghost" icon={shareCopied ? Check : Share2} onClick={handleShare}>{shareCopied ? "Link copied!" : "Share & invite others"}</Button>
          <Button variant="ghost" icon={MessageCircle} onClick={onChat}>Syndicate chat</Button>
          <Button variant="ghost" icon={Download} onClick={() => downloadSyndicatePdf(pool)}>Download syndicate as PDF</Button>
          <Button variant="ghost" icon={Clock} onClick={() => setShowActivityLog(true)}>Activity log</Button>
        </div>

        {myParticipant && myPayoutRequest === null && !pool.rolledForwardTo && canCashOut && (
          <button onClick={() => setShowCashOut(true)} className="w-full flex items-center gap-3 bg-[#C1473A]/8 border border-[#C1473A]/25 rounded-xl px-4 py-3 mb-5 text-left">
            <LogOut size={17} className="text-[#C1473A] shrink-0" />
            <div className="flex-1">
              <div className="text-[13px] font-medium text-[#10201D]">Cash out</div>
              <div className="text-[11.5px] text-[#8A6A15]">Take your current share ({money(myPayoutAmount)}) and leave this syndicate</div>
            </div>
          </button>
        )}
        {pool.rolledForwardTo && myParticipant && (
          <p className="text-[11.5px] text-[#8A968F] mb-5 px-1">This syndicate has rolled forward — cash out from the new syndicate instead if you'd like to leave.</p>
        )}
        {!pool.rolledForwardTo && !canCashOut && myParticipant && myPayoutRequest === null && (
          <p className="text-[11.5px] text-[#8A968F] mb-5 px-1">Cash-out reopens once the organiser enters the draw result — this keeps things fair while entries are closed but the result isn't locked in yet.</p>
        )}
        {myPayoutRequest && !myPayoutRequest.paid && (
          <div className="bg-[#2F6F5E]/8 border border-[#2F6F5E]/25 rounded-xl px-4 py-3 mb-5">
            <div className="flex items-center gap-2 mb-1">
              <Clock size={15} className="text-[#2F6F5E]" />
              <span className="text-[13px] font-medium text-[#10201D]">Payout requested</span>
            </div>
            <p className="text-[11.5px] text-[#3E5652] mb-2">The organiser has been notified and will process this soon.</p>
            <button onClick={handleCancelCashOut} disabled={cashOutSaving} className="text-[11.5px] text-[#C1473A] underline">Cancel request</button>
          </div>
        )}

        <div className="text-[12px] uppercase tracking-wide text-[#6B7A76] mb-2.5">Ticket photos</div>
        <div className="mb-6"><PhotoGallery photos={pool.ticketPhotos} editable={false} emptyHint="The organiser hasn't added ticket photos yet." /></div>
        <div className="text-[12px] uppercase tracking-wide text-[#6B7A76] mb-2.5">Results &amp; winnings</div>
        <div className="mb-6"><PhotoGallery photos={pool.resultPhotos} editable={false} emptyHint="No results or winnings photos yet." /></div>
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

    {showCashOut && (
      <div className="fixed inset-0 z-30 flex items-end justify-center bg-black/40" onClick={() => setShowCashOut(false)}>
        <div className="w-full max-w-[430px] bg-[#F7F2E7] rounded-t-3xl p-6 pb-8 max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
          <div className="w-10 h-1 rounded-full bg-[#D8D0BC] mx-auto mb-5" />
          <h3 className="font-[Fraunces] text-[19px] text-[#10201D] font-medium mb-1">Cash out</h3>
          <p className="text-[13px] text-[#6B7A76] mb-4">
            You'll leave this syndicate once the organiser pays out your current share ({myParticipant ? money(myPayoutAmount) : ""}). Adding your bank details is optional but makes it easier for the organiser to pay you — only they can see them.
          </p>
          <Field label="Bank name (optional)"><input className={inputCls} value={bankName} onChange={(e) => setBankName(e.target.value)} /></Field>
          <Field label="Account name (optional)"><input className={inputCls} value={accountName} onChange={(e) => setAccountName(e.target.value)} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="BSB (optional)"><input className={inputCls} value={bsb} onChange={(e) => setBsb(e.target.value)} /></Field>
            <Field label="Account no. (optional)"><input className={inputCls} value={accountNumber} onChange={(e) => setAccountNumber(e.target.value)} /></Field>
          </div>
          <Field label="PayID (optional)"><input className={inputCls} value={payid} onChange={(e) => setPayid(e.target.value)} /></Field>
          {cashOutError && <div className="flex items-center gap-2 text-[#C1473A] text-[13px] mb-4"><AlertCircle size={15} /> {cashOutError}</div>}
          <div className="flex gap-3">
            <Button variant="ghost" onClick={() => setShowCashOut(false)}>Cancel</Button>
            <Button onClick={handleRequestCashOut} disabled={cashOutSaving} icon={cashOutSaving ? Loader2 : Check}>{cashOutSaving ? "Requesting…" : "Request cash-out"}</Button>
          </div>
        </div>
      </div>
    )}
    {showReviewModal && <ReviewModal session={session} profile={null} onClose={() => setShowReviewModal(false)} />}
    </>
  );
}

/* ---------------------------------------------------------
   Organiser dashboard
--------------------------------------------------------- */

function Dashboard({ session, code, onBack, onSignIn, isAdmin, onNavigateCode }) {
  const [pool, setPool] = useState(null);
  const [copied, setCopied] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const [winningsInput, setWinningsInput] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [showChat, setShowChat] = useState(false);
  const [showActivityLog, setShowActivityLog] = useState(false);
  const [showReviewModal, setShowReviewModal] = useState(false);
  const [showRollover, setShowRollover] = useState(false);
  const [rolloverJackpot, setRolloverJackpot] = useState("");
  const [rolloverDrawDate, setRolloverDrawDate] = useState("");
  const [rolloverDeadline, setRolloverDeadline] = useState("");
  const [rolloverCarry, setRolloverCarry] = useState(false);
  const [rolloverCarryPayment, setRolloverCarryPayment] = useState(true);
  const [rolloverSaving, setRolloverSaving] = useState(false);
  const [rolloverError, setRolloverError] = useState("");
  const fileInputRef = useRef(null);
  const resultFileInputRef = useRef(null);
  const [resultUploading, setResultUploading] = useState(false);
  const [resultUploadError, setResultUploadError] = useState("");
  const [sortMode, setSortMode] = useState("unpaid"); // "unpaid" | "name" | "winnings"

  const [paymentDetails, setPaymentDetails] = useState(null);
  const [bankName, setBankName] = useState("");
  const [accountName, setAccountName] = useState("");
  const [bsb, setBsb] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [payid, setPayid] = useState("");
  const [iban, setIban] = useState("");
  const [bic, setBic] = useState("");
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

  const [editingDeadline, setEditingDeadline] = useState(false);
  const [deadlineValue, setDeadlineValue] = useState("");
  const [deadlineSaving, setDeadlineSaving] = useState(false);
  function openEditDeadline() {
    if (pool.entryDeadline) {
      const d = new Date(pool.entryDeadline);
      const pad = (n) => String(n).padStart(2, "0");
      setDeadlineValue(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`);
    } else {
      setDeadlineValue("");
    }
    setEditingDeadline(true);
  }
  async function saveDeadline() {
    setDeadlineSaving(true);
    try {
      const iso = deadlineValue ? new Date(deadlineValue).toISOString() : null;
      await updateEntryDeadline(pool.code, iso);
      setEditingDeadline(false);
      await refresh();
    } finally {
      setDeadlineSaving(false);
    }
  }
  async function removeDeadline() {
    setDeadlineSaving(true);
    try {
      await updateEntryDeadline(pool.code, null);
      setEditingDeadline(false);
      await refresh();
    } finally {
      setDeadlineSaving(false);
    }
  }

  const [editingName, setEditingName] = useState(false);
  const [nameValue, setNameValue] = useState("");
  const [nameSaving, setNameSaving] = useState(false);
  function openEditName() { setNameValue(pool.name); setEditingName(true); }
  async function saveName() {
    if (!nameValue.trim()) return;
    setNameSaving(true);
    try {
      await updateSyndicateName(pool.code, nameValue.trim());
      setEditingName(false);
      await refresh();
    } finally {
      setNameSaving(false);
    }
  }


  const [editingParticipant, setEditingParticipant] = useState(null);
  const [editAmountValue, setEditAmountValue] = useState("");
  const [editSaving, setEditSaving] = useState(false);
  const [removingParticipant, setRemovingParticipant] = useState(null);
  const [removeSaving, setRemoveSaving] = useState(false);

  const [showDuplicates, setShowDuplicates] = useState(false);
  const [showManualMerge, setShowManualMerge] = useState(false);
  const [payoutRequests, setPayoutRequests] = useState([]);
  const [showPayoutQueue, setShowPayoutQueue] = useState(false);
  const [processingPayout, setProcessingPayout] = useState(null);
  const [proofUploading, setProofUploading] = useState(null);

  const refreshPayoutRequests = useCallback(async () => {
    setPayoutRequests(await loadPayoutRequests(code));
  }, [code]);
  useEffect(() => { refreshPayoutRequests(); }, [refreshPayoutRequests]);

  async function handleUploadProof(requestId, file) {
    setProofUploading(requestId);
    try {
      await uploadPayoutProof(requestId, file);
      await refreshPayoutRequests();
    } finally {
      setProofUploading(null);
    }
  }

  async function handleMarkPaid(req) {
    setProcessingPayout(req.id);
    try {
      await markPayoutPaid(req.id, req.participant.id, code);
      await refreshPayoutRequests();
      await refresh();
    } finally {
      setProcessingPayout(null);
    }
  }

  const [manualSelectedIds, setManualSelectedIds] = useState([]);
  const [manualKeepId, setManualKeepId] = useState(null);
  const [manualMerging, setManualMerging] = useState(false);

  function toggleManualSelect(id) {
    setManualSelectedIds((ids) => {
      const next = ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id];
      if (!next.includes(manualKeepId)) setManualKeepId(next[0] || null);
      return next;
    });
  }

  async function handleManualMerge() {
    if (manualSelectedIds.length < 2 || !manualKeepId) return;
    const keepName = pool.participants.find((p) => p.id === manualKeepId)?.name;
    setManualMerging(true);
    try {
      await mergeParticipantGroup(pool.code, manualSelectedIds, manualKeepId, keepName);
      setShowManualMerge(false);
      setManualSelectedIds([]);
      setManualKeepId(null);
      await refresh();
    } finally {
      setManualMerging(false);
    }
  }

  const [keepChoice, setKeepChoice] = useState({}); // { [userId]: participantId to keep }
  const [mergingUserId, setMergingUserId] = useState(null);

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
    if (pool.status === "drawn") {
      setAddPError("This syndicate has already been drawn — new entries can't be added. Roll over into a new syndicate instead.");
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
      const isRlsError = e.code === "42501" || (e.message && e.message.includes("row-level security"));
      setAddPError(isRlsError ? "This syndicate has already been drawn — new entries can't be added." : (e.message || "Something went wrong adding them."));
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
          setIban(pd.iban || "");
          setBic(pd.bic || "");
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

  const duplicateGroups = pool.participants.reduce((groups, p) => {
    if (!p.userId) return groups;
    if (!groups[p.userId]) groups[p.userId] = [];
    groups[p.userId].push(p);
    return groups;
  }, {});
  const duplicateList = Object.values(duplicateGroups).filter((g) => g.length > 1);
  const confirmedIds = new Set(duplicateList.flat().map((p) => p.id));
  const possibleDuplicateList = findPossibleDuplicates(pool.participants, confirmedIds);
  // "Who owes what" list order — organiser-selectable via the sort buttons above the list.
  // Winnings are proportional to each person's contribution (same jackpot/winnings pot for
  // everyone in a pool), so sorting by amount contributed gives the same order as sorting
  // by potential winnings without needing to recompute each person's share here.
  const sortedParticipants = [...pool.participants].sort((a, b) => {
    if (sortMode === "name") return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
    if (sortMode === "winnings") return Number(b.amount || 0) - Number(a.amount || 0);
    return Number(a.paid) - Number(b.paid); // "unpaid" — unpaid entries first
  });

  async function handleMergeGroup(group, groupKey) {
    const keepId = keepChoice[groupKey] || group[0].id;
    const keepName = group.find((p) => p.id === keepId)?.name || group[0].name;
    setMergingUserId(groupKey);
    try {
      await mergeParticipantGroup(pool.code, group.map((p) => p.id), keepId, keepName);
      await refresh();
    } finally {
      setMergingUserId(null);
    }
  }

  if (showChat) {
    return <ChatRoom session={session} code={pool.code} poolName={pool.name} onBack={() => setShowChat(false)} onSignIn={onSignIn} />;
  }

  if (showActivityLog) {
    return <ActivityLogScreen code={pool.code} onBack={() => setShowActivityLog(false)} />;
  }

  const { totalAmount, confirmed } = totals(pool);

  async function handleCopy() {
    try { await navigator.clipboard.writeText(pool.code); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch (e) {}
  }
  async function handleShare() {
    const text = `Join "${pool.name}" — use code ${pool.code} in the Syndicate app: ${shareOrigin()}/#/j/${pool.code}`;
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

  async function handleResultPhotoSelect(e) {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    setResultUploading(true);
    setResultUploadError("");
    try {
      for (const file of files) await uploadResultPhoto(code, file);
      await refresh();
    } catch (e) {
      setResultUploadError("Couldn't upload one of those photos — try again.");
    } finally {
      setResultUploading(false);
      if (resultFileInputRef.current) resultFileInputRef.current.value = "";
    }
  }
  async function handleResultPhotoRemove(id) { await removeResultPhoto(id); await refresh(); }

  async function togglePaid(p) { await setParticipantPaid(p.id, !p.paid); await refresh(); }

  function openEditAmount(p) { setEditingParticipant(p); setEditAmountValue(String(p.amount)); }
  async function saveEditedAmount() {
    if (!editingParticipant) return;
    const amt = Number(editAmountValue);
    if (!amt || amt <= 0) return;
    setEditSaving(true);
    try {
      await updateParticipantAmount(pool.code, editingParticipant.id, amt);
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
      await removeParticipant(pool.code, removingParticipant.id);
      setRemovingParticipant(null);
      await refresh();
    } finally {
      setRemoveSaving(false);
    }
  }

  async function handleSubmitResults() {
    const amt = Number(winningsInput);
    if (winningsInput === "" || isNaN(amt) || amt < 0) return;
    await submitResults(code, amt);
    if (amt > 0) {
      fetch("/api/record-win-location", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      }).catch(() => {}); // best-effort — never block results submission on this
    }
    setShowResults(false);
    await refresh();
  }
  async function handleRollover() {
    setRolloverSaving(true);
    setRolloverError("");
    try {
      const oldPool = {
        code: pool.code,
        name: pool.name,
        organiser: pool.organiser,
        actualWinnings: pool.actualWinnings,
        participants: pool.participants.map((p) => ({ name: p.name, amount: p.amount, userId: p.userId })),
      };
      const options = {
        jackpot: Number(rolloverJackpot),
        drawDate: rolloverDrawDate,
        entryDeadline: rolloverDeadline ? new Date(rolloverDeadline).toISOString() : null,
        carryMembers: rolloverCarry,
        carryPaymentDetails: rolloverCarryPayment,
        ownerId: session.user.id,
      };

      // Accounts an admin has granted free access to skip Stripe entirely here too.
      const isComped = await isEmailComped(session.user.email);
      if (isComped) {
        const newCode = await rolloverSyndicate(oldPool, options);
        setShowRollover(false);
        onNavigateCode(newCode);
        return;
      }

      localStorage.setItem("pendingRollover", JSON.stringify({ oldPool, options }));

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
      await savePaymentDetails(code, { bankName, accountName, bsb, accountNumber, payid, iban, bic });
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
  async function handleViewPayoutProof(path) {
    setReceiptLoading(true);
    const url = await getSignedPayoutProofUrl(path);
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
      <TopBar
        title={
          <button onClick={openEditName} className="flex items-center gap-1.5">
            <span className="truncate max-w-[180px]">{pool.name}</span>
            <Pencil size={12} className="text-[#6B7A76] shrink-0" />
          </button>
        }
        onBack={onBack}
        right={<button onClick={refresh} className="text-[#6B7A76]"><RefreshCw size={16} className={refreshing ? "animate-spin" : ""} /></button>}
      />
      <div className="flex-1 px-6 pb-10">
        <button onClick={() => setShowReviewModal(true)} className="flex items-center gap-1.5 text-[12.5px] text-[#2F6F5E] font-medium mb-4">
          <Star size={13} />Leave a review
        </button>
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
        <button onClick={openEditDeadline} className="flex items-center gap-1.5 text-[12.5px] text-[#2F6F5E] mb-5 -mt-2">
          <Pencil size={12} />{pool.entryDeadline ? "Edit entry deadline" : "Add an entry deadline"}
        </button>

        <Button variant="ghost" icon={MessageCircle} onClick={() => setShowChat(true)}>Syndicate chat</Button>
        <div className="mt-2" />
        <Button variant="ghost" icon={Clock} onClick={() => setShowActivityLog(true)}>Activity log</Button>

        <div className="flex items-center justify-between mb-2.5 mt-5">
          <span className="text-[12px] uppercase tracking-wide text-[#6B7A76]">Ticket photos</span>
          <button onClick={() => fileInputRef.current?.click()} disabled={uploading} className="flex items-center gap-1.5 text-[#2F6F5E] text-[13px] font-medium disabled:opacity-50">
            {uploading ? <Loader2 size={14} className="animate-spin" /> : <ImagePlus size={14} />} {uploading ? "Uploading…" : "Add photos"}
          </button>
          <input ref={fileInputRef} type="file" accept="image/*" multiple className="hidden" onChange={handlePhotoSelect} />
        </div>
        {uploadError && <div className="flex items-center gap-2 text-[#C1473A] text-[13px] mb-2"><AlertCircle size={14} />{uploadError}</div>}
        <div className="mb-5"><PhotoGallery photos={pool.ticketPhotos} editable onRemove={handlePhotoRemove} emptyHint="Snap a photo of the purchased tickets so everyone can see them here." /></div>

        <div className="flex items-center justify-between mb-2.5">
          <span className="text-[12px] uppercase tracking-wide text-[#6B7A76]">Results &amp; winnings</span>
          <button onClick={() => resultFileInputRef.current?.click()} disabled={resultUploading} className="flex items-center gap-1.5 text-[#2F6F5E] text-[13px] font-medium disabled:opacity-50">
            {resultUploading ? <Loader2 size={14} className="animate-spin" /> : <ImagePlus size={14} />} {resultUploading ? "Uploading…" : "Add photos"}
          </button>
          <input ref={resultFileInputRef} type="file" accept="image/*" multiple className="hidden" onChange={handleResultPhotoSelect} />
        </div>
        <p className="text-[11.5px] text-[#8A968F] mb-2">Winning tickets, results screenshots, or transfer receipts.</p>
        {resultUploadError && <div className="flex items-center gap-2 text-[#C1473A] text-[13px] mb-2"><AlertCircle size={14} />{resultUploadError}</div>}
        <div className="mb-5"><PhotoGallery photos={pool.resultPhotos} editable onRemove={handleResultPhotoRemove} emptyHint="Add a photo once you have a result or proof of a payout." /></div>

        <div className="grid grid-cols-2 gap-3 mb-5">
          <div className="bg-white rounded-2xl p-4">
            <div className="flex items-center justify-between mb-1">
              <div className="flex items-center gap-1.5 text-[#6B7A76] text-[11px] uppercase tracking-wide"><Trophy size={12} className="text-[#C9982E]" />Jackpot</div>
              <button onClick={openEditJackpot} className="text-[#6B7A76]"><Pencil size={13} /></button>
            </div>
            <div className="font-[Fraunces] text-[19px] text-[#10201D] font-medium">{money(pool.jackpot, COUNTRIES[pool.country]?.currency)}</div>
          </div>
          <div className="bg-white rounded-2xl p-4">
            <div className="flex items-center gap-1.5 text-[#6B7A76] text-[11px] uppercase tracking-wide mb-1"><Users size={12} />Participants</div>
            <div className="font-[Fraunces] text-[19px] text-[#10201D] font-medium">{pool.participants.length}</div>
          </div>
          <div className="bg-white rounded-2xl p-4">
            <div className="flex items-center gap-1.5 text-[#6B7A76] text-[11px] uppercase tracking-wide mb-1"><Ticket size={12} />Total pool</div>
            <div className="font-[JetBrains_Mono] text-[17px] text-[#10201D] font-medium">{money(totalAmount, COUNTRIES[pool.country]?.currency)}</div>
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
              <div className="font-[Fraunces] text-[26px] text-[#F7F2E7] font-medium">{money(pool.actualWinnings, COUNTRIES[pool.country]?.currency)}</div>
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
          <Button full={false} variant="ghost" icon={Users} onClick={() => setShowManualMerge(true)}>
            <span className="text-[13px]">Merge manually</span>
          </Button>
        </div>

        {payoutRequests.length > 0 && (
          <button onClick={() => setShowPayoutQueue(true)} className="w-full flex items-center gap-3 bg-[#C1473A]/8 border border-[#C1473A]/25 rounded-xl px-4 py-3 mb-4 text-left">
            <LogOut size={17} className="text-[#C1473A] shrink-0" />
            <div className="flex-1">
              <div className="text-[13px] font-medium text-[#10201D]">{payoutRequests.length} pending cash-out {payoutRequests.length === 1 ? "request" : "requests"}</div>
              <div className="text-[11.5px] text-[#8A6A15]">Tap to review and pay out</div>
            </div>
            <ChevronRight size={16} className="text-[#8A6A15]" />
          </button>
        )}

        {(duplicateList.length > 0 || possibleDuplicateList.length > 0) && (
          <button onClick={() => setShowDuplicates(true)} className="w-full flex items-center gap-3 bg-[#C9982E]/12 border border-[#C9982E]/30 rounded-xl px-4 py-3 mb-4 text-left">
            <AlertCircle size={17} className="text-[#8A6A15] shrink-0" />
            <div className="flex-1">
              <div className="text-[13px] font-medium text-[#10201D]">
                {duplicateList.length > 0 && `${duplicateList.length} duplicate ${duplicateList.length === 1 ? "entry" : "entries"}`}
                {duplicateList.length > 0 && possibleDuplicateList.length > 0 && ", "}
                {possibleDuplicateList.length > 0 && `${possibleDuplicateList.length} possible ${possibleDuplicateList.length === 1 ? "match" : "matches"}`}
              </div>
              <div className="text-[11.5px] text-[#8A6A15]">Tap to review and merge</div>
            </div>
            <ChevronRight size={16} className="text-[#8A6A15]" />
          </button>
        )}

        <div className="flex items-center gap-2 mb-2">
          {[
            { key: "unpaid", label: "Unpaid first" },
            { key: "name", label: "Name A–Z" },
            { key: "winnings", label: "Winnings" },
          ].map((opt) => (
            <button
              key={opt.key}
              onClick={() => setSortMode(opt.key)}
              className={`text-[11px] font-medium px-3 py-1.5 rounded-full transition ${
                sortMode === opt.key ? "bg-[#2F6F5E] text-white" : "bg-white text-[#6B7A76]"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
        <div className="flex items-center justify-between mb-2.5">
          <span className="text-[12px] uppercase tracking-wide text-[#6B7A76]">Who owes what</span>
          <span className="text-[11px] uppercase tracking-wide text-[#6B7A76]">{pool.status === "drawn" ? "Actual winnings" : "Potential winnings"}</span>
        </div>
        <div className="space-y-2 mb-6">
          {pool.participants.length === 0 && <div className="text-[13.5px] text-[#8A968F] bg-white rounded-xl px-4 py-6 text-center">No one has joined yet — share your code to get started.</div>}
          {sortedParticipants.map((p) => {
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
                  <div className="flex items-center gap-5">
                    <button onClick={() => openEditAmount(p)} className="text-[#6B7A76] p-1"><Pencil size={13} /></button>
                    <button onClick={() => setRemovingParticipant(p)} className="text-[#C1473A] p-1"><UserX size={14} /></button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <div className="text-[12px] uppercase tracking-wide text-[#6B7A76] mb-2.5 flex items-center gap-2"><Landmark size={13} />Your payment details</div>
        <TicketCard className="mb-6">
          <p className="text-[12.5px] text-[#8A968F] mb-4">Only visible to people who've joined this syndicate. {COUNTRIES[pool.country].flag} {COUNTRIES[pool.country].name} ({COUNTRIES[pool.country].currency})</p>
          <Field label="Bank name"><input className={inputCls} placeholder="e.g. Commonwealth Bank" value={bankName} onChange={(e) => setBankName(e.target.value)} /></Field>
          <Field label="Account name"><input className={inputCls} placeholder="e.g. Gavin Davies" value={accountName} onChange={(e) => setAccountName(e.target.value)} /></Field>
          {COUNTRIES[pool.country].usesIban ? (
            <>
              <Field label="IBAN"><input className={inputCls} placeholder="IE29 AIBK 9311 5212 3456 78" value={iban} onChange={(e) => setIban(e.target.value)} /></Field>
              <Field label="BIC / SWIFT"><input className={inputCls} placeholder="AIBKIE2D" value={bic} onChange={(e) => setBic(e.target.value)} /></Field>
            </>
          ) : (
            <div className={COUNTRIES[pool.country].routingLabel ? "grid grid-cols-2 gap-3" : ""}>
              {COUNTRIES[pool.country].routingLabel && (
                <Field label={COUNTRIES[pool.country].routingLabel}><input className={inputCls} value={bsb} onChange={(e) => setBsb(e.target.value)} /></Field>
              )}
              <Field label="Account number"><input className={inputCls} value={accountNumber} onChange={(e) => setAccountNumber(e.target.value)} /></Field>
            </div>
          )}
          {COUNTRIES[pool.country].quickLabel && (
            <Field label={`${COUNTRIES[pool.country].quickLabel} (optional)`}><input className={inputCls} value={payid} onChange={(e) => setPayid(e.target.value)} /></Field>
          )}
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
            <Field label="Total winnings ($)"><input className={inputCls} inputMode="decimal" placeholder="0" value={winningsInput} onChange={(e) => setWinningsInput(e.target.value.replace(/[^0-9.]/g, ""))} autoFocus /></Field>
            <div className="flex gap-3"><Button variant="ghost" onClick={() => setShowResults(false)}>Cancel</Button><Button onClick={handleSubmitResults} disabled={!winningsInput}>Save results</Button></div>
          </div>
        </div>
      )}

      {showRollover && (
        <div className="fixed inset-0 z-30 flex items-end justify-center bg-black/40" onClick={() => setShowRollover(false)}>
          <div className="w-full max-w-[430px] bg-[#F7F2E7] rounded-t-3xl p-6 pb-8 max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="w-10 h-1 rounded-full bg-[#D8D0BC] mx-auto mb-5" />
            <h3 className="font-[Fraunces] text-[19px] text-[#10201D] font-medium mb-1">Roll winnings forward</h3>
            <p className="text-[13px] text-[#6B7A76] mb-4">Starts a new "{pool.name}" syndicate with {money(pool.actualWinnings, COUNTRIES[pool.country]?.currency)} noted as rolled over. A $3.00 AUD service fee applies, same as creating any syndicate.</p>
            <Field label="Jackpot estimate for next draw *"><input className={inputCls} inputMode="decimal" placeholder="40,000,000" value={rolloverJackpot} onChange={(e) => setRolloverJackpot(e.target.value.replace(/[^0-9.]/g, ""))} /></Field>
            <Field label="Draw date (optional)"><input type="date" className={inputCls} value={rolloverDrawDate} onChange={(e) => setRolloverDrawDate(e.target.value)} /></Field>
            <Field label="Entry deadline (optional)"><input type="datetime-local" className={inputCls} value={rolloverDeadline} onChange={(e) => setRolloverDeadline(e.target.value)} /></Field>
            <label className="flex items-center gap-2.5 mb-5 bg-white rounded-xl px-4 py-3">
              <input type="checkbox" checked={rolloverCarry} onChange={(e) => setRolloverCarry(e.target.checked)} className="w-4 h-4" />
              <span className="text-[13.5px] text-[#3E5652]">Carry over the same members and share percentages</span>
            </label>
            <label className="flex items-center gap-2.5 mb-5 bg-white rounded-xl px-4 py-3">
              <input type="checkbox" checked={rolloverCarryPayment} onChange={(e) => setRolloverCarryPayment(e.target.checked)} className="w-4 h-4" />
              <span className="text-[13.5px] text-[#3E5652]">Keep your payment details from this syndicate</span>
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

      {showDuplicates && (
        <div className="fixed inset-0 z-30 flex items-end justify-center bg-black/40" onClick={() => setShowDuplicates(false)}>
          <div className="w-full max-w-[430px] bg-[#F7F2E7] rounded-t-3xl p-6 pb-8 max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="w-10 h-1 rounded-full bg-[#D8D0BC] mx-auto mb-5" />
            <h3 className="font-[Fraunces] text-[19px] text-[#10201D] font-medium mb-1">Duplicate entries</h3>
            <p className="text-[13px] text-[#6B7A76] mb-5">Same person, same account, joined more than once. Pick which name to keep — amounts always combine into one total.</p>

            {duplicateList.length === 0 && possibleDuplicateList.length === 0 && (
              <p className="text-[13.5px] text-[#2F6F5E] text-center py-6">All merged — nothing left to clean up.</p>
            )}

            <div className="space-y-4">
              {duplicateList.map((group) => {
                const uid = group[0].userId;
                const selected = keepChoice[uid] || group[0].id;
                const total = group.reduce((s, p) => s + Number(p.amount || 0), 0);
                return (
                  <div key={uid} className="bg-white rounded-2xl p-4">
                    {group.map((p) => (
                      <label key={p.id} className="flex items-center gap-3 py-2 border-b border-[#F0EBDC] last:border-0">
                        <input
                          type="radio"
                          name={`keep-${uid}`}
                          checked={selected === p.id}
                          onChange={() => setKeepChoice((k) => ({ ...k, [uid]: p.id }))}
                          className="w-4 h-4"
                        />
                        <div className="flex-1">
                          <div className="text-[14px] font-medium text-[#10201D]">{p.name}</div>
                          <div className="text-[12px] text-[#8A968F]">{money(p.amount)}</div>
                        </div>
                      </label>
                    ))}
                    <div className="flex items-center justify-between mt-3 pt-3 border-t border-[#F0EBDC]">
                      <span className="text-[12.5px] text-[#6B7A76]">Combined total: <strong className="text-[#10201D]">{money(total)}</strong></span>
                      <Button full={false} onClick={() => handleMergeGroup(group, uid)} disabled={mergingUserId === uid} icon={mergingUserId === uid ? Loader2 : Check}>
                        {mergingUserId === uid ? "Merging…" : "Merge"}
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>

            {possibleDuplicateList.length > 0 && (
              <>
                <div className="flex items-center gap-2 mt-6 mb-1">
                  <AlertCircle size={15} className="text-[#8A6A15]" />
                  <h4 className="text-[13.5px] font-medium text-[#10201D]">Possible matches — please check</h4>
                </div>
                <p className="text-[12.5px] text-[#8A6A15] mb-4">These have similar names but aren't linked to the same account — could be the same person, or could genuinely be two different people. Only merge if you're sure.</p>
                <div className="space-y-4">
                  {possibleDuplicateList.map((group) => {
                    const gk = group[0].id;
                    const selected = keepChoice[gk] || group[0].id;
                    const total = group.reduce((s, p) => s + Number(p.amount || 0), 0);
                    return (
                      <div key={gk} className="bg-white rounded-2xl p-4 border border-[#C9982E]/30">
                        {group.map((p) => (
                          <label key={p.id} className="flex items-center gap-3 py-2 border-b border-[#F0EBDC] last:border-0">
                            <input
                              type="radio"
                              name={`keep-${gk}`}
                              checked={selected === p.id}
                              onChange={() => setKeepChoice((k) => ({ ...k, [gk]: p.id }))}
                              className="w-4 h-4"
                            />
                            <div className="flex-1">
                              <div className="text-[14px] font-medium text-[#10201D]">{p.name}</div>
                              <div className="text-[12px] text-[#8A968F]">{money(p.amount)}{!p.userId && " · no account linked"}</div>
                            </div>
                          </label>
                        ))}
                        <div className="flex items-center justify-between mt-3 pt-3 border-t border-[#F0EBDC]">
                          <span className="text-[12.5px] text-[#6B7A76]">Combined total: <strong className="text-[#10201D]">{money(total)}</strong></span>
                          <Button full={false} variant="ghost" onClick={() => handleMergeGroup(group, gk)} disabled={mergingUserId === gk} icon={mergingUserId === gk ? Loader2 : Check}>
                            {mergingUserId === gk ? "Merging…" : "Merge anyway"}
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            )}

            <div className="mt-5">
              <Button variant="ghost" onClick={() => setShowDuplicates(false)}>Done</Button>
            </div>
          </div>
        </div>
      )}

      {showPayoutQueue && (
        <div className="fixed inset-0 z-30 flex items-end justify-center bg-black/40" onClick={() => setShowPayoutQueue(false)}>
          <div className="w-full max-w-[430px] bg-[#F7F2E7] rounded-t-3xl p-6 pb-8 max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="w-10 h-1 rounded-full bg-[#D8D0BC] mx-auto mb-5" />
            <h3 className="font-[Fraunces] text-[19px] text-[#10201D] font-medium mb-1">Payout requests</h3>
            <p className="text-[13px] text-[#6B7A76] mb-5">Transfer their share directly, then upload proof and mark it paid — they'll leave the syndicate automatically once you do.</p>

            {payoutRequests.length === 0 && (
              <p className="text-[13.5px] text-[#2F6F5E] text-center py-6">All caught up — nothing pending.</p>
            )}

            <div className="space-y-4">
              {payoutRequests.map((req) => (
                <div key={req.id} className="bg-white rounded-2xl p-4">
                  <div className="flex items-center justify-between mb-2">
                    <div className="text-[15px] font-medium text-[#10201D]">{req.participant.name}</div>
                    <div className="font-[JetBrains_Mono] text-[15px] font-bold text-[#10201D]">{money(req.amount)}</div>
                  </div>
                  {(req.bank_name || req.account_name || req.bsb || req.account_number) ? (
                    <div className="bg-[#F7F2E7] rounded-xl p-3 mb-3 text-[12.5px] text-[#3E5652] space-y-0.5">
                      {req.account_name && <div>Account name: <strong>{req.account_name}</strong></div>}
                      {req.bank_name && <div>Bank: <strong>{req.bank_name}</strong></div>}
                      {req.bsb && <div>BSB: <strong>{req.bsb}</strong></div>}
                      {req.account_number && <div>Account no: <strong>{req.account_number}</strong></div>}
                      {req.payid && <div>PayID: <strong>{req.payid}</strong></div>}
                    </div>
                  ) : (
                    <p className="text-[12px] text-[#8A968F] mb-3">No bank details provided — contact them directly to arrange payment.</p>
                  )}

                  <div className="flex items-center gap-2 mb-3">
                    <label className="flex-1 text-center text-[12.5px] text-[#2F6F5E] border border-[#2F6F5E]/40 rounded-lg py-2 cursor-pointer">
                      {proofUploading === req.id ? "Uploading…" : req.proof_path ? "Replace proof screenshot" : "Upload proof screenshot"}
                      <input type="file" accept="image/*" className="hidden" disabled={proofUploading === req.id} onChange={(e) => { const f = e.target.files?.[0]; if (f) handleUploadProof(req.id, f); }} />
                    </label>
                    {req.proof_path && (
                      <button onClick={() => handleViewPayoutProof(req.proof_path)} className="text-[12px] text-[#2F6F5E] underline shrink-0">
                        {receiptLoading ? "Loading…" : "View"}
                      </button>
                    )}
                  </div>

                  <Button onClick={() => handleMarkPaid(req)} disabled={processingPayout === req.id} icon={processingPayout === req.id ? Loader2 : Check}>
                    {processingPayout === req.id ? "Processing…" : "Mark paid & remove from syndicate"}
                  </Button>
                </div>
              ))}
            </div>

            <div className="mt-5">
              <Button variant="ghost" onClick={() => setShowPayoutQueue(false)}>Done</Button>
            </div>
          </div>
        </div>
      )}

      {showManualMerge && (
        <div className="fixed inset-0 z-30 flex items-end justify-center bg-black/40" onClick={() => setShowManualMerge(false)}>
          <div className="w-full max-w-[430px] bg-[#F7F2E7] rounded-t-3xl p-6 pb-8 max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="w-10 h-1 rounded-full bg-[#D8D0BC] mx-auto mb-5" />
            <h3 className="font-[Fraunces] text-[19px] text-[#10201D] font-medium mb-1">Merge manually</h3>
            <p className="text-[13px] text-[#6B7A76] mb-4">Good for someone who joined under two different logins. Tick everyone who's really the same person, then pick which name to keep.</p>

            <div className="space-y-2 mb-4">
              {pool.participants.map((p) => {
                const checked = manualSelectedIds.includes(p.id);
                return (
                  <label key={p.id} className={`flex items-center gap-3 rounded-xl px-4 py-3 ${checked ? "bg-[#C9982E]/15 border border-[#C9982E]/40" : "bg-white"}`}>
                    <input type="checkbox" checked={checked} onChange={() => toggleManualSelect(p.id)} className="w-4 h-4" />
                    <div className="flex-1">
                      <div className="text-[14px] font-medium text-[#10201D]">{p.name}</div>
                      <div className="text-[12px] text-[#8A968F]">{money(p.amount)}{!p.userId && " · no account linked"}</div>
                    </div>
                  </label>
                );
              })}
            </div>

            {manualSelectedIds.length >= 2 && (
              <div className="bg-white rounded-2xl p-4 mb-4">
                <div className="text-[12px] uppercase tracking-wide text-[#6B7A76] mb-2">Keep which name?</div>
                {manualSelectedIds.map((id) => {
                  const p = pool.participants.find((x) => x.id === id);
                  if (!p) return null;
                  return (
                    <label key={id} className="flex items-center gap-3 py-1.5">
                      <input type="radio" name="manual-keep" checked={manualKeepId === id} onChange={() => setManualKeepId(id)} className="w-4 h-4" />
                      <span className="text-[13.5px] text-[#10201D]">{p.name}</span>
                    </label>
                  );
                })}
                <div className="text-[12.5px] text-[#6B7A76] mt-2 pt-2 border-t border-[#F0EBDC]">
                  Combined total: <strong className="text-[#10201D]">{money(manualSelectedIds.reduce((s, id) => s + Number(pool.participants.find((x) => x.id === id)?.amount || 0), 0))}</strong>
                </div>
              </div>
            )}

            <div className="flex gap-3">
              <Button variant="ghost" onClick={() => { setShowManualMerge(false); setManualSelectedIds([]); setManualKeepId(null); }}>Cancel</Button>
              <Button onClick={handleManualMerge} disabled={manualSelectedIds.length < 2 || manualMerging} icon={manualMerging ? Loader2 : Check}>
                {manualMerging ? "Merging…" : `Merge ${manualSelectedIds.length || ""}`}
              </Button>
            </div>
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
              <input className={inputCls} inputMode="decimal" value={jackpotValue} onChange={(e) => setJackpotValue(e.target.value.replace(/[^0-9.]/g, ""))} autoFocus />
            </Field>
            <div className="flex gap-3">
              <Button variant="ghost" onClick={() => setEditingJackpot(false)}>Cancel</Button>
              <Button onClick={saveJackpot} disabled={!jackpotValue || jackpotSaving} icon={jackpotSaving ? Loader2 : Check}>{jackpotSaving ? "Saving…" : "Save"}</Button>
            </div>
          </div>
        </div>
      )}

      {editingName && (
        <div className="fixed inset-0 z-30 flex items-end justify-center bg-black/40" onClick={() => setEditingName(false)}>
          <div className="w-full max-w-[430px] bg-[#F7F2E7] rounded-t-3xl p-6 pb-8" onClick={(e) => e.stopPropagation()}>
            <div className="w-10 h-1 rounded-full bg-[#D8D0BC] mx-auto mb-5" />
            <h3 className="font-[Fraunces] text-[19px] text-[#10201D] font-medium mb-1">Rename syndicate</h3>
            <p className="text-[13px] text-[#6B7A76] mb-4">Visible to everyone in this syndicate, including on their invite link.</p>
            <Field label="Syndicate name">
              <input className={inputCls} value={nameValue} onChange={(e) => setNameValue(e.target.value)} autoFocus />
            </Field>
            <div className="flex gap-3">
              <Button variant="ghost" onClick={() => setEditingName(false)}>Cancel</Button>
              <Button onClick={saveName} disabled={!nameValue.trim() || nameSaving} icon={nameSaving ? Loader2 : Check}>{nameSaving ? "Saving…" : "Save"}</Button>
            </div>
          </div>
        </div>
      )}

      {editingDeadline && (
        <div className="fixed inset-0 z-30 flex items-end justify-center bg-black/40" onClick={() => setEditingDeadline(false)}>
          <div className="w-full max-w-[430px] bg-[#F7F2E7] rounded-t-3xl p-6 pb-8" onClick={(e) => e.stopPropagation()}>
            <div className="w-10 h-1 rounded-full bg-[#D8D0BC] mx-auto mb-5" />
            <h3 className="font-[Fraunces] text-[19px] text-[#10201D] font-medium mb-1">{pool.entryDeadline ? "Edit entry deadline" : "Add an entry deadline"}</h3>
            <p className="text-[13px] text-[#6B7A76] mb-4">After this time, no one new can join or contribute to this syndicate.</p>
            <Field label="Entry deadline">
              <input type="datetime-local" className={inputCls} value={deadlineValue} onChange={(e) => setDeadlineValue(e.target.value)} autoFocus />
            </Field>
            <div className="flex gap-3">
              <Button variant="ghost" onClick={() => setEditingDeadline(false)}>Cancel</Button>
              <Button onClick={saveDeadline} disabled={!deadlineValue || deadlineSaving} icon={deadlineSaving ? Loader2 : Check}>{deadlineSaving ? "Saving…" : "Save"}</Button>
            </div>
            {pool.entryDeadline && (
              <button onClick={removeDeadline} disabled={deadlineSaving} className="w-full text-center text-[12.5px] text-[#C1473A] underline mt-4">
                Remove deadline — allow entries any time
              </button>
            )}
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
      {showReviewModal && <ReviewModal session={session} profile={null} onClose={() => setShowReviewModal(false)} />}
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

  // Native only: catch the app.lottosyndicate://auth-callback link the OS hands back
  // to us after someone taps a magic-link email, and finish signing them in.
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    const listenerPromise = CapacitorApp.addListener("appUrlOpen", async ({ url }) => {
      try {
        const parsed = new URL(url);
        const hashParams = new URLSearchParams(
          parsed.hash && parsed.hash.startsWith("#") ? parsed.hash.slice(1) : parsed.hash
        );
        const access_token = hashParams.get("access_token");
        const refresh_token = hashParams.get("refresh_token");
        const code = parsed.searchParams.get("code");
        if (access_token && refresh_token) {
          await supabase.auth.setSession({ access_token, refresh_token });
        } else if (code) {
          await supabase.auth.exchangeCodeForSession(code);
        }
      } catch (e) {
        console.error("Deep link sign-in failed:", e);
      }
    });
    return () => { listenerPromise.then((l) => l.remove()); };
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
      fetch("/api/track-visit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ visitorId }),
      }).catch(() => {}); // best-effort — never block the app on this
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
    return <Dashboard key={route.code} session={session} code={route.code} onBack={goHome} onSignIn={requestSignIn} isAdmin={isAdmin} onNavigateCode={goDashboard} />;
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
    return (
      <ProfileScreen
        session={session}
        onBack={() => setSubRoute(null)}
        onAccountDeleted={() => { setSubRoute(null); goHome(); }}
      />
    );
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
      return <ViewPool key={foundPool.code} code={foundPool.code} session={session} onBack={() => setSubRoute("landing")} onChat={() => setSubRoute("chat")} />;
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
    return <CreatePool session={session} onBack={() => setSubRoute(null)} onCreated={(code) => { setSubRoute(null); goDashboard(code); }} />;
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
