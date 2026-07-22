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

const SYS = [
  // decay rebalanced downward after the starting-stat nerf below (everyone -1 star,
  // so a new village's raw repair output is ~30% lower than it was) — see TUNING GUIDE
  {id:"turbine",   name:"Wind turbine",    decay:3.6, draw:0, start:true,  blurb:"The blades were old when it was found, but the turbine still turns."},
  {id:"solar",     name:"Solar array",     decay:2.0, draw:0, start:false, cost:{scrap:5,parts:3},  work:11, blurb:"Panels on the depot roofs. Quiet, and only works in daylight.", gate:{discover:true}},
  {id:"battery",   name:"Battery bank",    decay:1.6, draw:0, start:true,  blurb:"Salvaged cells that hold barely enough charge to be useful."},
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
const RES_CAP = {scrap:120, parts:60, wood:150};

const SITE_DEF = [
  {id:"oldtown",  name:"Old Town Row",          days:2, known:true,  stock:{scrap:40, parts:8, cans:14},   blurb:"Collapsed storefronts containing a mix of scrap, parts, and some canned food."},
  {id:"kessler",  name:"Kessler Depot",         days:3, known:true,  stock:{parts:30, scrap:10},           blurb:"An electronics depot, already looted before we found it."},
  {id:"pharmacy", name:"Greenbriar Pharmacy",   days:2, known:true,  stock:{meds:20, scrap:6},             blurb:"Shelves behind a grate somebody gave up on."},
  {id:"seedvault",name:"County Seed Vault",     days:4, known:false, stock:{seeds:30, meds:4},             blurb:"A basement archive. Cool and dry."},
  {id:"substation",name:"Riverside Substation", days:5, known:false, stock:{parts:26, scrap:14},           blurb:"Transformers like sleeping animals."},
  {id:"extension",name:"Agricultural Extension",days:5, known:false, stock:{seeds:22, scrap:12, parts:6},  blurb:"Test plots gone feral. Filing cabinets full of seed varieties."},
  {id:"hospital", name:"Valley Hospital",       days:6, known:false, stock:{meds:30, parts:8},             blurb:"Long halls and mysterious stains. A little creepy alone."},
  {id:"solarfarm",name:"Solar Farm Ruins",      days:7, known:false, stock:{parts:34, scrap:20},           blurb:"A field of cracked panels that once moved to track the Sun."},
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
  {id:"rootCellar",  name:"Root cellar",           cost:{scrap:8},           work:14, blurb:"Cool, dark, and relatively rat-proof. Holds far more food, and food spoils far slower."},
  {id:"dryRacks",    name:"Drying racks",          cost:{scrap:4},           work:10, blurb:"Sun, air, patience. Fresh food becomes dried for storage — losing a fifth on the way."},
  {id:"crocks",      name:"Fermenting crocks",     cost:{scrap:5, seeds:2},  work:12, blurb:"Salt, time, and the right microbial community. Pretty good for preserving food, even if not everyone loves the smell."},
  {id:"canning",     name:"Canning kitchen",       cost:{scrap:6, parts:5},  work:18, blurb:"Jars, lids, and heat. The fastest way to preserve food, but it requires power.", gate:{flag:"dryRacks"}},
  {id:"gardenBeds",  name:"New beds",              cost:{scrap:5, seeds:4},  work:14, blurb:"More ground turned, more trellis raised. Another pair of hands can work the gardens."},
  {id:"batteryRecond",name:"Battery reconditioning",cost:{parts:6},          work:14, gate:{sys:"battery"}, blurb:"New cells in old shells. The power bank's capacity is nearly doubled."},
  {id:"panelWash",   name:"Panel wash rig",        cost:{scrap:5},           work:10, gate:{sys:"solar"}, blurb:"A squeegee on a long pole, mostly. Solar array wears slower."},
  {id:"bearings",    name:"Spare bearings",        cost:{parts:8},           work:14, gate:{sys:"turbine"}, blurb:"Machined to fit. The turbine wears much slower."},
  {id:"dripRetrofit",name:"Drip retrofit",         cost:{scrap:6, parts:4},  work:14, gate:{sys:"irrigation"}, blurb:"Every joint resealed. Irrigation wears slower, gardens drink less."},
  {id:"graywater",   name:"Graywater loop",        cost:{scrap:7, parts:3},  work:16, gate:{sys:"irrigation"}, blurb:"Wash water and rinse water, filtered through sand and reed, sent back to the beds. The gardens take far less from the cisterns."},
  {id:"coldFrames",  name:"Cold frames",           cost:{scrap:6, seeds:6},  work:16, gate:{sys:"irrigation"}, blurb:"Miniature greenhouses to keep the garden growing straight through winter frost, and you can sow out of season."},
  {id:"herbalStores",name:"Herbal stores",         cost:{meds:6, seeds:3},   work:12, gate:{discover:true}, blurb:"Dried, labeled, jarred. Illness is briefer and less frequent."},
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
  radish:  {name:"Radishes",  work:14, minDays:14,  yield:16, seed:1, seeds:1, sow:["spring","summer","autumn"], feed:"light",  note:"Fast, thin, and better than nothing."},
  greens:  {name:"Greens",    work:20, minDays:20,  yield:24, seed:1, seeds:1, sow:["spring","summer","autumn"], feed:"light",  note:"Cut and come again, until it bolts."},
  beans:   {name:"Beans",     work:32, minDays:26,  yield:40, seed:2, seeds:3, sow:["spring","summer"],          feed:"legume", locked:true, note:"Feeds you, then feeds the soil, then feeds you again."},
  squash:  {name:"Squash",    work:44, minDays:44,  yield:58, seed:2, seeds:2, sow:["spring","summer"],          feed:"heavy", locked:true, note:"Slow, heavy, and it keeps all winter in a cold room."},
  potatoes:{name:"Potatoes",  work:38, minDays:40,  yield:53, seed:3, seeds:3, sow:["spring"],                   feed:"heavy", locked:true, note:"Dull, heavy, and the reason anyone survived anything. Keep back the small ones to plant."},
  grain:   {name:"Grain",     work:56, minDays:50,  yield:84, seed:3, seeds:4, sow:["spring","autumn"], hardy:true, feed:"heavy", locked:true, note:"The one crop frost won't kill: plant it in autumn and it sleeps under the snow, ready in spring. Slow, but it feeds a winter."},
  peas:    {name:"Peas",      work:36, minDays:28,  yield:52, seed:2, seeds:3, sow:["spring","summer"],
            sowWindow:{spring:[1,12], summer:[22,30]}, feed:"legume", locked:true,
            note:"Wants the cold shoulders of the year, not the middle of it. Early spring, or the very end of summer as it breaks toward autumn — never the heat between."},
  // discovered through the seed-frame puzzles; locked until then
  turnip:  {name:"Turnips",   work:22, minDays:24,  yield:34, seed:1, seeds:1, sow:["spring","summer","autumn"], hardy:true, locked:true, feed:"light", note:"Homely and dependable. Shrugs off an early frost and keeps in the cellar."},
  sunflower:{name:"Sunflowers",work:40, minDays:40, yield:44, seed:2, seeds:4, sow:["spring","summer"],          locked:true, feed:"heavy", note:"Oil for the lamps, seed for the birds, and a wall of gold that lifts the whole village."},
  amaranth:{name:"Amaranth",  work:34, minDays:42,  yield:56, seed:2, seeds:3, sow:["spring","summer","autumn"], locked:true, feed:"light", note:"Grain and greens both, and it grows where little else will. An old, stubborn plant."},
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
  catalpa:   {name:"Catalpa trees", perennial:true, shade:true, locked:true, matureYears:5,
              sow:["spring"], note:"Heart-shaped leaves the size of a hand, and a canopy that turns the south wall cool. Five years of nothing, and then a great deal of shade."},
  // slow, native, and a piece of what was lost: chestnuts take longer than
  // anything else in the ground here, and then they feed a village
  chestnut:  {name:"Chestnuts", perennial:true, native:true, matureYears:7, harvestSeason:"autumn",
              yield:200, seed:4, seeds:0, sow:["spring"], feed:"light", locked:true,
              note:"American chestnut, somehow still standing where four billion others fell. Seven years to bear, and then more than you can carry."},
  strawberry:{name:"Strawberries", perennial:true, matureYears:1, harvestSeason:"summer",
              yield:80, seed:3, seeds:0, sow:["spring"], feed:"light", locked:true,
              note:"Runners fill a plot in a year. After that, pickings all summer for almost no work."},
  blueberry: {name:"Blueberries", perennial:true, native:true, matureYears:3, harvestSeason:"summer",
              yield:150, seed:4, seeds:0, sow:["spring"], feed:"light", locked:true,
              note:"Highbush blueberry, native to these woods. Three slow years, then a whole summer of it, and it feeds the soil it stands in."},
  raspberry: {name:"Raspberries", perennial:true, matureYears:2, harvestSeason:"summer",
              yield:125, seed:3, seeds:0, sow:["spring"], feed:"light", locked:true,
              note:"Cane fruit — raspberry, or blackberry, whichever cuttings took. Bears for weeks. Spreads if you let it."},
  apple:     {name:"Apple trees", food:"apples", perennial:true, matureYears:4, harvestSeason:"autumn",
              yield:170, seed:5, seeds:0, sow:["spring"], feed:"light", locked:true,
              note:"Old grafted stock from the parking-lot rows. Four years to bear, then baskets of them every fall."},
  hazelnut:  {name:"Hazelnuts", perennial:true, native:true, matureYears:5, harvestSeason:"autumn",
              yield:200, seed:5, seeds:0, sow:["spring"], feed:"light", locked:true,
              note:"American hazelnut, native stock. Five years to a real harvest, then a wall of nuts every autumn, and roots that hold the hillside."},
  // the rest of the native forest crops, researched rather than guessed —
  // maturity years drawn from real extension/nursery sources, yield tiers
  // reasoned by relative fruit size and prolificacy against what's already here.
  pawpaw:    {name:"Pawpaw", perennial:true, native:true, matureYears:6, harvestSeason:"autumn",
              yield:170, seed:6, seeds:0, sow:["spring"], feed:"light", locked:true,
              note:"Asimina triloba — the largest fruit native to this continent, custard-sweet, and it needs two trees near each other to set anything. Five or six years before the first ones fall."},
  persimmon: {name:"American persimmon", perennial:true, native:true, matureYears:8, harvestSeason:"autumn",
              yield:160, seed:6, seeds:0, sow:["spring"], feed:"light", locked:true,
              note:"Diospyros virginiana, and usually a male tree and a female tree both, or nothing sets. Bitter unripe, honey-sweet after the first hard frost softens it. A slow tree — plant it for later."},
  mulberry:  {name:"Red mulberry", perennial:true, native:true, matureYears:5, harvestSeason:"summer",
              yield:130, seed:4, seeds:0, sow:["spring"], feed:"light", locked:true,
              note:"Morus rubra — not the white mulberry that escaped every hedge in the old world, the real native one. Five years, then it drops fruit for weeks like it's trying to give the whole thing away."},
  cranberrybush:{name:"Cranberrybush viburnum", perennial:true, native:true, matureYears:4, harvestSeason:"autumn",
              yield:100, seed:4, seeds:0, sow:["spring"], feed:"light", locked:true,
              note:"Viburnum trilobum — tart, close cousin of the true cranberry only in name. Four years to bear, and it bears heavily; you'll want a lot of them to make the harvest worth the tartness."},
  chestnut:  {name:"American chestnut", perennial:true, native:true, matureYears:5, harvestSeason:"autumn",
              yield:190, seed:6, seeds:0, sow:["spring"], feed:"light", locked:true,
              note:"Castanea dentata — sweeter and faster than people expect; it was bearing in five years before the blight took the species down to almost nothing. Plant it anyway. Some things are worth trying to bring back."},
  // a legacy planting: real oak and hickory don't mast until ~20 years old, peak
  // decades after that — genuinely outside any playthrough. It's here so the
  // choice to plant it can be made honestly: not a crop with a payoff, a gift
  // to whoever's still tending this ground when it's grown.
  oakhickory:{name:"Oak & hickory", perennial:true, native:true, matureYears:20, harvestSeason:"autumn",
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
const FABS = [
  {id:"seedSaving", name:"Seed saving",   cost:{seeds:4},           work:16, gives:"seeds",
   blurb:"Save the best, sow the best. A steady source of seeds"},
  {id:"forge",      name:"The forge",     cost:{scrap:16, parts:4}, work:30, gives:"scrap",
   blurb:"Charcoal, bellows, an anvil off a truck axle. Turning garbage into useful scrap."},
  {id:"machineShop",name:"Machine shop",  cost:{scrap:20, parts:12},work:40, gives:"parts",
   blurb:"Tools and equipment to produce the parts we need to fix things."},
  {id:"apothecary", name:"Apothecary",    cost:{seeds:8, meds:4},   work:26, gives:"meds",
   blurb:"A medicinal herb garden and a good book. Medicine we can grow."}
];

const FAB_RATE = {seeds:0.35, scrap:0.9, parts:0.5, meds:0.25};

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
const FAB_DRAW = 0.8;
const WELL_DRAW = 1.1;   // the pump runs whenever the well is drawing
const AC_DRAW = 1.6;   // heavy on purpose: the cooling unit is the most expensive thing
                       // on the grid, and it wants power on exactly the days solar is
                       // strong and everyone else wants power too
const AQUA_STAGNANT_WEAR = 1.5;
const WITHER_CHANCE = 0.04;
const NO_CLEANING_SICK = 0.10;

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


export { WELL_DRAW, AC_DRAW, AQUA_STAGNANT_WEAR, BATTERY_UNIT, CANNING_DRAW, CROPS, DAY_MS, FABS, FAB_DRAW, FAB_RATE, FOREST_PLOT_COST, INJURY_PER_DAY, JOB_PRACTICE, LOSS_DECAY, MAX_BATTERIES, MAX_FOREST_PLOTS, MAX_SOLAR, NO_CLEANING_SICK, OFFLINE_CAP, POLLINATOR_YIELD, POWER_DEMANDS, POWER_LOSS_BASE, PRACTICE_BROAD_CAP, PRACTICE_BROAD_DECAY, PRACTICE_BROAD_GROWTH, PRACTICE_SPECIFIC_CAP, PRACTICE_SPECIFIC_DECAY, PRACTICE_SPECIFIC_GROWTH, PRESERVE, PROJECTS, RESTORE_GATE, RESTORE_HIGH, RESTORE_IN, RESTORE_LOW, RES_CAP, SEASONS, SEASON_LEN, SITE_DEF, SITE_LOOT_TABLE, SOLAR_UNIT, STACKABLE, SYS, TURBINE_UNIT, WATER_DEMANDS, WATER_LOSS_BASE, WEATHERS, WITHER_CHANCE, YIELD_SOIL_FLOOR, YIELD_TEND_MAX, YIELD_TEND_SCALE };
