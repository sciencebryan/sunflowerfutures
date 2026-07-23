/* data-moments.js — small tender moments for the journal, and the lookup
   tables their slots draw from. Pure data: lines are templates, gates are
   NAMED STRINGS resolved by a lookup in moments.js. Adding a line that uses
   existing slots and gates never touches code.

   Slots: {A} {B} {C} {Aposs} {Bobj} {tool} {document} {skill} {job}
          {jobplace} {explace} {instrument}
   Tiers: 1 warming · 2 close · 3 deepest · "visit" · "cooling" · "ambient"
   Gates: tower · rain · sharedJob · returnedToday · three · musical
          · oneDown · peakDrop */

const MOMENT_TIERS = { t1: 1.5, t2: 4, t3: 7 };   // min pair affinity per tier
const MOMENT_AFF   = { 1: 0.15, 2: 0.2, 3: 0.25, visit: 0.25, ambient: 0, cooling: 0 };
const MOMENT_DAILY_P = 0.35;      // chance any moment fires on a given day
const MOMENT_PAIR_COOLDOWN = 18;  // days before the same pair gets another line

const MOMENTS = [
  // --- tier 1: warming ---
  {t:"{A} and {B} did the washing up together and stayed in the kitchen talking after.", tier:1},
  {t:"{A} saved {B} a seat at dinner again.", tier:1},
  {t:"{A} went out of {Aposs} way to stop by {jobplace} this afternoon, just to spend a little time with {B}.", tier:1, needs:["hasJobPlace"]},
  {t:"{A} and {B} spent most of the afternoon disagreeing about how to stack the woodpile, and enjoyed themselves thoroughly.", tier:1},

  // --- tier 2: close ---
  {t:"{A} and {B} climbed the water tower to watch the sunset together.", tier:2, needs:["tower"]},
  {t:"{A}, {B}, and {C} brought a blanket up to the roof and spent half the night stargazing and talking.", tier:2, needs:["three"]},
  {t:"{B} couldn't sleep, and {A} sat up with {B} until {B} could.", tier:2},
  {t:"{A} gave {B} {Aposs} favorite {tool}.", tier:2, needs:["hasTool"]},
  {t:"{A} and {B} disappeared for a couple of hours together and came back late, muddy, and cheerful.", tier:2},
  {t:"{A} has been secretly leaving the last of the tea for {B}.", tier:2},
  {t:"{A} and {B} fell asleep in the commons with {document} open between them.", tier:2},
  {t:"{A} and {B} have so many inside jokes now that it's hard to follow their conversations.", tier:2},
  {t:"{A} has been teaching {B} {skill}, and {B} is getting the hang of it.", tier:2, needs:["hasSkillGap"]},
  {t:"{A} and {B} sat out on the porch through the storm, listening to the rain and the thunder.", tier:2, needs:["rain"]},

  // --- tier 3: deepest ---
  {t:"{A} and {B} moved their beds into the same room.", tier:3, once:true},
  {t:"When {A} came back from {explace}, {B} was the first person {A} looked for.", tier:3, needs:["returnedToday"]},
  {t:"{A} and {B} took the bed by the window, even though it's the coldest one.", tier:3, once:true},

  // --- visiting the laid-up (one down, the other present and NOT their caretaker) ---
  {t:"{A} stopped in to see how {B} was doing.", tier:"visit", needs:["oneDown"]},
  {t:"{A} sat with {B} at the sickbed for a while to keep {B} company.", tier:"visit", needs:["oneDown"]},
  {t:"{A} brought {B} {document} to get {Bobj} through the long afternoon.", tier:"visit", needs:["oneDown"]},
  {t:"{A} brought {B} dinner and stayed to eat with {B}.", tier:"visit", needs:["oneDown"]},
  {t:"{A} has visited {B} every day since {B} got hurt.", tier:"visit", needs:["oneDown","closePair"]},
  {t:"{A} carried {B} outside to sit in the sun for an hour.", tier:"visit", needs:["oneDown","closePair"]},

  // --- cooling (requires a real prior closeness — peakDrop) ---
  {t:"{A} and {B} haven't eaten together in a while.", tier:"cooling", needs:["peakDrop"]},
  {t:"{A} was noticeably terse with {B} today.", tier:"cooling", needs:["peakDrop"]},
  {t:"{A} and {B} went the whole day at {job} without speaking to each other.", tier:"cooling", needs:["peakDrop","sharedJob"]},
  {t:"{A} has stopped saving {B} a seat.", tier:"cooling", needs:["peakDrop"], once:true},

  // --- ambient / group ---
  {t:"{A} had {Aposs} {instrument} out after dinner, and {B} sang along.", tier:"ambient", needs:["musical"]},
  {t:"Three minor arguments over a card game in the commons tonight.", tier:"ambient", solo:true},
  {t:"The long table was full tonight and stayed full long after the food was gone.", tier:"ambient", solo:true}
];

/* {tool} by the giver's job — what {A} would actually own and part with */
const TOOL_BY_JOB = {
  garden:"trowel", woodcut:"hatchet", turbine:"wrench", solar:"multimeter",
  battery:"wire strippers", catchment:"pipe wrench", irrigation:"pipe wrench",
  aquaponics:"net", aquatend:"net", cook:"paring knife", care:"sewing kit",
  preserve:"canning tongs", press:"mallet", commons:"broom"
};

/* {document} by a person's leaning (highest base stat) — what they'd be
   reading in the first place */
const DOC_BY_LEAN = {
  green:["a plant identification guide","a seed catalog from before","a book of pressed flowers"],
  wild:["a road map of the old county","a trail journal someone else kept","a photo book of butterflies"],
  care:["a cookbook","a collection of poetry","a book of folk remedies"],
  hands:["a repair manual","an old field engineering handbook","a book of knots and hitches"]
};

/* {skill} where A's stat clearly exceeds B's — what the teaching would be */
const SKILL_TEACH = {
  green:"how to identify plants", wild:"how to read the weather off the ridge",
  hands:"how to solder", care:"how to dress a wound properly"
};

/* {jobplace} — where you'd find someone at their work */
const JOB_PLACE = {
  garden:"the gardens", woodcut:"the tree line", turbine:"the turbine",
  solar:"the panel rack", battery:"the battery shed", catchment:"the catchment",
  irrigation:"the irrigation lines", aquaponics:"the aquaponics tanks",
  aquatend:"the aquaponics tanks", cook:"the kitchen", care:"the sickbed",
  preserve:"the canning kitchen", press:"the oil press", commons:"the commons"
};

const INSTRUMENTS = ["guitar","ukulele","hand drum","fiddle"];
const MUSIC_MODES = ["singing","clapping",...INSTRUMENTS];

export { DOC_BY_LEAN, INSTRUMENTS, JOB_PLACE, MOMENTS, MOMENT_AFF, MOMENT_DAILY_P, MOMENT_PAIR_COOLDOWN, MOMENT_TIERS, MUSIC_MODES, SKILL_TEACH, TOOL_BY_JOB };
