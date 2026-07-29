/* data-food.js — what food actually IS, once it stops being one number.

   Three tables here, all pure data:

   FOOD_DATA   every distinct thing the village can have in the larder, with
               a real decay rate, a real macro split, and which preservation
               methods actually work on it.
   RECIPES     real dishes, fired at the hearth when the larder happens to
               hold the ingredients. Flavor with a small mechanical kick.
   CROP_FAM    which real plant family each crop belongs to, and FAM_PAIR,
               what happens when two families share a bed. Deliberately NOT
               shared with the seed puzzle any more — that puzzle is free to
               be an unrealistic logic puzzle; a bed should behave like a bed.

   ---- on macros ----
   `mac` is {c, f, p} — the share of this food's FOOD VALUE coming from
   carbohydrate, fat, and protein. They sum to 1. These are real figures,
   rounded: caloric shares off standard composition tables, not vibes.

   The whole point is that "variety" as the game measured it before —
   distinct crop NAMES in the diet log — could score a village living on
   apples and raspberries as eating well. Nutritionally those are the same
   food. Macros are what variety was always gesturing at and missing.

   Two facts worth knowing while reading the table, because they're the
   ones that make the system interesting rather than uniform:
     · chestnuts are the carbohydrate nut (~76% carb, low fat) — genuinely
       unusual, and historically a grain substitute in famine years.
       Hickory and hazelnut are the opposite: fat, overwhelmingly.
     · fish and beans are the only real protein in the valley. A village
       with no tanks and no legumes planted is in trouble eventually, no
       matter how much fruit it picks.

   ---- on decay ----
   `dk` is the fraction of a stock lost PER DAY while fresh. Fractional
   losses resolve probabilistically (see larder.js) so an entry stays a
   whole readable number instead of drifting to 11.83 dried apples.
   Pawpaws rot in days — that's real, it's why you've never seen one in a
   shop. Squash and grain keep for months.

   ---- on preservation ----
   `pres` lists the methods that actually work. Not everything takes every
   method: you do not can a leaf into anything anyone wants to eat, and
   drying a fish and fermenting a fish are both real while canning one
   needs pressure the village hasn't got. Each method also has its own
   keeping time — see PRES_KEEP below. */

const FOOD_DATA = {
  // ---- garden annuals ----
  radish:    {name:"radishes",      dk:0.055, mac:{c:0.86,f:0.03,p:0.11}, pres:["ferment","dry"],            tags:["veg","root","brassica"]},
  greens:    {name:"greens",        dk:0.130, mac:{c:0.62,f:0.10,p:0.28}, pres:["ferment","dry"],            tags:["veg","leaf"]},
  turnip:    {name:"turnips",       dk:0.022, mac:{c:0.84,f:0.03,p:0.13}, pres:["ferment","dry","can"],      tags:["veg","root","brassica"]},
  potatoes:  {name:"potatoes",      dk:0.014, mac:{c:0.89,f:0.01,p:0.10}, pres:["dry","can"],                tags:["veg","root","staple"]},
  // summer squash keeps about a week; winter squash keeps until spring. That
  // difference is the entire reason they're two crops now.
  summersquash:{name:"summer squash", dk:0.090, mac:{c:0.62,f:0.14,p:0.24}, pres:["ferment","can","dry"],    tags:["veg"]},
  wintersquash:{name:"winter squash", dk:0.008, mac:{c:0.89,f:0.02,p:0.09}, pres:["dry","can"],              tags:["veg","staple"]},
  // cucumbers into the crocks is what "pickles" actually means
  cucumber:  {name:"cucumbers",     dk:0.100, mac:{c:0.80,f:0.06,p:0.14}, pres:["ferment","can"],            tags:["veg"]},
  tomato:    {name:"tomatoes",      dk:0.110, mac:{c:0.74,f:0.09,p:0.17}, pres:["can","dry"],                tags:["veg","nightshade"]},
  // the cultivated leaves. Spinach and tatsoi carry a genuinely high protein
  // SHARE — they're thin food, but what's in them is unusually good.
  spinach:   {name:"spinach",       dk:0.150, mac:{c:0.49,f:0.12,p:0.39}, pres:["dry","can","ferment"],      tags:["veg","leaf"]},
  tatsoi:    {name:"tatsoi",        dk:0.150, mac:{c:0.50,f:0.12,p:0.38}, pres:["ferment","dry"],            tags:["veg","leaf","brassica"]},
  kale:      {name:"kale",          dk:0.080, mac:{c:0.58,f:0.13,p:0.29}, pres:["dry","ferment","can"],      tags:["veg","leaf","brassica"]},
  cabbage:   {name:"cabbage",       dk:0.020, mac:{c:0.79,f:0.03,p:0.18}, pres:["ferment","dry","can"],      tags:["veg","leaf","brassica"]},
  beans:     {name:"beans",         dk:0.006, mac:{c:0.68,f:0.04,p:0.28}, pres:["dry","can","ferment"],      tags:["legume","protein","staple"]},
  peas:      {name:"peas",          dk:0.030, mac:{c:0.70,f:0.04,p:0.26}, pres:["dry","can","ferment"],      tags:["legume","protein"]},
  grain:     {name:"grain",         dk:0.004, mac:{c:0.83,f:0.04,p:0.13}, pres:["dry"],                      tags:["grain","staple"]},
  amaranth:  {name:"amaranth",      dk:0.005, mac:{c:0.70,f:0.14,p:0.16}, pres:["dry"],                      tags:["grain","staple"]},
  sunflower: {name:"sunflower seed",dk:0.010, mac:{c:0.22,f:0.60,p:0.18}, pres:["dry"],                      tags:["seed","fat"]},

  // ---- the food forest ----
  strawberry:{name:"strawberries",  dk:0.200, mac:{c:0.90,f:0.05,p:0.05}, pres:["dry","can","ferment"],      tags:["fruit"]},
  raspberry: {name:"raspberries",   dk:0.200, mac:{c:0.88,f:0.07,p:0.05}, pres:["dry","can","ferment"],      tags:["fruit"]},
  blueberry: {name:"blueberries",   dk:0.150, mac:{c:0.93,f:0.03,p:0.04}, pres:["dry","can","ferment"],      tags:["fruit"]},
  mulberry:  {name:"mulberries",    dk:0.190, mac:{c:0.87,f:0.05,p:0.08}, pres:["dry","can","ferment"],      tags:["fruit"]},
  apple:     {name:"apples",        dk:0.028, mac:{c:0.95,f:0.03,p:0.02}, pres:["dry","can","ferment"],      tags:["fruit"]},
  pawpaw:    {name:"pawpaws",       dk:0.250, mac:{c:0.83,f:0.11,p:0.06}, pres:["dry","can"],                tags:["fruit"]},
  persimmon: {name:"persimmons",    dk:0.090, mac:{c:0.92,f:0.03,p:0.05}, pres:["dry","can"],                tags:["fruit"]},
  cranberrybush:{name:"viburnum berries", dk:0.120, mac:{c:0.92,f:0.03,p:0.05}, pres:["dry","can"],          tags:["fruit"]},
  hazelnut:  {name:"hazelnuts",     dk:0.008, mac:{c:0.12,f:0.78,p:0.10}, pres:["dry"],                      tags:["nut","fat"]},
  chestnut:  {name:"chestnuts",     dk:0.030, mac:{c:0.84,f:0.09,p:0.07}, pres:["dry","can"],                tags:["nut","staple"]},
  oakhickory:{name:"nuts",          dk:0.010, mac:{c:0.30,f:0.60,p:0.10}, pres:["dry"],                      tags:["nut","fat"]},

  // ---- the tanks ----
  fish:      {name:"fish",          dk:0.300, mac:{c:0.00,f:0.35,p:0.65}, pres:["dry","ferment","can"],      tags:["fish","protein"]},

  // ---- what the near country gives (typed foraging) ----
  // season-gated below in FORAGE_TABLE; these are the goods themselves
  ramps:     {name:"wild ramps",    dk:0.110, mac:{c:0.70,f:0.08,p:0.22}, pres:["ferment","dry"],            tags:["wild","leaf"]},
  fiddlehead:{name:"fiddleheads",   dk:0.160, mac:{c:0.62,f:0.10,p:0.28}, pres:["ferment","can"],            tags:["wild","veg"]},
  morel:     {name:"morels",        dk:0.220, mac:{c:0.60,f:0.08,p:0.32}, pres:["dry"],                      tags:["wild","mushroom","protein"]},
  chanterelle:{name:"chanterelles", dk:0.200, mac:{c:0.62,f:0.09,p:0.29}, pres:["dry"],                      tags:["wild","mushroom","protein"]},
  henofwoods:{name:"hen-of-the-woods", dk:0.180, mac:{c:0.58,f:0.08,p:0.34}, pres:["dry"],                   tags:["wild","mushroom","protein"]},
  purslane:  {name:"purslane",      dk:0.140, mac:{c:0.60,f:0.16,p:0.24}, pres:["ferment"],                  tags:["wild","leaf"]},
  wildgrape: {name:"wild grapes",   dk:0.170, mac:{c:0.94,f:0.03,p:0.03}, pres:["dry","can","ferment"],      tags:["wild","fruit"]},
  rosehip:   {name:"rose hips",     dk:0.060, mac:{c:0.90,f:0.05,p:0.05}, pres:["dry","can"],                tags:["wild","fruit"]},
  acorn:     {name:"acorns",        dk:0.012, mac:{c:0.55,f:0.37,p:0.08}, pres:["dry"],                      tags:["wild","nut","staple"]},
  cattail:   {name:"cattail root",  dk:0.040, mac:{c:0.92,f:0.02,p:0.06}, pres:["dry"],                      tags:["wild","root"]},
  bark:      {name:"inner bark",    dk:0.020, mac:{c:0.94,f:0.02,p:0.04}, pres:["dry"],                      tags:["wild","famine"]},

  // ---- made things ----
  // noBulk: this is food and it counts in the stores, but nobody sits down
  // to a bowl of oil. It leaves the pantry through RECIPES (dressing a
  // salad, frying potatoes) and through the dinner line's flavor draw --
  // never through the ordinary perishable-first meal. See takeFrom() in
  // larder.js, which skips noBulk entries on the first pass and only
  // reaches for them if the village would otherwise go hungry beside them.
  oil:       {name:"pressed oil",   dk:0.004, mac:{c:0.00,f:1.00,p:0.00}, pres:[], noBulk:true,             tags:["fat","made"]}
};

/* What the near country actually gives, by season — the flavor text in
   FORAGE_FLAVOR made mechanical. `rain` entries only appear if it has
   rained in the last few days: mushroom flushes follow weather, which is
   the single most real thing about foraging and was pure decoration until
   now. Winter is deliberately thin — that is the whole argument for
   preserving anything. */
const FORAGE_TABLE = {
  spring: {always:["ramps","fiddlehead","greens"],           rain:["morel"]},
  summer: {always:["blueberry","raspberry","purslane"],      rain:["chanterelle"]},
  autumn: {always:["acorn","rosehip","wildgrape","chestnut"],rain:["henofwoods"]},
  winter: {always:["bark","rosehip","cattail"],              rain:[]}
};
const FORAGE_RAIN_DAYS = 3;   // a flush follows rain within this many days

/* How long a preservation method holds, and what it can hold at all.
   `keep` is the daily loss on preserved stock — canning is near-perfect,
   drying is good, fermenting sits between and is the only one that
   improves what it touches. `only` restricts a method to foods whose
   FOOD_DATA.pres includes it (enforced in larder.js, not here). */
const PRES_KEEP = {
  dry:     {name:"dried",     keep:0.0016, loss:0.20, blurb:"Sun, air, patience."},
  ferment: {name:"fermented", keep:0.0009, loss:0.08, blurb:"Salt and time."},
  can:     {name:"canned",    keep:0.0002, loss:0.12, blurb:"Jars, lids, heat."}
};
/* PRESERVE (data-economy) is keyed by project flag; this maps those to the
   method ids above so the two tables never drift apart. */
const PRES_METHOD_OF = {drying:"dry", fermenting:"ferment", canning:"can"};

/* ---- recipes ----
   Real dishes, every one of them, using only what this valley grows.
   A recipe fires at most once a day, at the hearth, when a cook is working
   and the larder holds every `needs` entry — matched against FOOD_DATA ids
   OR tags, so "any mushroom" and "any fruit" work without listing twelve
   variants. `takes` is food value consumed beyond the ordinary meal (small
   — a dish is mostly a better arrangement of what was being eaten anyway);
   `wb` is the lift. `macFix` marks dishes that specifically shore up a
   macro, which is how a deficiency actually gets solved on purpose rather
   than by luck. */
const RECIPES = [
  {id:"succotash", name:"Succotash", needs:["beans","wintersquash",{tag:"grain"}], takes:2.5, wb:3.5, macFix:"p",
   line:"Beans, squash, and grain in one pot — the three of them grow together and it turns out they cook together too."},
  {id:"chowder", name:"Fish chowder", needs:["fish","turnip",{tag:"leaf"}], takes:2.5, wb:3.5, macFix:"p",
   line:"Fish chowder, thick with turnip, and everyone went back for more than they admitted to."},
  {id:"pilaf", name:"Grain and pea pilaf", needs:[{tag:"grain"},"peas"], takes:2, wb:2.5, macFix:"p",
   line:"Grain and peas cooked down together in one pot, which is the oldest good idea there is."},
  {id:"beanstew", name:"Bean and turnip stew", needs:["beans","turnip",{tag:"leaf"}], takes:2.5, wb:3,  macFix:"p",
   line:"A stew of beans and turnip and whatever green was to hand, left on the heat most of the afternoon."},
  {id:"hickorysoup", name:"Hickory nut soup", needs:["oakhickory",{tag:"grain"}], takes:2, wb:4, macFix:"f",
   line:"Nuts pounded and boiled until the milk rose, then grain stirred through it. An old way of doing it, and a rich one."},
  {id:"chestnutporridge", name:"Chestnut porridge", needs:["chestnut",{tag:"grain"}], takes:2, wb:3,
   line:"Chestnuts and grain boiled to a porridge. People have eaten through whole winters on exactly this."},
  {id:"amaranthporridge", name:"Amaranth porridge", needs:["amaranth"], takes:1.5, wb:2,
   line:"Amaranth simmered thick and eaten hot, which is most of what anyone wants in the cold."},
  {id:"fishgreens", name:"Fish and greens", needs:["fish",{tag:"leaf"}], takes:1.5, wb:2.5, macFix:"p",
   line:"Fish in the pan and greens wilted in after it. Ten minutes, and the best meal of the week."},
  {id:"fritters", name:"Bean fritters", needs:["beans","oil"], takes:2, wb:3, macFix:"f",
   line:"Bean fritters, fried in our own oil, and gone before the last of them came off the heat."},
  {id:"pawpawbread", name:"Pawpaw bread", needs:["pawpaw",{tag:"grain"}], takes:2, wb:4,
   line:"Pawpaw bread — the custard-sweet ones mashed straight into the batter. It doesn't keep. It didn't need to."},
  {id:"persimmonpudding", name:"Persimmon pudding", needs:["persimmon",{tag:"grain"}], takes:2, wb:4,
   line:"Persimmon pudding, dark and dense, made from the ones the frost had got to first."},
  {id:"mushroomsupper", name:"Mushrooms and greens", needs:[{tag:"mushroom"},{tag:"leaf"}], takes:1.5, wb:3, macFix:"p",
   line:"The mushrooms went in with the greens and the whole commons smelled like the forest floor."},
  // needsFlag: the dish names equipment, so the equipment has to exist. Both
  // of these used to fire in villages with no racks and no crocks.
  {id:"fruitleather", name:"Fruit leather", needs:[{tag:"fruit"}], takes:1.5, wb:1.5, needsFlag:"dryRacks",
   line:"Fruit boiled down and spread thin on the racks to dry. Something sweet to find in a pocket in February."},
  {id:"nutbutter", name:"Pounded nuts", needs:[{tag:"nut"}], takes:1.5, wb:2, macFix:"f",
   line:"Nuts pounded to a paste and spread on whatever there was. Half the village has an opinion on how fine to pound them."},
  {id:"kraut", name:"Kraut", needs:[{tag:"brassica"}], takes:1.5, wb:1.5, needsFlag:"crocks",
   line:"Salted down into the crocks by the handful. It'll be sour in a month and welcome in four."},
  // cucumbers in the crocks — the thing the dinner line kept claiming existed
  {id:"pickles", name:"Pickles", needs:["cucumber"], takes:1.5, wb:2, needsFlag:"crocks",
   line:"Cucumbers into the crocks with salt and whatever was growing near the door. Pickles by midwinter."},
  {id:"sundried", name:"Dried tomatoes", needs:["tomato"], takes:1.5, wb:2, needsFlag:"dryRacks",
   line:"Tomatoes halved and laid out on the racks until they went dark and sweet and kept forever."},
  {id:"squashsoup", name:"Squash soup", needs:["wintersquash",{tag:"leaf"}], takes:2, wb:3,
   line:"Winter squash cooked down to a thick soup, with greens torn in at the end. It filled the room with steam."},
  /* ---- the oil dishes ----
     Oil is a pantry entry now rather than a scalar off to one side, which
     means it has to have somewhere to GO. These are the ways a kitchen
     actually spends oil: dressing something raw, and frying something
     starchy. All three carry macFix:"f", because that is precisely what
     they do -- a village running sunflowers and nothing else is short of
     fat until it presses some and cooks with it. */
  {id:"dressedgreens", name:"Dressed greens", needs:[{tag:"leaf"},"oil"], takes:1.5, wb:2.5, macFix:"f",
   line:"Greens torn up raw and turned through oil and salt until every leaf had a shine on it."},
  {id:"friedpotatoes", name:"Fried potatoes", needs:["potatoes","oil"], takes:2, wb:3.5, macFix:"f",
   line:"Potatoes sliced thin and fried hard in oil, and the pan was scraped out before it had cooled."},
  {id:"sauteedsquash", name:"Sauteed squash", needs:["summersquash","oil"], takes:1.5, wb:2.5, macFix:"f",
   line:"Summer squash cut into coins and taken through hot oil until the edges caught and went sweet."}
];

/* ---- macro thresholds ----
   Shares of the day's intake below which the village is running a real
   deficiency. Carbohydrate has no floor: nothing grown here is short of it,
   and a carb floor would only ever fire in a famine the hunger system
   already handles.

   These are shares, not amounts — a village eating almost nothing is
   starving, which is a different system with its own counters. This one
   is about eating enough of the WRONG thing for long enough. */
const MAC_MIN = {p:0.09, f:0.09};
/* Deficiency is slow on purpose — the failure mode to avoid is a
   micronutrient system that either never fires or dominates the game.
   GRACE days of shortfall cost nothing at all (bodies have reserves; a
   thin fortnight is not a disease). Past that the drag builds gently and
   caps low. Recovery is gradual too — RECOVER days come off the counter
   for each good day, not the whole thing, because you do not undo a
   season of the same meal with one supper. */
const MAC_GRACE = 14;      // days below the line before anything bites
const MAC_DRAG = 0.18;     // wb/day per deficient day past grace
const MAC_DRAG_CAP = 1.2;  // never worse than this per macro per day
const MAC_CEIL_AT = 30;    // days at which a soft wb ceiling appears
const MAC_CEIL = 70;       // and what that ceiling is
const MAC_RECOVER = 2;     // counter days removed per day back above the line
/* The floor is what makes this a plateau instead of a slide. A long
   deficiency drags spirits DOWN TO a level and then stops pushing — real
   malnutrition makes people weak and keeps them weak; it doesn't drive
   them to zero on its own. Below the floor the drag simply doesn't apply,
   so a village can be badly fed for a year and still be alive to fix it.
   Dying of not eating is starvation's job, and starvation has its own
   counters and its own much harder caps. */
const MAC_FLOOR_START = 88;   // where the floor sits as the drag begins
const MAC_FLOOR_RATE = 1.1;   // how fast it descends per deficient day
const MAC_FLOOR_MIN = 46;     // and how low it ever goes

/* TUNED AGAINST A HEADLESS RUN, and worth keeping honest about: the first
   pass at these numbers (grace 10, drag 0.35, cap 3.5) took a village fed
   nothing but potatoes from 90 spirits to 2 in under three weeks — a death
   spiral from malnutrition alone, with both counters stacking. That is the
   exact failure this system was supposed to avoid.
   What's here now: both deficiencies together cost at most 2.4 wb/day
   against a resting recovery of 4, so a badly-fed village sags and stops
   flourishing rather than dying. The SOFT CEILING is the real signal —
   long malnutrition means you can't be well, not that you're doomed.
   The thresholds also moved: at 0.09, potatoes clear the protein line
   (low but real, and historically people did live on them) while still
   failing on fat, which is the honest shape of that diet. */

/* Journal leaks — one line, at the crossing, same discipline as the
   ideology band-crossing lines. Never a number, never a warning box. */
const MAC_LINES = {
  p: {
    onset:["It's been weeks of nothing but bulk — roots and grain and not one thing with any substance in it. People are getting through the days and no further.",
           "Somebody said it plainly at supper: we are eating plenty and we are not eating well. Nothing lately has had anything in it to build on."],
    relief:["There was something solid on the table — proper food, not just filling. You could see it in people by evening.",
            "A meal with real substance in it for once, and the difference showed within the hour."]
  },
  f: {
    onset:["Everything lately has been lean. People finish a full plate and are hungry again an hour later, which wears on a person worse than going short.",
           "Nothing on the table has had any richness to it in weeks. You can eat your fill of it and still feel like you've missed a meal."],
    relief:["Something rich, at last. People ate less of it than usual and were satisfied for the first time in weeks.",
            "There was fat in the pan tonight. It carried everyone through to morning in a way the last month hasn't."]
  }
};

/* ---- companion planting ----
   REBUILT on real plant families. This deliberately no longer shares data
   with the seed-frame puzzle: that puzzle's five abstract seed types are a
   logic puzzle and are free to stay unrealistic, while a garden bed should
   behave the way a garden actually does. Forcing real crops into the
   puzzle's categories is what produced the wrong answers — greens reading
   as a rival to beans, sunflowers reading as a good neighbour.

   What's encoded, all of it documented practice:
     · legumes fix nitrogen, so they help almost every heavy feeder — this
       is the one companion effect big enough to really feel, and it shows
       up as FERTILITY at harvest rather than as yield, because that's the
       actual mechanism.
     · Three Sisters falls out of the above for free: beans + grain +
       squash all read as mutual companions without a special case.
     · same family next to itself concentrates its own pests and draws the
       same nutrients — brassica beside brassica, nightshade beside
       nightshade. Potato and tomato share blight, which is the classic one.
     · brassicas (radish especially) beside cucurbits is a real, commonly
       used pairing — radish is planted to draw cucumber beetles off.
     · sunflowers are allelopathic: they release compounds that suppress
       their neighbours. They are a bad companion to essentially everything,
       which is the opposite of what the old puzzle-derived table said. */
const CROP_FAM = {
  radish:"brassica", turnip:"brassica", tatsoi:"brassica", kale:"brassica", cabbage:"brassica",
  beans:"legume", peas:"legume",
  summersquash:"cucurbit", wintersquash:"cucurbit", cucumber:"cucurbit",
  tomato:"nightshade", potatoes:"nightshade",
  grain:"grass",
  amaranth:"amaranth", spinach:"amaranth",
  sunflower:"aster",
  greens:"leafy"
};
/* +1 companion, -1 rival, absent = no strong interaction. Keys are the two
   family names sorted and joined, so lookup is order-free. */
const FAM_PAIR = {
  "brassica|legume": +1, "grass|legume": +1, "cucurbit|legume": +1,
  "legume|nightshade": +1, "amaranth|legume": +1, "leafy|legume": +1,
  "brassica|cucurbit": +1,
  "amaranth|brassica": +1, "cucurbit|leafy": +1,
  "brassica|brassica": -1, "nightshade|nightshade": -1,
  "brassica|nightshade": -1, "cucurbit|nightshade": -1, "grass|grass": -1,
  "aster|brassica": -1, "aster|legume": -1, "aster|cucurbit": -1,
  "aster|nightshade": -1, "aster|grass": -1, "aster|amaranth": -1,
  "aster|leafy": -1, "aster|aster": -1
};
const famOf = id => CROP_FAM[id] || null;
function famPair(a, b){
  if(!a || !b) return 0;
  return FAM_PAIR[[a,b].sort().join("|")] || 0;
}
/* Plain-language reason, for the planting screen — this is knowledge a
   gardener would simply have, so it's shown, not hidden. */
function pairingNote(primaryId, mateId){
  const a = famOf(primaryId), b = famOf(mateId), v = famPair(a,b);
  if(v > 0){
    if(a==="legume" || b==="legume") return "feeds the soil for it";
    if((a==="brassica"&&b==="cucurbit")||(a==="cucurbit"&&b==="brassica")) return "draws the beetles off";
    return "grows well alongside";
  }
  if(v < 0){
    if(a===b && a==="nightshade") return "shares the same blight";
    if(a===b) return "same family — pests and hunger double up";
    if(a==="aster"||b==="aster") return "sunflowers poison the ground around them";
    return "the two of them fight";
  }
  return "no strong feelings either way";
}

const COMP_YIELD = 0.12;    // per satisfied companion, on the bed's yield
const RIVAL_YIELD = -0.15;  // per rival pairing
const COMP_FERT = 6;        // extra fertility at harvest per legume companion
const MAX_COMPANIONS = 2;   // a bed holds a primary plus this many

export { COMP_FERT, COMP_YIELD, CROP_FAM, FAM_PAIR, famOf, famPair, pairingNote, FOOD_DATA, FORAGE_RAIN_DAYS, FORAGE_TABLE,
         MAC_FLOOR_MIN, MAC_FLOOR_RATE, MAC_FLOOR_START, MAC_CEIL, MAC_CEIL_AT, MAC_DRAG, MAC_DRAG_CAP, MAC_GRACE, MAC_LINES, MAC_MIN, MAC_RECOVER,
         MAX_COMPANIONS, PRES_KEEP, PRES_METHOD_OF, RECIPES, RIVAL_YIELD };
