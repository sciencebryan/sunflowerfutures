/* ================= climate =================
   Real daily temperature, replacing the season-id comfort abstraction.

   Everything here is a PURE function of its arguments except tickClimate(),
   which is the one place S is written. That's deliberate: it means the
   curves can be tested — and the numbers checked against actual Hudson
   Valley normals — without standing up a game state.

   Units are °F throughout. The setting's people would say "down into the
   twenties," not "minus six," and the flavor text has to read right.

   GAME YEAR IS 120 DAYS (SEASON_LEN 30 x 4), not 365. Every phase and
   period below is on that compressed calendar. */

import { S } from "./state.js";
import { SEASON_LEN } from "./data-economy.js";
import { season, dayOfSeason, yearOf } from "./seasons.js";
import { clamp } from "./helpers.js";
import { gauss, rand } from "./rng.js";

const YEAR_LEN = SEASON_LEN * 4;          // 120
const dayOfYear = day => ((day - 1) % YEAR_LEN) + 1;

/* ---- 1a. seasonal baseline ----
   Peak on day 45 (midpoint of summer). Winter's midpoint lands on day 105,
   exactly half a period away, so ONE phase constant places both the hottest
   and coldest points correctly. Mean/amplitude are real Hudson Valley
   figures (Jan ~35/19, Jul ~84/63) and don't depend on how long a game
   year is — only the period and phase changed for the 120-day calendar. */
const PEAK_DAY = 45;
const MEAN_HI = 62, AMP_HI = 23;
const MEAN_LO = 41, AMP_LO = 22;
const phase = doy => 2 * Math.PI * (doy - PEAK_DAY) / YEAR_LEN;
const baseHi = doy => MEAN_HI + AMP_HI * Math.cos(phase(doy));
const baseLo = doy => MEAN_LO + AMP_LO * Math.cos(phase(doy));

/* ---- 1b. weather coupling ----
   Clear skies push the high UP and the low DOWN — full sun by day, full
   radiative loss at night. Cloud damps both toward the middle. */
const WX_SHIFT = {
  clear:    {hi: +4, lo: -3},
  overcast: {hi: -2, lo: +2},
  rain:     {hi: -5, lo: -1}
};

/* ---- 1c. frontal passage ----
   A smooth random walk only WANDERS. What the Hudson Valley actually does
   in spring and autumn is alternate air masses in quick succession as a
   wavy jet stream drags fronts through — that's a shock, not a drift, so
   it gets its own layer on top of a quiet background.

   The seasonal signature is carried by FREQUENCY, not magnitude: spring and
   autumn get a front every four or five days; winter's are rarer but hit
   harder (an arctic outbreak drops further than a spring front); summer is
   nearly still, which is what a stable ridge feels like. */
const P_FRONT = {spring:0.22, summer:0.05, autumn:0.20, winter:0.12};
const KICK    = {spring:[11,3], summer:[6,2], autumn:[10,3], winter:[13,4]};
const REVERSAL_P = 0.7;   // fronts alternate more often than they repeat
const ANOM_CLAMP = 22;

function tickAnomaly(seasonId){
  const c = S.climate;
  // background wander: quiet, and deliberately season-blind
  c.anomaly = clamp(c.anomaly * 0.88 + gauss(0, 1.5), -ANOM_CLAMP, ANOM_CLAMP);
  if(rand() < (P_FRONT[seasonId] ?? 0.1)){
    const last = c.lastFrontSign || (rand() < 0.5 ? 1 : -1);
    const sign = (rand() < REVERSAL_P) ? -last : last;
    const [m, sd] = KICK[seasonId] || [8, 3];
    const kick = Math.max(4, gauss(m, sd));
    // partially overwrite rather than nudge: the air mass CHANGED
    c.anomaly = clamp(c.anomaly * 0.3 + sign * kick, -ANOM_CLAMP, ANOM_CLAMP);
    c.lastFrontSign = sign;
    c.lastFront = {day: S.day, sign, kick};
    return {sign, kick};
  }
  c.lastFront = null;
  return null;
}
/* An extreme event is simply a big kick — no separate roll, no separate
   flag. "It lasted several days" falls out for free: the anomaly it leaves
   behind just sits there until the next front reverses it, which is how a
   real cold snap or heat wave actually ends. */
const EXTREME_KICK = 14;
function extremeOf(front){
  if(!front || front.kick < EXTREME_KICK) return null;
  return front.sign > 0 ? "heatwave" : "deepfreeze";
}

/* ---- 1d. warming trend, and a kind first year ---- */
const WARM_PER_YEAR = 0.35, WARM_CAP = 6, YEAR1_MILD = -2.5;
function trendOffset(day){
  const y = yearOf(day);
  return Math.min((y - 1) * WARM_PER_YEAR, WARM_CAP) + (y === 1 ? YEAR1_MILD : 0);
}

/* ---- 7a. rain or snow ---- */
const FREEZING = 32;
const precipKind = (wxId, lo) => wxId !== "rain" ? null : (lo < FREEZING ? "snow" : "rain");

/* ---- 2. the greenhouse ----
   Salvaged single-pane glass is roughly R-1: it gains hard by day and
   loses hard by night, which is exactly why it extends a season rather
   than providing comfort. Venting is automatic (no player decision), so
   the daytime gain is capped rather than allowed to run away. */
/* Venting is automatic (there is no player decision here), and the thing an
   earlier pass got wrong is that a vent has no authority of its own — it can
   only trade the house's air for OUTSIDE air. So the hotter the day, the less
   opening the vents can accomplish, and a wide-open glasshouse on a 91F
   afternoon settles a few degrees over ambient rather than 25 over it.
   Modelling that as a flat +25 cap made the greenhouse strictly WORSE than
   open ground all summer: it drove the house to 109F, which is past every
   crop's tMax, so greens stopped growing entirely and tomatoes crawled at a
   fifth of the rate of the bed outside. Below the setpoint the vents are shut
   and the full solar gain stands; above it they are open and only the
   irreducible bit of glasshouse effect is left. */
const GH_VENT_TARGET = 82;   // the temperature the vents are trying to hold
const GH_MIN_GAIN = 4;       // glass still traps this much with everything open
const GH_NIGHT_PENALTY = 2;
/* The house's OWN thermal mass — the soil in the beds and the frame itself.
   Deliberately small: a 50x20 glasshouse holds a couple of degrees overnight
   and no more. This is the knob to raise if water walls or a bermed north
   wall ever become a buildable upgrade; it is NOT the Commons' massDamping,
   which an earlier pass wrongly borrowed (a bermed Commons wall fifty feet
   away does nothing at all for the greenhouse). */
/* Raised from 3 after watching a year of it. At 3 (net +1 overnight, once
   the night penalty is taken off) the greenhouse was almost exactly as frosty
   as open ground, which meant the single thing players buy a greenhouse FOR —
   not losing the tender crops — it did not do, while costing more than
   anything else in the build table. A real unheated glasshouse over warm soil,
   out of the wind, runs several degrees over the outdoor minimum; this is that.
   Still nowhere near enough to hold a January night, which is correct: that is
   what the heaters are for. */
const GH_THERMAL_MASS = 8;
/* Row cover and cloches INSIDE the house — cold frames stack with glass, the
   way they actually do for anyone growing under both. This is the cheap
   upgrade path for the greenhouse, and it needs no new project. */
const GH_COLDFRAME_BONUS = 5;
/* Note what these two numbers mean together, because it IS the design: at
   +25F by day the house cooks in midsummer (tomatoes top out around 95F and
   a 90F August day makes it 115F inside), and at outLo+1 by night it freezes
   in midwinter unless something is burning. The greenhouse buys SHOULDER
   SEASON — a month either side of the outdoor year — not a warm room. */
function greenhouseTemps(outHi, outLo, solarFactor, thermalMass, heatIn){
  const closedGain = 16 * (solarFactor == null ? 1 : solarFactor);
  const headroom = Math.max(0, GH_VENT_TARGET - outHi);
  const gain = Math.max(GH_MIN_GAIN, Math.min(closedGain, headroom));
  return {
    hi: outHi + gain,
    lo: outLo + (thermalMass == null ? GH_THERMAL_MASS : thermalMass) + (heatIn || 0) - GH_NIGHT_PENALTY
  };
}
/* What the NIGHT has to be held above, driven by what's actually planted:
   a house full of cold-hardy greens in midwinter shouldn't burn power
   chasing tomato temperatures.

   This is a floor, not a setpoint. An earlier pass averaged the planted
   crops' tOpt, which is a DAYTIME growing optimum — it asked the heaters to
   hold ~65F all night for a bed of kale that is perfectly happy at 30F, and
   the resulting demand was large enough that the greenhouse looked to the
   allocator like an emergency every night of the year. Take the most tender
   thing in the house, add the same margin frostKills() uses, and hold that.
   With nothing planted, hold just clear of freezing and no more. */
const GH_EMPTY_FLOOR = 36;
function greenhouseTarget(beds, cropData){
  const planted = (beds || []).filter(b => b && b.crop && cropData[b.crop]);
  if(!planted.length) return GH_EMPTY_FLOOR;
  // every crop in the house, primary and interplanted alike — the tenderest
  // one sets the bill, which is exactly the decision a grower actually faces
  const floors = [];
  for(const b of planted){
    for(const id of [b.crop, ...(b.companions || [])]){
      const c = cropData[id];
      if(c && c.tMin != null && !c.perennial) floors.push(c.tMin + FROST_BUFFER);
    }
  }
  if(!floors.length) return GH_EMPTY_FLOOR;
  return Math.max(GH_EMPTY_FLOOR, ...floors);
}

/* ---- 3. the commons ----
   Three genuinely different mechanisms, which an earlier draft wrongly
   collapsed into one damping term. A lag only changes how FAST a building
   tracks a target; it can't change where the target sits, so damping alone
   would have left the commons settling at outdoor-mean over any sustained
   cold month no matter how much had been built — which is the opposite of
   the point.

   groundCoupling is the one that does the real work: berming and earth
   tubes tie the building to deep-soil temperature, which sits near 52F
   year-round regardless of season. That's free winter warmth and free
   summer cool, and it's why the commons can hold without a fire. */
const GROUND_TEMP = 52;
/* What the building sits at with NOTHING burning: ground-coupled, shaded,
   but unheated. The heating gap MUST be measured against this rather than
   against yesterday's (already heated) indoor temperature — otherwise the
   fire sees its own output as evidence that less fire is needed, backs
   off, and the whole loop settles at a steady-state offset permanently
   below the comfort band. That's textbook proportional-control droop, and
   in game terms it meant no amount of firewood could ever actually make
   the Commons comfortable. Feed-forward off this, not off the result. */
function baseTarget(outMean, groundCoupling, loadReduction){
  return outMean + (GROUND_TEMP - outMean) * clamp(groundCoupling, 0, 0.9) - (loadReduction || 0);
}
function commonsTemps(o){
  const base = o.outMean + (GROUND_TEMP - o.outMean) * clamp(o.groundCoupling, 0, 0.9);
  const target = base - (o.loadReduction || 0) + (o.heatIn || 0) - (o.coolIn || 0);
  const d = clamp(o.massDamping, 0, 0.92);
  const mean = (o.prevMean == null) ? target : o.prevMean + (target - o.prevMean) * (1 - d);
  // mass and draft-proofing also flatten the daily swing, which is the
  // visible payoff for building them
  const swing = (o.outHi - o.outLo) / 2 * (1 - d) * 0.6;
  return {hi: mean + swing, lo: mean - swing, mean};
}

/* ---- 4a. growth ----
   Trapezoid on tMin/tOpt/tMax. Day-weighted, because photosynthesis
   happens in daylight — the overnight low shouldn't get equal billing. */
const growTemp = (hi, lo) => 0.4 * lo + 0.6 * hi;
function growthMult(crop, hi, lo){
  const T = growTemp(hi, lo);
  const {tMin, tOpt, tMax} = crop;
  if(tMin == null || T <= tMin || T >= tMax) return 0;
  if(T < tOpt) return (T - tMin) / (tOpt - tMin);
  if(T === tOpt) return 1;
  return Math.max(0, 1 - (T - tOpt) / (tMax - tOpt));
}

/* ---- 4b. frost, deterministic ----
   Past the buffer the crop dies; inside it, growth simply stalls (which
   growthMult already returns 0 for). The buffer exists so a crop sitting
   exactly at its floor doesn't flicker between fine and dead on noise.

   Snow cover is real insulation — a blanket of it holds ground crops
   several degrees above what bare ground would. Perennials are exempt
   from killing entirely: an established tree goes dormant, it doesn't
   die back to nothing at the first hard night. */
const FROST_BUFFER = 4, SNOW_INSUL_MAX = 8, SNOW_INSUL_PER = 1.5;
const snowInsulation = snowpack => Math.min(SNOW_INSUL_MAX, (snowpack || 0) * SNOW_INSUL_PER);
const effectiveLow = (lo, snowpack) => lo + snowInsulation(snowpack);
function frostKills(crop, lo, snowpack){
  if(!crop || crop.perennial || crop.tMin == null) return false;
  return (crop.tMin - effectiveLow(lo, snowpack)) > FROST_BUFFER;
}
/* 4d. the sow gate: never let a player commit seed to a day that is
   already past the kill line. Same predicate as the kill itself, on
   purpose — if these used two thresholds there'd be a crack between them
   where the game called something plantable and killed it that night. */
const tooColdToSow = (crop, lo, snowpack) => frostKills(crop, lo, snowpack);

/* 4c. typical first-frost day for a crop, off the BASELINE curve only
   (no weather, no anomaly) — a forecast, not a promise. */
function typicalFrostDay(crop, fromDay){
  if(!crop || crop.tMin == null || crop.perennial) return null;
  const start = dayOfYear(fromDay);
  for(let i = 1; i <= YEAR_LEN; i++){
    const doy = ((start - 1 + i) % YEAR_LEN) + 1;
    if(baseLo(doy) + trendOffset(fromDay) < crop.tMin) return i;   // days from now
  }
  return null;
}

/* ---- 5. gap-driven heating and cooling ----
   Everything that heats or cools scales with how big the gap actually is,
   instead of running flat whenever the season id matched. GAP_REF is the
   gap at which a source runs at its full rated output. */
const GAP_REF = 20;
const gapRate = (gap, baseRate, maxRate) =>
  clamp(baseRate * Math.max(0, gap) / GAP_REF, 0, maxRate);

/* Commons comfort band: seasonal, not one year-round setpoint. People
   dress for winter and expect less of a building in it; summer's band is
   tighter because there's less you can do about heat by putting on a
   sweater. */
const COMFORT = {
  spring: {lo:60, hi:76},
  summer: {lo:64, hi:78},
  autumn: {lo:60, hi:76},
  winter: {lo:56, hi:74}
};
const comfortBand = seasonId => COMFORT[seasonId] || COMFORT.spring;

/* ---- 7b/7c. water demand that responds to weather ----
   One-sided on purpose: thirst climbs with heat and doesn't meaningfully
   fall with cold. Irrigation uses a steeper curve than people do — a hot
   dry stretch can plausibly double a garden's draw, which is a bigger
   swing than a body's. */
const heatMult = (hi, per = 0.012, cap = 1.5) =>
  clamp(1 + Math.max(0, hi - 65) * per, 1, cap);
const drinkHeatMult = hi => heatMult(hi, 0.012, 1.5);
const irrigationHeatMult = hi => heatMult(hi, 0.020, 2.0);

/* Soil holds a few days of rain. Short memory, same texture as S.larder. */
const SOIL_CAP = 1, SOIL_REFILL = 0.55, SOIL_DRY = 0.7, SOIL_MAX_DISCOUNT = 0.45;
function tickSoilMoisture(kind){
  const c = S.climate;
  c.soilMoisture = kind === "rain"
    ? Math.min(SOIL_CAP, (c.soilMoisture || 0) + SOIL_REFILL)
    : (c.soilMoisture || 0) * SOIL_DRY;
  return c.soilMoisture;
}
const soilDiscount = m => 1 - SOIL_MAX_DISCOUNT * clamp(m || 0, 0, 1);

/* ---- 7d. snow on the ground, and melting it on purpose ---- */
const SNOW_PER_PRECIP = 1.2;      // a snowy day banks this much pack
const THAW_PER_DEGREE = 0.12;     // free melt once the high clears freezing
const SNOWMELT_WOOD_PER_UNIT = 0.6;
const SNOWMELT_PASSIVE = 0.4;     // a pot near a fire that's lit anyway
const SNOWMELT_ACTIVE_MAX = 3.0;  // someone tending it; never a well replacement

function tickSnowpack(kind, hi){
  const c = S.climate;
  if(kind === "snow") c.snowpack = (c.snowpack || 0) + SNOW_PER_PRECIP;
  let thaw = 0;
  if(hi > FREEZING && (c.snowpack || 0) > 0){
    thaw = Math.min(c.snowpack, (hi - FREEZING) * THAW_PER_DEGREE);
    c.snowpack -= thaw;
  }
  if(c.snowpack < 0.01) c.snowpack = 0;
  return thaw;   // free water into the catchment
}
/* Returns {water, wood} — caller deducts the wood and adds the water. */
function meltSnow(active, hearthLit, woodAvailable){
  const c = S.climate;
  let water = 0, wood = 0;
  if((c.snowpack || 0) <= 0) return {water, wood};
  if(hearthLit){
    water = Math.min(c.snowpack, SNOWMELT_PASSIVE);
    c.snowpack -= water;
  }
  if(active && c.snowpack > 0 && woodAvailable > 0){
    const can = Math.min(c.snowpack, SNOWMELT_ACTIVE_MAX,
                         woodAvailable / SNOWMELT_WOOD_PER_UNIT);
    if(can > 0){ c.snowpack -= can; water += can; wood = can * SNOWMELT_WOOD_PER_UNIT; }
  }
  if(c.snowpack < 0.01) c.snowpack = 0;
  return {water, wood};
}

/* ---- the one impure function ---- */
function tickClimate(wx){
  if(!S.climate) S.climate = freshClimate();
  const c = S.climate;
  const sn = season(), doy = dayOfYear(S.day);
  const front = tickAnomaly(sn.id);
  const shift = WX_SHIFT[wx && wx.id] || {hi:0, lo:0};
  const off = trendOffset(S.day) + c.anomaly;
  const hi = baseHi(doy) + shift.hi + off;
  const lo = Math.min(baseLo(doy) + shift.lo + off, hi - 2);   // low is never above the high
  c.out = {hi, lo, mean: (hi + lo) / 2};
  c.precip = precipKind(wx && wx.id, lo);
  c.extreme = extremeOf(front);
  c.thaw = tickSnowpack(c.precip, hi);
  tickSoilMoisture(c.precip);
  return c;
}
const freshClimate = () => ({
  out:{hi:62, lo:41, mean:51.5}, greenhouse:{hi:62, lo:41}, commons:{hi:62, lo:62, mean:62},
  anomaly:0, lastFrontSign:0, lastFront:null, extreme:null,
  snowpack:0, soilMoisture:0, precip:null, thaw:0
});

export {
  FREEZING, FROST_BUFFER, GAP_REF, GH_COLDFRAME_BONUS, GH_THERMAL_MASS, GH_VENT_TARGET, GROUND_TEMP,
  SNOWMELT_WOOD_PER_UNIT, YEAR_LEN,
  baseHi, baseLo, baseTarget, comfortBand, commonsTemps, drinkHeatMult, effectiveLow, freshClimate,
  frostKills, gapRate, greenhouseTarget, greenhouseTemps, growthMult, growTemp,
  irrigationHeatMult, meltSnow, precipKind, snowInsulation, soilDiscount,
  tooColdToSow, tickClimate, trendOffset, typicalFrostDay
};
