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
   Three arbitrary types, assigned at random when a person first exists
   (freshPerson, and the birth literal in day.js). Never shown, never
   derived from anything visible — this is chemistry with no tell.

   The relation table is DIRECTIONAL: P_REL[a][b] is how a feels about b's
   type, not a shared fact about the pair. In the pure 3-cycle below, every
   cross-type pair nets out the same once averaged (one dislike + one
   neutral); the direction survives for flavor — moreBothered() says who's
   carrying the friction, for journal lines that want it.
   dislike is weighted heavier than like (-2 vs +1): one grating presence
   costs more than one pleasant one pays. */
const PERSONALITIES = ["A", "B", "C"];
const P_REL = {
  A: { A: +1, B: -2, C: 0 },
  B: { A: 0, B: +1, C: -2 },
  C: { A: -2, B: 0, C: +1 }
};

const rollPersonality = () => PERSONALITIES[Math.floor(Math.random() * PERSONALITIES.length)];

/* Averaged both directions: +1 for a same-type pair, -1 for any cross-type
   pair (in the pure cycle), 0 if either person somehow lacks a type. */
function personalityTerm(pA, pB) {
  const a = pA && pA.personality, b = pB && pB.personality;
  if (!a || !b || !P_REL[a] || !P_REL[b]) return 0;
  return (P_REL[a][b] + P_REL[b][a]) / 2;
}

/* Which of the two is more bothered by the other, or null if it's mutual.
   Not used by any math — exists so milestone-3 flavor text can say
   "X seems more bothered by this than Y does" without new state. */
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
const PERSONA_W = 0.6;
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
  return clamp(t, -0.5, 2);
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
   Personality cross-type alone (0.4) qualifies; a good ideology match can
   lift a cross-type pair back out of it. */
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
      s.bonds[bondKey(ppl[i].id, ppl[j].id)] = {
        familiarity: FOUNDER_FAM,
        affinity: clamp(FOUNDER_FAM * 0.6 * compatibility(ppl[i], ppl[j]), -10, 10)
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

export { PERSONALITIES, P_REL, bondKey, bondOf, compatibility, dumpBonds, isMismatched, moreBothered, personalityTerm, rollPersonality, seedFounderBonds, setIdeologyTermFn, termBreakdown, tickBondPair };
