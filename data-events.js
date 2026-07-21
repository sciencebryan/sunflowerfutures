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
  "Born here. Has never seen a working streetlight.",
  "Knew every path on the ridge before knowing how to read.",
  "Grew up falling asleep to the turbine's hum.",
  ""
];

const FORAGE_FLAVOR = {
  spring:"In the Spring, we find fiddlehead ferns, wild ramps, morel mushrooms, wild violets, spruce tips, maple samaras, all sorts of wild greens.",
  summer:"Summer brings blueberries, juneberries, raspberries, strawberries, chanterelle and chicken-of-the-woods mushrooms, purslane, lambsquarters, black cherries.",
  autumn:"Autumn brings acorns, hazelnuts, hickory nuts, black walnuts, hen-of-the-woods mushrooms, rose hips, apples, honey locust pods, wild grapes.",
  winter:"The inner bark of trees, what's left of the rose hips, jelly mushrooms, cattail root. It's hard to find much to eat in winter."
};

/* FV — journal flavor-line pools, keyed by a founding visual's fx.journal id.
   Ambient text only; none of these change any number. Entries are plain
   strings, or {who, present, absent}: `who` names a character id, and the
   journal writer uses `present` when that character is in the village that
   day, `absent` otherwise. */
const FV={
  meadow:["The old highway is gold with grass.",
          "Six lanes of little bluestem, going nowhere in particular."],
  mall:["",
        ""],
  orchard:["",
           ""],
  tower:["The water tower caught the last of the light.",
         "You can see the tower from every roof. Nobody gets lost here.",
         ""],
  greenhouse:["The sound of rain on the car-glass roofs.",
              "The greenhouse panes are a hundred windshields. It's oddly beautiful."],
  rail:["They walked the rail line to the bend and back.",
        "",
        "Pulled a dozen spikes off the ballast. Good steel, and the grade walks itself."],
  vines:["",
         "We cut bittersweet vines for cordage."],
  mush:[{who:"halla",
     present:"The shaded logs were furred with new caps. Halla would know which. Halla always knows which.",
     absent:"The shaded logs were furred with new caps. Nobody was quite sure which were which, and ate carefully anyway."},
        "Dinner smelled like the forest floor, in the way that means good."],
  river:["The river ran high and muddy and loud.",
         "The floodplain is the river's again."],
  deer:["Deer in the gymnasium again. Nobody chases them out anymore. It's their gym.",
        "There are hoofprints on the free-throw line."],
  library:["Someone read aloud in the library at dusk.",
           ""],
  paths:["The path to the gardens is worn deeper than last year.",
         "Every path here was made by somebody deciding, over and over, to go that way."],
  barrels:["",
           "The rainbarrels were full by noon."],
  bridge:["",
          ""],
  graffiti:["",
            ""],
  laundry:["Laundry hung between the dead streetlights, its own kind of banner.",
           "Sheets snapping in the wind all afternoon."],
  chapel:["The chapel is cool and dry and smells like a thousand summers of seed.",
          {who:"marisol",
     present:"Marisol sorted seed in the chapel with the door open, humming, off-key.",
     absent:"Someone sorted seed in the chapel with the door open."}],
  bees:["The courthouse hives were loud with foraging. First real flow of the season.",
        "Bees on the courthouse steps, conducting business."],
  stars:["We had an impromptu star-gazing party. Someone taught the constellations.",
         "All the stars are back — the ones the old city lights hid."],
  bikes:[{who:"ilya",
     present:"Ilya trued a wheel by ear, spinning it, listening, tapping. Fixed before he could explain how.",
     absent:"Somebody trued a wheel by ear, spinning it, listening, tapping. Fixed before they could explain how."},
         "",
         ""],
  reservoir:["The reservoir's down enough to see the old foundations. A town under the town.",
             "Whoever they were, down there under the water, they built square."],
  goats:["A cemetery goat got into the beds again. Ora negotiated. The goat won.",
         "The goats keep the cemetery as well as anyone did before."],
  turbinehum:["The turbine hummed all night. Some sleep worse for it; most sleep better.",
              "You stop hearing the turbine after a month. Then one still night it stops, and you wake."],
  solarfound:["Someone kept that one rack of panels clean for years before anyone else showed up. It still works.",
              "The panel rack faces the wrong way for a proper array, but it catches the morning light."],
  antenna:["Kav ran the radio an hour after dark. Static, and once — xe swears — a chord.",
           "Nobody's answered the antenna in years. Kav still checks."],
  fireweed:["The burn scar was pink to the horizon with fireweed.",
            "Fireweed all up the burn. It only grows where something went badly first."]
};








export { CHILD_NAMES, CHILD_NOTES, FORAGE_FLAVOR, FV, STRANGER_NAMES, STRANGER_NOTES };
