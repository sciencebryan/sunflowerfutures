/* ================= conversations =================
   The processing half of the memory system. A memory that only ever decays
   is a wound nobody attends to; talking is the one thing in this game that
   raises `warmth`, and warmth is what turns a grief into something a person
   can carry.

   A conversation needs a TOPIC, not necessarily a pre-existing memory.
   Recalling one is a topic; so is a values gap, so is the storm three days
   ago. Three sources, tried in that order.

   THE PART MOST LIKELY TO GET BUILT WRONG — and worth stating flatly:
   valence comes from compatibility(A,B), NOT from the topic. Whether they
   agreed or clashed is what the conversation was ABOUT: that's tags and
   journal text. Whether it FELT good is chemistry. Values-alignment and
   personal chemistry are tracked as separate independent signals everywhere
   else in this codebase and they must not collapse into one number here.

   A disagreement between two people who click lands as a warm memory —
   "argued all evening about whether the valley should be left alone, and
   neither one minded losing." Agreement between two who don't mesh still
   grates. That's a better sentence than any blended number produces, and
   it costs nothing extra to compute.

   Pair selection deliberately mirrors moments.js rather than importing it:
   same presence rules, same weighted draw, its own cooldown so the two
   systems don't starve each other of pairs. */

import { S } from "./state.js";
import { byId, clamp, pick } from "./helpers.js";
import { MISMATCH_T, bondKey, bondOf, compatibility } from "./bonds.js";
import { AXES, ideoOf } from "./ideology.js";
import { canWork } from "./seasons.js";
import { AXIS_TOPIC, CONV_LINES, MEM_TOPIC } from "./data-memories.js";
import { addMemory, frontMemory, recentEvents } from "./memories.js";

const CONV_DAILY_P = 0.3;         // village-wide, per day
const CONV_PAIR_COOLDOWN = 10;    // days before the same pair talks again
const CONV_BOND = 0.3;            // affinity moved — harder than the daily tick
const CONV_WARMTH = 0.12;         // warmth added to a memory that got talked through
const CONV_SALIENCE = 0.05;       // ...and it becomes a little more present, too
const CONV_MEM_INTENSITY = 0.25;  // a memory OF a conversation is always smaller
                                  // than the thing the conversation was about
const RECALL_MIN = 0.4;           // a memory has to be present enough to come up
const IDEO_GAP = 0.8;             // an axis they differ on this much is a topic
const IDEO_EXTREME = 0.85;        // ...as is one they BOTH sit past, same side

const present = p => p && p.status !== "away";
const actor = p => present(p) && p.status !== "down" && canWork(p);

/* --- topic selection, in priority order --- */
function topicFor(A, B){
  // 1. something on A's mind, if it's actually present enough to come up
  const m = frontMemory(A);
  if(m && m.salience > RECALL_MIN && m.text){
    return { kind: "memory", memory: m, mode: null,
             subject: m.tags.subject || m.kind,
             phrase: MEM_TOPIC[m.kind] || MEM_TOPIC[m.tags.subject] || MEM_TOPIC._default };
  }

  // 2. values. A gap they can argue over, or a conviction they turn out to
  //    share — the latter is the whole payoff of authoring worldviews at all:
  //    an extreme conviction is lonely unless somebody else holds it.
  const vA = ideoOf(A), vB = ideoOf(B);
  const gaps = [], shared = [];
  for(const ax of AXES){
    const a = vA[ax] || 0, b = vB[ax] || 0;
    if(Math.abs(a - b) > IDEO_GAP) gaps.push(ax);
    else if(Math.abs(a) > IDEO_EXTREME && Math.abs(b) > IDEO_EXTREME && Math.sign(a) === Math.sign(b)) shared.push(ax);
  }
  if(gaps.length || shared.length){
    const useShared = shared.length && (!gaps.length || Math.random() < 0.4);
    const ax = pick(useShared ? shared : gaps);
    return { kind: "ideology", memory: null, mode: useShared ? "shared" : "gap",
             subject: ax, phrase: pick(AXIS_TOPIC[ax]) };
  }

  // 3. whatever the village has been chewing on lately
  const evs = recentEvents().filter(e => e.text);
  if(evs.length){
    const w = evs.map(e => (e.weight || 1) * Math.max(0.1, 1 - (S.day - e.day) / 14));
    const tot = w.reduce((a,b)=>a+b, 0);
    let r = Math.random()*tot, ev = evs[evs.length-1];
    for(let i=0;i<evs.length;i++){ r -= w[i]; if(r <= 0){ ev = evs[i]; break; } }
    return { kind: "event", memory: null, mode: null,
             subject: ev.kind, phrase: ev.text };
  }
  return null;
}

/* THE one number, pulled out as a pure function of the PAIR so the design
   claim is checkable rather than buried: it takes no topic argument, and
   there is nowhere for a topic to get in. MISMATCH_T is imported rather
   than written as 0.6 — one definition of "well below neutral" per game. */
function convValenceOf(A, B){
  return clamp((compatibility(A, B) - MISMATCH_T) / 1.4, -1, 1);
}

function lineFor(topic, warm){
  const bucket = topic.kind === "ideology"
    ? CONV_LINES.ideology[topic.mode]
    : CONV_LINES[topic.kind];
  if(!bucket) return null;
  const pool = warm ? bucket.warm : bucket.cold;
  return (pool && pool.length) ? pick(pool) : null;
}

function tickConversations(lines){
  if(Math.random() > CONV_DAILY_P) return;
  S.bonds = S.bonds || {};

  // candidate pairs: both here, both able to hold a conversation, off cooldown
  const ppl = S.people.filter(actor);
  const cands = [];
  for(let i=0;i<ppl.length;i++) for(let j=i+1;j<ppl.length;j++){
    const A = ppl[i], B = ppl[j];
    const b = bondOf(S.bonds, bondKey(A.id, B.id));
    if(S.day - (b.lastConv || -999) < CONV_PAIR_COOLDOWN) continue;
    // people who barely know each other don't sit down over anything.
    // Weight by familiarity, not affinity: you talk to who you're AROUND,
    // and whether it goes well is the next question, not this one.
    if(b.familiarity < 1) continue;
    cands.push({ A, B, b, w: b.familiarity });
  }
  if(!cands.length) return;

  const tot = cands.reduce((a,c)=>a+c.w, 0);
  let r = Math.random()*tot, c = cands[cands.length-1];
  for(const x of cands){ r -= x.w; if(r <= 0){ c = x; break; } }
  const { A, B, b } = c;

  // A is whoever's memory is more present — so recall lines name the right
  // person as the one doing the telling
  const mA = frontMemory(A), mB = frontMemory(B);
  const swap = (mB && mB.salience > RECALL_MIN) && !(mA && mA.salience > RECALL_MIN);
  const [X, Y] = swap ? [B, A] : [A, B];

  const topic = topicFor(X, Y);
  if(!topic) return;

  const convValence = convValenceOf(X, Y);
  const warm = convValence >= 0;

  const t = lineFor(topic, warm);
  if(!t) return;
  lines.push(t.replaceAll("{A}", X.name).replaceAll("{B}", Y.name).replaceAll("{topic}", topic.phrase));

  /* --- effects --- */
  // 1. the bond moves, harder than an ordinary day's proximity would move it
  b.affinity = clamp(b.affinity + CONV_BOND * convValence, -10, 10);
  if(b.affinity > (b.peakAff || 0)) b.peakAff = b.affinity;
  b.lastConv = S.day;

  // 2. if it was a memory, it got tended. Salience AND warmth: saying a thing
  //    out loud makes it more present and less sharp at the same time.
  if(topic.kind === "memory" && topic.memory){
    topic.memory.warmth  = clamp(topic.memory.warmth + CONV_WARMTH, 0, 1);
    topic.memory.salience = clamp(topic.memory.salience + CONV_SALIENCE, 0, 1);
  }

  // 3. the conversation becomes its own small memory, for both. Deliberately
  //    thin: no place tag, no action tag, so these never reactivate off
  //    ordinary work and never crowd the twelve slots. A memory about a
  //    conversation should always be smaller than the thing it was about.
  const text = topic.kind === "ideology"
    ? `${warm ? "Talking" : "Going round"} with ${Y.name} about ${topic.phrase}.`
    : `Talking to ${Y.name} about ${topic.phrase}.`;
  const textY = topic.kind === "ideology"
    ? `${warm ? "Talking" : "Going round"} with ${X.name} about ${topic.phrase}.`
    : `Talking to ${X.name} about ${topic.phrase}.`;
  addMemory(X, { kind: "conversation", text, intensity: CONV_MEM_INTENSITY,
                 valence: convValence, tags: { people: [Y.id], subject: topic.subject } });
  addMemory(Y, { kind: "conversation", text: textY, intensity: CONV_MEM_INTENSITY,
                 valence: convValence, tags: { people: [X.id], subject: topic.subject } });
}

export { CONV_BOND, CONV_DAILY_P, CONV_PAIR_COOLDOWN, CONV_WARMTH, convValenceOf, tickConversations, topicFor };
