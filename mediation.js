/* ================= conflict mediation =================
   Milestone 5: the first interactive phase-2 system.

   A conflict is a promoted pattern, not a single bad day — three flares in
   a season between the same pair. The player reads symptoms (the pair's
   recent flare lines, shown verbatim; never the cause tag, never a number)
   and picks an intervention. Each intervention is diagnostically RIGHT for
   a specific kind of conflict and costs real ground when misapplied:

     give them space   — right for circumstantial flares (a hard week, not
                         really about them); wrong for a pattern
     shared task       — right for temperament + decent familiarity: there's
                         no belief to reconcile, only chemistry to prove out.
                         Wrong for values: now the disagreement co-owns a project
     air it out        — right for values: a real disagreement, worked
                         through in the open. Wrong for temperament: you
                         can't amend finding someone tedious; it just
                         embarrasses two people over nothing
     peer mediation    — gated on someone having real standing with BOTH;
                         player picks who; reliable but the mediator pays
                         in wb (emotional labor), scaled by severity,
                         reduced by care skill + Mender + earned practice
     let it be         — the default; genuinely correct for minor first
                         frictions. The ambient layer keeps running either
                         way; mediation is an override, never a queue.

   Legitimacy (S.legitimacy, hidden) moves here too: an honest public
   airing builds a sliver; a misjudged one spends some. */

import { S } from "./state.js";
import { $ } from "./dom.js";
import { byId, clamp, effStat, growPractice, practiceOf, wbFloor } from "./helpers.js";
import { PRACTICE_SPECIFIC_CAP, PRACTICE_SPECIFIC_GROWTH } from "./data-economy.js";
import { bondKey, bondOf } from "./bonds.js";
import { openSheet, closeSheet } from "./sheets.js";
import { renderAll } from "./render.js";

/* --- tuning --- */
const SPACE_DAYS = 12;
const JOINT_DAYS_NEEDED = 5;
const JOINT_DEADLINE = 20;
const FADE_P = 0.03;          // open conflicts can just blow over...
const FADE_QUIET_DAYS = 10;   // ...once the flares have actually stopped
const FESTER_P = 0.01;
const MED_MIN_STANDING = 3.5; // familiarity+affinity floor, to EACH party
const MED_GAP_LOPSIDED = 2.5;

function ensureConflictState() {
  if (!S.activeConflicts) S.activeConflicts = [];
  if (S.legitimacy === undefined) S.legitimacy = 70;
  if (!S.conflictSeq) S.conflictSeq = 1;
}
const conflictFor = key => (S.activeConflicts || []).find(c => c.key === key);
const legit = amt => { S.legitimacy = clamp((S.legitimacy ?? 70) + amt, 0, 100); };

/* ================= promotion ================= */
function promoteConflict(pA, pB, b, lines) {
  ensureConflictState();
  const key = bondKey(pA.id, pB.id);
  if (conflictFor(key)) return;

  const log = b.log || [];
  const values = log.filter(e => e.cause === "values").length;
  const cause = values > log.length / 2 ? "values" : "temperament";
  const circShare = log.length ? log.filter(e => e.circumstantial).length / log.length : 0;
  const severity = Math.min(3, 1 + (b.flares >= 5 ? 1 : 0) + (b.affinity <= -3 ? 1 : 0));

  S.activeConflicts.push({
    id: S.conflictSeq++, key, pair: [pA.id, pB.id],
    cause, circShare, severity,
    startDay: S.day, status: "open", intervention: null, progress: 0
  });

  // the promotion line remembers the last fix, if there was one — a durable
  // record: what you chose for this pair before is part of their story now
  const prior = b.lastFix
    ? (b.lastFix.kind === "mediate"
        ? ` ${byId(b.lastFix.by)?.name || "Someone"}'s talk with them didn't hold, it seems.`
        : " It has flared before; whatever settled it then hasn't held.")
    : "";
  lines.push(`It's past small things now with ${pA.name} and ${pB.name}. The village can feel it.${prior}`);
}

/* ================= the daily tick ================= */
function tickConflicts(lines) {
  ensureConflictState();
  for (const c of [...S.activeConflicts]) {
    const pA = byId(c.pair[0]), pB = byId(c.pair[1]);
    // a party died or departed: the conflict leaves with them
    if (!pA || !pB) { removeConflict(c); continue; }
    const b = bondOf(S.bonds, c.key);

    if (c.status === "open") {
      const lastFlare = (b.log || []).length ? b.log[b.log.length - 1].day : c.startDay;
      const quiet = S.day - lastFlare >= FADE_QUIET_DAYS;
      if (quiet && Math.random() < FADE_P) {
        resolve(c, b, { aff: +0.5, kind: "faded" });
        lines.push(`Whatever it was between ${pA.name} and ${pB.name} seems to have gone quiet on its own. Not every knot needs untying.`);
      } else if (Math.random() < FESTER_P) {
        c.severity = Math.min(3, c.severity + 1);
        b.affinity = Math.max(-10, b.affinity - 0.3);
        b.log = b.log || [];
        b.log.push({ day: S.day, cause: c.cause, circumstantial: false, line: "It got worse, quietly." });
        if (b.log.length > 5) b.log.shift();
        lines.push(`The thing between ${pA.name} and ${pB.name} is calcifying. People have started planning around it.`);
      }
    }

    else if (c.status === "cooling" && S.day >= c.until) {
      if (c.circShare > 0.5) {
        resolve(c, b, { aff: +0.8, kind: "space" });
        lines.push(`The space seems to have done it. ${pA.name} and ${pB.name} shared a bench this evening, and it was fine.`);
      } else {
        c.status = "open";
        lines.push(`The space between ${pA.name} and ${pB.name} didn't help; if anything it let the silence calcify.`);
      }
    }

    else if (c.status === "jointwork") {
      const together = pA.job && pA.job === pB.job &&
        (pA.status === "ok" || pA.status === "spent") && (pB.status === "ok" || pB.status === "spent");
      if (together) c.progress++;
      if (c.progress >= JOINT_DAYS_NEEDED) {
        if (c.cause === "temperament" && b.familiarity >= 3) {
          resolve(c, b, { aff: +2.0, kind: "jointwork" });
          lines.push(`${pA.name} and ${pB.name} finished the stretch of work side by side, and finished it friends — or near enough. A thing built together argues for itself.`);
        } else {
          c.status = "open"; c.severity = Math.min(3, c.severity + 1); c.progress = 0;
          b.affinity = Math.max(-10, b.affinity - 1.0);
          b.log = b.log || [];
          b.log.push({ day: S.day, cause: c.cause, circumstantial: false, line: "The shared work made it worse." });
          if (b.log.length > 5) b.log.shift();
          lines.push(`Putting ${pA.name} and ${pB.name} on the same work only gave the disagreement a shared address. It's worse now.`);
        }
      } else if (S.day >= c.deadline) {
        c.status = "open"; c.progress = 0;
        lines.push(`${pA.name} and ${pB.name} never did end up working the same job long enough for it to matter.`);
      }
    }
  }
}

function resolve(c, b, { aff, kind, by, quality }) {
  b.affinity = clamp(b.affinity + aff, -10, 10);
  b.flares = 0;
  b.lastFix = { day: S.day, kind, by: by || null, quality: quality || "full" };
  removeConflict(c);
}
function removeConflict(c) { S.activeConflicts = S.activeConflicts.filter(x => x.id !== c.id); }

/* ================= interventions (called from the sheet) ================= */
function doGiveSpace(c) {
  c.status = "cooling"; c.until = S.day + SPACE_DAYS; c.intervention = "space";
  S.pending.push(`We arranged things so ${names(c)} wouldn't be elbow to elbow for a while. Sometimes distance is the kindest tool.`);
  finishAction();
}

function doJointWork(c) {
  c.status = "jointwork"; c.deadline = S.day + JOINT_DEADLINE; c.progress = 0; c.intervention = "jointwork";
  S.pending.push(`The thought is to give ${names(c)} something to build together. It falls to you to actually put them on the same work.`);
  finishAction();
}

function doAirOut(c) {
  const [pA, pB] = c.pair.map(byId);
  const b = bondOf(S.bonds, c.key);
  c.intervention = "aired";
  if (c.cause === "values") {
    if (Math.random() < 0.75) {
      resolve(c, b, { aff: +1.5, kind: "aired" });
      legit(+2);
      S.pending.push(`It all came out at the Commons — ${pA.name} and ${pB.name}, and the whole village listening. Hard to say who gave more ground, but ground was given. People slept easier for having heard it said out loud.`);
    } else {
      resolve(c, b, { aff: +0.6, kind: "aired", quality: "partial" });
      S.pending.push(`The airing at the Commons helped, some. ${pA.name} and ${pB.name} understand each other better now, which is not the same as agreeing.`);
    }
  } else {
    // there was no position to concede — just two people embarrassed in public
    b.affinity = Math.max(-10, b.affinity - 1.2);
    c.severity = Math.min(3, c.severity + 1);
    legit(-3);
    S.pending.push(`The meeting was a mistake. There was no disagreement to work through — ${pA.name} and ${pB.name} just don't much like each other, and now everyone's watched them fail to say so politely.`);
  }
  finishAction();
}

function doPeerMediate(c, mediatorId) {
  const [pA, pB] = c.pair.map(byId);
  const m = byId(mediatorId);
  if (!m) return;
  const b = bondOf(S.bonds, c.key);
  const sA = standing(m, pA), sB = standing(m, pB);
  const gap = Math.abs(sA - sB);
  const pr = practiceOf(m);
  const skill = effStat(m, "care", "mediate") + (m.trait === "Mender" ? 1.5 : 0);

  // emotional labor: the cost is real, scaled by severity, eased by skill
  const wbCost = clamp(6 + 3 * c.severity - 0.8 * skill, 2, 14);
  m.wb = clamp(m.wb - wbCost, wbFloor(m), 100);

  const quality = 0.9 * skill + 0.35 * Math.min(sA, sB) - 0.5 * gap + (Math.random() * 2 - 1);
  pr.specific.mediate = growPractice(pr.specific.mediate || 0, PRACTICE_SPECIFIC_CAP, PRACTICE_SPECIFIC_GROWTH * (quality >= 2 ? 8 : 4));

  if (quality >= 4) {
    resolve(c, b, { aff: +2.2, kind: "mediate", by: m.id });
    // success reinforces the mediator's standing with both — helping lands
    for (const p of [pA, pB]) {
      const mb = bondOf(S.bonds, bondKey(m.id, p.id));
      mb.affinity = clamp(mb.affinity + 0.3, -10, 10);
    }
    S.pending.push(`${m.name} sat with ${pA.name} and ${pB.name} until it was talked all the way through. It cost ${m.name} something — you could see it — but it held.`);
  } else if (quality >= 2) {
    resolve(c, b, { aff: +1.0, kind: "mediate", by: m.id, quality: "partial" });
    let line = `${m.name} got ${pA.name} and ${pB.name} to a truce, if not a peace.`;
    if (gap > MED_GAP_LOPSIDED) {
      const lesser = sA < sB ? pA : pB;
      const mb = bondOf(S.bonds, bondKey(m.id, lesser.id));
      mb.affinity = clamp(mb.affinity - 0.4, -10, 10);
      line += ` Though ${lesser.name} came away feeling a little outnumbered in that room.`;
    }
    S.pending.push(line);
  } else {
    b.affinity = Math.max(-10, b.affinity - 0.3);
    S.pending.push(`${m.name} tried to talk ${pA.name} and ${pB.name} through it, and it went nowhere. ${m.name} came home tired for nothing.`);
  }
  finishAction();
}

function finishAction() { closeSheet(); renderAll(); }
const names = c => c.pair.map(id => byId(id)?.name || "someone").join(" and ");

/* ================= mediator gating ================= */
const standing = (m, p) => {
  const b = bondOf(S.bonds, bondKey(m.id, p.id));
  return b.familiarity + b.affinity;
};
function mediatorCandidates(c) {
  const [idA, idB] = c.pair;
  return S.people.filter(m =>
    m.id !== idA && m.id !== idB &&
    m.age >= 16 && m.status !== "away" && m.status !== "down" &&
    Math.min(standing(m, byId(idA)), standing(m, byId(idB))) >= MED_MIN_STANDING
  );
}
// the qualitative balance line — the ONLY relational read the player gets.
// The gap decides the bucket; no number ever shows.
function balanceLine(m, c) {
  const [pA, pB] = c.pair.map(byId);
  const sA = standing(m, pA), sB = standing(m, pB);
  const gap = Math.abs(sA - sB);
  if (gap <= 1.2) return `close with both of them`;
  const nearer = sA > sB ? pA : pB, further = sA > sB ? pB : pA;
  if (gap <= MED_GAP_LOPSIDED) return `knows ${nearer.name} a little better than ${further.name}`;
  return `${nearer.name}'s friend, really — ${further.name} may see it that way too`;
}

/* ================= UI ================= */
function openConflictSheet(cid) {
  ensureConflictState();
  const c = S.activeConflicts.find(x => x.id === Number(cid));
  if (!c) return;
  const [pA, pB] = c.pair.map(byId);
  const b = bondOf(S.bonds, c.key);
  const recent = (b.log || []).slice(-3).map(e => `<div style="font-family:var(--serif);font-style:italic;font-size:13.5px;color:var(--ink-soft);margin:6px 0;line-height:1.5">Day ${e.day} — ${e.line}</div>`).join("");
  const cands = mediatorCandidates(c);

  openSheet(`<h3>${pA.name} and ${pB.name}</h3>
    <div class="sub">It's been going on ${S.day - c.startDay < 2 ? "since just now" : `for ${S.day - c.startDay} days`}. What the journal remembers:</div>
    ${recent || `<div class="sub" style="font-style:italic">Nothing written down — only a feeling in the room.</div>`}
    <div style="margin-top:14px"></div>
    <button class="opt" id="cfSpace"><span class="l1">Give them space</span><span class="l2">Keep them off shared work a while. Kind, if it's the season talking and not the two of them.</span></button>
    <button class="opt" id="cfJoint"><span class="l1">Give them something to build together</span><span class="l2">A shared job, seen through. Chemistry can be proven wrong — a real disagreement can't.</span></button>
    <button class="opt" id="cfAir"><span class="l1">Air it out at the Commons</span><span class="l2">Say it in the open, all of it. Honest work if there's a real disagreement under there. Cruel if there isn't.</span></button>
    ${cands.length
      ? `<button class="opt" id="cfPeer"><span class="l1">Ask someone to sit with them</span><span class="l2">Someone they both trust. It will cost that person something.</span></button>`
      : `<div class="sub" style="font-style:italic;margin-top:7px">Nobody stands close enough to both of them to sit in the middle. That's its own kind of finding.</div>`}
    <button class="opt" id="cfLet" style="margin-top:7px"><span class="l1">Let it be</span><span class="l2">Not every knot needs untying. Some tighten when pulled.</span></button>`);

  $("cfSpace").onclick = () => doGiveSpace(c);
  $("cfJoint").onclick = () => doJointWork(c);
  $("cfAir").onclick = () => doAirOut(c);
  if (cands.length) $("cfPeer").onclick = () => openMediatorSheet(c);
  $("cfLet").onclick = () => { c.intervention = "letbe"; closeSheet(); };
}

function openMediatorSheet(c) {
  const [pA, pB] = c.pair.map(byId);
  const cands = mediatorCandidates(c);
  let h = `<h3>Who sits with them?</h3>
    <div class="sub">Between ${pA.name} and ${pB.name}. Whoever it is pays for it in spirit — more, the deeper this runs.</div>`;
  for (const m of cands) {
    h += `<button class="opt" data-med="${m.id}">
      <span class="l1">${m.name} <span style="font-size:11px;color:var(--ink-soft)">· ${m.trait} · spirits ${m.wb.toFixed(0)}</span></span>
      <span class="l2">${balanceLine(m, c)}${m.trait === "Mender" ? " · a mender's hands for exactly this" : ""}</span>
    </button>`;
  }
  h += `<button class="opt" id="medBack" style="margin-top:7px;justify-content:center"><span class="l1">Back</span></button>`;
  openSheet(h);
  document.querySelectorAll("[data-med]").forEach(el => { el.onclick = () => doPeerMediate(c, el.dataset.med); });
  $("medBack").onclick = () => openConflictSheet(c.id);
}

export { ensureConflictState, mediatorCandidates, openConflictSheet, promoteConflict, tickConflicts };
