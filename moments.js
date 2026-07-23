/* ================= moments =================
   Small tender lines for the journal, generated from the bond graph the
   sim already keeps. This is the output channel for relationship state
   that was previously visible only in the dev Ledger.

   Rules:
   - at most ONE moment per day, and only some days (MOMENT_DAILY_P)
   - a pair rests MOMENT_PAIR_COOLDOWN days between lines
   - warm and visiting moments ALSO warm the pair a little (the moment is
     both a report and an event); cooling and ambient lines change nothing
   - cooling lines fire only for pairs well below a real former closeness
     (b.peakAff, tracked in tickBondPair) — never for strangers
   - both people present; if one is laid up, the other may visit — unless
     they're the assigned caretaker, in which case it's a shift, not a
     visit, and the caretaker bond tick already covers it */

import { S } from "./state.js";
import { byId, pick, poss, objp } from "./helpers.js";
import { bondKey, bondOf } from "./bonds.js";
import { DOC_BY_LEAN, JOB_PLACE, MOMENTS, MOMENT_AFF, MOMENT_DAILY_P, MOMENT_PAIR_COOLDOWN, MOMENT_TIERS, SKILL_TEACH, TOOL_BY_JOB } from "./data-moments.js";

const present = p => p && p.status !== "away";
const upright = p => present(p) && p.status !== "down";

/* --- gates: named in data, resolved here. ctx = {A,B,b} --- */
const GATES = {
  tower:        () => S.founding && S.founding.visuals && S.founding.visuals.includes("tower"),
  rain:         () => S.weather === "rain",
  sharedJob:    (c) => c.A.job && c.A.job === c.B.job,
  hasJobPlace:  (c) => !!JOB_PLACE[c.B.job],
  hasTool:      (c) => !!TOOL_BY_JOB[c.A.job],
  hasSkillGap:  (c) => !!skillGapOf(c.A, c.B),
  returnedToday:(c) => (S.returnedToday||[]).some(r => r.id === c.A.id),
  three:        (c) => !!c.C,
  musical:      (c) => (c.A.music||[]).some(m => m !== "singing" && m !== "clapping") && (c.B.music||[]).includes("singing"),
  oneDown:      (c) => c.B.status === "down" && upright(c.A) && c.A.job !== "care",
  closePair:    (c) => c.b.affinity >= MOMENT_TIERS.t2,
  peakDrop:     (c) => (c.b.peakAff||0) >= 3 && c.b.affinity < (c.b.peakAff||0) * 0.55
};

function skillGapOf(A, B){
  let best = null, gap = 1.5;   // needs a real gap, not a sliver
  for(const k of Object.keys(SKILL_TEACH)){
    const d = (A[k]||0) - (B[k]||0);
    if(d >= gap){ gap = d; best = k; }
  }
  return best && SKILL_TEACH[best];
}
function leanOf(p){
  let best = "care", v = -1;
  for(const k of ["green","wild","care","hands"]) if((p[k]||0) > v){ v = p[k]; best = k; }
  return best;
}

function fill(t, c){
  return t
    .replaceAll("{A}", c.A.name).replaceAll("{B}", c.B.name)
    .replaceAll("{C}", c.C ? c.C.name : "someone")
    .replaceAll("{Aposs}", poss(c.A)).replaceAll("{Bobj}", objp(c.B))
    .replaceAll("{tool}", TOOL_BY_JOB[c.A.job] || "knife")
    .replaceAll("{document}", pick(DOC_BY_LEAN[leanOf(c.A)]))
    .replaceAll("{skill}", skillGapOf(c.A, c.B) || "a trick of the trade")
    .replaceAll("{job}", JOB_PLACE[c.A.job] || "their work")
    .replaceAll("{jobplace}", JOB_PLACE[c.B.job] || "where {B} was working".replace("{B}", c.B.name))
    .replaceAll("{explace}", (S.returnedToday||[]).find(r=>r.id===c.A.id)?.place || "the road")
    .replaceAll("{instrument}", (c.A.music||[]).find(m => m!=="singing" && m!=="clapping") || "guitar");
}

function eligible(m, c){
  if(m.needs) for(const g of m.needs){ if(!GATES[g] || !GATES[g](c)) return false; }
  if(m.once && c.b.momentsSeen && c.b.momentsSeen.includes(m.t)) return false;
  return true;
}

function tierFor(aff){
  if(aff >= MOMENT_TIERS.t3) return 3;
  if(aff >= MOMENT_TIERS.t2) return 2;
  if(aff >= MOMENT_TIERS.t1) return 1;
  return 0;
}

function tickMoments(lines){
  if(Math.random() > MOMENT_DAILY_P) return;
  S.bonds = S.bonds || {};

  // candidate pairs: both alive, neither away, off cooldown
  const cands = [];
  const ppl = S.people.filter(present);
  for(let i=0;i<ppl.length;i++) for(let j=i+1;j<ppl.length;j++){
    let A = ppl[i], B = ppl[j];
    const b = bondOf(S.bonds, bondKey(A.id, B.id));
    if(S.day - (b.lastMoment||-999) < MOMENT_PAIR_COOLDOWN) continue;

    if(A.status==="down" || B.status==="down"){
      // visiting: the down one is always {B}
      if(A.status==="down") [A,B] = [B,A];
      if(!upright(A) || A.job==="care") continue;
      if(b.affinity < MOMENT_TIERS.t1) continue;   // strangers don't visit
      cands.push({A,B,b,pool:"visit",w:b.affinity});
      continue;
    }

    const tier = tierFor(b.affinity);
    if(tier > 0) cands.push({A,B,b,pool:tier,w:b.affinity});
    if(GATES.peakDrop({A,B,b})) cands.push({A,B,b,pool:"cooling",w:2+(b.peakAff-b.affinity)});
  }
  if(!cands.length) return;

  // weighted pick — warmer (or more fallen) pairs surface more often
  const tot = cands.reduce((a,c)=>a+c.w,0);
  let r = Math.random()*tot, c = cands[cands.length-1];
  for(const x of cands){ r -= x.w; if(r<=0){ c=x; break; } }

  // a third for group lines: the next-warmest person to both
  if(c.pool===2 || c.pool===3){
    let best=null, bw=MOMENT_TIERS.t1;
    for(const p of ppl){
      if(p.id===c.A.id || p.id===c.B.id || p.status==="down") continue;
      const w = Math.min(bondOf(S.bonds,bondKey(p.id,c.A.id)).affinity,
                         bondOf(S.bonds,bondKey(p.id,c.B.id)).affinity);
      if(w > bw){ bw = w; best = p; }
    }
    c.C = best;
  }

  // pool: exact-tier lines plus any lower warm tier (a close pair still
  // saves seats), never higher; visit/cooling pools are their own
  const pool = MOMENTS.filter(m => {
    if(c.pool==="visit" || c.pool==="cooling") return m.tier===c.pool && eligible(m,c);
    return typeof m.tier==="number" && m.tier<=c.pool && eligible(m,c);
  });
  // ambient lines ride along in any warm draw, at low weight
  if(typeof c.pool==="number") for(const m of MOMENTS) if(m.tier==="ambient" && eligible(m,c)) pool.push(m);
  if(!pool.length) return;

  const m = pick(pool);
  lines.push(m.solo ? m.t : fill(m.t, c));
  c.b.lastMoment = S.day;
  if(m.once){ c.b.momentsSeen = c.b.momentsSeen || []; c.b.momentsSeen.push(m.t); }

  // the moment warms the pair — a report that is also an event
  const warm = MOMENT_AFF[m.tier] || 0;
  if(warm > 0 && !m.solo){
    c.b.affinity = Math.min(10, c.b.affinity + warm);
    if(c.b.affinity > (c.b.peakAff||0)) c.b.peakAff = c.b.affinity;
    if(c.C){
      for(const other of [c.A, c.B]){
        const cb = bondOf(S.bonds, bondKey(c.C.id, other.id));
        cb.affinity = Math.min(10, cb.affinity + warm*0.5);
      }
    }
  }
}

export { tickMoments };
