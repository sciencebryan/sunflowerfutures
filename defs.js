import { clamp, pick } from "./helpers.js";
import { STRANGER_NAMES, STRANGER_NOTES } from "./data-events.js";
import { S } from "./state.js";
import { CROPS, RESTORE_GATE, RESTORE_HIGH, RESTORE_LOW, RES_CAP } from "./data-economy.js";











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
  {id:"ora",    name:"Ora",     pn:"she/they", trait:"Green-thumb", hands:1, green:4, care:2, wild:1, note:"Talks to the plants. Swears they answer."},
  {id:"bec",    name:"Bec",     pn:"they/them",trait:"Restless",    hands:2, green:1, care:1, wild:4, note:"Maps the ridgeline in their head at night."},
  {id:"sam",    name:"Sam",     pn:"he/him",   trait:"Steady",      hands:2, green:1, care:1, wild:2, note:"Has never once complained about the rain."},
  {id:"yusuf",  name:"Yusuf",   pn:"he/him",   trait:"Cautious",    hands:3, green:1, care:1, wild:2, note:"Checks every ladder twice."},
  {id:"petra",  name:"Petra",   pn:"she/her",  trait:"Mender",      hands:1, green:1, care:4, wild:1, note:"Remembers how everyone takes their tea."},
  {id:"ilya",   name:"Ilya",    pn:"he/they",  trait:"Tinkerer",    hands:3, green:1, care:1, wild:2, note:"Hums to engines and motors until they start."},
  {id:"june",   name:"June",    pn:"she/her",  trait:"Weathered",   hands:2, green:3, care:3, wild:1, note:"Planted the first bed the spring after."},
  {id:"marisol",name:"Marisol", pn:"she/her",  trait:"Green-thumb", hands:1, green:3, care:2, wild:1, note:"Braids seed packets into her hair."},
  {id:"theo",   name:"Theo",    pn:"he/him",   trait:"Restless",    hands:1, green:1, care:1, wild:3, note:"The fastest up the water tower."},
  {id:"ash",    name:"Ash",     pn:"they/them",trait:"Steady",      hands:2, green:2, care:1, wild:2, note:"Speaks rarely; finishes everything."},
  {id:"kav",    name:"Kav",     pn:"xe/xem",   trait:"Cautious",    hands:1, green:2, care:2, wild:1, note:"Keeps a weather log. Likes to sketch the clouds."}
];

const NEWCOMERS = [
  {id:"rosa",  name:"Rosa",  pn:"she/her",  trait:"Steady",      hands:1, green:2, care:3, wild:1, note:"Arrived with a sourdough starter older than she is."},
  {id:"emrys", name:"Emrys", pn:"he/him",   trait:"Tinkerer",    hands:3, green:1, care:1, wild:1, note:"Carries a multimeter like a holy relic."},
  {id:"din",   name:"Din",   pn:"they/them",trait:"Restless",    hands:1, green:1, care:1, wild:3, note:"Doesn't say where they walked from."},
  {id:"halla", name:"Halla", pn:"she/her",  trait:"Green-thumb", hands:1, green:3, care:2, wild:1, note:"Knows mushrooms. Most of them, anyway."},
  {id:"moss",  name:"Moss",  pn:"they/them",trait:"Weathered",   hands:2, green:2, care:1, wild:1, note:"Old enough to remember what life was like before. Doesn't like to talk about it."},
  {id:"yara",  name:"Yara",  pn:"she/her",  trait:"Cautious",    hands:2, green:1, care:2, wild:2, note:"Measured, deliberate, and always kind."}
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
  if(up(was.M,r.mycosphere)) lines.push("The soil has turned a corner. Dig anywhere and it's dark, and it smells alive.");
  if(up(was.A,r.aquifer))    lines.push("The water table has come back up. The low ground stays damp through the dry weeks.");
  if(up(was.P,r.pollinator)) lines.push("The valley hums. Bee balm flowers dip under the weight of visiting pollinators.");
  if(down(was.M,r.mycosphere)) lines.push("The bare ground is washing away. Without more rooted in it, the soil won't stay.");
  if(down(was.P,r.pollinator)) lines.push("There's little to attract pollinators if the soil and water beneath don't sustain life.");

  // the gate: all three restored
  if(!r.restored && r.mycosphere>=RESTORE_GATE && r.aquifer>=RESTORE_GATE && r.pollinator>=RESTORE_GATE){
    r.restored = true;
    lines.push("Someone stood on the ridge at dusk and couldn't tell, for a moment, where the village ended and the woods began.");
  }
}

const BASE_GARDEN_SLOTS = 1;
const gardenSlots=()=>(S.beds?S.beds.length:1);
const foodCap=()=>S.flags.rootCellar?120:90;   // fresh-food storage ceiling; the root cellar project raises it
const waterCapEff=()=>(S.waterCap||80)+(S.flags.cutCistern?12:0);
const built=id=>!!(S.sys[id] && S.sys[id].built);

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
  {id:"tower",     label:"a rusting water tower that can be seen for miles",
   fx:{drawReduce:2, safeReturn:true, strangerRate:1.7, journal:"tower"}},
  {id:"bittersweet",label:"bittersweet vines swallowing old power lines",
   fx:{carry:2, siteYield:{substation:0.6, solarfarm:0.6}, journal:"vines"}},
  {id:"rail",      label:"train tracks that haven't seen a train in years",
   fx:{farSafe:0.45, scrapTrickle:0.3, journal:"rail"}},
  {id:"bikes",     label:"bicycles, endlessly repaired",
   fx:{fastLong:true, carry:3, partsUpkeep:0.14, journal:"bikes"}},
  {id:"paths",     label:"paths worn by feet, not plows", //weak
   fx:{spirits:0.1, bikeDull:true, journal:"paths"}},
  {id:"river",     label:"a river, wide and swift",
   fx:{wetter:true, waterStart:15, floodRisk:0.035, journal:"river"}},
  {id:"library",   label:"a library, kept dry at all costs",
   fx:{projectFaster:true, upkeepScrap:0.16, journal:"library"}},
  {id:"greenhouse",label:"greenhouses patched with car glass",
   fx:{coldStart:true, stormBreak:true, journal:"greenhouse"}},
  {id:"reservoir", label:"the reservoir low, showing old foundations", //weak
   fx:{scrapStart:10, drier:true, journal:"reservoir"}},
  {id:"turbinehum",label:"a turbine you can hear at night",
   fx:{sysStart:["turbine",25], spirits:-0.15, journal:"turbinehum"}},
  {id:"solarfound",label:"a rack of solar panels, cracked but functional",
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
  {id:"chapel",    label:"a chapel repurposed as a seed store",
   fx:{seedsStart:6, cropUnlock:3, journal:"chapel"}},
  {id:"mushroom",  label:"mushroom logs in the shade",
   fx:{foodTrickle:0.5, journal:"mush"}},
  {id:"orchard",   label:"a long-abandoned apple orchard",
   fx:{forestStart:3, orchardApples:2, journal:"orchard"}},
  {id:"scar",      label:"a burn scar coming back in fireweed",
   fx:{seedsStart:8, journal:"fireweed"}},
  {id:"barrels",   label:"rain barrels under every gutter",
   fx:{sysStart:["catchment",18], journal:"barrels"}},
  {id:"stars",     label:"night skies with all the stars back", //weak
   fx:{spirits:0.25, journal:"stars"}},
  {id:"meadow",    label:"a highway gone to meadow",
   fx:{spirits:0.15, journal:"meadow"}},
  {id:"laundry",   label:"laundry strung between dead streetlights",
   fx:{spirits:0.2, journal:"laundry"}},
  {id:"antenna",   label:"a crossed-shaped radio antenna on a swaying metal mast",
   fx:{spirits:0.1, spiritsGrey:-0.15, journal:"antenna"}},
  {id:"graffiti",  label:"graffiti gone soft with moss",
   fx:{spirits:-0.1, journal:"graffiti"}}
];










export { NEWCOMERS, ROSTER, SKILL_INFO, TRAITS, VISUALS, addRes, addRestore, built, decayOf, foodCap, gardenSlots, isVisible, rollStranger, stepRestoration, waterCapEff };
