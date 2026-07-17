/* data-events.js — story text and name pools.
   Plain strings only, plus {who, present, absent} variant objects where a
   line differs by whether a named character is in the village (the journal
   writer in day.js resolves these). Interpolated narrative lines built from
   live state stay with the logic that fires them. */

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

const CHILD_NAMES = ["Wren","Alder","Fen","Sorrel","Reed","Juniper","Hazel","Rook","Linnet","Tamsin","Bram","Vesper",
  "Sage","Briar","Marsh","Thistle","Cedar","Larkin","Moss","Sable","Aster","Fennel","Rye","Willow",
  "Clover","Ash","Merrow","Pike","Quill","Sorel","Teal","Yarrow"];

const CHILD_NOTES = [
  "Born in the village. Has never seen a working streetlight.",
  "Knows every path on the ridge before knowing how to read.",
  "Grew up thinking the turbine's hum was the sound of night.",
  "Learned to plant before learning to count."
];

const FORAGE_FLAVOR = {
  spring:"Fiddleheads, ramps, nettle tops, the first dandelion greens. Spring foraging is thin but bright — the woods are barely awake.",
  summer:"Berries, chanterelles, purslane, lambsquarters, green walnuts. High summer gives the most, if you know where to look.",
  autumn:"Acorns, hickory nuts, hen-of-the-woods, rose hips, the last apples gone wild. Autumn is the year's real harvest from the near country.",
  winter:"Bark, rose hips frozen sweet, cattail root, whatever the squirrels cached and forgot. Winter foraging is hungry work for little return."
};

/* FV — journal flavor-line pools, keyed by a founding visual's fx.journal id.
   Ambient text only; none of these change any number. Entries are plain
   strings, or {who, present, absent}: `who` names a character id, and the
   journal writer uses `present` when that character is in the village that
   day, `absent` otherwise. */
const FV={
  meadow:["The old highway is gold with grass. Somebody walked the median just to do it.",
          "Six lanes of little bluestem, going nowhere in particular."],
  mall:["Something silver moved in the mall atrium. Fish, or the light.",
        "The mall's skylights still work, which is the strangest thing about the mall."],
  orchard:["Someone counted the parking-lot trees again. Still forty. Still forty.",
           "The orchard rows run straight where the parking lines used to. Nobody planned that; it just happened."],
  tower:["The water tower caught the last of the light, and everyone looked up without deciding to.",
         "You can see the tower from every roof. Nobody gets lost here — and nobody misses us, either.",
         "Pressure in the lines all day and not a watt spent on it. The tower does the work standing still."],
  greenhouse:["Rain on the car-glass roofs, a sound like applause.",
              "The greenhouse panes are a hundred windshields. It's beautiful. It shouldn't be."],
  rail:["They walked the rail line to the bend and back. The rails go somewhere. Nobody's been.",
        "The rails are still bright on top. Something keeps them polished, and it isn't trains.",
        "Pulled a dozen spikes off the ballast. Good steel, and the grade walks itself."],
  vines:["The bittersweet took another few feet of the old high line. Beautiful. Impassable. Both.",
         "Marisol cut bittersweet for pack frames. The vine gives that much, at least, for what it takes."],
  mush:[{who:"halla",
     present:"The shaded logs were furred with new caps. Halla would know which. Halla always knows which.",
     absent:"The shaded logs were furred with new caps. Nobody was quite sure which were which, and ate carefully anyway."},
        "Dinner smelled like the forest floor, in the way that means good."],
  river:["The river ran high and brown and loud. It has opinions about where it lives now.",
         "The floodplain is the river's again, and the river is easy in it."],
  deer:["Deer in the gymnasium again. Nobody chases them out anymore. It's their gym.",
        "There are hoofprints on the free-throw line."],
  library:["Someone read aloud in the library at dusk. No one remembered starting the habit.",
           "The library roof holds. It will keep holding. This is not negotiable, apparently."],
  paths:["The path to the gardens is worn a hand deeper than last year. Feet remember.",
         "Every path here was made by somebody deciding, over and over, to go that way."],
  barrels:["Every gutter ran into a barrel, and every barrel sang a different note.",
           "The barrels were full by noon and nobody had to say anything about it."],
  bridge:["Somebody proposed fixing the bridge again. The long way around won, again.",
          "The long way around is four miles and worth it in October."],
  graffiti:["The moss took another letter off the overpass. Soon it will say something new.",
            "Whatever that wall used to shout, it murmurs now."],
  laundry:["Laundry between the dead streetlights, bright as signal flags.",
           "Sheets snapping in the wind all afternoon. Cheerful racket."],
  chapel:["The chapel is cool and dry and smells like a thousand summers of seed.",
          {who:"marisol",
     present:"Marisol sorted seed in the chapel with the door open, humming, off-key.",
     absent:"Someone sorted seed in the chapel with the door open, and left it better labeled than before."}],
  bees:["The courthouse hives were loud with foraging. First real flow of the season.",
        "Bees on the courthouse steps, conducting the only business there anymore."],
  stars:["The whole sky was out. Someone dragged a mattress up to look. Nobody worked late.",
         "All the stars are back — the ones the old light hid. There are so many more than anyone said."],
  bikes:[{who:"ilya",
     present:"Ilya trued a wheel by ear, spinning it, listening, tapping. Fixed before he could explain how.",
     absent:"Somebody trued a wheel by ear, spinning it, listening, tapping. Fixed before they could explain how."},
         "Four bicycles went out and four came back, which is not always how it goes.",
         "Another bearing gone. The bicycles are a promise the village keeps re-making."],
  reservoir:["The reservoir's down enough to see the old foundations. A town under the town.",
             "Whoever they were, down there under the water, they built square."],
  goats:["A cemetery goat got into the beds again. Ora negotiated. The goat won.",
         "The goats keep the cemetery better than anyone did before."],
  turbinehum:["The turbine hummed all night. Some sleep worse for it; most sleep better.",
              "You stop hearing the turbine after a month. Then one still night it stops, and you wake."],
  solarfound:["Someone kept that one rack of panels clean for years before anyone else showed up. It still works.",
              "The panel rack faces the wrong way for a proper array, but it catches the morning light, and that's enough."],
  antenna:["Kav ran the radio an hour after dark. Static, and once — xe swears — a chord.",
           "Nobody's answered the antenna in years. Kav still checks. That's the whole story."],
  fireweed:["The burn scar was pink to the horizon with fireweed. The ground remembers how to come back.",
            "Fireweed all up the burn. It only grows where something went badly first."]
};








export { CHILD_NAMES, CHILD_NOTES, FORAGE_FLAVOR, FV, STRANGER_NAMES, STRANGER_NOTES };
