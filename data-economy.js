/* data-economy.js — constants, rates, and village rules.
   SITE_DEF, PROJECTS, SYS, crops, fabrication, practice rates, and every
   tuning dial. Pure data: nothing in this file may reference game state
   or engine functions. */

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

const OFFLINE_CAP = 7;

const INJURY_PER_DAY = 0.03;

/* ---- seed-rich salvage sites ----
   A normal salvage trip gets ONE roll at turning up a crop the village has
   never grown. These two places are, in the fiction, nothing but seed — a
   vault of it and a building full of filing cabinets of varieties — and
   were rolling at exactly the same odds as an electronics depot, which is
   why a full year could pass with crops still undiscovered.

   The roll COUNT scales with how much is left to find:
     rolls = clamp(lockedCrops().length, 1, MAX_SEED_ROLLS)
   Lots undiscovered -> the full five. As the pool drains, so does the
   count, one for one, down to a single roll for whatever's left. No
   separate total-crop constant and no tuning curve needed: the pool
   shrinks inside the loop as each roll lands, so a roll can never be
   spent on a crop already found.
   Per-roll odds are unchanged (see DISCOVER_P in expeditions.js) — five
   rolls at 16% is ~58% of finding something, which is a real difference
   from 16% without being a guarantee. */
const SEED_RICH_SITES = ["seedvault", "extension"];
const MAX_SEED_ROLLS = 5;

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

// wiring in another bank needs an actual salvaged pack now — see S.cells and
// bankCapacity() in day.js. Cells come home from the substation, the hospital
// backup room, the dry marina and the ridgeline houses.
const BATTERY_BANK_COST = {scrap:4, parts:3, cells:1};

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

const SYS = [
  // decay rebalanced downward after the starting-stat nerf below (everyone -1 star,
  // so a new village's raw repair output is ~30% lower than it was) — see TUNING GUIDE
  {id:"turbine",   name:"Wind turbine",    decay:3.6, draw:0, start:true,  blurb:"The blades were old when it was found, but the turbine still turns."},
  {id:"solar",     name:"Solar array",     decay:2.0, draw:0, start:false, cost:{scrap:5,parts:3},  work:11, blurb:"Panels on the depot roofs. Quiet, and only works in daylight.", gate:{discover:true}},
  // decay 0: a battery bank is NOT maintained. Capacity loss here is chemistry,
  // not wear, and no amount of hands-on work reverses it — see S.cells and
  // bankCapacity() in day.js. The `cond` field survives only so the storm and
  // render code that reads every SYS uniformly keeps working; it stays at 100.
  {id:"battery",   name:"Battery bank",    decay:0,   draw:0, start:true,  noRepair:true, blurb:"Salvaged cells wired into one bank. They hold what they hold, and a little less each year."},
  {id:"catchment", name:"Water catchment", decay:2.4, draw:2, start:true,  blurb:"Rain gutters, storage tanks, and pumps."},
  {id:"aquaponics",name:"Aquaponics",      decay:2.4, draw:3, start:false, cost:{scrap:12,parts:6}, work:22, blurb:"Fish feed plants feed fish. Wants a machinist and a keeper of living things. Uses power.", gate:{sys:"irrigation"}},
  {id:"irrigation",name:"Irrigation lines",decay:2.4, draw:0, start:false, cost:{scrap:9},          work:14, blurb:"Drip lines that stretch every liter."},
  {id:"commons",   name:"The commons",     decay:2.0, draw:1, start:true,  blurb:"A roof, a long table, a stove. Wants a keeper for the roof and a cook for the rest."}
];

// The depot only holds so much: scrap and parts stop accumulating past a cap
// generous enough to save for the biggest single project several times over
// (largest costs in the game are 20 scrap / 12 parts), but bounded so a long
// game doesn't drift into the hundreds with nothing to spend it on. Food,
// water, and seeds aren't capped here — they're already bounded by spoilage,
// tank size, and regular sowing respectively.
const RES_CAP = {scrap:120, parts:60, wood:150, cells: 40};

const SITE_DEF = [
  {id:"oldtown",  name:"Old Town Row",          days:2, known:true,  stock:{scrap:40, parts:8, cans:14},   blurb:"Collapsed storefronts containing a mix of scrap, parts, and some canned food."},
  {id:"kessler",  name:"Kessler Depot",         days:3, known:true,  stock:{parts:30, scrap:10},           blurb:"An electronics depot, already looted before we found it."},
  {id:"pharmacy", name:"Greenbriar Pharmacy",   days:2, known:true,  stock:{meds:20, scrap:6},             blurb:"Shelves behind a grate somebody gave up on."},
  {id:"seedvault",name:"County Seed Vault",     days:4, known:false, stock:{seeds:30, meds:4},             blurb:"A basement archive. Cool and dry."},
  {id:"substation",name:"Riverside Substation", days:5, known:false, stock:{parts:26, scrap:14, cells:3}, blurb:"Transformers like sleeping animals. The buffer room at the back was never opened."},
  {id:"extension",name:"Agricultural Extension",days:5, known:false, stock:{seeds:22, scrap:12, parts:6},  blurb:"Test plots gone feral. Filing cabinets full of seed varieties."},
  {id:"hospital", name:"Valley Hospital",       days:6, known:false, stock:{meds:30, parts:8, cells:2},   blurb:"Long halls and mysterious stains. Nobody looting drugs thought to check the backup power room."},
  {id:"solarfarm",name:"Solar Farm Ruins",      days:7, known:false, stock:{parts:34, scrap:20},           blurb:"A field of cracked panels that once moved to track the Sun."},
  {id:"reservoir",name:"The Reservoir Works",   days:8, known:false, stock:{scrap:30, parts:16, meds:6},   blurb:"The far edge of anyone's map."},
  // Two more places worth the walk, both chosen because they hold the kind of
  // battery nobody stripped early: bolted in, awkward, and not worth much to
  // anyone who didn't have a grid of their own to run.
  {id:"marina",   name:"The Dry Marina",        days:4, known:false, stock:{cells:4, scrap:12, parts:6},   blurb:"Boats up on blocks in a lot gone to birch. Deep-cycle banks in half of them, too heavy to have been worth stealing."},
  {id:"solarrow", name:"Ridgeline Houses",      days:6, known:false, stock:{cells:5, parts:10, scrap:8},   blurb:"Big houses along the ridge, panels still on the roofs and the wall units still wired to them."}
]
/* Sorted by distance at definition, so every consumer agrees on "nearest
   first" without each one remembering to sort: the Beyond tab's listing,
   the "Farther out" card, the party sheet, and — importantly — the
   SITE_DEF.find() in expeditions.js that decides which place a ranging
   party actually turns up. Authored order used to put the Dry Marina (4d)
   after the Reservoir Works (8d), so the queue read wrong AND the marina's
   deep-cycle cells arrived last instead of fourth. Everything else in the
   codebase keys off site id, never index, so this is safe to reorder. */
.sort((a,b)=>a.days-b.days);

const SITE_LOOT_TABLE = {
  "oldtown":    { scrap: 0.6, parts: 0.4 },
  "kessler":    { parts: 0.8, scrap: 0.2 },
  "pharmacy":   { meds: 1.0 },
  "seedvault":  { seeds: 0.8, meds: 0.2 },
  "substation": { parts: 0.7, cells: 0.3 },
  "extension":  { seeds: 0.6, parts: 0.4 },
  "hospital":   { meds: 0.7, parts: 0.15, cells: 0.15 },
  "marina":     { cells: 0.5, scrap: 0.35, parts: 0.15 },
  "solarrow":   { cells: 0.55, parts: 0.3, scrap: 0.15 },
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
  {id:"seedSaving",  name:"Seed saving",           cost:{scrap:3},           work:16, blurb:"Screens, envelopes, and a steady eye for the best plants. Every harvest returns half again the seed."},
  {id:"toolLibrary", name:"Tool library",          cost:{scrap:12},          work:18, blurb:"Sorted, sharpened, and where you left it. All repairs work 20% better."},
  {id:"rootCellar",  name:"Root cellar",           cost:{scrap:8},           work:14, blurb:"Cool, dark, and relatively rat-proof. Holds far more food, and food spoils far slower."},
  {id:"dryRacks",    name:"Drying racks",          cost:{scrap:4},           work:10, blurb:"Sun, air, patience. Fresh food becomes dried for storage — losing a fifth on the way."},
  {id:"crocks",      name:"Fermenting crocks",     cost:{scrap:6},           work:12, blurb:"Salt, time, and the right microbial community. Pretty good for preserving food, even if not everyone loves the smell."},
  {id:"canning",     name:"Canning kitchen",       cost:{scrap:6, parts:5},  work:18, blurb:"Jars, lids, and heat. The fastest way to preserve food, but it requires power.", gate:{flag:"dryRacks"}},
  {id:"gardenBeds",  name:"New beds",              cost:{scrap:6},           work:14, blurb:"More ground turned, more trellis raised. Another pair of hands can work the gardens."},
  {id:"batteryRecond",name:"Battery reconditioning",cost:{parts:6},          work:14, gate:{sys:"battery"}, blurb:"New cells in old shells. The power bank's capacity is nearly doubled."},
  {id:"panelWash",   name:"Panel wash rig",        cost:{scrap:5},           work:10, gate:{sys:"solar"}, blurb:"A squeegee on a long pole, mostly. Solar array wears slower."},
  {id:"bearings",    name:"Spare bearings",        cost:{parts:8},           work:14, gate:{sys:"turbine"}, blurb:"Machined to fit. The turbine wears much slower."},
  {id:"dripRetrofit",name:"Drip retrofit",         cost:{scrap:6, parts:4},  work:14, gate:{sys:"irrigation"}, blurb:"Every joint resealed. Irrigation wears slower, gardens drink less."},
  {id:"graywater",   name:"Graywater loop",        cost:{scrap:7, parts:3},  work:16, gate:{sys:"irrigation"}, blurb:"Wash water and rinse water, filtered through sand and reed, sent back to the beds. The gardens take far less from the cisterns."},
  {id:"coldFrames",  name:"Cold frames",           cost:{scrap:8},           work:16, gate:{sys:"irrigation"}, blurb:"Miniature greenhouses to keep the garden growing straight through winter frost, and you can sow out of season."},
  /* The most expensive thing in this table, and it should be: fifty feet of
     welded frame, a poured sill, and every windshield left in the valley cut
     down and puttied into it. Gated on irrigation because nothing under glass
     is ever rained on — a greenhouse with no pipe to it is three beds of dust. */
  {id:"greenhouse",  name:"The greenhouse",        cost:{scrap:26, parts:10}, work:52, gate:{flag:"coldFrames"},
   blurb:"Fifty feet by twenty, framed in salvaged steel and glazed in car glass. Three beds that keep their own weather — a month of growing either side of the outdoor year. It gains hard by day and loses all of it by night, so what it buys is a longer season, not a warm room."},
  {id:"herbalStores",name:"Herbal stores",         cost:{meds:6},            work:12, gate:{discover:true}, blurb:"Dried, labeled, jarred. Illness is briefer and less frequent."},
  {id:"oilPress",    name:"Oil press",             cost:{scrap:7, parts:3},  work:14, gate:{crop:"sunflower"}, blurb:"A hand crank and a screw. Turns seed into oil, if someone's willing to stand there and turn it."},
  {id:"compost",     name:"Compost bins",          cost:{scrap:3},           work:8,  blurb:"Rotten food and vegetable scraps are composted. Discarded food contributes to soil fertility."},
  {id:"woodStove", name:"Masonry Heater", cost:{scrap:10, parts:4}, work:16, blurb:"A heavy stone hearth in the Commons. Burns wood slowly and holds the heat for hours. Crucial for winter survival."},
  {id:"earthBerming", name:"Earth-bermed Walls", cost:{scrap:15}, work:25, blurb:"Packing earth and tires against the north walls of the Commons and sickbed. Passive solarpunk insulation, good for keeping temperatures stable in both winter and summer."},
  /* --- heat and cold ---
     One heating upgrade and three ways to cool a building, deliberately
     spread across the cost axes rather than being strictly ranked:
     the cooling unit is cheap to raise and expensive forever; the passive
     options are expensive once and free thereafter, and cannot fail. */
  {id:"rocketHeater", name:"Rocket mass heater", cost:{scrap:12, parts:3}, work:22, gate:{flag:"woodStove"},
   blurb:"A J-tube burn chamber and a long cob bench for the exhaust to give up its heat into. Same warmth off half the wood."},
  {id:"acUnit",      name:"Salvaged cooling unit", cost:{scrap:6, parts:8}, work:12, gate:{sys:"solar"},
   blurb:"Compressor, coil, and a great deal of wire. It will cool the Commons properly — on the days the grid can carry it."},
  {id:"earthTubes",  name:"Earth tubes", cost:{scrap:14}, work:34,
   blurb:"A long run of salvaged pipe buried deep enough that the ground stays cool, and a duct drawing the house's air through it. Mostly digging. Nothing in it can break."},
  {id:"well",        name:"Drilled well & pump", cost:{scrap:10, parts:9}, work:26, gate:{sys:"solar"},
   blurb:"Down past the topsoil, past the clay, into the water that was already there. Reliable in a way rain is not — and it brings up whatever else is down there with it."},
  {id:"windcatcher", name:"Windcatcher", cost:{scrap:9}, work:30,
   blurb:"A tower on the roof, open to the prevailing wind, pulling the hot air up and out. Older than any of us, and it has no moving parts at all."}

];

const WEATHERS = [
  {id:"clear",    p:0.5, solar:1.0, wind:1.0, rain:0,  word:"clear"},
  {id:"overcast", p:0.3, solar:0.6, wind:1.3, rain:2,  word:"overcast"},
  {id:"rain",     p:0.2, solar:0.4, wind:1.3, rain:8,  word:"rain"}
];

/* ================= seasons =================
   A year is 4 seasons of 30 days. Winter is the one you plan for. */
const SEASON_LEN = 30;

/* Crops: sow, wait, harvest. `work` is growth-points needed; a tended bed
   accrues roughly 1.5–3/day, so a radish is a week and a squash is a month. */
/* CROPS — what can be sown in a bed. Fields:
     name    display name
     work    growth-points needed before ready (roughly: work/2.2 = days at full staffing)
     yield   food produced on harvest (scaled by F.contourBeds, reduced by fo.nibble)
     seed    seed cost to sow one bed
     seeds   seed RETURNED on harvest (0 = doesn't replenish itself; balance carefully —
              a crop that returns no seed and is the only thing sown starves the seed
              stock over time, which was a real bug once)
     sow     array of season ids ["spring","summer","autumn"] it can be planted in
     hardy   (optional) true = survives winter outdoors, sleeping under snow, instead
              of dying at first frost. The ONLY way a crop grows through deep winter
              without cold frames.
     locked  (optional) true = hidden from the sow sheet until S.crops[id] is set true
              (currently done via seed-frame puzzle rewards — see SEED_REWARD)
     note    flavor text on the sow sheet. */
/* feed: what a crop does to the bed's soil on harvest — see the "fertility" block
   in the growth loop. "legume" restores fertility (beans, peas fix nitrogen);
   "heavy" draws it down hard (the big calorie crops); unmarked/"light" draws a
   little, same as anything growing takes a little. A bed's fertility multiplies
   its growth rate — see bed.fertility and fertilityMult in simulateDay. */
const CROPS = {
  // radish and greens are the only crops available with zero discovery; beans,
  // squash, and potatoes are locked but evidently get discovered fast enough (via
  // seed-frame puzzles / other unlock triggers) to still carry most of year 1.
  // Playtest report: by end of autumn yr1 (day 90), 6 founders were sitting on 50
  // banked days of food and near-max spirits — too much slack for what's meant to
  // be the scrappy, tight phase. Cut yield ~20% on these five specifically, since
  // together they're what an early village is actually eating; locked/later crops
  // beyond these are untouched, since that's not where the reported problem is and
  // the headless-bot balance for the later game shouldn't be disturbed on a guess.
  // If this over-corrects, these are the first numbers to walk back — check
  // against a fresh save at day 90 before tightening further.
  //
  // TIMING & WINDOWS (the 1/3-scale pass): the game year is 120 days against
  // a real 365, so every annual's minDays is now its real days-to-first-
  // harvest divided by ~3 — a radish is a sprint again, squash is a season.
  // `window` is the picking span in days: once ready, a bed bears
  // yield/window per tended day for `window` days (see the picking loop in
  // day.js), then returns its `seeds` (typed, to seedStock). Yields were
  // rescaled alongside so food per day-of-bed-occupancy stays near the
  // playtested rate — shorter cycles alone would have re-inflated the food
  // budget the note above cut.
  radish:  {name:"Radishes", tMin:22, tOpt:62, tMax:82,  work:11, minDays:9,  window:3,  yield:12, seed:1, seeds:1, sow:["spring","summer","autumn"], feed:"light",  note:"Fast, thin, and better than nothing."},
  // "Greens" stays as the catch-all cut-and-come-again planting — the named
  // brassicas above are what you grow on purpose once you know them.
  greens:  {name:"Greens", tMin:22, tOpt:62, tMax:82,    work:14, minDays:10,  window:10, yield:24, seed:1, seeds:1, sow:["spring","summer","autumn"], feed:"light",  note:"Whatever leaf comes up fastest. Cut and come again, until it bolts."},
  beans:   {name:"Beans", edibleSeed:true, tMin:33, tOpt:75, tMax:92,     work:26, minDays:18,  window:7,  yield:38, seed:2, seeds:3, sow:["spring","summer"],          feed:"legume", locked:true, note:"Feeds you, then feeds the soil, then feeds you again."},
  // The old single "squash" was internally contradictory — it kept like a
  // winter squash (barely decays) but matured and picked like a summer one.
  // Split, they're two genuinely different crops: one you eat all season and
  // can't store, one you harvest once and live on until spring.
  summersquash:{name:"Summer squash", tMin:33, tOpt:78, tMax:95, work:24, minDays:18, window:12, yield:40, seed:2, seeds:2, sow:["spring","summer"], feed:"heavy", locked:true, note:"Gives and gives until you're sick of it, and keeps about a week."},
  wintersquash:{name:"Winter squash", seedFood:"pepita", tMin:33, tOpt:76, tMax:93, work:40, minDays:32, window:3,  yield:48, seed:2, seeds:2, sow:["spring","summer"], feed:"heavy", locked:true, note:"Slow, heavy, and it keeps all winter in a cold room."},
  cucumber:{name:"Cucumbers", tMin:35, tOpt:78, tMax:92, work:22, minDays:17, window:10, yield:34, seed:1, seeds:2, sow:["spring","summer"],        feed:"heavy", locked:true, note:"Half water and no use to anyone in February — unless it went into the crocks first."},
  tomato:  {name:"Tomatoes", tMin:34, tOpt:77, tMax:92,  work:30, minDays:24, window:14, yield:52, seed:1, seeds:2, sow:["spring","summer"],        feed:"heavy", locked:true, note:"Wants heat and hates its own relatives. Keeps not at all, dries beautifully."},
  spinach: {name:"Spinach", tMin:15, tOpt:60, tMax:78,   work:12, minDays:9,  window:6,  yield:20, seed:1, seeds:1, sow:["spring","autumn"],        feed:"light", locked:true, note:"Bolts the moment it feels summer. Grow it at the cold ends of the year."},
  tatsoi:  {name:"Tatsoi", tMin:14, tOpt:58, tMax:78,    work:12, minDays:8,  window:6,  yield:18, seed:1, seeds:1, sow:["spring","autumn"],  feed:"light", locked:true, note:"Flat rosettes that shrug off a frost and sweeten after one."},
  kale:    {name:"Kale", tMin:10, tOpt:60, tMax:80,      work:16, minDays:17, window:20, yield:34, seed:1, seeds:1, sow:["spring","summer","autumn"],  feed:"light", locked:true, note:"Cut it all season, and it's better after the first hard frost than before."},
  cabbage: {name:"Cabbage", tMin:20, tOpt:62, tMax:80,   work:26, minDays:24, window:2,  yield:36, seed:1, seeds:1, sow:["spring","autumn"],        feed:"heavy", locked:true, note:"One head, all at once, and a cellar or a crock will hold it for months."},
  potatoes:{name:"Potatoes", edibleSeed:true, tMin:30, tOpt:68, tMax:85,  work:36, minDays:33,  window:2,  yield:46, seed:3, seeds:3, sow:["spring"],                   feed:"heavy", locked:true, note:"Dull, heavy, and the reason anyone survived anything. Keep back the small ones to plant."},
  grain:   {name:"Grain", edibleSeed:true, tMin:5, tOpt:65, tMax:88,     work:48, minDays:40,  window:2,  yield:68, seed:3, seeds:4, sow:["spring","autumn"],  feed:"heavy", locked:true, note:"The one crop frost won't kill: plant it in autumn and it sleeps under the snow, ready in spring. Slow, but it feeds a winter."},
  peas:    {name:"Peas", edibleSeed:true, tMin:24, tOpt:62, tMax:80,      work:30, minDays:21,  window:5,  yield:48, seed:2, seeds:3, sow:["spring","summer"],
            sowWindow:{spring:[1,12], summer:[22,30]}, feed:"legume", locked:true,
            note:"Wants the cold shoulders of the year, not the middle of it. Early spring, or the very end of summer as it breaks toward autumn — never the heat between."},
  // discovered through the seed-frame puzzles; locked until then
  turnip:  {name:"Turnips", tMin:18, tOpt:62, tMax:80,   work:20, minDays:18,  window:4,  yield:30, seed:1, seeds:1, sow:["spring","summer","autumn"],  locked:true, feed:"light", note:"Homely and dependable. Shrugs off an early frost and keeps in the cellar."},
  sunflower:{name:"Sunflowers", edibleSeed:true, tMin:32, tOpt:76, tMax:95,work:34, minDays:33, window:2,  yield:36, seed:2, seeds:4, sow:["spring","summer"],          locked:true, feed:"heavy", note:"Oil for the lamps, seed for the birds, and a wall of gold that lifts the whole village."},
  amaranth:{name:"Amaranth", edibleSeed:true, tMin:34, tOpt:80, tMax:100,  work:32, minDays:30,  window:4,  yield:45, seed:2, seeds:3, sow:["spring","summer","autumn"], locked:true, feed:"light", note:"Grain and greens both, and it grows where little else will. An old, stubborn plant."},
  // perennials: planted once, never resown. They take years to earn their keep,
  // then keep giving with almost no labor — see the perennial handling in the
  // growth loop. Each bears in exactly one season; the rest of the year they
  // simply stand, dormant through winter regardless of hardy status.
  // `native:true` perennials build the soil web (mycosphere) when planted — they
  // yield food AND restore, so they're a real choice, not a sacrifice. Apple stays
  // unflagged (Eurasian orchard stock, the thing you'd eventually turn under), and so
  // does this strawberry — it's modeled as the cultivated garden strawberry (dense
  // yield, matures in a year), not Fragaria virginiana, whose wild fruit is tiny and
  // wouldn't remotely produce at this rate. Don't borrow native credibility for the
  // wrong plant. Raspberry also unflagged: the cultivated red cane is Eurasian.
  // Not food. A perennial with no harvestSeason, so the food-forest bearing
  // loop skips it entirely and only shadeCooling() in day.js reads it —
  // planted for a summer five years from now. See the Now/Later axis.
  catalpa:   {name:"Catalpa trees", tMin:-10, tOpt:72, tMax:98, perennial:true, shade:true, locked:true, matureYears:5,
              sow:["spring"], note:"Heart-shaped leaves the size of a hand, and a canopy that turns the south wall cool. Every year it gives a little more shade than the last; in five it will be doing real work."},
  strawberry:{name:"Strawberries", tMin:12, tOpt:68, tMax:85, perennial:true, bearYears:0.5, matureYears:1, harvestSeason:"summer",
              yield:80, seed:3, seeds:0, sow:["spring"], feed:"light", locked:true,
              note:"Runners fill a plot in a year. After that, pickings all summer for almost no work."},
  blueberry: {name:"Blueberries", tMin:5, tOpt:70, tMax:88, perennial:true, native:true, bearYears:2, matureYears:3, harvestSeason:"summer",
              yield:150, seed:4, seeds:0, sow:["spring"], feed:"light", locked:true,
              note:"Highbush blueberry, native to these woods. Three slow years, then a whole summer of it, and it feeds the soil it stands in."},
  raspberry: {name:"Raspberries", tMin:5, tOpt:70, tMax:88, perennial:true, bearYears:1, matureYears:2, harvestSeason:"summer",
              yield:125, seed:3, seeds:0, sow:["spring"], feed:"light", locked:true,
              note:"Cane fruit — raspberry, or blackberry, whichever cuttings took. Bears for weeks. Spreads if you let it."},
  apple:     {name:"Apple trees", tMin:-5, tOpt:68, tMax:90, food:"apples", perennial:true, bearYears:3, matureYears:4, harvestSeason:"autumn",
              yield:170, seed:5, seeds:0, sow:["spring"], feed:"light", locked:true,
              note:"Old grafted stock from the parking-lot rows. Four years to bear, then baskets of them every fall."},
  hazelnut:  {name:"Hazelnuts", tMin:-5, tOpt:68, tMax:90, perennial:true, native:true, bearYears:3, matureYears:5, harvestSeason:"autumn",
              yield:200, seed:5, seeds:0, sow:["spring"], feed:"light", locked:true,
              note:"American hazelnut, native stock. Five years to a real harvest, then a wall of nuts every autumn, and roots that hold the hillside."},
  // the rest of the native forest crops, researched rather than guessed —
  // maturity years drawn from real extension/nursery sources, yield tiers
  // reasoned by relative fruit size and prolificacy against what's already here.
  pawpaw:    {name:"Pawpaw", tMin:0, tOpt:75, tMax:92, perennial:true, native:true, bearYears:4, matureYears:6, harvestSeason:"autumn",
              yield:170, seed:6, seeds:0, sow:["spring"], feed:"light", locked:true,
              note:"Asimina triloba — the largest fruit native to this continent, custard-sweet, and it needs two trees near each other to set anything. Five or six years before the first ones fall."},
  persimmon: {name:"American persimmon", tMin:-5, tOpt:75, tMax:95, perennial:true, native:true, bearYears:5, matureYears:8, harvestSeason:"autumn",
              yield:160, seed:6, seeds:0, sow:["spring"], feed:"light", locked:true,
              note:"Diospyros virginiana, and usually a male tree and a female tree both, or nothing sets. Bitter unripe, honey-sweet after the first hard frost softens it. A slow tree — plant it for later."},
  mulberry:  {name:"Red mulberry", tMin:0, tOpt:75, tMax:95, perennial:true, native:true, bearYears:3, matureYears:5, harvestSeason:"summer",
              yield:130, seed:4, seeds:0, sow:["spring"], feed:"light", locked:true,
              note:"Morus rubra — not the white mulberry that escaped every hedge in the old world, the real native one. Five years, then it drops fruit for weeks like it's trying to give the whole thing away."},
  cranberrybush:{name:"Cranberrybush viburnum", tMin:-10, tOpt:68, tMax:88, perennial:true, native:true, bearYears:2, matureYears:4, harvestSeason:"autumn",
              yield:100, seed:4, seeds:0, sow:["spring"], feed:"light", locked:true,
              note:"Viburnum trilobum — tart, close cousin of the true cranberry only in name. Four years to bear, and it bears heavily; you'll want a lot of them to make the harvest worth the tartness."},
  chestnut:  {name:"American chestnut", tMin:-5, tOpt:72, tMax:92, perennial:true, native:true, bearYears:4, matureYears:5, harvestSeason:"autumn",
              yield:190, seed:6, seeds:0, sow:["spring"], feed:"light", locked:true,
              note:"Castanea dentata — sweeter and faster than people expect; it was bearing in five years before the blight took the species down to almost nothing. Plant it anyway. Some things are worth trying to bring back."},
  // a legacy planting: real oak and hickory don't mast until ~20 years old, peak
  // decades after that — genuinely outside any playthrough. It's here so the
  // choice to plant it can be made honestly: not a crop with a payoff, a gift
  // to whoever's still tending this ground when it's grown.
  oakhickory:{name:"Oak & hickory", tMin:-10, tOpt:72, tMax:95, perennial:true, native:true, bearYears:12, matureYears:20, harvestSeason:"autumn",
              yield:150, seed:8, seeds:0, sow:["spring"], feed:"light", locked:true,
              note:"White oak and shagbark hickory. These take decades to mature."}
};

/* Preservation: fresh food spoils; preserved food does not.
   Preserving costs a day of someone's hands and some of the food itself. */
/* PRESERVE — the three ways to turn fresh food into food-that-keeps. Each is unlocked
   by the matching PROJECTS entry (id must match the `flag` here — e.g. building the
   "dryRacks" project sets S.flags.dryRacks, which is what `flag` below checks for).
   Fields: name, flag (S.flags key that must be true to use this method), rate (base
   food/day one worker converts, before their care skill is added — see the
   "preservation" phase in simulateDay), loss (fraction lost to the process itself —
   this food never becomes preserved food, it's just gone). Two workers max; see the
   `preserve` entry in SHEET_META for the cap. */
const PRESERVE = {
  drying:     {name:"Drying racks",  flag:"dryRacks",  rate:2.8, loss:0.20, blurb:"Sun, air, patience. Loses a fifth to the process."},
  fermenting: {name:"Crocks",        flag:"crocks",    rate:2.4, loss:0.08, blurb:"Salt and time. Loses almost nothing, and it's good for people."},
  canning:    {name:"Canning",       flag:"canning",   rate:3.6, loss:0.12, blurb:"Jars, lids, heat. Fastest by far — when the power holds."}
};

/* Fabrication ends the salvage economy. Each ends one reason to leave. */
/* FABS — fabrication projects. Each is a one-time build (cost + work, like PROJECTS)
   that, once finished, produces FAB_RATE[gives] of resource `gives` EVERY DAY FOREVER
   (see the "fabrication" phase in simulateDay). This is the endgame pivot: fabs let
   the village stop depending on finite salvage sites. Fields: id, name, cost, work,
   gives (a key into S.res / FAB_RATE), blurb. */
/* Each shop, once built, produces FAB_RATE[gives] per day — but ONLY while
   someone works the fab job and the feedstock holds: `feed` is {res, per},
   the resource consumed per unit of output (see the fab phase in day.js).
   Nothing comes from nothing. Seed saving is no longer a fab — it moved to
   PROJECTS as a one-time bench that multiplies harvest seed return.
   EXCEPT `passive:true` shops, which need neither: they produce their rate
   every day from the moment they're built. Use it only where the fiction
   genuinely carries the work (a herb garden), not to dodge a labor cost. */
const FABS = [
  {id:"forge",      name:"The forge",     cost:{scrap:16, parts:4}, work:30, gives:"scrap",
   feed:{res:"wood", per:1.2},
   blurb:"Charcoal, bellows, an anvil off a truck axle. Wood in, worked scrap out."},
  {id:"machineShop",name:"Machine shop",  cost:{scrap:20, parts:12},work:40, gives:"parts",
   feed:{res:"scrap", per:2},
   blurb:"Tools and equipment to turn rough scrap into the parts we need to fix things."},
  // passive: a herb bed tends itself once it's in. No assignment, no feedstock —
  // the little medicinal garden behind it is assumed, not simulated.
  {id:"apothecary", name:"Apothecary",    cost:{wood:8, meds:4},    work:26, gives:"meds",
   passive:true,
   blurb:"A medicinal herb garden and a good book. Once it's in, it looks after itself."}
];

const FAB_RATE = {scrap:0.9, parts:0.5, meds:0.25};

const SEASONS = [
  {id:"spring", name:"Spring", wx:[0.38,0.28,0.34],
   solar:0.9,  heat:0,    grow:1.15, forage:0.9,  roadDays:1,
   note:"The forest is waking up."},
  {id:"summer", name:"Summer", wx:[0.62,0.24,0.14],
   solar:1.15, heat:1,    grow:1.0,  forage:1.15, roadDays:0,
   note:"Sunlight late into the evening, the water tanks always warm."},
  {id:"autumn", name:"Autumn", wx:[0.45,0.33,0.22],
   solar:0.85, heat:0,    grow:0.85, forage:1.35, roadDays:0,
   note:"The leaves turning red, orange, and yellow."},
  {id:"winter", name:"Winter", wx:[0.4,0.42,0.18],
   solar:0.5,  heat:0,    grow:0.0,  forage:0.25, roadDays:2,
   note:"Not much growing outside. We rely on what we've preserved."}
];

/* ================= practice: earned skill, not endless growth =================
   Two small, capped bonuses on top of a person's fixed hands/green/care/wild.
   SPECIFIC practice is tied to one exact job — turbine repair, cooking, foraging
   the near country — and caps at +0.7. BROAD practice is tied to the wider
   category that job belongs to (any hands-job, any green-job...) and caps at
   +0.3. They stack, so a lifelong specialist tops out +1.0 on that stat; someone
   who rotates jobs within a category without specializing tops out +0.3.
   Both grow on days the matching job is actually worked, and both decay — slowly
   — on days it isn't, so an unused skill fades but never resets to zero.
   None of this is inherited by children (see the birth code): each person earns
   their own. It also never shows in the dot display — the dots are a person's
   fixed nature; practice is silent texture read only by the day's math and by
   the one flavour line under their name (see practiceLine()).

   JOB_PRACTICE maps a static job id to {specific, broad}. Two jobs resolve
   dynamically instead (their specific target changes over time) and are
   handled in buildWorkSnapshot(): "project" (specific = the SYS being raised,
   or none for a one-off PROJECTS build) and "fab" (specific = the FABS id
   under construction). Expedition types (forage/explore/salvage) feed "wild"
   and are credited separately, from S.expeditions, since travelling people
   carry job:"away" rather than a job id. */
const PRACTICE_SPECIFIC_CAP = 0.9;

const PRACTICE_BROAD_CAP = 0.5;

const PRACTICE_SPECIFIC_GROWTH = 0.012;   // per day worked -> ~94% of cap by ~2 game-years

const PRACTICE_BROAD_GROWTH = 0.005;      // per day worked (any job in the category)

const PRACTICE_SPECIFIC_DECAY = 0.0023;   // per day NOT worked -> ~300-day half-life

const PRACTICE_BROAD_DECAY = 0.00115;     // per day NOT worked -> ~600-day half-life (slower: general handiness is stickier than one task)


const JOB_PRACTICE = {
  turbine:{specific:"turbine", broad:"hands"}, solar:{specific:"solar", broad:"hands"}, woodcut:{specific:"woodcut", broad:"wild"},
  battery:{specific:"battery", broad:"hands"}, catchment:{specific:"catchment", broad:"hands"},
  aquaponics:{specific:"aquaponics", broad:"hands"}, irrigation:{specific:"irrigation", broad:"hands"},
  commons:{specific:"commons", broad:"hands"},
  garden:{specific:"garden", broad:"green"}, aquatend:{specific:"aquatend", broad:"green"},
  cook:{specific:"cook", broad:"care"}, care:{specific:"care", broad:"care"}, preserve:{specific:"preserve", broad:"care"}, press:{specific:"press", broad:"hands"}
};


/* ============================================================
   ALLOCATION — power & water triage (the Power and Water tabs)
   Each demand can be set to a level in `levels` (fractions of full).
   0 = off, 0.5 = half/rationed, 1 = full. Engine effects live in
   day.js next to the systems they change (per the no-dispatcher
   rule); the strings here are what the tabs show for each level.
   With every demand at full, the sim behaves exactly as it did
   before allocation existed — brownout forces each demand to its
   old brownout tier (pump gravity-fed, tanks slow, commons dark,
   canning cold, shops on hand power).

   Dials:
     CANNING_DRAW / FAB_DRAW   power these draw *while active* —
       new costs (they used to ride free outside brownouts). The
       canning kitchen draws while built + allocated; the shops
       only while a fabrication project is running.
     AQUA_STAGNANT_WEAR   extra condition loss per day the
       aquaponics pumps are off (still water sours the system)
     WITHER_CHANCE        per-crop daily death roll with
       irrigation shut off entirely
     NO_CLEANING_SICK     daily chance someone falls ill while
       cleaning water is off
   ============================================================ */
const CANNING_DRAW = 1.0;
/* The canning kitchen used to draw the moment it was BUILT, forever, in a
   village that might not be preserving anything at all. It now needs two
   things: hands on the job, and enough cannable stock on the shelf to be
   worth firing the boilers for. Two units is roughly a real batch --
   below that you'd wait until tomorrow and do it in one go. */
const CANNING_MIN_STOCK = 2;

/* ---- climate ----
   Temperatures are °F. The `hardy` boolean is gone: a crop is hardy
   because its tMin is low, not because a second authored fact says so and
   might disagree with it. HARDY / COLD-HARDY badges derive from tMin
   (cropHardiness below), so the label can never contradict the model.

   Heating and cooling: the _MAX values are the °F of lift or drop each
   source can deliver in a day. Actual output scales with the temperature
   gap (climate.js gapRate), so a mild day genuinely costs less firewood
   than a cold one -- which the old flat model could not express. */
const HEATER_DRAW = 2.2;              // electric space heater, at full output
const HEATER_BREAK_BASE = 0.004;      // per night, unloaded
const HEATER_BREAK_LOAD = 0.030;      // added, scaled by how hard it ran
const WOOD_STOVE_MAX = 26;            // °F of lift a well-fed fire can add
const HEATER_MAX = 14;                // °F of lift from the electric heaters
const AC_MAX = 12;                    // °F of cooling from the unit

/* Two tiers so the badge can distinguish "shrugs off an ordinary frost"
   from "sleeps under the snow all winter" -- the old single flag flattened
   grain and turnip into the same thing. */
const cropHardiness = c =>
  (c && c.tMin != null) ? (c.tMin <= 15 ? "COLD-HARDY" : c.tMin <= 28 ? "HARDY" : null) : null;
const FAB_DRAW = 0.8;
const WELL_DRAW = 1.1;   // the pump runs whenever the well is drawing
const AC_DRAW = 1.6;   // heavy on purpose: the cooling unit is the most expensive thing
                       // on the grid, and it wants power on exactly the days solar is
                       // strong and everyone else wants power too
const AQUA_STAGNANT_WEAR = 1.5;
const WITHER_CHANCE = 0.04;
/* Nothing under glass ever gets rained on, so shutting irrigation off is a
   death sentence in there rather than a gamble. Same roll, much worse odds. */
const GH_WITHER_CHANCE = 0.22;
const NO_CLEANING_SICK = 0.10;

/* ---- the greenhouse ----
   Fifty feet by twenty, which is a thousand square feet of floor and, once
   you take out the centre path and the potting end, about three long beds
   of growing ground. GH_BEDS_FOUND is the smaller, already-standing pair
   you can start with as a founding visual; GH_BEDS_BUILT is what the
   project gets you, and building it on top of a founding pair EXTENDS that
   pair rather than starting over. */
/* ---- seed held back for planting ----
   How many plantings' worth of an edible seed crop the village keeps in
   reserve rather than eating or pressing. Two is enough to re-sow and have
   a second go if the first fails. The player can release a crop's reserve
   entirely from the larder card (see seedReserveFor in day.js). */
const SEED_RESERVE_PLANTINGS = 2;
/* ---- unified seed-and-food crops ----
   `edibleSeed:true` on a CROPS entry means the thing you eat and the thing
   you plant are THE SAME OBJECT: a bean is a bean. For these there is no
   S.seedStock entry at all — the pantry is the only pool, and "how much can
   we plant" is a computed read of it. See plantableStock()/grantPlantingStock()
   in seasons.js; nothing outside those two functions should touch either pool.

   `seedFood:"pepita"` is the OTHER case: the seed is a byproduct, not the
   harvest. Winter squash flesh keeps all winter intact, so its seeds only
   come free when the squash is actually processed — eaten or preserved —
   which is handled at the harvest, not here.

   The old tag-sniffing version of this (seed/grain/legume off FOOD_DATA) is
   gone: it answered "is this food seed-like", which is a different question
   from "is this crop's seed its harvest", and it had no way to express the
   squash case at all. */
const isEdibleSeed = id => !!(CROPS[id] && CROPS[id].edibleSeed);

const GH_BEDS_FOUND = 2;
const GH_BEDS_BUILT = 3;

const POWER_DEMANDS = [
  {id:"pump",    name:"Catchment pump",   gate:"catchment",  levels:[0,0.5,1],
   draw: SYS.find(s=>s.id==="catchment").draw,
   blurb:"Moves water to where we need it.",
   fx:{0:"gravity feed only — the tanks fill at half rate",
       0.5:"low pressure — the tanks fill at three-quarters rate",
       1:"full pressure"}},
  {id:"aqua",    name:"Aquaponics pumps", gate:"aquaponics", levels:[0,0.5,1],
   draw: SYS.find(s=>s.id==="aquaponics").draw,
   blurb:"Circulation and aeration. Both fish and plants suffer without it.",
   fx:{0:"still water — a third of the yield, and the system breaks down quickly",
       0.5:"slow water — seven-tenths of the yield",
       1:"full flow"}},
  {id:"commons", name:"Commons stove & lights", gate:"commons", levels:[0,1],
   draw: SYS.find(s=>s.id==="commons").draw,
   blurb:"The long table's stove, and the lights above it.",
   fx:{0:"dark evenings — less time spent gathered together",
       1:"lit and warm"}},
  {id:"well",    name:"Well pump",       gate:"flag:well", levels:[0,0.5,1],
   draw: WELL_DRAW,
   blurb:"Lifts groundwater into the tanks. Independent of the weather entirely.",
   fx:{0:"capped — the village drinks rain only",
       0.5:"drawing lightly — half what the well could give",
       1:"drawing full"}},
  {id:"ac",      name:"Cooling unit",    gate:"flag:acUnit", levels:[0,1],
   draw: AC_DRAW,
   blurb:"Cools the Commons and the sickbed through the worst of the summer.",
   fx:{0:"off — the summer is whatever the walls and the trees make of it",
       1:"running — the Commons stays bearable"}},
  {id:"canning", name:"Canning kitchen",  gate:"flag:canning", levels:[0,1],
   draw: CANNING_DRAW,
   blurb:"Jars, lids, and heat — the fastest way to preserve food.",
   fx:{0:"boilers cold — preserving falls back to the fermenting crocks or the drying racks",
       1:"boilers hot"}},
  {id:"heater",  name:"Electric heaters",  gate:"flag:eHeater", levels:[0,0.5,1],
   draw: HEATER_DRAW,
   blurb:"Resistance heaters for the Commons and the greenhouse. They draw hard, and they draw hardest exactly when the panels are giving least.",
   fx:{0:"off — wood and walls only",
       0.5:"taking the edge off",
       1:"running — whatever the fire can't close, this does"}},
  {id:"fab",     name:"Fabrication shops", gate:"fab", levels:[0,1],
   draw: FAB_DRAW,
   blurb:"The lathe and the forge blower.",
   fx:{0:"hand power only — output at six-tenths",
       1:"machines humming"}}
];

const WATER_DEMANDS = [
  {id:"drinking",  name:"Drinking water", levels:[0.5,1], use:"people",
   blurb:"Cups, canteens, the kettle. This one has no off switch.",
   fx:{0.5:"on ration — saves three-tenths, and everyone suffers",
       1:"as much as anyone wants"}},
//  {id:"cooking",   name:"Cooking",        levels:[0,1],   use:"1/day",
//   blurb:"Washing grain, soaking beans, stock on the stove.",
//   fx:{0:"cold sparse meals — spirits sag",
//       1:"proper meals"}},
  {id:"cleaning",  name:"Cleaning",       levels:[0,0.5,1], use:"1/day",
   blurb:"Dishes, laundry, scrubbed hands. Invisible until it stops.",
   fx:{0:"nothing washed — spirits sag hard, and people get sick easier",
       0.5:"the essentials only — spirits sag a little",
       1:"clean and well-maintained"}},
  {id:"snowmelt", name:"Melting snow",   levels:[0,1], use:"wood",
   blurb:"Snow hauled in and melted down on purpose. Costs firewood you might rather burn for warmth.",
   fx:{0:"left on the ground to melt when it melts",
       1:"a pot kept going — water out of a frozen week, at a price in wood"}},
  {id:"irrigation",name:"Irrigation",     levels:[0,0.5,1], use:"beds",
   blurb:"What the gardens use. The biggest water draw.",
   fx:{0:"dry beds — growth all but stops, and crops start to die",
       0.5:"half water — growth at about two-thirds",
       1:"watered in full"}}
];




/* ============================================================
   TRANSMISSION LOSS — what the lines and the mains bleed away.
   Applied to generation (before the draw is met) and to catchment
   intake (rain into the tanks and hand-hauled water skip the
   pipes, so neither is taxed). Each completed level of the
   matching bench puzzle (the line run / the water mains)
   multiplies the loss by LOSS_DECAY, so it falls toward zero
   without ever reaching it: 30% → 21% → 14.7% → 10.3% → 7.2% →
   5.0% with five runs solved. Raise LOSS_DECAY toward 1 to make
   the grind longer, lower the bases to soften the whole system.
   NOTE: this is a real early-game nerf relative to the old
   balance — a fresh village loses ~30% of everything until the
   bench work starts. That is the point, but it is a dial.
   ============================================================ */
const POWER_LOSS_BASE = 0.30;
const WATER_LOSS_BASE = 0.30;
const LOSS_DECAY = 0.7;



/* ============================================================
   MATURITY & YIELD
   Two separate axes, deliberately:
     crop.work     the tending a bed needs before it will set a
                   crop at all. Undertended beds take LONGER to
                   reach it — weed competition. Labor moves this.
     crop.minDays  the biological floor: days from sowing before
                   anything can be harvested, no matter how many
                   green thumbs stand over it. Nothing moves this.
   A bed comes ready only when BOTH are met, so labor can pull a
   harvest forward to the floor and never past it.

   Yield is then set ONCE, at the moment the bed comes ready, from
   how well it was grown rather than how fast:
     tending   growth banked beyond crop.work by the day the floor
               lifts. 1.0 = only just made it (a thin, weedy stand);
               more = a bed kept ahead of the weeds all season.
               Saturating, so stacking gardeners has a ceiling.
     soil      bed fertility. Rich ground fills out a crop; poor
               ground gives a small one even if it ripens on time.
     bloom     pollinator restoration (this is where the +20% the
               old comment promised actually lives now).

   Dials: YIELD_TEND_MAX is the most tending can add (+50%);
   YIELD_TEND_SCALE is how fast it saturates (1.0 -> +32% at twice
   the needed work, +43% at three times); YIELD_SOIL_FLOOR is what
   dead ground still returns (65%).
   ============================================================ */
const YIELD_TEND_MAX = 0.5;
const YIELD_TEND_SCALE = 1.0;
const YIELD_SOIL_FLOOR = 0.65;
const POLLINATOR_YIELD = 0.20;


export { GH_BEDS_BUILT, GH_BEDS_FOUND, GH_WITHER_CHANCE, SEED_RESERVE_PLANTINGS, isEdibleSeed,
  AC_MAX, HEATER_DRAW, HEATER_MAX, HEATER_BREAK_BASE, HEATER_BREAK_LOAD, WOOD_STOVE_MAX, cropHardiness, SEED_RICH_SITES, MAX_SEED_ROLLS, CANNING_MIN_STOCK, WELL_DRAW, AC_DRAW, AQUA_STAGNANT_WEAR, BATTERY_UNIT, CANNING_DRAW, CROPS, DAY_MS, FABS, FAB_DRAW, FAB_RATE, FOREST_PLOT_COST, INJURY_PER_DAY, JOB_PRACTICE, LOSS_DECAY, MAX_BATTERIES, MAX_FOREST_PLOTS, MAX_SOLAR, NO_CLEANING_SICK, OFFLINE_CAP, POLLINATOR_YIELD, POWER_DEMANDS, POWER_LOSS_BASE, PRACTICE_BROAD_CAP, PRACTICE_BROAD_DECAY, PRACTICE_BROAD_GROWTH, PRACTICE_SPECIFIC_CAP, PRACTICE_SPECIFIC_DECAY, PRACTICE_SPECIFIC_GROWTH, PRESERVE, PROJECTS, RESTORE_GATE, RESTORE_HIGH, RESTORE_IN, RESTORE_LOW, RES_CAP, SEASONS, SEASON_LEN, SITE_DEF, SITE_LOOT_TABLE, SOLAR_UNIT, STACKABLE, SYS, TURBINE_UNIT, WATER_DEMANDS, WATER_LOSS_BASE, WEATHERS, WITHER_CHANCE, YIELD_SOIL_FLOOR, YIELD_TEND_MAX, YIELD_TEND_SCALE };
