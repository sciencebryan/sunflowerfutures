/* data-celebrations.js — the kinds of celebration, what each costs, and the
   lines they put in the journal. Pure data; celebrations.js does the work.

   Every kind: cost scales with the chosen scale, and so does what it gives.
   A modest bonfire is a small warm evening; an all-out one is a night the
   village remembers. `bond` is affinity added to every pair present — this
   is what makes celebrations feed the moments system rather than just
   bumping a number.

   gate strings resolved in celebrations.js:
     season:<id> · afterDeath · musical · hasWood · hasProject */

const SCALES = [
  {id:"modest", label:"Modest",  mult:0.5, note:"a small thing, but a real one"},
  {id:"proper", label:"Proper",  mult:1,   note:"the way it ought to be done"},
  {id:"grand",  label:"All out", mult:2,   note:"empty the stores and mean it"}
];

const CELEBRATIONS = [
  {
    id:"feast", name:"A feast", verb:"held",
    cost:{food:30}, optional:{oil:3}, margin:20,
    wb:12, days:3, bond:0.3, cooldown:40,
    blurb:"A night the stores can afford, given over on purpose. Everyone eats well and nobody works.",
    lines:[
      "Everything on the table at once, and no one rationing tonight.",
      "The plates went round twice and nobody kept count of the servings.",
      "Whatever the day's work was, it waited."
    ],
    rich:"Half of it grown this year, and all of it different."
  },
  {
    id:"bonfire", name:"A bonfire", verb:"lit",
    cost:{wood:16}, margin:0, gate:["hasWood"],
    wb:8, days:2, bond:0.45, cooldown:30,
    blurb:"Wood that could have been saved for the cold, burned all at once instead, with everyone standing around it.",
    lines:[
      "The fire threw light up the walls of every building still standing.",
      "People stood close to it and closer to each other, and stayed out later than was sensible.",
      "Sparks went up past the roofline all evening."
    ]
  },
  {
    id:"music", name:"A music night", verb:"held",
    cost:{}, margin:0, gate:["musical"],
    wb:5, days:2, bond:0.4, cooldown:18,
    blurb:"Costs nothing but an evening. Somebody plays, everyone else finds out they know the words.",
    lines:[
      "{player} played until {Pposs} fingers gave out, and there was still singing after.",
      "Somebody remembered a song nobody had heard in years, and half the room knew it anyway.",
      "It went on long past when the sensible people had gone to bed."
    ]
  },
  {
    id:"harvest", name:"Harvest home", verb:"kept",
    cost:{food:24}, optional:{oil:2}, margin:24, gate:["season:autumn"],
    wb:14, days:4, bond:0.35, cooldown:60,
    blurb:"The end of the picking, marked properly. Everything that came out of the ground this year, eaten in one sitting.",
    lines:[
      "The last of the picking came in and went straight onto the table.",
      "Everyone ate standing up, and nobody minded.",
      "A year's work, all of it visible at once for one evening."
    ],
    rich:"Every different thing the beds gave, out at the same time."
  },
  {
    id:"remembrance", name:"A remembrance", verb:"held",
    cost:{}, margin:0, gate:["afterDeath"],
    wb:6, days:3, bond:0.5, cooldown:0,
    blurb:"Not a celebration exactly. A night set aside for the people who aren't here, so the village doesn't just keep going without saying anything.",
    lines:[
      "Names were said out loud, which is most of what a remembrance is.",
      "People told the stories they'd been holding onto, and some of them were funny.",
      "Nobody hurried it along."
    ]
  },
  {
    id:"raising", name:"A work party", verb:"threw",
    cost:{food:18}, margin:16, gate:["hasProject"],
    wb:7, days:2, bond:0.5, cooldown:35, work:0.18,
    blurb:"Everyone on the same job for a day, fed properly for it. The work goes faster and the day feels like something other than work.",
    lines:[
      "Everyone on the one job, and it went up faster than anyone expected.",
      "Somebody kept the food coming all day and nobody had to be asked twice.",
      "It got done, and it got done together, which is a different thing than getting done."
    ]
  }
];

/* Suggested names when the player makes a celebration into a tradition.
   They can type their own instead; these are just a starting shelf. */
const TRADITION_NAMES = {
  feast:      ["The Long Table","First Plenty","The Given Night","Enoughday"],
  bonfire:    ["The Burning","Longfire","The Standing Watch","Sparknight"],
  music:      ["The Singing","Songnight","The Old Words","Playing Out"],
  harvest:    ["Harvest Home","The Last Picking","Ingathering","Downtools"],
  remembrance:["The Naming","Remembrance","The Ones Before","Saying Aloud"],
  raising:    ["The Raising","All Hands","Workday","The Big Push"]
};

/* Lines for a tradition coming round again — {name} and {n} (times held). */
const TRADITION_LINES = [
  "{name} came round again, the {nth} time. Everyone knew what to do without being told.",
  "{name}, for the {nth} year. The children think it has always been this way.",
  "{name} again. Same day, same table, fewer of the same people.",
  "{name}, kept. It is starting to feel less like something the village decided and more like something the village is."
];
const TRADITION_MISSED = [
  "{name} should have been today. There wasn't enough to keep it with, so it went unmarked.",
  "The day of {name} came and went. People noticed. Nobody said much."
];

export { CELEBRATIONS, SCALES, TRADITION_LINES, TRADITION_MISSED, TRADITION_NAMES };
