/* ================= debug: the ledger =================
   A dev-only tab showing every number the game deliberately hides —
   ideology vectors, affinity, compatibility, flares, legitimacy, the lot.
   Injected into the nav at boot ONLY when the logged-in Supabase user
   matches the allowlist below, so it doesn't exist in the DOM for anyone
   else. Playtesting instrument, not a game surface: raw tables, no voice.

   To find your uid the first time: boot the game and check the browser
   console — it's logged once at startup regardless of allowlist. Paste it
   (or just your email) below. */

import { $ } from "./dom.js";
import { S } from "./state.js";
import { db } from "./db.js";
import { byId } from "./helpers.js";
import { bondKey, compatibility, isMismatched, termBreakdown } from "./bonds.js";
import { AXES } from "./ideology.js";
import { toxLoad } from "./toxins.js";

const DEBUG_UIDS = [
  "df874858-baf7-46ed-86f4-5d16aec1056a"
];
const DEBUG_EMAILS = [
  // "you@example.com"
];

const fmt = (n, d = 2) => (n === undefined || n === null) ? "—" : (+n).toFixed(d);
const cell = "padding:3px 8px;border-bottom:1px solid rgba(0,0,0,.08);text-align:left;white-space:nowrap";
const th = cell + ";font-weight:600;position:sticky;top:0;background:var(--paper)";
const tbl = "border-collapse:collapse;font:11.5px/1.5 ui-monospace,monospace;margin:8px 0 18px;overflow-x:auto;display:block;max-width:100%";
const h2 = `style="font:600 13px ui-monospace,monospace;letter-spacing:.08em;text-transform:uppercase;margin:16px 0 2px;color:var(--ink-soft)"`;

function renderDebug() {
  const el = $("tab-debug");
  if (!el || !S) return;

  /* --- village scalars: everything commented HIDDEN in state.js --- */
  let h = `<div ${h2}>Village — the hidden scalars</div>
  <table style="${tbl}"><tr>
    <th style="${th}">day</th><th style="${th}">legitimacy</th><th style="${th}">reputation</th>
    <th style="${th}">neighborStanding</th><th style="${th}">gwContam</th><th style="${th}">hungerDays</th><th style="${th}">lowSpiritsStreak</th></tr>
  <tr><td style="${cell}">${S.day}</td><td style="${cell}">${fmt(S.legitimacy, 1)}</td>
    <td style="${cell}">${fmt(S.reputation)}</td><td style="${cell}">${fmt(S.neighborStanding)}</td><td style="${cell}">${fmt(S.groundwaterContam,1)}</td>
    <td style="${cell}">${S.hungerDays}</td><td style="${cell}">${S.lowSpiritsStreak ?? 0}</td></tr></table>`;

  if (S.f && S.f.ideoSeed) {
    h += `<div ${h2}>Founding ideology seed (applied to founders, once)</div>
    <div style="font:11.5px ui-monospace,monospace;margin-bottom:14px">${
      Object.entries(S.f.ideoSeed).map(([ax, v]) => `${ax} ${v >= 0 ? "+" : ""}${fmt(v)}`).join(" · ")}</div>`;
  }

  /* --- people: personality, wb, mediate practice, full ideology vector --- */
  h += `<div ${h2}>People</div><table style="${tbl}"><tr>
    <th style="${th}">name</th><th style="${th}">type</th><th style="${th}">wb</th><th style="${th}">job</th>
    <th style="${th}">toxins</th><th style="${th}">mediate</th>${AXES.map(ax => `<th style="${th}">${ax.slice(0, 5)}</th>`).join("")}</tr>`;
  for (const p of S.people) {
    const band = x => x >= 0.5 ? "background:rgba(90,140,70,.18)" : x <= -0.5 ? "background:rgba(170,80,50,.18)" : "";
    h += `<tr><td style="${cell}">${p.name}</td><td style="${cell}">${p.personality || "—"}</td>
      <td style="${cell}">${fmt(p.wb, 0)}</td><td style="${cell}">${p.job || "—"}</td>
      <td style="${cell};${(p.toxins||0)>=25?"background:rgba(170,80,50,.18)":""}">${fmt(p.toxins||0,1)}${(p.toxins||0)>0?` (×${fmt(1+1.4*toxLoad(p))} ill)`:""}</td>
      <td style="${cell}">${fmt(p.practice?.specific?.mediate || 0)}</td>
      ${AXES.map(ax => { const v = p.ideology ? p.ideology[ax] : undefined; return `<td style="${cell};${v !== undefined ? band(v) : ""}">${fmt(v)}</td>`; }).join("")}</tr>`;
  }
  h += `</table>`;

  /* --- bonds: both dimensions, live compat + term breakdown, flare state --- */
  const rows = [];
  for (const [key, b] of Object.entries(S.bonds || {})) {
    if (typeof b === "number") { rows.push({ key, legacy: true, fam: b }); continue; }
    const [idA, idB] = key.split(":");
    const pA = byId(idA), pB = byId(idB);
    if (!pA || !pB) continue;   // the dead and departed keep their rows in state, not in the ledger
    const t = termBreakdown(pA, pB);
    rows.push({
      key: `${pA.name}·${pB.name}`, fam: b.familiarity, aff: b.affinity,
      compat: compatibility(pA, pB), persona: t.persona, ideo: t.ideo,
      mm: isMismatched(pA, pB), flares: b.flares || 0,
      lastFix: b.lastFix ? `${b.lastFix.kind}@${b.lastFix.day}` : "",
      log: (b.log || []).map(e => `d${e.day} ${e.cause[0]}${e.circumstantial ? "·c" : ""}`).join(" ")
    });
  }
  rows.sort((a, b) => (a.aff ?? 99) - (b.aff ?? 99));   // coldest pairs first — they're the story
  h += `<div ${h2}>Bonds (coldest first) — fam / aff / compat = 1 + persona + ideo</div><table style="${tbl}"><tr>
    <th style="${th}">pair</th><th style="${th}">fam</th><th style="${th}">aff</th><th style="${th}">compat</th>
    <th style="${th}">persona</th><th style="${th}">ideo</th><th style="${th}">mm</th><th style="${th}">flares</th>
    <th style="${th}">lastFix</th><th style="${th}">log (v=values t=temp ·c=circ)</th></tr>`;
  for (const r of rows) {
    if (r.legacy) { h += `<tr><td style="${cell}">${r.key}</td><td style="${cell}">${fmt(r.fam)}</td><td style="${cell}" colspan="8">legacy numeric bond</td></tr>`; continue; }
    const warn = r.compat < 0 ? "background:rgba(170,80,50,.18)" : r.mm ? "background:rgba(200,160,60,.15)" : "";
    h += `<tr style="${warn}"><td style="${cell}">${r.key}</td><td style="${cell}">${fmt(r.fam)}</td>
      <td style="${cell}">${fmt(r.aff)}</td><td style="${cell}">${fmt(r.compat)}</td>
      <td style="${cell}">${fmt(r.persona)}</td><td style="${cell}">${fmt(r.ideo)}</td>
      <td style="${cell}">${r.mm ? "✕" : ""}</td><td style="${cell}">${r.flares}</td>
      <td style="${cell}">${r.lastFix}</td><td style="${cell};white-space:normal;min-width:160px">${r.log}</td></tr>`;
  }
  h += `</table>`;

  /* --- active conflicts, full internals --- */
  h += `<div ${h2}>Active conflicts</div>`;
  if (!(S.activeConflicts || []).length) h += `<div style="font:11.5px ui-monospace,monospace">none</div>`;
  else {
    h += `<table style="${tbl}"><tr><th style="${th}">pair</th><th style="${th}">cause</th><th style="${th}">sev</th>
      <th style="${th}">status</th><th style="${th}">circShare</th><th style="${th}">since</th><th style="${th}">progress/until</th></tr>`;
    for (const c of S.activeConflicts) {
      h += `<tr><td style="${cell}">${c.pair.map(id => byId(id)?.name || id).join("·")}</td>
        <td style="${cell}">${c.cause}</td><td style="${cell}">${c.severity}</td><td style="${cell}">${c.status}</td>
        <td style="${cell}">${fmt(c.circShare)}</td><td style="${cell}">d${c.startDay}</td>
        <td style="${cell}">${c.status === "cooling" ? "until d" + c.until : c.status === "jointwork" ? c.progress + "/5, dl d" + c.deadline : "—"}</td></tr>`;
    }
    h += `</table>`;
  }

  h += `<button class="confirm" id="dbgRefresh" style="max-width:200px">Refresh</button>
    <div style="font:10.5px ui-monospace,monospace;color:var(--ink-soft);margin-top:8px">re-renders on tab open; numbers move at end of day</div>`;
  el.innerHTML = h;
  $("dbgRefresh").onclick = renderDebug;
}

async function initDebugTab() {
  let user = null;
  try { user = (await db.auth.getUser()).data.user; } catch (e) { /* not signed in */ }
  if (user) console.info("[ledger] uid:", user.id, "email:", user.email);   // so you can copy it into the allowlist
  const ok = user && (DEBUG_UIDS.includes(user.id) || DEBUG_EMAILS.includes(user.email));
  if (!ok) return;

  // inject the nav button and tab section — they exist only for you
  const nav = document.querySelector("nav");
  const btn = document.createElement("button");
  btn.dataset.tab = "debug"; btn.textContent = "Ledger";
  nav.appendChild(btn);
  const sec = document.createElement("section");
  sec.id = "tab-debug"; sec.style.display = "none";
  document.querySelector("main").appendChild(sec);

  const TABS = ["village", "beyond", "works", "power", "water", "people", "journal"];
  btn.onclick = () => {
    document.querySelectorAll("nav button").forEach(x => x.classList.remove("on"));
    btn.classList.add("on");
    TABS.forEach(t => { const el = $("tab-" + t); if (el) el.style.display = "none"; });
    sec.style.display = "";
    renderDebug();
  };
  // the stock nav handlers don't know this tab exists; hide it when they fire.
  // addEventListener rides alongside their onclick= without replacing it.
  document.querySelectorAll("nav button").forEach(b => {
    if (b !== btn) b.addEventListener("click", () => { sec.style.display = "none"; });
  });
}

export { initDebugTab, renderDebug };
