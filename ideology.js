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
     wholeness     +1 the given form is off-limits  -1 the self can be remade

   On the sixth axis, since it is the one that isn't obvious: it is NOT
   "are you for or against biotech" — that would just be complexity or
   intervention again. It asks whether the HUMAN FORM is exempt from the
   engineering you'd apply to anything else, and it is genuinely orthogonal
   to intervention. The revealing quadrant is restraint + adaptation: the
   person who would leave the valley entirely alone and change THEMSELVES
   instead, because the self isn't privileged — if something has to give,
   it should be you and not the ecosystem. No other axis can hold that.

   Drift is deliberately slow: a stance should take seasons to move and
   years to cross a band. Three years in the food forest is an argument;
   one bad week is not. */

import { S } from "./state.js";
import { clamp, pick } from "./helpers.js";
import { JOB_PRACTICE } from "./data-economy.js";
import { setIdeologyTermFn } from "./bonds.js";

const AXES = ["intervention", "complexity", "openness", "temporality", "obligation", "wholeness"];

/* --- seeding ---
   Initial vector from base stats and trait, so ideology feels continuous
   with who they already were, plus per-person jitter so two Cautious
   tinkerers aren't clones. All amounts are tuning knobs. */
const TRAIT_SEED = {
  // a tinkerer sees a body the way they see an engine — something with a
  // cover you can take off
  Tinkerer:      { intervention: +0.20, complexity: +0.25, wholeness: -0.20 },
  "Green-thumb": { intervention: +0.10, temporality: +0.15 },
  Restless:      { temporality: -0.25, obligation: -0.25, openness: +0.10, wholeness: -0.10 },
  Steady:        { temporality: +0.20, obligation: +0.15, wholeness: +0.10 },
  Cautious:      { intervention: -0.25, openness: -0.15, wholeness: +0.20 },
  // a mender's whole practice is returning a body to the shape it should
  // have been in, which is an argument that there IS such a shape
  Mender:        { openness: +0.15, obligation: +0.10, wholeness: +0.25 },
  Weathered:     { complexity: -0.15, temporality: +0.10, wholeness: +0.15 }
};
const STAT_SEED = p => ({
  intervention: (p.hands - 2) * 0.10,
  complexity:   (p.hands - 2) * 0.12 - (p.wild - 2) * 0.06,
  openness:     (p.wild - 2) * 0.08 + (p.care - 2) * 0.08,
  temporality:  (p.green - 2) * 0.10,
  obligation:   (p.care - 2) * 0.06,
  wholeness:    (p.care - 2) * 0.07 - (p.hands - 2) * 0.06
});

/* --- authored worldviews ---
   Derived by default, hand-authored where it should hurt. An override SETS
   the axis, regardless of where stats+trait would put it.

   WHY SET RATHER THAN ADD. STAT_SEED contributes roughly 0.12–0.24 per
   axis and the jitter is ±0.15, so for anyone unauthored the noise is the
   same size as the signal — an axis can flip sign between playthroughs.
   That is the mechanical reason a character didn't feel like the same
   person twice. Adding onto a hidden baseline can't guarantee the authored
   position actually lands, because the baseline isn't visible or controlled.
   So: set.

   DISTRIBUTION IS THE POINT. Extremism only reads as a trait against people
   who don't have it, so this is deliberately lopsided:
     · four true believers (moss, din, bec, emrys) — two or more axes past
       ±0.9, clustering into a coherent position rather than one loud number
     · twelve moderates — one or two axes at ±0.4–0.6
     · three deliberately unideological (theo, sam, petra) — nothing past
       ±0.3. A person whose defining trait is that they don't have a strong
       worldview is its own kind of interesting and costs nothing to write.
   Every remaining axis is left to STAT_SEED + jitter, so each person still
   has game-to-game texture outside their defining convictions.

   DRIFT INTERACTION IS A FEATURE. Someone authored at ±0.95 has real room
   to erode before crossing back under a band line, so a hardliner mellowing
   over years is a genuine arc — using the drift mechanism that already
   exists rather than a new one.

   `worldview` is for narrative use: it lets identity leak without leaking
   numbers, which nothing else here can do (drift only leaks single-axis
   band crossings). Each is grounded in the character's `note` in defs.js. */
const IDEO_OVERRIDES = {
  /* --- true believers --- */
  // "old enough to remember what life was like before. Doesn't like to talk
  // about it." What broke, when it broke, was the complicated stuff — and
  // moss watched every stage of it go.
  moss: { axes: { complexity: -0.95, intervention: -0.92, openness: -0.45, temporality: +0.55 },
          worldview: "Every machine we keep is a promise we have to keep making." },
  // "doesn't say where they walked from." The road brought them here; they
  // will not be the one who closes it behind anyone else.
  din: { axes: { openness: +0.95, obligation: -0.92, temporality: -0.50 },
         worldview: "Nobody gets to shut the road behind them. I'd know." },
  // "sleeps outside, when the weather allows it." The argument that a person
  // is something you fit to the world, not the other way round — restraint
  // and self-adaptation together, which is the one quadrant no other axis holds.
  bec: { axes: { wholeness: -0.95, intervention: -0.92, obligation: -0.60 },
         worldview: "If the valley has to bend or I do, it should be me. I'm the one who can choose." },
  // "carries a multimeter like a holy relic." The other pole of complexity,
  // so moss has someone real to argue with.
  emrys: { axes: { complexity: +0.95, intervention: +0.92, wholeness: -0.55 },
           worldview: "Anything that measures can be understood, and anything understood can be kept running." },

  /* --- moderates --- */
  // "keeps a tackle box of salvaged screws, meticulously sorted."
  nadia: { axes: { complexity: +0.55, obligation: +0.45 },
           worldview: "A thing sorted is a thing you'll find again." },
  // "talks to the plants. Likes to imagine they answer."
  ora: { axes: { intervention: -0.50, wholeness: +0.45 },
         worldview: "They were here first and they'll be here after. Asking costs nothing." },
  // "checks ladders twice." A body is the one thing he won't improvise with.
  yusuf: { axes: { wholeness: +0.60, intervention: -0.40 },
           worldview: "There's no spare of a person. That's the whole argument." },
  // "can diagnose motor and engine problems by sound."
  ilya: { axes: { complexity: +0.50, obligation: -0.40 },
          worldview: "Listen long enough and the machine tells you. Nobody has to be told to listen." },
  // "likes the people here almost as much as she likes the garden" — a
  // garden lifer plants for decades she won't see.
  june: { axes: { temporality: +0.60, openness: +0.45 },
          worldview: "You plant for the year you won't see. It isn't a sacrifice, it's just the schedule." },
  // "arms covered in colorful tattoos of native flowers and butterflies."
  marisol: { axes: { temporality: +0.50, intervention: -0.45 },
             worldview: "Put back what was here. Everything after that is decoration." },
  // "speaks rarely; doesn't like to leave jobs half-done."
  ash: { axes: { obligation: +0.60, temporality: +0.40 },
         worldview: "Half a job is a lie you tell the next person." },
  // "keeps a weather log. Likes to sketch the clouds."
  kav: { axes: { temporality: +0.50, complexity: +0.40, openness: +0.40 },
         worldview: "Write it down long enough and it stops being weather and starts being a pattern." },
  // "arrived with a sourdough starter older than she is."
  rosa: { axes: { temporality: +0.60, wholeness: +0.40 },
          worldview: "Some things you don't own. You keep them alive and hand them on." },
  // "knows mushrooms. Most of them, anyway."
  halla: { axes: { complexity: -0.50, intervention: -0.45 },
           worldview: "The forest already solved most of it. We only have to learn which ones." },
  // "measured, deliberate, and always kind."
  yara: { axes: { obligation: +0.50, openness: -0.40 },
          worldview: "Say who's doing what, out loud, so nobody has to guess and nobody gets missed." },
  // "always has a jar of black birch tea steeping somewhere."
  eli: { axes: { wholeness: +0.50, openness: +0.45 },
         worldview: "A body knows how to mend. Mostly the work is not getting in its way." },

  /* --- deliberately unideological --- */
  // sixteen, and "nobody has ever seen him sit still." Hasn't landed
  // anywhere yet, which is a real thing to be.
  theo: { axes: { openness: +0.25, obligation: -0.25 },
          worldview: "Hasn't decided yet, and isn't in a hurry about it." },
  // "has never once complained about the rain." A man without a program.
  sam: { axes: { temporality: +0.20, obligation: +0.15 },
         worldview: "It rains. You work in the rain. There isn't a position to take about it." },
  // "remembers how everyone takes their tea."
  petra: { axes: { openness: +0.25, wholeness: +0.20 },
           worldview: "People aren't arguments. They're people, and they take their tea a particular way." }
};

/* PLAYER CHOICE WINS. applyFounders() applies the founding visuals'
   ideoSeed on top of this, additively — so a circled place can still move
   an authored character, and any future founding-conflict feature that
   sets an axis outright can simply run after this and overwrite it. The
   lookup is structured so that's possible without touching this table. */
const worldviewOf = p => (IDEO_OVERRIDES[p && p.id] || {}).worldview || null;

function seedIdeology(p) {
  const v = {};
  const t = TRAIT_SEED[p.trait] || {};
  const s = STAT_SEED(p);
  for (const ax of AXES) {
    v[ax] = clamp((s[ax] || 0) + (t[ax] || 0) + (Math.random() * 0.3 - 0.15), -1, 1);
  }
  const over = IDEO_OVERRIDES[p.id];
  // tolerate the old flat {axis:value} shape as well as {axes:{...}} — a
  // save written before worldviews existed re-seeds through here on migrate
  const axes = over && (over.axes || over);
  if (axes) for (const ax of Object.keys(axes)) if (AXES.includes(ax)) v[ax] = axes[ax];
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
  hands: { complexity: +0.0005, intervention: +0.0003, wholeness: -0.0003 },
  green: { temporality: +0.0005, intervention: +0.0003 },
  // tending bodies daily is a slow argument that bodies have a proper shape
  care:  { obligation: +0.0005, openness: +0.0003, wholeness: +0.0004 },
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
  },
  wholeness: {
    up: [n => `${n} said there's a shape a person is meant to be, and that we've already lost enough without going after that too.`,
         n => `${n} argued that the body is the one thing left that nobody engineered, and it should stay that way.`],
    down: [n => `${n} said if the valley has to bend or we do, it should be us. "We're the ones who can choose."`,
           n => `${n} doesn't see why a person should be the one thing we're forbidden to improve.`]
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

export { AXES, IDEO_OVERRIDES, driftIdeology, dumpIdeology, ideoOf, ideologyTerm, nudgeIdeology, seedIdeology, worldviewOf };
