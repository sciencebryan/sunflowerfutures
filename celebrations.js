/* ================= celebrations & traditions =================
   Replaces the single hardcoded festival. Two things going on:

   1. SCALE. Every celebration costs and gives in proportion — a modest
      bonfire is half the wood and half the night; an all-out one is double
      both. The player chooses how much of a good year to spend.

   2. TRADITIONS. Hold a celebration, name it, and it comes back on the same
      day every year for as long as the village can keep it. A tradition
      strengthens the longer it's kept (up to a point) — this is the one
      thing in the game that accumulates without anything growing.

   Celebrations also warm every pair present, which is what makes them feed
   the bond graph and therefore the journal's tender moments. A village that
   celebrates is a village whose people end up closer. */

import { S } from "./state.js";
import { clamp, pick, poss, wbFloor } from "./helpers.js";
import { season, yearOf } from "./seasons.js";
import { SEASON_LEN } from "./data-economy.js";
import { bondKey, bondOf } from "./bonds.js";
import { CELEBRATIONS, SCALES, TRADITION_LINES, TRADITION_MISSED } from "./data-celebrations.js";

const YEAR_LEN = SEASON_LEN * 4;
const dayOfYear = day => ((day - 1) % YEAR_LEN) + 1;
const celebDef = id => CELEBRATIONS.find(c => c.id === id);
const scaleDef = id => SCALES.find(s => s.id === id) || SCALES[1];

/* --- gates --- */
const GATES = {
  musical:     () => S.people.some(p => p.status !== "away" && (p.music||[]).length),
  hasWood:     () => (S.res.wood||0) >= 8,
  hasProject:  () => !!S.project,
  afterDeath:  () => (S.deaths||0) > (S.mournedDeaths||0)
};
function gatesOk(def){
  if(!def.gate) return true;
  return def.gate.every(g => g.startsWith("season:") ? season().id === g.slice(7)
                           : (GATES[g] ? GATES[g]() : true));
}

/* What a celebration costs at a given scale, rounded to whole units. */
function costOf(def, scaleId){
  const m = scaleDef(scaleId).mult, out = {};
  for(const [k,v] of Object.entries(def.cost||{})) out[k] = Math.round(v*m);
  return out;
}
function stores(){ return S.res.food + S.preserved; }
function canAfford(def, scaleId){
  const c = costOf(def, scaleId);
  if(c.food && stores() < c.food + (def.margin||0)) return false;
  for(const [k,v] of Object.entries(c)) if(k!=="food" && (S.res[k]||0) < v) return false;
  return true;
}
const onCooldown = def => (S.celebCd && S.celebCd[def.id] || 0) > 0;
const available = def => gatesOk(def) && !onCooldown(def);

/* --- holding one --- */
function holdCelebration(id, scaleId, traditionName){
  const def = celebDef(id); if(!def) return false;
  if(!gatesOk(def) || onCooldown(def) || !canAfford(def, scaleId)) return false;
  const sc = scaleDef(scaleId), m = sc.mult;
  const c = costOf(def, scaleId);

  // pay: food comes out of fresh first, then preserved — same order as famine
  if(c.food){
    let need = c.food;
    const fresh = Math.min(S.res.food, need); S.res.food -= fresh; need -= fresh;
    S.preserved = Math.max(0, S.preserved - need);
  }
  for(const [k,v] of Object.entries(c)) if(k!=="food") S.res[k] = Math.max(0, (S.res[k]||0) - v);

  // the optional extra: taken only if it's genuinely spare
  let rich = false;
  if(def.optional){
    const [k,v] = Object.entries(def.optional)[0];
    if((S[k]||S.res[k]||0) >= v){
      if(S[k]!==undefined) S[k]-=v; else S.res[k]-=v;
      rich = true;
    }
  }

  // tradition weight: a thing kept for years lands harder than a new one
  const trad = (S.traditions||[]).find(t => t.kind===id && t.name===traditionName);
  const tw = trad ? 1 + Math.min(0.5, (trad.timesHeld||0)*0.06) : 1;

  const here = S.people.filter(p => p.status !== "away");
  for(const p of here) p.wb = clamp(p.wb + def.wb*m*tw, wbFloor(p), 100);

  S.festivalBoostDays = Math.max(S.festivalBoostDays||0, Math.round(def.days*m*tw));
  S.celebCd = S.celebCd || {};
  if(def.cooldown) S.celebCd[def.id] = Math.round(def.cooldown*m);

  // everyone present gets a little closer to everyone else
  S.bonds = S.bonds || {};
  const warmth = def.bond*m;
  for(let i=0;i<here.length;i++) for(let j=i+1;j<here.length;j++){
    const b = bondOf(S.bonds, bondKey(here[i].id, here[j].id));
    b.familiarity = Math.min(10, b.familiarity + warmth*0.4);
    b.affinity = clamp(b.affinity + warmth, -10, 10);
    if(b.affinity > (b.peakAff||0)) b.peakAff = b.affinity;
  }

  if(def.work && S.project) S.project.progress += (workDefWork()||40) * def.work * m;
  if(id==="remembrance") S.mournedDeaths = S.deaths||0;

  // journal
  const varied = new Set(S.dietLog.filter(e=>S.day-e.day<=21).map(e=>e.crop)).size >= 3;
  let line = pick(def.lines);
  const player = here.find(p => (p.music||[]).some(x=>x!=="singing"&&x!=="clapping"));
  line = line.replace("{player}", player?player.name:"Somebody").replace("{Pposs}", player?poss(player):"their");
  const head = trad
    ? pick(TRADITION_LINES).replace(/\{name\}/g, trad.name).replace("{nth}", ordinal((trad.timesHeld||0)+1))
    : `${def.name} — ${sc.label.toLowerCase()}. ${sc.note}.`;
  S.pending.push(head);
  S.pending.push(line + (rich && def.rich ? " " + def.rich : ""));

  if(trad){ trad.timesHeld = (trad.timesHeld||0)+1; trad.lastHeld = S.day; }
  S.lastCelebration = {kind:id, scale:scaleId, day:S.day};
  return true;
}
function workDefWork(){
  // the project's total work, without importing day.js (cycle) — the field
  // is on S.project when it was set up
  return (S.project && S.project.work) || 40;
}
const ORD=["","first","second","third","fourth","fifth","sixth","seventh","eighth","ninth","tenth",
           "eleventh","twelfth","thirteenth","fourteenth","fifteenth"];
const ordinal = n => ORD[n] || (n + (n%10===1&&n%100!==11?"st":n%10===2&&n%100!==12?"nd":n%10===3&&n%100!==13?"rd":"th"));

/* --- traditions --- */
function makeTradition(name){
  const last = S.lastCelebration;
  if(!last || !name || !name.trim()) return false;
  S.traditions = S.traditions || [];
  if(S.traditions.some(t => t.day === dayOfYear(last.day))) return false;   // one per date
  S.traditions.push({
    name: name.trim().slice(0,32), kind: last.kind, scale: last.scale,
    day: dayOfYear(last.day), founded: yearOf(last.day), timesHeld: 1, lastHeld: last.day
  });
  S.pending.push(`It was decided that this would happen every year on this day, and that it would be called ${name.trim()}.`);
  return true;
}
function forgetTradition(name){
  S.traditions = (S.traditions||[]).filter(t => t.name !== name);
}

/* Runs daily. A tradition whose day has come is kept automatically if the
   village can keep it — no prompt, because that's what a tradition is. */
function tickTraditions(lines){
  if(!S.traditions || !S.traditions.length) return;
  const today = dayOfYear(S.day);
  for(const t of S.traditions){
    if(t.day !== today) continue;
    if(t.lastHeld && S.day - t.lastHeld < YEAR_LEN - 2) continue;   // already kept this year
    const def = celebDef(t.kind); if(!def) continue;
    const cd = S.celebCd && S.celebCd[def.id];
    if(S.celebCd) S.celebCd[def.id] = 0;   // a tradition overrides its own cooldown
    if(gatesOk(def) && canAfford(def, t.scale)){
      holdCelebration(t.kind, t.scale, t.name);
    } else {
      if(S.celebCd && cd) S.celebCd[def.id] = cd;
      lines.push(pick(TRADITION_MISSED).replace(/\{name\}/g, t.name));
      for(const p of S.people) if(p.status!=="away") p.wb = clamp(p.wb-3, wbFloor(p), 100);
      t.missed = (t.missed||0)+1;
    }
  }
}
function tickCelebCooldowns(){
  if(!S.celebCd) return;
  for(const k of Object.keys(S.celebCd)) if(S.celebCd[k]>0) S.celebCd[k]--;
}

export { CELEBRATIONS, SCALES, available, canAfford, celebDef, costOf, dayOfYear, forgetTradition, gatesOk, holdCelebration, makeTradition, onCooldown, scaleDef, tickCelebCooldowns, tickTraditions };
