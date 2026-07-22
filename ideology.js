/* ================= ideology =================
   Milestone 2: every person carries a hidden 5-axis stance vector.
   Never rendered. The numbers leak only through journal lines at band
   crossings, so the phase-2 reveal is recognition, not surprise.

   Axis polarity (memorize once, grep forever):
     intervention  +1 act on the living world      -1 restraint
     complexity    +1 depend on complex systems    -1 conviviality / low-tech
     openness      +1 porous village               -1 boundedness
     temporality   +1 the long harvest (Later)     -1 this year's (Now)
     obligation    +1 duty, assignment, structure  -1 autonomy

   Drift is deliberately slow: a stance should take seasons to move and
   years to cross a band. Three years in the food forest is an argument;
   one bad week is not. */

import { S } from "./state.js";
import { clamp, pick } from "./helpers.js";
import { JOB_PRACTICE } from "./data-economy.js";
import { setIdeologyTermFn } from "./bonds.js";

const AXES = ["intervention", "complexity", "openness", "temporality", "obligation"];

/* --- seeding ---
   Initial vector from base stats and trait, so ideology feels continuous
   with who they already were, plus per-person jitter so two Cautious
   tinkerers aren't clones. All amounts are tuning knobs. */
const TRAIT_SEED = {
  Tinkerer:      { intervention: +0.20, complexity: +0.25 },
  "Green-thumb": { intervention: +0.10, temporality: +0.15 },
  Restless:      { temporality: -0.25, obligation: -0.25, openness: +0.10 },
  Steady:        { temporality: +0.20, obligation: +0.15 },
  Cautious:      { intervention: -0.25, openness: -0.15 },
  Mender:        { openness: +0.15, obligation: +0.10 },
  Weathered:     { complexity: -0.15, temporality: +0.10 }
};
const STAT_SEED = p => ({
  intervention: (p.hands - 2) * 0.10,
  complexity:   (p.hands - 2) * 0.12 - (p.wild - 2) * 0.06,
  openness:     (p.wild - 2) * 0.08 + (p.care - 2) * 0.08,
  temporality:  (p.green - 2) * 0.10,
  obligation:   (p.care - 2) * 0.06
});

/* --- authored overrides ---
   Derived by default, hand-authored where it should hurt. An override SETS
   the axis, regardless of where stats+trait would put it — and the reason
   is a journal line somewhere, not a config field. PLACEHOLDERS: these are
   my sketches against the roster notes; rewrite them in your own voice, or
   delete. Grep-able per character, per the no-central-dispatcher rule. */
const IDEO_OVERRIDES = {
  // moss is "old enough to remember what life was like before. Doesn't
  // like to talk about it." — what broke, when it broke, was the complex stuff.
  moss: { complexity: -0.55 },
  // din "doesn't say where they walked from." The road brought them here;
  // they will not be the one who closes it behind them.
  din: { openness: +0.45 },
  // june "likes the people here almost as much as she likes the garden" —
  // a garden lifer plants for decades she won't see.
  june: { temporality: +0.50 }
};

function seedIdeology(p) {
  const v = {};
  const t = TRAIT_SEED[p.trait] || {};
  const s = STAT_SEED(p);
  for (const ax of AXES) {
    v[ax] = clamp((s[ax] || 0) + (t[ax] || 0) + (Math.random() * 0.3 - 0.15), -1, 1);
  }
  const over = IDEO_OVERRIDES[p.id];
  if (over) for (const ax of Object.keys(over)) v[ax] = over[ax];
  return v;
}

/* Ensure-shape, tolerant of people created before this feature (same
   pattern as practiceOf). Also (re)snapshots the current band so a person
   backfilled mid-game doesn't emit a spurious crossing line on day one. */
function ideoOf(p) {
  if (!p.ideology) { p.ideology = seedIdeology(p); p._ideoBand = bandsOf(p.ideology); }
  if (!p._ideoBand) p._ideoBand = bandsOf(p.ideology);
  return p.ideology;
}

/* --- the compatibility term ---
   Normalized dot product in [-1, +1]. Registered into bonds.js at module
   load; from that moment, shared values accelerate warming and opposed
   values cool it — including below zero when stacked on personality friction. */
function ideologyTerm(pA, pB) {
  const a = pA && pA.ideology, b = pB && pB.ideology;
  if (!a || !b) return 0;
  let dot = 0;
  for (const ax of AXES) dot += (a[ax] || 0) * (b[ax] || 0);
  // divide by 1.5, not by axis count: realistic vectors are moderate (~±0.3
  // per axis), and dividing by 5 crushed the term to decoration — values
  // opposition could never outweigh personality, so every flare tagged
  // "temperament". Caught in headless test; 1.5 lets a real clash matter.
  return clamp(dot / 1.5, -1, 1);
}
setIdeologyTermFn(ideologyTerm);

/* --- drift ---
   Sources, most powerful first (per the design doc): lived events, job
   hours, bond homophily. Founding visuals seed rather than drift (state.js).
   Rates are per-day and tiny on purpose. */

// job → axis nudges, keyed off the broad category JOB_PRACTICE already
// assigns every job. Two derived effects off one input.
const AXIS_BY_BROAD = {
  hands: { complexity: +0.0005, intervention: +0.0003 },
  green: { temporality: +0.0005, intervention: +0.0003 },
  care:  { obligation: +0.0005, openness: +0.0003 },
  wild:  { openness: +0.0005, complexity: -0.0003 }
};

// one-shot nudges from elsewhere in the sim (arrival sites in events.js
// call this; anything else can too). Exported so effects can live next to
// the systems they belong to, not in a dispatcher here.
function nudgeIdeology(people, axis, amt) {
  for (const p of people) {
    const v = ideoOf(p);
    v[axis] = clamp((v[axis] || 0) + amt, -1, 1);
  }
}

const bandOf = x => x >= 0.5 ? 1 : x <= -0.5 ? -1 : 0;
function bandsOf(v) { const b = {}; for (const ax of AXES) b[ax] = bandOf(v[ax] || 0); return b; }

/* Band-crossing journal lines — the leak layer. One line max per day,
   village-wide, so drift never floods the journal. PLACEHOLDER VOICE:
   two lines per axis-direction; rewrite or extend freely. */
const AXIS_LINES = {
  intervention: {
    up: [n => `${n} has started arguing for doing more with the land, not less. "It won't heal on a schedule we can eat by."`,
         n => `${n} spent the evening sketching what the south slope could be, if somebody just made it so.`],
    down: [n => `${n} said the valley did fine for ten thousand years without anyone managing it.`,
           n => `${n} has taken to leaving things unpruned, unweeded, unfixed — on purpose, it seems.`]
  },
  complexity: {
    up: [n => `${n} keeps saying the village should run more on wire and less on backbone.`,
         n => `${n} wants more machines minding things. "Sleep is a technology too," came the argument.`],
    down: [n => `${n} said every machine we keep is a promise we have to keep making. Fewer promises, then.`,
           n => `${n} has been favoring the hand tools lately, even when the powered ones sit charged.`]
  },
  openness: {
    up: [n => `${n} talked at dinner about widening the road sign, so more people find us before winter.`,
         n => `${n} said a village that stops taking people in has started dying, it just doesn't know it yet.`],
    down: [n => `${n} said what we have holds because we know every hand in it. ${n} would keep it that way.`,
           n => `${n} has started counting chairs at the long table before welcoming anyone new to it.`]
  },
  temporality: {
    up: [n => `${n} planted something today that won't bear until the youngest here are grown.`,
         n => `${n} keeps steering talk from this winter to the tenth one out.`],
    down: [n => `${n} said you can't eat a plan. This year's harvest first; the rest is weather.`,
           n => `${n} argued for pulling effort off the long projects until the stores look better.`]
  },
  obligation: {
    up: [n => `${n} thinks the work should be spoken for out loud — names against tasks, so nothing falls quiet.`,
         n => `${n} said freedom to drift is how the water tank goes unminded.`],
    down: [n => `${n} said nobody here should be told where to stand. People find their work, or it finds them.`,
           n => `${n} has been quietly ignoring the duty list, and doing good work anyway, which is the argument.`]
  }
};

function driftIdeology(lines) {
  let lineEmitted = false;

  // lived-events pressure, read straight off today's state
  const hungry = S.hungerDays > 0;
  const brownout = S.report && S.report.brownout;

  for (const p of S.people) {
    if (p.status === "away") continue;
    const v = ideoOf(p);

    // the winter you ate the seed potatoes scars everyone there
    if (hungry) v.temporality = clamp(v.temporality - 0.003, -1, 1);
    // the system that failed you argues for fewer systems
    if (brownout) v.complexity = clamp(v.complexity - 0.002, -1, 1);

    // job hours: today's work is a slow argument
    const jp = p.job && JOB_PRACTICE[p.job];
    if (jp && (p.status === "ok" || p.status === "spent")) {
      const nudges = AXIS_BY_BROAD[jp.broad];
      if (nudges) for (const [ax, amt] of Object.entries(nudges)) v[ax] = clamp(v[ax] + amt, -1, 1);
    }
  }

  // homophily: you drift toward who you eat with. Strong warm bonds only.
  const HOMOPHILY = 0.0006;
  for (const [key, b] of Object.entries(S.bonds || {})) {
    if (typeof b === "number" || b.affinity < 4) continue;
    const [idA, idB] = key.split(":");
    const pA = S.people.find(x => x.id === idA), pB = S.people.find(x => x.id === idB);
    if (!pA || !pB) continue;
    const vA = ideoOf(pA), vB = ideoOf(pB);
    for (const ax of AXES) {
      const d = (vB[ax] - vA[ax]) * HOMOPHILY;
      vA[ax] = clamp(vA[ax] + d, -1, 1);
      vB[ax] = clamp(vB[ax] - d, -1, 1);
    }
  }

  // the leak: at most one band-crossing line per day, village-wide
  for (const p of S.people) {
    if (lineEmitted || p.status === "away" || !p.ideology) continue;
    const now = bandsOf(p.ideology);
    for (const ax of AXES) {
      if (!lineEmitted && p._ideoBand && now[ax] !== p._ideoBand[ax]) {
        const dir = now[ax] > p._ideoBand[ax] ? "up" : "down";
        lines.push(pick(AXIS_LINES[ax][dir])(p.name));
        lineEmitted = true;
      }
    }
    p._ideoBand = now;
  }
}

/* Dev-only, console: window.dumpIdeology() — wired in main.js if wanted. */
function dumpIdeology() {
  console.table(S.people.map(p => ({ name: p.name, ...(p.ideology || {}) })));
}

export { AXES, IDEO_OVERRIDES, driftIdeology, dumpIdeology, ideoOf, ideologyTerm, nudgeIdeology, seedIdeology };
