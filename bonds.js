/* ================= bonds & personality =================
   Milestone 1: bonds become two-dimensional.

   familiarity — how well two people know each other. 0..10, only grows.
     Exactly the old single bond number; every accrual site keeps its old rate.
   affinity — how they feel about each other. -10..+10. Grows alongside
     familiarity, scaled by compatibility(), which for now reads only the
     hidden personality types. (Milestone 2 adds an ideology term; milestone 3
     adds erosion under stress. Nothing here ever renders — see the
     hidden-number rule.)

   This module imports nothing, so it can be pulled into state.js, day.js,
   and events.js without widening any import cycle. */

const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

/* --- personality ---
   Four arbitrary types, assigned at random when a person first exists
   (freshPerson, and the birth literal in day.js). Never shown, never
   derived from anything visible — this is chemistry with no tell.

   The table is SYMMETRIC now (circumplex-derived: the four types abstract
   a warm/cold × dominant/yielding grid, but nothing in-game ever names
   those axes). P_REL[a][b] === P_REL[b][a] by construction. Texture the
   table deliberately keeps: same-type is more often a mild liability than
   a bonus (only B-B runs warm — birds of a feather don't reliably flock);
   A-B and C-D are the two genuinely good matches; A-C is the one truly
   bad one; C is the type that struggles with itself.
   Range −3.0..+2.5. At PERSONA_W=0.25 and MISMATCH_T=0.6, exactly two
   combinations flag mismatched from personality alone: A-C and C-C —
   ~19% of pairs under a uniform draw. Occasional, specific friction,
   not a coin flip at character creation. */
const PERSONALITIES = ["A", "B", "C", "D"];
const P_REL = {
  A: { A: -1.0, B: +2.5, C: -3.0, D: -0.5 },
  B: { A: +2.5, B: +1.0, C:  0.0, D: -1.0 },
  C: { A: -3.0, B:  0.0, C: -2.0, D: +2.0 },
  D: { A: -0.5, B: -1.0, C: +2.0, D: -1.5 }
};

const rollPersonality = () => PERSONALITIES[Math.floor(Math.random() * PERSONALITIES.length)];

/* Averaged both directions — a no-op average now that the table is
   symmetric, kept so the callers and the debug breakdown don't care
   whether the table is directional. 0 if either person lacks a type. */
function personalityTerm(pA, pB) {
  const a = pA && pA.personality, b = pB && pB.personality;
  if (!a || !b || !P_REL[a] || !P_REL[b]) return 0;
  return (P_REL[a][b] + P_REL[b][a]) / 2;
}

/* Which of the two is more bothered by the other, or null if it's mutual.
   Under the symmetric 4-type table this is ALWAYS null — friction is
   mutual by construction. Kept as a stable no-op so any flavor-text call
   site keeps working; if a directional table ever returns, this comes
   back to life without touching its callers. */
function moreBothered(pA, pB) {
  const a = pA && pA.personality, b = pB && pB.personality;
  if (!a || !b) return null;
  const ab = P_REL[a][b], ba = P_REL[b][a];
  if (ab === ba) return null;
  return ab < ba ? pA : pB;
}

/* --- compatibility ---
   The multiplier on affinity growth whenever familiarity grows.
   1.0 = neutral: affinity tracks familiarity at the base rate.
   Same-type pairs run warm (1.6); cross-type pairs run cool (0.4) — they
   still warm from working together, just slowly. Personality alone never
   drives affinity DOWN in good times; erosion is milestone 3's job, under
   stress. The clamp floor is negative on purpose: once milestone 2 adds
   the ideology term, personality friction + opposed values can push a
   pair's compatibility below zero, and shared work starts costing warmth. */
/* PERSONA_W retuned for the 4-type table: its raw spread (−3.0..+2.5) is
   nearly twice the old 3-cycle's, so the old 0.6 weight over-flagged.
   At 0.25, personality alone can pull compatibility to 0.25 at worst
   (1 + 0.25×−3) — never below zero without ideology stacking on top. */
const PERSONA_W = 0.25;
const IDEO_W = 0.9;

/* ideology.js registers its term here at module load — dependency injection
   keeps this file import-free. Before registration (or in headless tests
   without ideology), the term is simply 0 and compatibility behaves exactly
   as it did in milestone 1. */
let ideologyTermFn = null;
function setIdeologyTermFn(fn) { ideologyTermFn = fn; }

function compatibility(pA, pB) {
  const ideo = ideologyTermFn ? ideologyTermFn(pA, pB) : 0;
  const t = 1 + PERSONA_W * personalityTerm(pA, pB) + IDEO_W * ideo;
  return clamp(t, -0.75, 2);
}

/* The two weighted terms separately — the friction layer reads whichever is
   more negative to tag a flare "temperament" vs "values". */
function termBreakdown(pA, pB) {
  return {
    persona: PERSONA_W * personalityTerm(pA, pB),
    ideo: IDEO_W * (ideologyTermFn ? ideologyTermFn(pA, pB) : 0)
  };
}

/* "Negatively-compatible" for the friction layer: well below neutral.
   From personality alone, only A-C (compat 0.25) and C-C (0.5) qualify;
   a good ideology match can lift even those back out, and a bad one can
   drag milder pairs (A-A, D-D, B-D) under the line. Threshold unchanged
   from the ideology tuning pass — it also gates the values-driven
   mismatch path, so it stays put and PERSONA_W carries the retune. */
const MISMATCH_T = 0.6;
const isMismatched = (pA, pB) => compatibility(pA, pB) < MISMATCH_T;

/* --- bond storage ---
   Keys stay exactly as they were: sorted "idA:idB". */
const bondKey = (id1, id2) => [id1, id2].sort().join(":");

/* Fetch-or-create. Also quietly upgrades a legacy bare-number bond to the
   new shape (an old save mid-restart; harmless to keep). */
function bondOf(bonds, key) {
  let b = bonds[key];
  if (b === undefined) b = bonds[key] = { familiarity: 0, affinity: 0 };
  else if (typeof b === "number") b = bonds[key] = { familiarity: b, affinity: b * 0.3 };
  return b;
}

/* THE accrual primitive. Every place that used to add to a bond number goes
   through here now: familiarity grows by exactly the old amount, and
   affinity grows by that amount scaled by compatibility. AFF_RATE keeps
   affinity a slower-moving read than familiarity even for well-matched
   pairs — knowing someone is faster than loving them. */
const AFF_RATE = 0.6;   // 0.6 × max-compat 1.6 = 0.96 — even the best-matched pair warms no faster than it familiarizes
const LOW_WB = 35;      // same threshold tickDepartures already uses — one definition of "low spirits" per game
function tickBondPair(bonds, pA, pB, famAmt) {
  if (!pA || !pB || pA.id === pB.id) return;
  const b = bondOf(bonds, bondKey(pA.id, pB.id));
  const compat = compatibility(pA, pB);
  // friction, routine layer: a hard day next to someone who grates just
  // doesn't build the relationship the way it would with someone you click
  // with. No roll, no journal line — the warmth simply doesn't accrue.
  let f = famAmt;
  if (compat < MISMATCH_T && ((pA.wb !== undefined && pA.wb < LOW_WB) || (pB.wb !== undefined && pB.wb < LOW_WB))) f *= 0.5;
  b.familiarity = Math.min(10, b.familiarity + f);
  b.affinity = clamp(b.affinity + f * AFF_RATE * compat, -10, 10);
  if(b.affinity > (b.peakAff||0)) b.peakAff = b.affinity;   // remembered high-water mark, for the cooling lines
}

/* what music, if any, a person makes — rolled once at creation. About 4 in
   10 people are musical; instruments are rarer than voices. */
function rollMusic(){
  if(Math.random() > 0.4) return [];
  const out=[];
  if(Math.random() < 0.6) out.push("singing");
  if(Math.random() < 0.4) out.push("clapping");
  if(Math.random() < 0.55) out.push(["guitar","ukulele","hand drum","fiddle"][Math.floor(Math.random()*4)]);
  return out.length ? out : ["singing"];
}

/* --- founding ---
   The founders didn't meet in the yard on day one — they traveled here
   together and chose this. Every founder pair starts with real shared
   history, personality-modulated: well-matched pairs start warmly close,
   clashing pairs still start net positive (they made the road work) but
   noticeably cooler. Newcomers and strangers correctly start at zero with
   everyone. Called from applyFounders(), after s.people exists. */
const FOUNDER_FAM = 3.5;
function seedFounderBonds(s) {
  s.bonds = s.bonds || {};
  const ppl = s.people;
  for (let i = 0; i < ppl.length; i++) {
    for (let j = i + 1; j < ppl.length; j++) {
      // floor at +0.5: with the 4-type table an unlucky draw (A-C, or
      // same-type friction plus opposed ideology) could otherwise start a
      // founding pair NEGATIVE — but the founders made the road together
      // and chose this. They start cool at worst, never adversarial.
      s.bonds[bondKey(ppl[i].id, ppl[j].id)] = {
        familiarity: FOUNDER_FAM,
        affinity: clamp(Math.max(0.5, FOUNDER_FAM * 0.6 * compatibility(ppl[i], ppl[j])), -10, 10)
      };
    }
  }
}

/* Dev-only: dump the current relationship spread to the console, since none
   of this ever renders. Call window.dumpBonds() from devtools. Wired up in
   main.js next to the dismissOffline exposure, or just paste there:
     import { dumpBonds } from "./bonds.js"; window.dumpBonds = dumpBonds;
   Takes S explicitly so this module stays import-free. */
function dumpBonds(S) {
  const rows = Object.entries(S.bonds || {}).map(([k, b]) => ({
    pair: k,
    fam: typeof b === "number" ? b : +b.familiarity.toFixed(2),
    aff: typeof b === "number" ? "(legacy)" : +b.affinity.toFixed(2)
  }));
  rows.sort((a, b) => b.fam - a.fam);
  console.table(rows);
  console.table(S.people.map(p => ({ name: p.name, personality: p.personality })));
}

export { MISMATCH_T, PERSONALITIES, rollMusic, P_REL, bondKey, bondOf, compatibility, dumpBonds, isMismatched, moreBothered, personalityTerm, rollPersonality, seedFounderBonds, setIdeologyTermFn, termBreakdown, tickBondPair };
