/* data-memories.js — the authored half of the memory system. Pure data:
   no imports, no logic, so state.js and memories.js can both read it
   without either importing the other.

   PREGAME is the thing that makes a character feel like the same person
   twice. Stats were always identical across restarts; nothing that had
   HAPPENED to anyone was. One line each, day 0, unforgettable — drawn from
   the character's own `note` in defs.js and their worldview in ideology.js,
   so the three agree without any of them naming the others.

   Voice rule, same as the journal: plain, past tense, no adjectives doing
   work a fact could do. These lines surface on the People tab and inside
   conversation text, so they have to read as something a person would
   actually say they remember — not as a character sheet entry. */

const PREGAME = {
  /* --- the twelve who could have been standing in the yard --- */
  nadia: {
    text: "Sorted a coffee can of screws by thread on the worst night of the walk here, because it was the only thing left that could be put right.",
    valence: -0.2, tags: { subject: "before", action: "project" }
  },
  ora: {
    text: "Talked to a tomato plant through a whole bad winter. It didn't answer, and it didn't die either.",
    valence: 0.4, tags: { subject: "before", action: "garden" }
  },
  bec: {
    text: "Slept out under an overpass for a season and came back easier in the body than anyone who'd stayed inside.",
    valence: 0.5, tags: { subject: "before" }
  },
  sam: {
    text: "Stood out in a downpour waiting on a truck that never came, and found it hadn't ruined the day.",
    valence: 0.2, tags: { subject: "before" }
  },
  yusuf: {
    text: "Watched a man come off a ladder that everybody had said was fine. Checks them twice now, and does not apologise for it.",
    valence: -0.7, tags: { subject: "before", action: "project" }
  },
  petra: {
    text: "Learned how eleven people took their tea, in a house where that was the only kindness anybody could still afford.",
    valence: 0.3, tags: { subject: "before", action: "care" }
  },
  ilya: {
    text: "Named a bad bearing by sound three days before it went, and nobody listened, and then it went.",
    valence: -0.3, tags: { subject: "before", action: "project" }
  },
  june: {
    text: "Put in an apple whip at thirty-one, in a yard she left at forty. Someone else is eating from it.",
    valence: 0.5, tags: { subject: "before", action: "garden" }
  },
  marisol: {
    text: "Sat for the first of the tattoos the week the last of the meadow went under, so at least something would keep the shape of it.",
    valence: -0.2, tags: { subject: "before" }
  },
  theo: {
    text: "Outran a bad crowd across two counties at fourteen and has not been able to sit still since.",
    valence: -0.4, tags: { subject: "before" }
  },
  ash: {
    text: "Left a roof half-shingled when the water came up, and has never once left anything half-done since.",
    valence: -0.5, tags: { subject: "before", action: "project" }
  },
  kav: {
    text: "Started the weather log in a month when nothing else could be counted on to happen twice.",
    valence: 0.1, tags: { subject: "before" }
  },

  /* --- the seven who might still find the road --- */
  rosa: {
    text: "Carried the starter in a jar against her ribs for eleven days of walking, and fed it before she fed herself.",
    valence: 0.4, tags: { subject: "before", action: "cook" }
  },
  emrys: {
    text: "Brought a dead street back for one evening with a meter and a length of wire, and everyone stood outside to look at the light.",
    valence: 0.7, tags: { subject: "before", action: "project" }
  },
  din: {
    text: "Was turned away from a gate once, in weather, and has never told anyone where it was.",
    valence: -0.8, tags: { subject: "arrival" }
  },
  halla: {
    text: "Fed nine people off a fallen oak for a fortnight, and knew exactly which caps to leave.",
    valence: 0.6, tags: { subject: "before", action: "woodcut" }
  },
  moss: {
    text: "The grid went down in stages, and each stage had a name at the time. Doesn't use the names any more.",
    valence: -0.6, tags: { subject: "before" }
  },
  yara: {
    text: "Was the one who read the list out loud, every morning, so that nobody in that camp went unaccounted for.",
    valence: 0.2, tags: { subject: "before", action: "care" }
  },
  eli: {
    text: "Kept birch tea going on a stove for a whole bad month, mostly so there'd be a reason for people to come and stand in the kitchen.",
    valence: 0.4, tags: { subject: "before", action: "care" }
  }
};

/* MEM_TEXT — templates for the memories the sim generates rather than
   authors. Functions rather than slot-strings: these need names, places and
   pronouns that the call site already has in hand, and a slot-filler here
   would only re-derive what the caller knows. Same reason moments.js keeps
   its fill() next to its gates. */
const MEM_TEXT = {
  death: (name) => `The night ${name} died, and the room it happened in.`,
  departure: (name) => `The morning ${name} left, and the road they took.`,
  permInjury: (place) => `The leg, at ${place}. It set the way it set.`,
  injury: (place) => `Came back hurt from ${place}, and was no use to anyone for a week.`,
  illness: () => `A fever that went on longer than it had any business going on.`,
  birth: (name) => `The winter ${name} was born, and how quiet everyone went.`,
  hunger: (n) => `${n} days of thin meals, and counting what was left out loud.`,
  famineEnd: () => `The first meal after the hungry stretch, and nobody talking through it.`,
  storm: (what) => `The storm that took the ${what}, and the sound it made going.`,
  heatwave: () => `The week the heat wouldn't break, and working before dawn to get anything done.`,
  deepfreeze: () => `The week the cold wouldn't break, and how everyone slept in one room.`,
  arrival: (warm) => warm
    ? `Coming up the road and being made room for, straight off, by people who had no reason to.`
    : `Coming up the road at a bad time, and being let in anyway.`,
  project: (what) => `Raising the ${what}, and standing back from it when it was done.`,
  discovery: (what) => `Finding ${what} out there, when there was no reason to expect it.`,
  firstHarvest: (crop) => `The first ${crop} out of this ground, and how small the pile was.`,
  restoration: () => `The season the valley started giving more back than it took.`,
  flare: (name) => `The thing said to ${name}, and how it landed, and not taking it back.`,
  repair: (name) => `Working it out with ${name}, badly and then properly.`,
  teach: (name, skill) => `Being shown ${skill} by ${name}, properly, with the time it takes.`,
  taught: (name, skill) => `Showing ${name} ${skill}, and watching it land.`,
  celebration: (what) => `The ${what}, and staying up later than was sensible.`,
  tradition: (name) => `The first ${name}, before it was a thing that happened every year.`,
  visited: (name) => `${name} sat with them at the sickbed, on a day that needed it.`,
  founding: () => `Standing in the yard on the first morning, deciding this was the place.`
};

/* MEM_TOPIC — how a memory gets NAMED when it comes up in conversation.
   The memory's own `text` is a whole sentence and won't slot into "told
   {B} about ___", so each kind gets a noun phrase instead. Keyed by memory
   kind first, then by tags.subject, then the fallback. */
const MEM_TOPIC = {
  death:        "the ones who aren't here",
  departure:    "the ones who left",
  formative:    "what it was like before",
  before:       "what it was like before",
  arrival:      "how they came to be here",
  injury:       "getting hurt out there",
  permInjury:   "the leg, and what it cost",
  illness:      "that fever",
  hunger:       "the hungry stretch",
  famineEnd:    "the first proper meal after",
  storm:        "the night of the storm",
  heatwave:     "the week the heat wouldn't break",
  deepfreeze:   "the week the cold wouldn't break",
  birth:        "the child, and that winter",
  project:      "what it took to raise it",
  discovery:    "what turned up out there",
  firstHarvest: "the first of it out of this ground",
  restoration:  "how the valley's coming back",
  flare:        "what got said, and how it landed",
  repair:       "how they patched it up",
  celebration:  "that night in the commons",
  tradition:    "how it started, the first time",
  teach:        "being shown properly",
  conversation: "something said a while back",
  _default:     "a thing that hadn't been said out loud here"
};

/* Conversation openers, by topic kind. {A} {B} are names; {topic} is the
   subject phrase the conversation module builds. Warm and cold variants —
   NOT because the topic was warm or cold, but because the PAIR was. Two
   people who click can argue all evening and both enjoy it; two who grate
   can agree about everything and still come away tired. See §6.3. */
const CONV_LINES = {
  memory: {
    warm: [
      "{A} told {B} about {topic}. It was the first time it had been said out loud here.",
      "{A} and {B} sat up over {topic}, and it got easier in the telling.",
      "{B} got the whole of {topic} out of {A}, mostly by not saying much."
    ],
    cold: [
      "{A} started in on {topic} and {B} listened the way you listen when you've heard it.",
      "{A} tried to explain {topic} to {B}, and gave it up halfway."
    ]
  },
  ideology: {
    gap: {
      warm: [
        "{A} and {B} argued half the evening about {topic}, and neither one minded losing.",
        "{A} and {B} disagree flatly about {topic}, and got on better for having it out.",
        "{B} put the other side of {topic} to {A}, and {A} conceded nothing and enjoyed it thoroughly."
      ],
      cold: [
        "{A} and {B} got onto {topic} again. It went the way it always goes.",
        "{topic} came up between {A} and {B}, and the table went quiet around them."
      ]
    },
    shared: {
      warm: [
        "{A} and {B} found out they think the same thing about {topic}, and talked past midnight.",
        "{A} said the thing about {topic} that {B} had been not-saying for a year."
      ],
      cold: [
        "{A} and {B} agree about {topic}, which somehow made the evening longer, not shorter."
      ]
    }
  },
  event: {
    warm: [
      "{A} and {B} went over {topic} again, the way people do when it hasn't settled yet.",
      "{A} and {B} talked {topic} through properly, and both slept better for it."
    ],
    cold: [
      "{A} and {B} rehashed {topic} without getting anywhere with it.",
      "{A} brought up {topic} to {B}, who had already decided how they felt about it."
    ]
  }
};

/* How each ideology axis gets NAMED in conversation — the leak layer for
   worldviews, same job the band-crossing lines in ideology.js do for drift.
   Never the axis name, never a number. */
const AXIS_TOPIC = {
  intervention: ["how much of the valley we ought to be managing",
                 "whether the south slope should be left to itself"],
  complexity:   ["how many machines this place can afford to keep promising to",
                 "whether the wiring is worth what it costs to keep"],
  openness:     ["whether the road should stay as open as it is",
                 "how many more chairs there ought to be at the long table"],
  temporality:  ["whether to spend this year on this year, or on the tenth one out",
                 "what we're planting for people who aren't born yet"],
  obligation:   ["whether the work should be spoken for out loud or left to find its people",
                 "what anyone here is actually owed"],
  wholeness:    ["whether a person is the one thing we don't get to redesign",
                 "what we'd be willing to change about ourselves to stay here"]
};

export { AXIS_TOPIC, CONV_LINES, MEM_TEXT, MEM_TOPIC, PREGAME };
