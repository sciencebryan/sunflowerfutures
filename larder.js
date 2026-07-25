/* ================= the larder =================
   Food stops being one number here — but S.res.food stays exactly what it
   always was, and every formula that reads it (hunger, caps, winter
   projections, the larder-freshness math) keeps reading the same thing.

   The arrangement, which is the whole trick:
     S.pantry   typed fresh stock — [{k, n, d}], k a FOOD_DATA id
     S.jars     typed preserved stock — [{k, n, m, d}], m a PRES_KEEP id
     S.res.food  = sum of S.pantry, resynced once a day
     S.preserved = sum of S.jars,   resynced once a day
   Composition is authoritative here; the totals are a cache. Only the
   WRITE sites in day.js had to change — harvest, forage, tanks, gleaning,
   preservation. Everything that only reads a total was left alone.

   NOTE the name collision that isn't one: S.larder (a 0..1 scalar) is the
   wild near-country's freshness and predates this file. It is not this.

   ---- why perishable-first ----
   The village eats what is about to spoil before it eats what keeps, which
   is what any real household does and gives the jars a sharper role: the
   preserved stock isn't a random slice of the harvest, it's specifically
   the reserve, spent only once the fresh runs thin. It also means macros
   move on their own — a week of nothing but berries ripening is a week of
   eating sugar whether anyone chose that or not. */

import { S } from "./state.js";
import { clamp, pick } from "./helpers.js";
import { season } from "./seasons.js";
import { FOOD_DATA, FORAGE_RAIN_DAYS, FORAGE_TABLE, MAC_CEIL, MAC_CEIL_AT, MAC_DRAG,
         MAC_DRAG_CAP, MAC_FLOOR_MIN, MAC_FLOOR_RATE, MAC_FLOOR_START, MAC_GRACE, MAC_LINES, MAC_MIN, MAC_RECOVER, PRES_KEEP,
         RECIPES } from "./data-food.js";

const fd = k => FOOD_DATA[k] || null;
const foodName = k => (fd(k)||{}).name || k;

/* ---- shape, tolerant of anything older ---- */
function pantry(){ if(!Array.isArray(S.pantry)) S.pantry = []; return S.pantry; }
function jars(){ if(!Array.isArray(S.jars)) S.jars = []; return S.jars; }
const pantryTotal = () => pantry().reduce((a,e)=>a+e.n, 0);
const jarsTotal   = () => jars().reduce((a,e)=>a+e.n, 0);

/* Push the composition back into the two scalars every other system reads.
   Called at the end of the food phase, and after anything that moves stock. */
function resync(){
  S.res.food = pantryTotal();
  S.preserved = jarsTotal();
}

/* ---- adding ----
   Same id merges into one entry, with a weighted-average acquisition day so
   the stock ages honestly rather than resetting every time more comes in. */
function addFood(k, n){
  if(!k || !(n>0)) return 0;
  if(!fd(k)) k = "greens";   // unknown id: it's food, it's leafy, it's fine
  const p = pantry();
  const e = p.find(x=>x.k===k);
  if(e){ e.d = (e.d*e.n + S.day*n)/(e.n+n); e.n += n; }
  else p.push({k, n, d:S.day});
  return n;
}
/* Straight into the jars — used by the overflow path, where a glut is put
   by without anyone standing at the racks. */
function addPreserved(k, n, method){
  if(!k || !(n>0)) return 0;
  const m = (fd(k) && fd(k).pres.includes(method)) ? method
          : (fd(k) && fd(k).pres[0]) || null;
  if(!m) return 0;   // some things simply cannot be kept — see oil
  const j = jars();
  const e = j.find(x=>x.k===k && x.m===m);
  if(e){ e.n += n; } else j.push({k, n, m, d:S.day});
  return n;
}

/* ---- eating ----
   Draws `want` food value, most-perishable-first, and reports the macro
   split of what was actually eaten. Fresh first; jars only once the fresh
   is gone (the caller decides whether to open them). */
function takeFrom(list, want, order){
  const got = {c:0, f:0, p:0};
  let taken = 0;
  const rows = [...list].sort(order);
  for(const e of rows){
    if(taken >= want-1e-9) break;
    const t = Math.min(e.n, want - taken);
    const m = (fd(e.k)||{mac:{c:1,f:0,p:0}}).mac;
    got.c += t*m.c; got.f += t*m.f; got.p += t*m.p;
    e.n -= t; taken += t;
  }
  // drop anything eaten to nothing
  for(let i=list.length-1;i>=0;i--) if(list[i].n <= 1e-6) list.splice(i,1);
  return {taken, mac:got};
}
const perishableFirst = (a,b) => ((fd(b.k)||{dk:0}).dk) - ((fd(a.k)||{dk:0}).dk);
const oldestFirst     = (a,b) => a.d - b.d;

const eatFresh = want => takeFrom(pantry(), want, perishableFirst);
const eatJars  = want => takeFrom(jars(),   want, oldestFirst);

/* ---- decay ----
   Fractional losses resolve probabilistically: an expected loss of 0.3
   units is a 30% chance of losing a whole one, which keeps entries
   readable instead of bleeding to 11.83. Preserved stock decays too, at
   its method's rate — canned is near-immortal, dried is merely good. */
function decayStock(lines){
  let lostFresh = 0, worst = null;
  for(const e of pantry()){
    // heat rots things faster and a cold cellar slows everything down —
    // both used to be flat modifiers on one pooled number; they belong here
    const rate = (fd(e.k)||{dk:0.05}).dk
               * (S.flags.rootCellar ? 0.72 : 1)
               * (season().heat ? 1.5 : 1)
               * (S.flags.seedLibrary ? 0.95 : 1);
    let loss = e.n * rate;
    const whole = Math.floor(loss);
    loss = whole + (Math.random() < (loss-whole) ? 1 : 0);
    if(loss > 0){
      loss = Math.min(loss, e.n);
      e.n -= loss; lostFresh += loss;
      if(!worst || loss > worst.n) worst = {k:e.k, n:loss};
    }
  }
  for(const e of jars()){
    const rate = (PRES_KEEP[e.m]||PRES_KEEP.dry).keep;
    let loss = e.n * rate;
    const whole = Math.floor(loss);
    loss = whole + (Math.random() < (loss-whole) ? 1 : 0);
    if(loss > 0){ e.n = Math.max(0, e.n - loss); }
  }
  for(const list of [pantry(), jars()])
    for(let i=list.length-1;i>=0;i--) if(list[i].n <= 1e-6) list.splice(i,1);

  if(S.flags.compost && lostFresh>0) S.compost = clamp((S.compost||0) + lostFresh*0.5, 0, 80);
  // only narrate a real loss, and only sometimes — spoilage is background
  if(worst && worst.n >= 3 && Math.random()<0.5)
    lines.push(`${worst.n.toFixed(0)} of the ${foodName(worst.k)} went over before anyone could get to them.`);
  return lostFresh;
}

/* ---- preserving ----
   The method decides what it can even touch: you do not can a leaf into
   anything worth eating, and pressure-canning fish is beyond this village.
   Takes from the LEAST perishable eligible stock first — the opposite of
   eating, and the right way round: put by what will survive being put by,
   and eat the fragile stuff tonight. */
function preserveInto(want, method){
  const eligible = pantry().filter(e => (fd(e.k)||{pres:[]}).pres.includes(method));
  if(!eligible.length) return {taken:0, kinds:[]};
  eligible.sort((a,b)=>((fd(a.k)||{dk:0}).dk) - ((fd(b.k)||{dk:0}).dk));
  const keep = PRES_KEEP[method];
  let taken = 0; const kinds = [];
  for(const e of eligible){
    if(taken >= want-1e-9) break;
    const t = Math.min(e.n, want - taken);
    e.n -= t; taken += t;
    addPreserved(e.k, t*(1-keep.loss), method);
    kinds.push(foodName(e.k));
  }
  const p = pantry();
  for(let i=p.length-1;i>=0;i--) if(p[i].n <= 1e-6) p.splice(i,1);
  return {taken, kinds};
}
/* Which methods this village can run, best-keeping first — canning needs
   power, so the caller passes whether it's on. */
function bestMethodFor(canningOn){
  const have = [];
  if(canningOn && S.flags.canning) have.push("can");
  if(S.flags.crocks) have.push("ferment");
  if(S.flags.dryRacks) have.push("dry");
  return have;
}

/* ---- foraging ----
   What the near country actually hands over, by season, with mushroom
   flushes following rain the way they really do. Splits one lump of
   forage value across two or three real things. */
function forageKinds(){
  const t = FORAGE_TABLE[season().id] || FORAGE_TABLE.spring;
  const wet = (S.day - (S.lastRainDay ?? -99)) <= FORAGE_RAIN_DAYS;
  const pool = [...t.always, ...(wet ? t.rain : [])];
  return pool.length ? pool : ["bark"];
}
function addForage(total){
  if(!(total>0)) return;
  const pool = forageKinds();
  const n = Math.min(pool.length, 1 + Math.floor(Math.random()*3));
  const picks = [...pool].sort(()=>Math.random()-0.5).slice(0,n);
  // uneven split — a day's foraging is rarely balanced
  let left = total;
  picks.forEach((k,i)=>{
    const share = i===picks.length-1 ? left : total*(0.3+Math.random()*0.4)/picks.length;
    const amt = Math.min(left, share);
    addFood(k, amt); left -= amt;
  });
  if(left>0.01) addFood(picks[0], left);
  return picks;
}

/* ---- macros ----
   Rolling deficiency counters, the same idiom as hungerDays/thirstDays:
   days below the line, escalating slowly, forgiving slowly. Returns the
   wb drag and a soft ceiling for the wellbeing loop to apply. */
function tickMacros(eaten, lines){
  S.macDays = S.macDays || {p:0, f:0};
  const total = eaten.c + eaten.f + eaten.p;
  const out = {drag:0, ceil:100, floor:0};
  if(total < 0.5) return out;   // nobody ate: that's starvation's business, not this
  for(const ax of ["p","f"]){
    const share = eaten[ax]/total;
    const was = S.macDays[ax];
    if(share < MAC_MIN[ax]) S.macDays[ax] = was + 1;
    else S.macDays[ax] = Math.max(0, was - MAC_RECOVER);
    const d = S.macDays[ax];
    if(d > MAC_GRACE){
      out.drag += Math.min(MAC_DRAG_CAP, (d-MAC_GRACE)*MAC_DRAG);
      // ...but only down to a floor that deepens with the deficiency and
      // then holds. See MAC_FLOOR_* — this is the plateau, and it's the
      // difference between "badly fed" and "dying", which are different
      // systems with different counters.
      out.floor = Math.max(out.floor, Math.max(MAC_FLOOR_MIN, MAC_FLOOR_START - (d-MAC_GRACE)*MAC_FLOOR_RATE));
    }
    if(d >= MAC_CEIL_AT) out.ceil = Math.min(out.ceil, MAC_CEIL);
    // one line at each crossing, never a number
    if(was <= MAC_GRACE && d > MAC_GRACE) lines.push(pick(MAC_LINES[ax].onset));
    else if(was > MAC_GRACE && d <= MAC_GRACE) lines.push(pick(MAC_LINES[ax].relief));
  }
  return out;
}

/* ---- recipes ----
   One dish a day at most, and only with someone at the hearth. A recipe
   is mostly a better arrangement of what was being eaten anyway, so it
   costs a little extra food and pays a little wb — plus it counts as real
   variety, and a macFix dish walks back the matching deficiency counter,
   which is how a village solves a shortfall on purpose. */
const matches = (need, e) => typeof need === "string"
  ? e.k === need
  : ((fd(e.k)||{tags:[]}).tags || []).includes(need.tag);
function findRecipe(){
  const stock = pantry().filter(e=>e.n >= 1);
  const usable = RECIPES.filter(r => r.needs.every(nd => stock.some(e => matches(nd, e))));
  if(!usable.length) return null;
  // prefer a dish that fixes whatever the village is actually short of
  const short = S.macDays && (S.macDays.p > MAC_GRACE ? "p" : S.macDays.f > MAC_GRACE ? "f" : null);
  const fixes = short ? usable.filter(r=>r.macFix===short) : [];
  let pool = fixes.length ? fixes : usable;
  // not the same supper two nights running, if there's any alternative —
  // a hearth that only ever makes one dish reads as a broken loop
  const fresh = pool.filter(r=>r.id !== S.lastRecipe);
  if(fresh.length) pool = fresh;
  return pick(pool);
}
function cookRecipe(lines){
  if(S.lastRecipeDay === S.day) return null;
  const r = findRecipe();
  if(!r) return null;
  // take the cost from the ingredients themselves, so the dish is made of
  // what it says it's made of
  let left = r.takes;
  for(const nd of r.needs){
    if(left <= 0) break;
    const e = pantry().find(x=>matches(nd, x) && x.n > 0);
    if(!e) continue;
    const t = Math.min(e.n, r.takes/r.needs.length);
    e.n -= t; left -= t;
  }
  const p = pantry();
  for(let i=p.length-1;i>=0;i--) if(p[i].n <= 1e-6) p.splice(i,1);
  if(r.macFix && S.macDays) S.macDays[r.macFix] = Math.max(0, S.macDays[r.macFix] - 3);
  S.lastRecipeDay = S.day;
  S.lastRecipe = r.id;
  lines.push(r.line);
  return r;
}

/* ---- readouts (render only) ---- */
function composition(){
  return [...pantry()].sort((a,b)=>b.n-a.n).map(e=>({
    k:e.k, name:foodName(e.k), n:e.n,
    fast:(fd(e.k)||{dk:0}).dk >= 0.12
  }));
}
function jarComposition(){
  return [...jars()].sort((a,b)=>b.n-a.n).map(e=>({
    k:e.k, name:foodName(e.k), n:e.n, m:e.m,
    method:(PRES_KEEP[e.m]||PRES_KEEP.dry).name
  }));
}
/* The macro split of what's actually on the shelves right now — the honest
   version of the old variety score, which counted crop names and so read
   apples-and-raspberries as a varied diet. */
function stockMacros(){
  const out = {c:0, f:0, p:0}; let tot = 0;
  for(const e of [...pantry(), ...jars()]){
    const m = (fd(e.k)||{mac:{c:1,f:0,p:0}}).mac;
    out.c += e.n*m.c; out.f += e.n*m.f; out.p += e.n*m.p; tot += e.n;
  }
  if(tot>0){ out.c/=tot; out.f/=tot; out.p/=tot; }
  return out;
}

export { addFood, addForage, addPreserved, bestMethodFor, composition, cookRecipe, decayStock,
         eatFresh, eatJars, foodName, forageKinds, jarComposition, jars, jarsTotal, pantry,
         pantryTotal, preserveInto, resync, stockMacros, tickMacros };
