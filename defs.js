import { clamp, pick } from "./helpers.js";
import { S } from "./state.js";
import { CROPS } from "./seasons.js";

/* ================= definitions ================= */
/* =========================================================================
   TUNING GUIDE — where the balance dials live.
   Rather than pull every constant out into named variables (risky to do
   by hand across a tested balance, and it wouldn't make the numbers any
   easier to find), this is a map: search for the bolded term to jump to
   the value. Everything here was arrived at by running headless bots for
   1-13 simulated years and reading the results, not by feel — see the
   comments at each site for the specific failure a value is guarding
   against before you change it.

   PACE
     DAY_MS (below)      real-world ms per in-game day
     OFFLINE_CAP (below) max days simulated at once when you return
     SEASON_LEN           search in this file — days per season (year = ×4)

   POWER / WATER
     "decay:" in SYS      wear per system per day — total is the village's
                           daily repair workload; see the SYS schema comment
     "draw:" in SYS       power cost per system, whether powered or not
     gardenWater           search "let gardenWater" — water cost per bed/day

   FOOD
     "work:" "yield:" "seed:" "seeds:" in CROPS   growth time / harvest size /
                           sow cost / seed return, per crop — see CROPS schema
     mouths                search "const mouths" — food eaten per person/day
                           (children eat less; see the canWork() ternary)
     foodCap()             search "const foodCap" — fresh-storage ceiling
     S.preserved cap       search "S.preserved = clamp" — jar-storage ceiling
     PRESERVE.rate/.loss    conversion speed and waste, per method

   SPIRITS (wellbeing)
     hungerBite / strain    search "const strain" — how hunger & thirst cost
                           spirits, and how it compounds with consecutive days
     aura                  search "let aura" — the daily spirits gain/loss
                           tally: commons condition, cooks, carers, sunflowers,
                           food variety (varietyMood) all add in here
     wbFloor()              minimum wellbeing a person can be ground down to

   DIFFICULTY / LATE-GAME PRESSURE
     stormChance            search "const stormChance" — escalates with yearOf(S.day)
     equipment failure       search "Something let go in" — breakdown odds vs. village age
     blight                 search "Blight took" — monoculture risk (n beds of one crop)
     dietLog / varietyMood   search "varietyMood" — monotony penalty, variety bonus

   PEOPLE
     ADULT, ELDER (below)   age thresholds for work / the road
     AGES                   search "const AGES" — starting ages of the named cast
   ========================================================================= */
const DAY_MS = 120000;
const OFFLINE_CAP = 14;
const INJURY_PER_DAY = 0.03;

const SKILL_INFO = {
  hands:"repairs, machines, building",
  green:"gardens, tanks, things that grow",
  care:"the hearth, the sickbed, people",
  wild:"the road — safer and stronger out beyond"
};

const TRAITS = {
  Tinkerer:   "+1.5 hands at repairs and projects; −2 spirits/day when resting",
  "Green-thumb": "+1.5 green in the gardens and the tanks",
  Restless:   "−3 spirits/day after 3 days on one task; gains spirits out beyond",
  Steady:     "work costs no spirits; never sours on a long task",
  Cautious:   "injury and illness much rarer; −0.5 hands",
  Mender:     "lifts others more at the hearth or the sickbed",
  Weathered:  "spirits never fall below 25"
};

const ROSTER = [
  {id:"nadia",  name:"Nadia",   pn:"she/her",  trait:"Tinkerer",    hands:4, green:1, care:1, wild:1, note:"Keeps a jar of salvaged screws sorted by mood."},
  {id:"ora",    name:"Ora",     pn:"she/they", trait:"Green-thumb", hands:1, green:4, care:2, wild:1, note:"Talks to the tomatoes. Swears they answer."},
  {id:"bec",    name:"Bec",     pn:"they/them",trait:"Restless",    hands:2, green:1, care:1, wild:4, note:"Maps the ridgeline in their head at night."},
  {id:"sam",    name:"Sam",     pn:"he/him",   trait:"Steady",      hands:2, green:1, care:1, wild:2, note:"Has never once complained about the rain."},
  {id:"yusuf",  name:"Yusuf",   pn:"he/him",   trait:"Cautious",    hands:3, green:1, care:1, wild:2, note:"Checks every ladder twice. Alive because of it."},
  {id:"petra",  name:"Petra",   pn:"she/her",  trait:"Mender",      hands:1, green:1, care:4, wild:1, note:"Remembers how everyone takes their tea."},
  {id:"ilya",   name:"Ilya",    pn:"he/they",  trait:"Tinkerer",    hands:3, green:1, care:1, wild:2, note:"Hums to engines until they start."},
  {id:"june",   name:"June",    pn:"she/her",  trait:"Weathered",   hands:2, green:3, care:3, wild:1, note:"Planted the first bed the spring after."},
  {id:"marisol",name:"Marisol", pn:"she/her",  trait:"Green-thumb", hands:1, green:3, care:2, wild:1, note:"Braids seed packets into her hair."},
  {id:"theo",   name:"Theo",    pn:"he/him",   trait:"Restless",    hands:1, green:1, care:1, wild:3, note:"Sixteen, and the fastest up the water tower."},
  {id:"ash",    name:"Ash",     pn:"they/them",trait:"Steady",      hands:2, green:2, care:1, wild:2, note:"Speaks rarely; finishes everything."},
  {id:"kav",    name:"Kav",     pn:"xe/xem",   trait:"Cautious",    hands:1, green:2, care:2, wild:1, note:"Keeps the weather log. Trusts the sky less each year."}
];

const NEWCOMERS = [
  {id:"rosa",  name:"Rosa",  pn:"she/her",  trait:"Steady",      hands:1, green:2, care:3, wild:1, note:"Arrived with a sourdough starter older than the quiet."},
  {id:"emrys", name:"Emrys", pn:"he/him",   trait:"Tinkerer",    hands:3, green:1, care:1, wild:1, note:"Carries a multimeter like a talisman."},
  {id:"din",   name:"Din",   pn:"they/them",trait:"Restless",    hands:1, green:1, care:1, wild:3, note:"Doesn't say where they walked from."},
  {id:"halla", name:"Halla", pn:"she/her",  trait:"Green-thumb", hands:1, green:3, care:2, wild:1, note:"Knows which mushrooms. All of which."},
  {id:"moss",  name:"Moss",  pn:"they/them",trait:"Weathered",   hands:2, green:2, care:1, wild:1, note:"Old enough to remember the before. Doesn't talk about it."},
  {id:"yara",  name:"Yara",  pn:"she/her",  trait:"Cautious",    hands:2, green:1, care:2, wild:2, note:"Counts everything twice, shares anyway."}
];

// once the radio reaches someone (S.flags.radioContact), arrivals stop being a
// fixed six-person list and become an open-ended trickle — a fresh name and a
// fresh set of stats each time, so reputation and strangerRate keep mattering
// for the rest of the game instead of going inert once NEWCOMERS runs out.
const STRANGER_NAMES = ["Idris","Nia","Cass","Perrin","Solveig","Briar","Osei","Marisela","Quill","Fenwick","Delphine","Amaro"];
const STRANGER_NOTES = [
  "Found the road by the antenna's static, and followed it here on purpose.",
  "Traveled three settlements before this one answered back.",
  "Brought nothing but what could be carried, and a working radio of their own.",
  "Had heard the name of this place before ever hearing a voice on it.",
  "Walked the last stretch by the sound of the turbine, once close enough to hear it."
];
function rollStranger(){
  const name=pick(STRANGER_NAMES);
  const trait=pick(Object.keys(TRAITS));
  const pn=pick(["she/her","he/him","they/them","xe/xem"]);
  const note=pick(STRANGER_NOTES);
  const stats={hands:1,green:1,care:1,wild:1};
  const boosted=pick(["hands","green","care","wild"]);
  stats[boosted]=3+Math.floor(Math.random()*2);
  for(const k of ["hands","green","care","wild"]) if(k!==boosted) stats[k]=1+Math.floor(Math.random()*2);
  return {name, trait, pn, note, ...stats};
}

/* start:false systems must be built before they do anything.
   draw = power drawn per day once running. */
/* SYS — the seven built systems (power, water, food-infrastructure, morale hub).
   Fields:
     id       unique key. Also used as a job id (working(id)) and a puz/flag lookup.
     name     display name.
     decay    condition points lost per day at 100% staffing elsewhere (see decayOf()
              in simulateDay — some PROJECTS reduce this per-system, e.g. F.bearings).
     draw     power drawn per day once built, whether or not there's power to draw
              (this is why more systems = tighter power budget, not just more decay).
     start    true = already built at game start; false = must be built (needs cost+work).
     cost     resource cost to build (only present when start:false).
     work     labour-points needed to finish building (only present when start:false).
     blurb    flavor text shown on the card.
   Total decay across all seven is the daily "wear budget" the village must cover with
   repair labour — see the balance note in decayOf() before changing any decay value,
   since raising the total materially changes how many hands are free for anything else. */
// stackable wind: one turbine is weak on purpose (you can't coast on wind alone
// anymore); raise more over time. A full array is deliberately a little short of
// the whole village's draw, so solar earns its place. One keeper maintains them all.
const TURBINE_UNIT = 1.3;    // power per turbine at full condition, good wind (start weak, build up)
const MAX_TURBINES = 5;
const TURBINE_COST = {scrap:9, parts:4};
// solar: the old flat array made 6 at full condition/full sun. Splitting it into
// 5 panels at 1.2 each keeps a maxed array close to the old total, while the
// first panel alone is a fifth of it -- same "start weak, build up" shape as wind.
const SOLAR_UNIT = 1.2;
const MAX_SOLAR = 5;
const SOLAR_PANEL_COST = {scrap:6, parts:3};
// battery: old flat capacity was 14 (26 with the batteryRecond upgrade). 5 banks
// at 2.8 each reaches the same 14 at full build; batteryRecond still multiplies
// the whole stack, same relative bump as before.
const BATTERY_UNIT = 2.8;
const MAX_BATTERIES = 5;
const BATTERY_BANK_COST = {scrap:5, parts:5};
// shared lookup so the card UI and the raise-another handler work for all three
// stackable power systems without three copies of the same code
const STACKABLE = {
  turbine: {unit:TURBINE_UNIT, max:MAX_TURBINES, cost:TURBINE_COST, stateKey:"turbines", noun:"turbines", verb:"standing", place:"the ridge"},
  solar:   {unit:SOLAR_UNIT,   max:MAX_SOLAR,    cost:SOLAR_PANEL_COST, stateKey:"solarPanels", noun:"panels", verb:"up", place:"the roof"},
  battery: {unit:BATTERY_UNIT, max:MAX_BATTERIES,cost:BATTERY_BANK_COST, stateKey:"batteries", noun:"banks", verb:"wired in", place:"the bank room"}
};
// the food forest: perennial ground you clear plot by plot, separate from the beds
const MAX_FOREST_PLOTS = 6;
const FOREST_PLOT_COST = {scrap:6};

/* ============================================================
   RESTORATION — three ecological metrics, 0..100 each, that
   the late game turns on. NOT a score to climb: a system with
   coupling and two tipping points, so it behaves like land.

     mycosphere  the living soil web   — fed by native perennials + compost
     aquifer     the water table       — fed by watershed puzzle/projects
     pollinator  the wild bloom        — fed by wildflower meadow plots

   COUPLING (few, strong, named — so a player can learn them):
     • soil<->water: mycosphere and aquifer reinforce each other.
       high water shields soil from drought decay; high soil holds
       water against runoff. together they are the stable core.
     • the living valley: pollinator is pulled toward min(soil,water)
       each season. it rises only as fast as its supports allow, and
       FALLS when they fail — pollinators die without flowers + water.
       this one rule is the whole tipping/cascade behaviour.

   TIPPING POINTS (feedback the player feels):
     • self-sustaining, above HIGH: a metric climbs a little on its
       own — the system has "caught". makes the finish line a stable
       state, not a plate to spin forever.
     • erosion, below LOW: a metric slides unless a coupled metric
       props it up. early restoration must be actively worked or it
       won't stick. below/above the same threshold IS the decay
       question — it decays when low+neglected, holds when high.

   Effects wired into existing threats:
     mycosphere -> blight roll down     (line: 0.012*n)
     aquifer    -> storm chance+damage down, drought softened
     pollinator -> garden yield up + a small standing morale floor
   ============================================================ */
const RESTORE_HIGH = 60;   // self-sustaining tipping point
const RESTORE_LOW  = 25;   // erosion tipping point
const RESTORE_GATE = 80;   // all three above this = valley restored (Phase 4)
// per-action inputs (applied when the action happens)
const RESTORE_IN = {
  nativePlant: 8,   // planting a native perennial in a forest plot
  meadowPlot:  12,  // dedicating a plot to wildflower meadow
  compost:     2,   // a compost spread event onto a worn plot
  waterLevel:  9,   // solving one watershed puzzle level
  waterProject:7    // completing a water-restoration project
};

function ensureRestore(s){
  if(!s.restore) s.restore = {mycosphere:0, aquifer:0, pollinator:0, seen:false, restored:false};
  return s.restore;
}
// push a metric up from anywhere an action happens; flips `seen` so the panel
// appears the first time the player does anything restorative.
function addRestore(metric, amount){
  const r = ensureRestore(S);
  r[metric] = clamp((r[metric]||0) + amount, 0, 100);
  r.seen = true;
}
// the seasonal update: coupling + tipping, run once per season.
function stepRestoration(lines){
  const r = ensureRestore(S);
  if(!r.seen) return;   // nothing planted/restored yet — engine dormant
  const M=r.mycosphere, A=r.aquifer, P=r.pollinator;
  const was = {M,A,P};

  // coupling: soil<->water reinforce; each shields the other from decay
  const support = v => v>=RESTORE_HIGH ? 1.5 : v<=RESTORE_LOW ? -1.5 : 0;
  let dM = support(A);   // water feeds soil
  let dA = support(M);   // soil holds water
  // the living valley: pollinator pulled toward its supports' floor
  const floor = Math.min(M, A);
  let dP = (floor - P) * 0.15;   // rises toward, and falls toward, min(soil,water)

  // tipping: self-sustaining above HIGH, erosion below LOW
  const tip = v => v>=RESTORE_HIGH ? +2 : (v<=RESTORE_LOW && v>0 ? -1.5 : 0);
  dM += tip(M); dA += tip(A); dP += tip(P);

  // gentle neglect drift — only bites in the mid-band where nothing self-sustains
  const drift = -0.6;
  dM += drift; dA += drift; dP += drift;

  r.mycosphere = clamp(M+dM, 0, 100);
  r.aquifer    = clamp(A+dA, 0, 100);
  r.pollinator = clamp(P+dP, 0, 100);

  // legible journal beats at the tipping points, not every season
  const up   = (v0,v1)=> v0<RESTORE_HIGH && v1>=RESTORE_HIGH;
  const down = (v0,v1)=> v0>=RESTORE_LOW && v1<RESTORE_LOW;
  if(up(was.M,r.mycosphere)) lines.push("The soil has turned a corner. Dig anywhere and it's dark, and it smells alive — it holds itself together now.");
  if(up(was.A,r.aquifer))    lines.push("The water table has come back up. The low ground stays damp through the dry weeks, the way the old people said it used to.");
  if(up(was.P,r.pollinator)) lines.push("The valley hums. Bees no one keeps, in flowers no one planted for food — the bloom has caught on its own.");
  if(down(was.M,r.mycosphere)) lines.push("The bare ground is washing thin again. Without more rooted in it, the soil won't stay.");
  if(down(was.P,r.pollinator)) lines.push("The blooms are thinning. Nothing holds the pollinators if the soil and water beneath them fail.");

  // the gate: all three restored
  if(!r.restored && r.mycosphere>=RESTORE_GATE && r.aquifer>=RESTORE_GATE && r.pollinator>=RESTORE_GATE){
    r.restored = true;
    lines.push("Someone stood on the ridge at dusk and couldn't tell, for a moment, where the village ended and the woods began. The valley is whole. Whatever comes next, it comes from a place that can hold it.");
  }
}
const SYS = [
  // decay rebalanced downward after the starting-stat nerf below (everyone -1 star,
  // so a new village's raw repair output is ~30% lower than it was) — see TUNING GUIDE
  {id:"turbine",   name:"Wind turbine",    decay:3.6, draw:0, start:true,  blurb:"The bearing was old when it was found. It turns anyway."},
  {id:"solar",     name:"Solar array",     decay:2.0, draw:0, start:false, cost:{scrap:5,parts:3},  work:11, blurb:"One panel off the depot roofs. Quiet, and only works in daylight.", gate:{discover:true}},
  {id:"battery",   name:"Battery bank",    decay:1.6, draw:0, start:true,  blurb:"Two salvaged cells. Holds the day's light for the night's work — barely."},
  {id:"catchment", name:"Water catchment", decay:2.4, draw:2, start:true,  blurb:"Gutters, tanks, and the pump that feeds them."},
  {id:"aquaponics",name:"Aquaponics",      decay:2.4, draw:3, start:false, cost:{scrap:12,parts:6}, work:22, blurb:"Fish feed plants feed fish. Wants a machinist and a keeper of living things. Hungry for power.", gate:{sys:"irrigation"}},
  {id:"irrigation",name:"Irrigation lines",decay:2.4, draw:0, start:false, cost:{scrap:9},          work:14, blurb:"Drip lines that stretch every liter."},
  {id:"commons",   name:"The commons",     decay:2.0, draw:1, start:true,  blurb:"A roof, a long table, a stove. Wants a keeper for the roof and a cook for the rest."}
];
const BASE_GARDEN_SLOTS = 1;
const gardenSlots=()=>(S.beds?S.beds.length:1);
const foodCap=()=>S.flags.rootCellar?120:90;   // fresh-food storage ceiling; the root cellar project raises it
const waterCapEff=()=>(S.waterCap||80)+(S.flags.cutCistern?12:0);
const built=id=>!!(S.sys[id] && S.sys[id].built);
// The depot only holds so much: scrap and parts stop accumulating past a cap
// generous enough to save for the biggest single project several times over
// (largest costs in the game are 20 scrap / 12 parts), but bounded so a long
// game doesn't drift into the hundreds with nothing to spend it on. Food,
// water, and seeds aren't capped here — they're already bounded by spoilage,
// tank size, and regular sowing respectively.
const RES_CAP = {scrap:120, parts:60, wood:150};
function addRes(k, amt){
  if(amt<=0) return 0;
  const cap = RES_CAP[k];
  if(cap===undefined){ S.res[k]=(S.res[k]||0)+amt; return amt; }
  const room = Math.max(0, cap-(S.res[k]||0));
  const actual = Math.min(amt, room);
  S.res[k] = (S.res[k]||0)+actual;
  return actual;
}
// Wear per day for a built system, after upgrades and stacking. The ONLY place
// this is computed — both the daily tick and the village card read it, so the
// displayed "wears −n" can never drift from what actually happens.
function decayOf(d){
  const F=S.flags;
  let base=d.decay;
  if(d.id==="turbine"&&F.bearings) base=2.2;
  if(d.id==="solar"&&F.panelWash) base=1.2;
  if(d.id==="irrigation"&&F.dripRetrofit) base=1.5;
  if(d.id==="turbine") base *= (1 + 0.03*((S.turbines||1)-1));   // one keeper minds them all; more turbines add only slight upkeep
  if(d.id==="solar")   base *= (1 + 0.03*((S.solarPanels||1)-1));
  if(d.id==="battery") base *= (1 + 0.03*((S.batteries||1)-1));
  if(F.relayGrid) base*=0.9;
  return base;
}
// whether a gated SYS/PROJECT entry should appear in the build menu at all.
// See the gate comment above PROJECTS for the three gate kinds.
function isVisible(entry){
  const g=entry.gate;
  if(!g) return true;
  if(g.sys && !built(g.sys)) return false;
  if(g.flag && !S.flags[g.flag]) return false;
  if(g.discover && !(S.discovered && S.discovered[entry.id])) return false;
  if(g.crop && !(S.crops && S.crops[g.crop]) && !(CROPS[g.crop] && !CROPS[g.crop].locked)) return false;
  return true;
}

const SITE_DEF = [
  {id:"oldtown",  name:"Old Town Row",          days:2, known:true,  stock:{scrap:40, parts:8, cans:14},   blurb:"Collapsed storefronts. Good bones, if you pry — and somebody's pantry might still be sealed."},
  {id:"kessler",  name:"Kessler Depot",         days:3, known:true,  stock:{parts:30, scrap:10},           blurb:"An electronics depot, half looted before the quiet."},
  {id:"pharmacy", name:"Greenbriar Pharmacy",   days:2, known:true,  stock:{meds:20, scrap:6},             blurb:"Shelves behind a grate somebody gave up on."},
  {id:"seedvault",name:"County Seed Vault",     days:4, known:false, stock:{seeds:30, meds:4},             blurb:"A basement archive. Cool, dry, and patient."},
  {id:"substation",name:"Riverside Substation", days:5, known:false, stock:{parts:26, scrap:14},           blurb:"Transformers like sleeping animals."},
  {id:"extension",name:"Agricultural Extension",days:5, known:false, stock:{seeds:22, scrap:12, parts:6},  blurb:"Test plots gone feral. Filing cabinets full of futures."},
  {id:"hospital", name:"Valley Hospital",       days:6, known:false, stock:{meds:30, parts:8},             blurb:"Long halls. You don't go alone."},
  {id:"solarfarm",name:"Solar Farm Ruins",      days:7, known:false, stock:{parts:34, scrap:20},           blurb:"A field of cracked mirrors aimed at nothing."},
  {id:"reservoir",name:"The Reservoir Works",   days:8, known:false, stock:{scrap:30, parts:16, meds:6},   blurb:"The far edge of anyone's map."}
];

const SITE_LOOT_TABLE = {
  "oldtown":    { scrap: 0.6, parts: 0.4 },
  "kessler":    { parts: 0.8, scrap: 0.2 },
  "pharmacy":   { meds: 1.0 },
  "seedvault":  { seeds: 0.8, meds: 0.2 },
  "substation": { parts: 1.0 },
  "extension":  { seeds: 0.6, parts: 0.4 },
  "hospital":   { meds: 0.8, parts: 0.2 },
  "solarfarm":  { parts: 1.0 },
  "reservoir":  { scrap: 0.5, parts: 0.5 }
};

/* PROJECTS — one-time builds that set a permanent S.flags[id]=true and change some
   rule elsewhere in the code (search for F.<id> to find the effect — e.g. F.dryRacks
   unlocks the "drying" method in PRESERVE, F.coldFrames lets crops survive winter).
   Fields: id, name, cost {resource:amount}, work (labour-points), needs (optional —
   an id from SYS that must be built first), blurb.
   A project itself does nothing until you go read its effect; this table only defines
   what it costs to build. */
// gate: {sys:id} needs a system built · {flag:id} needs a project already finished
// · {discover:true} needs S.discovered[id] (a founding choice or a specific
// expedition site turning it up). No gate = visible to a new village on day one.
const PROJECTS = [
  {id:"toolLibrary", name:"Tool library",          cost:{scrap:12},          work:18, blurb:"Sorted, sharpened, and where you left it. All repairs work 20% better."},
  {id:"rootCellar",  name:"Root cellar",           cost:{scrap:8},           work:14, blurb:"Cool, dark, and rat-proof. Holds far more food, and food spoils far slower."},
  {id:"dryRacks",    name:"Drying racks",          cost:{scrap:4},           work:10, blurb:"Sun, air, patience. Fresh food becomes food that keeps — losing a fifth on the way."},
  {id:"crocks",      name:"Fermenting crocks",     cost:{scrap:5, seeds:2},  work:12, blurb:"Salt and time. Keeps nearly all of what you put in, and it's good for people."},
  {id:"canning",     name:"Canning kitchen",       cost:{scrap:6, parts:5},  work:18, blurb:"Jars, lids, and heat. The fastest way to put a harvest by — when the power holds.", gate:{flag:"dryRacks"}},
  {id:"gardenBeds",  name:"New beds",              cost:{scrap:5, seeds:4},  work:14, blurb:"More ground turned, more trellis raised. Another pair of hands can work the gardens."},
  {id:"batteryRecond",name:"Battery reconditioning",cost:{parts:6},          work:14, gate:{sys:"battery"}, blurb:"New cells in old shells. The bank holds most of what it did over again."},
  {id:"panelWash",   name:"Panel wash rig",        cost:{scrap:5},           work:10, gate:{sys:"solar"}, blurb:"A squeegee on a long pole, mostly. Solar array wears slower."},
  {id:"bearings",    name:"Spare bearings",        cost:{parts:8},           work:14, gate:{sys:"turbine"}, blurb:"Machined to fit. The turbine wears much slower."},
  {id:"dripRetrofit",name:"Drip retrofit",         cost:{scrap:6, parts:4},  work:14, gate:{sys:"irrigation"}, blurb:"Every joint resealed. Irrigation wears slower, gardens drink less."},
  {id:"graywater",   name:"Graywater loop",        cost:{scrap:7, parts:3},  work:16, gate:{sys:"irrigation"}, blurb:"Wash water and rinse water, filtered through sand and reed, sent back to the beds. The gardens take far less from the cisterns."},
  {id:"coldFrames",  name:"Cold frames",           cost:{scrap:6, seeds:6},  work:16, gate:{sys:"irrigation"}, blurb:"Glass over good soil. A few beds keep growing straight through winter frost, and you can sow out of season."},
  {id:"herbalStores",name:"Herbal stores",         cost:{meds:6, seeds:3},   work:12, gate:{discover:true}, blurb:"Dried, labeled, jarred. Illness comes less often and leaves sooner."},
  {id:"oilPress",    name:"Oil press",             cost:{scrap:7, parts:3},  work:14, gate:{crop:"sunflower"}, blurb:"A hand crank and a screw. Turns seed into oil, if someone's willing to stand there and turn it."},
  {id:"compost",     name:"Compost bins",          cost:{scrap:3},           work:8,  blurb:"What spoils and what's trimmed away doesn't have to just be gone. Turned rot closes the loop back into the beds — tired soil recovers faster."},
  {id:"woodStove", name:"Masonry Heater", cost:{scrap:10, parts:4}, work:16, blurb:"A heavy stone hearth in the Commons. Burns wood slowly and holds the heat for hours. Crucial for winter survival."},
  {id:"earthBerming", name:"Earth-bermed Walls", cost:{scrap:15}, work:25, blurb:"Packing earth and tires against the north walls of the Commons and sickbed. Passive solarpunk insulation. permanently softens extreme heat and cold."}

];

const WEATHERS = [
  {id:"clear",    p:0.5, solar:1.0, wind:1.0, rain:0,  word:"clear"},
  {id:"overcast", p:0.3, solar:0.6, wind:1.3, rain:2,  word:"overcast"},
  {id:"rain",     p:0.2, solar:0.4, wind:1.3, rain:8,  word:"rain"}
];

/* ================= founding ================= */
/* Circle 3-5 visuals before day one. Each grants one small thing —
   a journal voice, a rename, a bias, a head start. Effects are
   deliberately not shown to the player: circling is a ritual, not a shop. */
/* VISUALS — the founding-choice options (circle 3-5 at game start). Each `fx` key is
   an arbitrary effect name that applyFounding() reads and copies onto S.f (so F.tower,
   F.carry etc below are really S.f.tower, S.f.carry — "F" is just the day's alias for
   S.f, set near the top of simulateDay). To find what an fx key actually DOES, grep for
   "F.<key>" or "fa.<key>" or "fo.<key>" through the file — effects are scattered to
   wherever they're physically relevant (siteYield affects expedition salvage math,
   spirits affects the daily aura calc, floodRisk affects the storm-crisis roll, etc).
   There is no central effects-dispatcher by design — each effect lives next to the
   system it changes. journal:"<key>" links to a flavor-line pool in FV (see the
   journal-writing section near the end of simulateDay) for ambient text only; it does
   not itself change any number. */
const VISUALS = [
  {id:"tower",     label:"a water tower everyone can see from home",
   fx:{drawReduce:2, safeReturn:true, strangerRate:1.7, journal:"tower"}},
  {id:"bittersweet",label:"bittersweet swallowing the power lines",
   fx:{carry:2, siteYield:{substation:0.6, solarfarm:0.6}, journal:"vines"}},
  {id:"rail",      label:"the rail line, walked but never ridden",
   fx:{farSafe:0.45, scrapTrickle:0.3, journal:"rail"}},
  {id:"bikes",     label:"bicycles, endlessly repaired",
   fx:{fastLong:true, carry:3, partsUpkeep:0.14, journal:"bikes"}},
  {id:"paths",     label:"paths worn by feet, not plows",
   fx:{spirits:0.1, bikeDull:true, journal:"paths"}},
  {id:"river",     label:"a river that took back its floodplain",
   fx:{wetter:true, waterStart:15, floodRisk:0.035, journal:"river"}},
  {id:"library",   label:"the library, kept dry at all costs",
   fx:{projectFaster:true, upkeepScrap:0.16, journal:"library"}},
  {id:"greenhouse",label:"greenhouses patched with car glass",
   fx:{coldStart:true, stormBreak:true, journal:"greenhouse"}},
  {id:"reservoir", label:"the reservoir low, showing old foundations",
   fx:{scrapStart:10, drier:true, journal:"reservoir"}},
  {id:"turbinehum",label:"a turbine you can hear at night",
   fx:{sysStart:["turbine",25], spirits:-0.15, journal:"turbinehum"}},
  {id:"solarfound",label:"a rack of panels someone kept the leaves off of",
   fx:{solarStart:true, journal:"solarfound"}},
  {id:"bees",      label:"bee boxes on the courthouse steps",
   fx:{gardenBonus:1.15, journal:"bees"}},
  {id:"deer",      label:"deer in the school gymnasium",
   fx:{spirits:0.1, nibble:0.4, journal:"deer"}},
  {id:"goats",     label:"goats in the cemetery",
   fx:{foodTrickle:0.6, nibble:0.3, journal:"goats"}},
  {id:"bridge",    label:"a bridge out, and the long way around",
   fx:{spirits:-0.1, tripLong:true, strangerRate:0.55, journal:"bridge"}},
  {id:"mall",      label:"the flooded mall",
   fx:{siteRename:["oldtown","The Flooded Mall"], siteBonus:["oldtown",{scrap:10,parts:3}], journal:"mall"}},
  {id:"chapel",    label:"a chapel reroofed as a seed store",
   fx:{seedsStart:6, cropUnlock:3, journal:"chapel"}},
  {id:"mushroom",  label:"mushroom logs in the shade of the ruin",
   fx:{foodTrickle:0.5, journal:"mush"}},
  {id:"orchard",   label:"orchards planted in parking lots",
   fx:{forestStart:3, orchardApples:2, journal:"orchard"}},
  {id:"scar",      label:"a burn scar coming back in fireweed",
   fx:{seedsStart:8, journal:"fireweed"}},
  {id:"barrels",   label:"rain barrels under every gutter",
   fx:{sysStart:["catchment",18], journal:"barrels"}},
  {id:"stars",     label:"night skies with all the stars back",
   fx:{spirits:0.25, journal:"stars"}},
  {id:"meadow",    label:"a highway gone to meadow",
   fx:{spirits:0.15, journal:"meadow"}},
  {id:"laundry",   label:"laundry strung between dead streetlights",
   fx:{spirits:0.2, journal:"laundry"}},
  {id:"antenna",   label:"an antenna kept for a radio no one's heard in years",
   fx:{spirits:0.1, spiritsGrey:-0.15, journal:"antenna"}},
  {id:"graffiti",  label:"graffiti gone soft with moss",
   fx:{spirits:-0.1, journal:"graffiti"}}
];


export { BATTERY_UNIT, DAY_MS, FOREST_PLOT_COST, INJURY_PER_DAY, MAX_BATTERIES, MAX_FOREST_PLOTS, MAX_SOLAR, NEWCOMERS, OFFLINE_CAP, PROJECTS, RESTORE_GATE, RESTORE_HIGH, RESTORE_IN, RESTORE_LOW, ROSTER, SITE_DEF, SITE_LOOT_TABLE, SKILL_INFO, SOLAR_UNIT, STACKABLE, SYS, TRAITS, TURBINE_UNIT, VISUALS, WEATHERS, addRes, addRestore, built, decayOf, foodCap, gardenSlots, isVisible, rollStranger, stepRestoration, waterCapEff };
