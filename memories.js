/* ================= memories =================
   Replaces `p.mem` — a single string that every new event overwrote — with
   a real array a person carries.

   THREE NUMBERS, DELIBERATELY NOT COLLAPSIBLE. Every temptation to merge
   them into one "how much does this hurt" score should be resisted:

     intensity — how big the thing was.  FIXED at creation.
     salience  — how present it is NOW.  Decays daily, bumps on context.
     warmth    — how much it's been tended, by talking about it or by
                 marking it together.    Only ever rises.

   A grief can be maximally salient (always with you, always nameable) and
   barely hurt any more, because warmth is high. A fresh wound can ambush
   someone at modest salience because warmth is zero. That is the whole
   point of keeping them apart, and it's what makes a remembrance able to
   do the thing a remembrance actually does: raise salience AND raise
   warmth at once — make the grief more present and less painful in the
   same evening.

   ONE MEMORY PER PERSON PER DAY AFFECTS WELLBEING. Not all twelve, not
   every day. This is the single most important simplification here: it
   bounds the math to one modifier per person per day and keeps "why is
   this person unhappy" answerable at a glance instead of by reading an
   array.

   RNG: Math.random, like moments.js and events.js. rng.js is still
   climate-only on purpose (see its header) — migrating this system in the
   same pass that builds it would tangle two changes together. The headless
   tests stub Math.random deterministically, so runs are reproducible in
   the harness regardless. */

import { S } from "./state.js";
import { byId, clamp, wbFloor } from "./helpers.js";
import { bondKey, bondOf } from "./bonds.js";
import { PREGAME } from "./data-memories.js";

/* --- tuning. All guesses; expect to move them after a soak run. --- */
const MEM_SLOTS = 12;
const SAL_DECAY = 0.985;         // daily, absent any context
const REACT_BUMP = 0.08;         // on a context match
const FRONT_COOLDOWN = 6;        // days before the same memory can surface again
const FRONT_SETTLE = 0.98;       // private recall SETTLES; see note in pickFront
const WB_SCALE = 3;              // effect -> wb points
const WARM_BONUS = 0.5;          // how much warmth deepens a fondness
/* ACHE_PEAK was 0.6 in the build plan's tuning table, and at 0.6 the plan's
   own test 4 — "a fond memory's wb effect goes sharply negative immediately
   after the tagged person dies" — cannot pass. A maximal fond memory
   (intensity, salience and valence all 0.8) is worth 0.512, while ache at
   full strength and maximum closeness was only 0.6 x 1.0 x 0.8 = 0.48. The
   best day you ever had with someone still netted out mildly pleasant the
   morning after they died. At 0.9 the same memory lands at -0.21, which is
   the behaviour the spec describes. The table said these were guesses. */
const ACHE_PEAK = 0.9;
const ACHE_TAU = 90;             // days; ache half-life-ish
const FRONT_DISPLAY_MIN = 0.3;   // salience floor for CARD TEXT ONLY
const RECENT_CAP = 10, RECENT_DAYS = 12;
const INJURY_QUIET = 20;         // notability floor: days between ordinary-injury memories

/* Teeth thresholds — a memory has to be both big and still sore to change
   anyone's behaviour. See §9 of the build plan: reluctance and journal
   texture, never a hard block. A hard refusal fights the player instead of
   characterising anybody. */
const TEETH_SAL = 0.6, TEETH_VAL = -0.5;

const memoriesOf = p => p.memories || (p.memories = []);

/* --- creation --- */
function nextMemId(){
  S.memSeq = (S.memSeq || 0) + 1;
  return `m_${S.day}_${S.memSeq}`;
}

/* The one factory. `intensity` seeds salience — a big thing arrives already
   present — and everything else has a sane default so call sites stay short. */
function makeMemory(spec, day){
  const intensity = clamp(spec.intensity ?? 0.4, 0, 1);
  return {
    id: spec.id || nextMemId(),
    kind: spec.kind || "event",
    day: day ?? S.day,
    text: spec.text || "",
    intensity,
    salience: clamp(spec.salience ?? intensity, 0, 1),
    valence: clamp(spec.valence ?? 0, -1, 1),
    warmth: clamp(spec.warmth ?? 0, 0, 1),
    tags: {
      people: (spec.tags && spec.tags.people) ? spec.tags.people.slice() : [],
      place: (spec.tags && spec.tags.place) || null,
      action: (spec.tags && spec.tags.action) || null,
      subject: (spec.tags && spec.tags.subject) || null
    },
    unforgettable: !!spec.unforgettable,
    lastFront: 0
  };
}

/* Eviction: drop the least-present thing that isn't one of the few a person
   keeps forever. `unforgettable` is reserved for a death, a person's own
   arrival or founding, and a permanent injury — nothing else. Real memory
   keeps some things retrievable forever at near-zero salience, and losing
   those to routine churn would flatten exactly the texture this exists to
   make. If somehow every slot is unforgettable, the lowest goes anyway
   rather than silently refusing to record anything ever again. */
function evict(list){
  if(list.length <= MEM_SLOTS) return;
  let idx = -1, low = Infinity;
  for(let i=0;i<list.length;i++){
    if(list[i].unforgettable) continue;
    if(list[i].salience < low){ low = list[i].salience; idx = i; }
  }
  if(idx < 0){
    low = Infinity;
    for(let i=0;i<list.length;i++) if(list[i].salience < low){ low = list[i].salience; idx = i; }
  }
  if(idx >= 0) list.splice(idx, 1);
}

function addMemory(p, spec){
  if(!p) return null;
  const list = memoriesOf(p);
  const m = makeMemory(spec);
  list.push(m);
  evict(list);
  return m;
}
/* Same event, everyone who was there. Returns the memories made. */
function addMemoryAll(people, spec){
  const out = [];
  for(const p of people){ const m = addMemory(p, spec); if(m) out.push(m); }
  return out;
}

/* The pre-game memory: one authored line per named character, from their
   own note and their worldview. This is what makes June feel like June
   across restarts — the stats were always the same, but nothing that had
   HAPPENED to her was. Day 0, unforgettable, never evictable. */
function seedPregameMemory(p){
  const def = PREGAME[p.id];
  if(!def) return;
  memoriesOf(p).push(makeMemory({
    id: `m_0_${p.id}`,
    kind: "formative",
    text: def.text,
    intensity: 0.6,
    salience: 0.6,
    valence: def.valence ?? 0,
    tags: def.tags || {},
    unforgettable: true
  }, 0));
}

/* --- who isn't here any more ---
   Death and departure remove people from S.people entirely, so nothing
   downstream can ask "is the person in this memory still around?". S.gone
   is the ledger that makes ache possible. Bond records survive removal in
   S.bonds, so peakAff is still readable — just never assume byId() resolves. */
function recordGone(p, kind){
  S.gone = S.gone || [];
  if(S.gone.some(g => g.id === p.id)) return;
  S.gone.push({ id: p.id, name: p.name, day: S.day, kind });
}
const goneOf = id => (S.gone || []).find(g => g.id === id) || null;
const isGoneNow = id => !!goneOf(id);
const lossDay = id => { const g = goneOf(id); return g ? g.day : S.day; };
function peakAffinityWith(p, id){
  const b = (S.bonds || {})[bondKey(p.id, id)];
  if(!b || typeof b === "number") return 0;
  return Math.max(0, b.peakAff || b.affinity || 0);
}

/* --- reactivation ---
   Does today's actual state touch this memory's tags? Deliberately narrow
   on `people`: "is anyone I remember also alive right now" is true almost
   every day for almost everyone, which would pin every people-tagged
   memory at salience 1 forever and turn decay into decoration. So it means
   WORKED WITH today, or out on the same road — proximity you'd actually
   notice. */
function todayTouches(p, tags){
  if(!tags) return false;
  if(tags.action && p.job && tags.action === p.job) return true;
  const ex = (S.expeditions || []).find(e => (e.party || []).includes(p.id));
  if(ex){
    if(tags.place && (tags.place === ex.siteId || tags.place === ex.type)) return true;
    if(tags.people && tags.people.some(id => ex.party.includes(id))) return true;
  }
  if(tags.people && p.job && tags.people.some(id => {
    const q = byId(id);
    return q && q.job && q.job === p.job;
  })) return true;
  if(tags.subject && (S.recentEvents || []).some(e =>
      e.day === S.day && e.tags && e.tags.subject === tags.subject)) return true;
  return false;
}

/* --- the daily pick ---
   Weighted-random by salience, same algorithm moments.js uses for pairs.
   The cooldown stops one dominant memory owning somebody for a season.

   Being picked SETTLES a memory slightly rather than spiking it. A memory
   that spikes every time it's recalled alone is an unbounded feedback loop
   with no floor — a doom spiral. The real weight goes on TALKING about it
   (see conversations.js), not on brooding. */
function pickFront(p){
  /* `lastFront: 0` means NEVER SURFACED, not "surfaced on day zero" — and
     reading it as the latter locked every fresh memory out of the draw for
     the first six days of a game. Nobody had anything on their mind on day
     one, which is exactly when a founder's pre-game memory should be the
     loudest thing they've got. Day numbering starts at 1, so 0 is safe to
     use as the sentinel; the check just has to ask the right question. */
  const list = memoriesOf(p).filter(m =>
    m.salience > 0.01 && (!m.lastFront || (S.day - m.lastFront) >= FRONT_COOLDOWN));
  if(!list.length) return null;
  const tot = list.reduce((a,m)=>a+m.salience, 0);
  if(tot <= 0) return null;
  let r = Math.random()*tot, m = list[list.length-1];
  for(const x of list){ r -= x.salience; if(r <= 0){ m = x; break; } }
  m.lastFront = S.day;
  m.salience = clamp(m.salience * FRONT_SETTLE, 0, 1);
  return m;
}

/* --- what it does to a person ---
   Ache is computed LIVE and never stored. "That day was wonderful" and "it
   hurts to think about now" are two different facts: the first is about the
   memory and never changes; the second is about an absence, on its own
   clock. Storing a combined number would mean cascading edits across every
   memory referencing someone the moment they die, and would quietly make
   `valence` a lie. The day really was good.

   Early on ache dominates and a fond memory nets out painful. Over years
   ache fades while warmth keeps deepening the fondness, and the same
   memory crosses into a comfort — not because anything rewrote it, but
   because the two forces stopped being lopsided.

   The `valence >= 0` guard is load-bearing. Ache applies only to FOND
   memories of the departed. A negative memory of someone now gone — an
   argument that never got finished, a regret — is a genuinely different
   emotion and this model does not handle it. Left deliberately unsolved;
   dropping the guard papers over it rather than fixing it. */
function memoryEffect(p, m){
  if(!m) return 0;
  const base = m.intensity * m.salience * m.valence;
  let effect = (m.valence < 0)
    ? base * (1 - m.warmth)                  // tending softens pain
    : base * (1 + m.warmth * WARM_BONUS);    // tending deepens fondness

  if(m.valence >= 0 && m.tags.people && m.tags.people.length){
    let worst = 0;
    for(const id of m.tags.people){
      if(!isGoneNow(id)) continue;
      const daysSince = Math.max(0, S.day - lossDay(id));
      const closeness = clamp(peakAffinityWith(p, id) / 10, 0, 1);
      const ache = ACHE_PEAK * Math.exp(-daysSince / ACHE_TAU) * closeness;
      if(ache > worst) worst = ache;
    }
    effect -= worst;
  }
  return effect;
}

/* --- the daily tick ---
   Decay/reactivate, pick one, apply it. `wbCeil` is simulateDay's hunger /
   thirst / malnutrition ceiling: a fond memory should not lift anyone above
   what a starving village allows. Callers outside the day loop can omit it. */
function tickMemories(lines, wbCeil){
  const ceil = (wbCeil === undefined || wbCeil === null) ? 100 : Math.min(100, wbCeil);
  for(const p of S.people){
    const list = memoriesOf(p);
    for(const m of list){
      m.salience = todayTouches(p, m.tags)
        ? Math.min(1, m.salience + REACT_BUMP)
        : m.salience * SAL_DECAY;
    }
    const front = pickFront(p);
    p.frontId = front ? front.id : null;
    if(!front) continue;
    if(p.status === "away") continue;   // wb out on the road is the expedition's business
    const effect = memoryEffect(p, front);
    p.wb = clamp(p.wb + effect * WB_SCALE, wbFloor(p), ceil);
  }
}

/* --- surfacing it ---
   The People-tab card shows the same pick the wellbeing math used — one
   concept, not two parallel reads of the array — with a legibility gate on
   the display half only. A barely-salient memory that happened to win the
   draw still moves wb (that's honest: it's what they thought about), but
   printing it as a headline on someone's card is noise. Same value both
   times; the floor is display-only. */
const frontMemory = p => (p.memories || []).find(m => m.id === p.frontId) || null;
function frontText(p){
  const m = frontMemory(p);
  return (m && m.salience >= FRONT_DISPLAY_MIN && m.text) ? m.text : null;
}

/* --- tending ---
   Raise warmth (and optionally salience) on whatever matches. This is the
   channel a remembrance and a kept tradition act through. Returns how many
   memories were touched, so callers can stay quiet when nothing was. */
function tendMemories(p, match, dWarm, dSal){
  let n = 0;
  for(const m of memoriesOf(p)){
    if(!match(m)) continue;
    m.warmth = clamp(m.warmth + (dWarm || 0), 0, 1);
    if(dSal) m.salience = clamp(m.salience + dSal, 0, 1);
    n++;
  }
  return n;
}

/* --- the shared recent-events log ---
   For a conversation to be ABOUT the storm three days ago, something has to
   remember there was one. Events push a line into the journal and nothing
   queryable survives it. This is that queryable thing — built once, shared,
   rather than each conversation trigger growing its own bespoke "did
   anything happen lately" detector. */
function pushRecentEvent(ev){
  S.recentEvents = S.recentEvents || [];
  S.recentEvents.push({
    day: S.day, kind: ev.kind || "event", text: ev.text || "",
    tags: ev.tags || {}, weight: ev.weight ?? 1
  });
  tickRecentEvents();
}
function tickRecentEvents(){
  if(!S.recentEvents) { S.recentEvents = []; return; }
  S.recentEvents = S.recentEvents.filter(e => S.day - e.day <= RECENT_DAYS);
  if(S.recentEvents.length > RECENT_CAP)
    S.recentEvents = S.recentEvents.slice(S.recentEvents.length - RECENT_CAP);
}
const recentEvents = () => S.recentEvents || [];

/* --- notability floor ---
   Expedition injuries are frequent enough that logging every one crowds out
   rarer, more defining material inside a single season. An ordinary injury
   only earns a slot if the person hasn't banked one lately. */
const hasRecentMemory = (p, kind, withinDays) =>
  memoriesOf(p).some(m => m.kind === kind && S.day - m.day <= withinDays);
const injuryIsNotable = p => !hasRecentMemory(p, "injury", INJURY_QUIET);

/* --- behavioural teeth ---
   A memory system without behavioural consequence is just a nicer p.mem.
   Returns the memory driving a reluctance, or null. Callers turn that into
   a journal line — never into a refusal. */
function reluctance(p, ctx){
  if(!p || !ctx) return null;
  for(const m of memoriesOf(p)){
    if(m.salience <= TEETH_SAL || m.valence >= TEETH_VAL) continue;
    if(ctx.place && m.tags.place === ctx.place) return m;
    if(ctx.action && m.tags.action === ctx.action) return m;
  }
  return null;
}
/* Someone carrying a live grief turns toward the sickbed. Query only — the
   player assigns jobs, and a system that reassigns them behind the player's
   back is a bug wearing a feature's coat. */
const drawnToCare = p =>
  memoriesOf(p).some(m => m.tags.subject === "death" && m.salience > TEETH_SAL);

/* Dev-only, console: window.dumpMemories(). Nothing here ever renders as a
   panel — see the UI-restraint note in the build plan. The journal is the
   output channel; if it can't be felt there, it isn't working. */
function dumpMemories(state){
  const St = state || S;
  for(const p of St.people){
    console.log(`\n${p.name} — ${(p.memories||[]).length} memories`);
    console.table((p.memories||[]).map(m => ({
      day: m.day, kind: m.kind, int: +m.intensity.toFixed(2),
      sal: +m.salience.toFixed(3), val: +m.valence.toFixed(2),
      warm: +m.warmth.toFixed(2), keep: m.unforgettable ? "*" : "",
      text: m.text.slice(0, 60)
    })));
  }
}

export {
  ACHE_PEAK, ACHE_TAU, FRONT_COOLDOWN, FRONT_DISPLAY_MIN, MEM_SLOTS,
  REACT_BUMP, SAL_DECAY, WARM_BONUS, WB_SCALE,
  addMemory, addMemoryAll, drawnToCare, dumpMemories, frontMemory, frontText,
  goneOf, hasRecentMemory, injuryIsNotable, isGoneNow, lossDay, makeMemory,
  memoriesOf, memoryEffect, peakAffinityWith, pickFront, pushRecentEvent,
  recentEvents, recordGone, reluctance, seedPregameMemory, tendMemories,
  tickMemories, tickRecentEvents, todayTouches
};
