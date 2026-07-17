/* data-puzzles.js — puzzle content: levels, pieces, shapes, seed types,
   and clear rewards. Checkers/solvers stay in puzzles.js; UI in puzzle-ui.js.
   vly() lives here because it is a level-authoring helper (it generates the
   watershed valley edge rows) and levels are defined in terms of it. */

/* ============================================================
   PUZZLES — circuit salvage & watershed
   Solve to unlock: puzzles are keys, not faucets.
   ============================================================ */

/* ---------- CIRCUIT SALVAGE ----------
   A dead board. Route current from the source to each load.
   Current SUMS on shared cells. Every cell has a rating.
   Over the rating, it burns. Parallel routes cost you cells.
   Later levels: capacity is insufficient. Choose who goes dark. */

const CIRCUIT_LEVELS = [
  { n:1, w:5, h:3, src:[0,1], srcMax:9, teach:"Trace a line from the bus to the pump, around the dead cells.",
    loads:[{p:[4,1],amps:4,name:"pump",req:true}], caps:null, blocked:[[2,0],[2,2]] },
  { n:2, w:5, h:4, src:[0,1], srcMax:12, teach:"The middle is thin here. Each row of it holds only so much — put each load on its own.",
    loads:[{p:[4,0],amps:4,name:"lights",req:true},{p:[4,3],amps:5,name:"pump",req:true}],
    caps:{"2,0":4,"2,1":4,"2,2":5,"2,3":5}, blocked:[[0,0],[0,3],[1,0],[1,3],[3,1],[3,2],[4,1],[4,2]] },
  { n:3, w:6, h:4, src:[0,1], srcMax:16, teach:"Two can share a row, if what they carry together still fits it.",
    loads:[{p:[5,0],amps:3,name:"lights",req:true},{p:[5,1],amps:3,name:"aerator",req:true},{p:[5,3],amps:5,name:"pump",req:true}],
    caps:{"2,0":6,"2,1":6,"2,2":6,"2,3":5}, blocked:[[1,2]] },
  { n:4, w:7, h:4, src:[0,1], srcMax:12, teach:"Not everything you could power is worth trying to power. Some paths just don't exist, no matter the budget.",
    loads:[{p:[6,1],amps:6,name:"pump",req:true},{p:[6,3],amps:4,name:"aerator",req:true},
           {p:[6,2],amps:4,name:"heater",req:false},{p:[2,0],amps:2,name:"lights",req:false}],
    caps:{"3,1":6,"3,3":6}, blocked:[[3,0],[3,2]] },
  { n:5, w:7, h:5, src:[0,2], srcMax:20, teach:"Four loads, one crossing. Every row has to earn its keep.",
    loads:[{p:[6,0],amps:3,name:"lights",req:true},{p:[6,1],amps:3,name:"aerator",req:true},
           {p:[6,3],amps:4,name:"heater",req:true},{p:[6,4],amps:4,name:"pump",req:true}],
    caps:{"3,0":6,"3,1":6,"3,2":8,"3,3":6,"3,4":6}, blocked:[] },
  { n:6, w:6, h:4, src:[0,0], srcMax:14, teach:"A thin board. Everything wants through the middle.",
    loads:[{p:[5,0],amps:3,name:"lights",req:true},{p:[5,2],amps:4,name:"pump",req:true},{p:[5,3],amps:3,name:"aerator",req:true}],
    caps:{"2,0":4,"2,1":4,"2,2":5,"2,3":5,"3,1":6}, blocked:[[1,1],[4,1]] },
  // --- the relay. A relay sits in a doorway the current MUST pass through, and it
  //     only wakes if enough amps cross it at once — so routing through it isn't a
  //     trick, it's the single path to the loads on the far side. ---
  { n:7, w:6, h:4, src:[0,1], srcMax:15,
    teach:"New part: a relay (the amber cell). Nothing reaches past it until enough current wakes it — and once it's awake, the current still has to go somewhere the board allows.",
    loads:[{p:[5,0],amps:4,name:"lights",req:true},{p:[5,3],amps:5,name:"pump",req:true}],
    caps:{"2,1":10,"3,0":5,"3,3":6}, blocked:[[2,0],[2,2],[2,3]], junctions:{"2,1":8} },
  { n:8, w:7, h:5, src:[0,2], srcMax:19,
    teach:"The relay again, and a load that would be nice to have. Wake the door, then decide what you can still afford.",
    loads:[{p:[6,0],amps:4,name:"lights",req:true},{p:[6,4],amps:5,name:"pump",req:true},{p:[6,2],amps:6,name:"heater",req:false}],
    caps:{"3,2":11,"3,0":5,"3,4":6}, blocked:[[3,1],[3,3]], junctions:{"3,2":9} }
];

/* ---------- WATERSHED ----------
   Rain falls. Water runs downhill. Beds want a range — too much
   drowns them. A channel that carries too much scours the land,
   and the scour is still there next season. */

const WATER_PIECES = {
  channel:{name:"Channel", blurb:"Cuts a run. Sends all its water one way, downhill. Scours if overloaded."},
  swale:  {name:"Swale",   blurb:"On contour. Drinks 4, passes the rest."},
  cistern:{name:"Cistern", blurb:"Holds up to 8 for the dry weeks."},
  berm:   {name:"Berm",    blurb:"Raises the ground 3. Water goes around."}
};

function vly(W,H,drop){ const e=[]; const mid=(H-1)/2;
  for(let y=0;y<H;y++){ const r=[]; for(let x=0;x<W;x++) r.push(Math.round((W+drop) - x + Math.abs(y-mid)*2)); e.push(r); } return e; }

const WATER_LEVELS = [
  { n:1, w:5, h:4, rain:1, teach:"Water runs downhill and spreads. A channel sends it all one way instead.",
    elev:vly(5,4,7), beds:[{p:[4,0],min:7,max:15}], budget:{channel:3}, cisternTarget:0 },
  { n:2, w:5, h:4, rain:2, teach:"A berm raises the ground. Water goes around it — or stays where you want it.",
    elev:vly(5,4,7), beds:[{p:[4,0],min:7,max:15},{p:[4,3],min:7,max:15}], budget:{channel:4,berm:4}, cisternTarget:0 },
  { n:3, w:6, h:4, rain:6, teach:"Too much water drowns a bed. A swale drinks four and passes the rest.",
    elev:vly(6,4,7), beds:[{p:[5,0],min:9,max:11}], budget:{channel:4,berm:3,swale:2}, cisternTarget:0 },
  { n:4, w:6, h:4, rain:4, teach:"Two beds, one supply. Neither may go thirsty, neither may drown.",
    elev:vly(6,4,7), beds:[{p:[5,0],min:10,max:15},{p:[5,3],min:10,max:15}], budget:{channel:5,berm:4,swale:2}, cisternTarget:0 },
  { n:5, w:6, h:5, rain:4, teach:"Store what the beds don't need. The dry weeks are coming.",
    elev:vly(6,5,7), beds:[{p:[5,0],min:7,max:14}], budget:{channel:4,berm:3,swale:2,cistern:2}, cisternTarget:8 },
  { n:6, w:7, h:5, rain:6, scour:true, teach:"A storm year. A channel carrying more than 9 scours the soil away. Slow the water before you move it.",
    elev:vly(7,5,7), beds:[{p:[6,0],min:8,max:14},{p:[6,4],min:8,max:14}],
    budget:{channel:6,berm:5,swale:4,cistern:2}, cisternTarget:10 },
  { n:7, w:6, h:5, rain:5, scour:true, teach:"Tighter windows now. Every bed wants nearly exactly what it gets.",
    elev:vly(6,5,7), beds:[{p:[5,0],min:9,max:12},{p:[5,4],min:9,max:12}],
    budget:{channel:5,berm:4,swale:3,cistern:2}, cisternTarget:8 },
  { n:8, w:7, h:4, rain:6, scour:true, teach:"A wide shallow slope and a lot of rain. Nothing wants to stay where you put it.",
    elev:vly(7,4,7), beds:[{p:[6,0],min:10,max:14},{p:[6,3],min:10,max:14},{p:[3,0],min:6,max:10}],
    budget:{channel:6,berm:5,swale:4,cistern:2}, cisternTarget:10 },
  { n:9, w:7, h:5, rain:7, scour:true, teach:"The last season. Three beds, a flood year, and soil that remembers every mistake.",
    elev:vly(7,5,7), beds:[{p:[6,0],min:9,max:13},{p:[6,4],min:9,max:13},{p:[0,0],min:6,max:11}],
    budget:{channel:7,berm:6,swale:5,cistern:3}, cisternTarget:12 }
];

/* ================= seed frame (third puzzle) =================
   A sorting/germination frame. Each cell has a light value (0-3) from where
   it sits under the eaves. Each seed type wants a light range. Some seeds are
   companions (must sit next to at least one of their partner) and some are
   rivals (must never sit orthogonally adjacent). Fill every marked slot,
   honour light, companions, and rivals. Constraint satisfaction — a different
   shape of thinking from routing (circuit) or flow (water).             */

const SEEDLINGS = {
  bean:   {name:"Beans",   glyph:"◗", light:[2,3]},
  corn:   {name:"Corn",    glyph:"↑", light:[2,3]},
  squash: {name:"Squash",  glyph:"❍", light:[1,3]},
  root:   {name:"Roots",   glyph:"▼", light:[0,2]},
  herb:   {name:"Herbs",   glyph:"✦", light:[1,3]},
  bramble:{name:"Bramble", glyph:"※", light:[0,2]}
};

/* companion / rival pairs (order-independent) */
const SEED_COMPANION = [["bean","corn"],["squash","corn"],["herb","root"]];

const SEED_RIVAL     = [["bean","herb"],["bramble","corn"],["bramble","squash"],["root","bramble"]];

/* Levels: `slots` are the cells to fill, each {p:[x,y], light}. `supply` is
   how many of each seed you have. Solvable states honour every constraint. */
const SEED_LEVELS = [
  { n:1, w:3, h:2, teach:"Every seed wants the right light. Match each to a cell it can live in.",
    slots:[{p:[2,0],light:2},{p:[0,1],light:0},{p:[1,1],light:3},{p:[2,1],light:2}],
    supply:{bean:1, root:1, herb:1, bramble:1} },
  { n:2, w:3, h:2, teach:"You have a seed to spare \u2014 light alone won't tell you where each goes.",
    slots:[{p:[2,1],light:0},{p:[1,0],light:1},{p:[1,1],light:3},{p:[0,0],light:2}],
    supply:{root:1, bramble:1, herb:2, bean:1} },
  { n:3, w:3, h:3, teach:"Bramble crowds out corn and squash. Never seat them side by side.",
    slots:[{p:[0,1],light:1},{p:[2,2],light:1},{p:[1,0],light:2},{p:[1,2],light:3},{p:[2,0],light:3}],
    supply:{bramble:2, squash:1, herb:1, bean:2} },
  { n:4, w:3, h:3, teach:"Beans and corn lean on each other. Set friends as neighbours.",
    slots:[{p:[1,1],light:0},{p:[2,1],light:2},{p:[0,0],light:0},{p:[0,2],light:2},{p:[1,2],light:2},{p:[2,0],light:1}],
    supply:{bramble:4, root:1, squash:1, bean:1} },
  { n:5, w:4, h:3, teach:"Herbs want roots beside them; beans can't abide herbs. Both at once.",
    slots:[{p:[2,0],light:3},{p:[1,1],light:3},{p:[2,2],light:3},{p:[0,0],light:2},{p:[3,0],light:3},{p:[2,1],light:0}],
    supply:{herb:1, squash:4, bean:2, root:1} },
  { n:6, w:4, h:3, teach:"A fuller frame. Light, friends, and rivals all pulling at the same cells.",
    slots:[{p:[3,0],light:2},{p:[0,1],light:1},{p:[0,2],light:1},{p:[1,0],light:1},{p:[3,1],light:2},{p:[1,2],light:3},{p:[1,1],light:2}],
    supply:{herb:2, root:4, bramble:2, bean:1} },
  { n:7, w:4, h:3, teach:"Bramble everywhere it isn't welcome. Thread the friendly seeds around it.",
    slots:[{p:[0,2],light:1},{p:[1,0],light:1},{p:[1,1],light:2},{p:[1,2],light:2},{p:[0,1],light:0},{p:[3,0],light:3},{p:[3,1],light:1},{p:[2,1],light:3}],
    supply:{bramble:4, bean:4, herb:2} },
  { n:8, w:4, h:4, teach:"The seed library's hardest frame. Every rule, every cell, all agreeing.",
    slots:[{p:[1,1],light:3},{p:[2,3],light:3},{p:[0,3],light:0},{p:[3,1],light:2},{p:[3,0],light:2},{p:[1,0],light:2},{p:[0,0],light:0},{p:[2,2],light:2},{p:[1,2],light:3}],
    supply:{squash:2, bramble:3, bean:2, root:3, herb:1} },
];

/* ============================================================
   SIGNAL — tuning the antenna
   Additive field placement. Each node broadcasts +1 signal to its own cell
   and the four cells orthogonally next to it; overlapping fields add. Every
   receiver must land on its exact target — no more, no less — inside a hard
   node budget. A genuinely different shape of thinking from the other three:
   not routing, not flow, not supply-and-adjacency, but overlapping coverage
   under an exact-match constraint.
   ============================================================ */
const SIGNAL_LEVELS = [
  { n:1, w:4, h:3, teach:"The valley radio. A node broadcasts +1 to itself and the four cells around it. Match the receiver exactly.",
    receivers:[{x:2,y:1,v:1}], blocked:[], budget:1 },
  { n:2, w:4, h:4, teach:"Fields add. This receiver needs 2 — two nodes have to reach it.",
    receivers:[{x:1,y:1,v:2}], blocked:[[1,1]], budget:2 },
  { n:3, w:5, h:4, teach:"Two voices now, and a strut in the way — nodes can't sit on a receiver or a blocked cell.",
    receivers:[{x:1,y:1,v:2},{x:3,y:2,v:1}], blocked:[[1,1],[3,2],[2,2]], budget:3 },
  { n:4, w:5, h:5, teach:"The static is thick here. A lot of signal into a tight space.",
    receivers:[{x:2,y:2,v:4}], blocked:[[2,2],[0,0],[4,4]], budget:4 },
  { n:5, w:6, h:5, teach:"Long distance tuning. A node in the right spot can serve two receivers at once.",
    receivers:[{x:1,y:2,v:2},{x:3,y:2,v:2},{x:5,y:0,v:1}], blocked:[[1,1],[3,1]], budget:4 },
  { n:6, w:7, h:5, teach:"The last frequency. Every node has to pull double duty to reach this far.",
    receivers:[{x:1,y:2,v:2},{x:3,y:2,v:3},{x:5,y:2,v:2}], blocked:[[3,1]], budget:5 }
];

/* ============================================================
   PATCHWORK — insulation & sealing
   Polyomino packing. Cover every leak cell with a supply of fixed-shape
   patches; nothing may overlap another patch or a load-bearing strut. A
   spatial-fit puzzle, unlike anything else on the bench.
   ============================================================ */
const PATCH_SHAPES = {
  p1:{name:"1×1 patch", pts:[[0,0]]},
  h2:{name:"2×1 strip",  pts:[[0,0],[1,0]]},
  v2:{name:"1×2 strip",  pts:[[0,0],[0,1]]},
  h3:{name:"3×1 strip",  pts:[[0,0],[1,0],[2,0]]},
  v3:{name:"1×3 strip",  pts:[[0,0],[0,1],[0,2]]},
  sq:{name:"2×2 tarp",   pts:[[0,0],[1,0],[0,1],[1,1]]},
  corner:{name:"Corner", pts:[[0,0],[1,0],[0,1]]},
  tee:{name:"T-patch",   pts:[[0,0],[1,0],[2,0],[1,1]]},
  tee2:{name:"L T-patch", pts:[[0,1],[1,0],[1,1],[1,2]]},
  tee3:{name:"U T-patch", pts:[[0,1],[1,0],[1,1],[2,1]]},
  tee4:{name:"R T-patch", pts:[[0,0],[0,1],[1,1],[0,2]]},
  corner2:{name:"UR Corner", pts:[[0,0],[1,0],[1,1]]},
  corner3:{name:"LL Corner", pts:[[0,0],[0,1],[1,1]]},
  corner4:{name:"LR Corner", pts:[[0,1],[1,0],[1,1]]}
};

// add this near your other data structures
const PATCH_VARIANTS = {
  h2: ['h2', 'v2'],
  v2: ['v2', 'h2'],
  h3: ['h3', 'v3'],
  v3: ['v3', 'h3'],
  tee: ['tee', 'tee2', 'tee3', 'tee4'],
  tee2: ['tee2', 'tee3', 'tee4', 'tee'],
  tee3: ['tee3', 'tee4', 'tee', 'tee2'],
  tee4: ['tee4', 'tee', 'tee2', 'tee3'],
  corner: ['corner', 'corner2', 'corner3', 'corner4'],
  corner2: ['corner2', 'corner3', 'corner4', 'corner'],
  corner3: ['corner3', 'corner4', 'corner', 'corner2'],
  corner4: ['corner4', 'corner', 'corner2', 'corner3'],
  p1: ['p1'],
  sq: ['sq']
};

const PATCH_LEVELS = [
  { n:1, leftoverGoal: 1, w:4, h:3, teach:"The catchment tank has a crack. Cover the gap completely — patches can't overlap.",
    leaks:[[1,1],[2,1]], blocked:[[0,0],[3,2]], supply:{h2:1, p1:1} },
  { n:2, leftoverGoal: 2, w:4, h:4, teach:"Struts, the dark cells, are load-bearing. You can't patch over them.",
    leaks:[[1,1],[1,2],[2,2]], blocked:[[0,1],[2,1],[3,1]], supply:{corner:1, v2:1, p1:1} },
  { n:3, leftoverGoal: 2, w:5, h:4, teach:"A shattered greenhouse pane. Every hole sealed, nothing hangs off the frame.",
    leaks:[[1,1],[2,1],[3,1],[2,2],[2,3]], blocked:[[0,0],[4,0],[0,3],[4,3]], supply:{h3:1, v2:1, p1:2} },
  { n:4, leftoverGoal: 0, w:5, h:5, teach:"The commons roof. Not pretty — tight.",
    leaks:[[1,1],[2,1],[3,1],[1,2],[2,2],[3,2],[1,3],[2,3],[3,3],[1,4]], blocked:[[4,1],[4,4]], supply:{sq:1, v3:2} },
  { n:5, leftoverGoal: 0, w:6, h:4, teach:"The old pipes. Long runs, awkward gaps, rust in the way.",
    leaks:[[0,1],[1,1],[2,1],[3,1],[4,1],[5,1],[2,2],[3,2],[2,3],[3,3],[1,2]], blocked:[[1,0],[5,3]], supply:{h3:2, sq:1, p1:1} },
  { n:6, leftoverGoal: 4, w:6, h:5, teach:"The worst draft in the sickbed. Every scrap of patch, no gaps left.",
    leaks:[[1,1],[2,1],[4,1],[1,2],[2,2],[3,2],[4,2],[1,3],[2,3],[4,3]], blocked:[[3,1],[3,3]], supply:{sq:2, h2:3, corner:1} },
  { n:7, leftoverGoal: 0, w:4, h:4, teach:"silly geese", leaks:[[1,1],[1,2],[2,1],[2,2],[1,0],[2,0]], blocked:[], supply:{tee:2, }},
  { n:8, leftoverGoal: 3, w:6, h:6, teach:"silly geese", leaks:[[1,1],[2,1],[3,1],[4,1],[1,2],[2,2],[3,2],[4,2],[1,3],[2,3],[3,3],[4,3],[1,4],[2,4],[3,4],[4,4]], blocked:[], supply:{sq:1, h3:5}},
  { n:9, leftoverGoal: 1, w:6, h:6, teach:"silly geese", leaks:[[1,1],[2,1],[3,1],[4,1],[1,2],[2,2],[3,2],[4,2],[1,3],[2,3],[3,3],[4,3],[1,4],[2,4],[3,4],[4,4]], blocked:[], supply:{tee:4, p1:1}},
  { n:10, leftoverGoal: 2, w:6, h:4, teach:"silly geese", leaks:[[3,1],[2,2],[3,2],[4,2],[1,3],[2,3],[3,3],[4,3],[5,3]], blocked:[], supply:{tee:1, corner:2, v2:1}},
  { n:11, leftoverGoal: 3, w:6, h:6, teach:"silly geese", leaks:[[1,1],[2,1],[1,2],[2,2],[3,2],[2,3],[3,3],[4,3],[2,4]], blocked:[], supply:{tee:1, corner:2, sq:1}}

];

/* ============================================================
   FOCUS — heliostat calibration
   Laser-reflection routing. Toggle mirrors between / and \ to bounce a beam
   of light from the source to the collector around ruined struts, inside a
   hard mirror budget. A path-tracing puzzle — closest in feel to circuit
   salvage, but the beam bounces instead of branching, and every cell only
   ever holds one piece of state.
   ============================================================ */
const FOCUS_LEVELS = [
  { n:1, w:4, h:4, teach:"The old heliostat field. Bounce the light from the sun tracker (☀) to the boiler (▣).",
    src:{x:0,y:3,dir:"E"}, target:{x:3,y:0}, blocked:[], budget:2 },
  { n:2, w:5, h:4, teach:"Tap a mirror to cycle it. Routing around a block costs more glass than routing along open ground.",
    src:{x:0,y:2,dir:"E"}, target:{x:4,y:2}, blocked:[[2,2]], budget:3 },
  { n:3, w:5, h:5, teach:"Work around the ruined struts. The light has to pass clear.",
    src:{x:1,y:4,dir:"N"}, target:{x:3,y:4}, blocked:[[1,2],[3,2],[2,1]], budget:3 },
  { n:4, w:6, h:5, teach:"A longer throw. Light loses nothing over distance, but glass is short.",
    src:{x:0,y:0,dir:"S"}, target:{x:5,y:0}, blocked:[[2,3],[3,3],[2,2],[3,2]], budget:4 },
  { n:5, w:6, h:6, teach:"The final array. Two clean bends, if you find the right corner.",
    src:{x:0,y:1,dir:"E"}, target:{x:5,y:4}, blocked:[[4,1],[1,3],[0,4],[4,3]], budget:3 }
];

/* ================= WORKS: puzzle UI ================= */
const CIRCUIT_REWARD = {
  2:{parts:5, desc:"the first boards give up their good components: +5 parts"},
  4:{parts:6, flag:"gridTuned", desc:"the whole grid rewired: +6 parts, and the village draws 1 less power, forever"},
  6:{parts:8, flag:"fineTools", desc:"+8 parts, and the bench earns fine tools: projects go 10% faster"},
  8:{parts:10, flag:"relayGrid", desc:"the relay boards mastered: +10 parts, and the grid self-balances — systems wear 10% slower"}
};

const WATER_REWARD = {
  2:{flag:"contourBeds", desc:"the first works are cut into the real beds: every harvest comes in 15% heavier"},
  4:{flag:"cutCistern", desc:"a cistern cut into the hill: water storage +12"},
  6:{flag:"keyline", desc:"the keyline: gardens drink less and yield more"},
  9:{seeds:10, flag:"terraces", desc:"terraces on the south slope: a third garden bed, and +10 seeds"}
};

const SEED_REWARD = {
  2:{seeds:6, desc:"a drawer of sorted seed: +6 seeds"},
  4:{crop:"turnip", desc:"a new crop for the beds: turnips, quick and frost-hardy"},
  6:{crop:"sunflower", desc:"a new crop: sunflowers, for oil and for spirits"},
  8:{crop:"amaranth", seeds:8, flag:"seedLibrary", desc:"the seed library opens: amaranth to plant, +8 seeds, and every crop keeps a little better"}
};

const SIGNAL_REWARD = {
  2:{parts:4, desc:"a clean signal, twice: +4 parts off a channel that used to be static"},
  4:{scrap:6, parts:3, desc:"the band's mapped past the near static: +6 scrap, +3 parts"},
  6:{flag:"radioContact", desc:"the antenna reaches someone who reaches back — the road doesn't end at the maps anymore. Word of this place travels now, on its own, the way it always should have."}
};

const PATCH_REWARD = {
  2:{flag:"sealedTanks", desc:"the catchment tanks are sealed tight: catchment gathers 20% more water"},
  4:{flag:"draftProof", desc:"the commons and sickbed are draft-proofed: illness is a little rarer"},
  6:{scrap:15, parts:5, desc:"the last of the big drafts sealed, leaving a pile of good surplus materials: +15 scrap, +5 parts"}
};

const FOCUS_REWARD = {
  2:{flag:"silveredPanels", desc:"the arrays are realigned and silvered: solar generates 20% more power"},
  4:{flag:"thermalStore", desc:"a thermal mass tank is plumbed in: the panels give a baseline trickle of power even in the rain"},
  5:{parts:12, scrap:20, desc:"the field is fully calibrated, yielding a haul of spare tracking motors: +12 parts, +20 scrap"}
};




/* ============================================================
   THE WATER MAINS (pipes) — rotate the buried junctions until
   every standpipe is fed and nothing spills. Each solved main
   cuts water transmission loss (see LOSS dials in data-economy).
   cells: row-major; "." empty, I straight, L elbow, T junction,
   X cross, S source, K standpipe (sink). rotations 0-3 = N,E,S,W
   of each piece's reference opening. start must not equal sol.
   ============================================================ */
const PIPES_LEVELS = [
  {n:1, teach:"The first main is three fittings in a trench. Turn them until the water has one road and no doors left open.",
   w:3, h:1,
   cells:["S","I","K"],
   sol:  [1,1,3],
   start:[0,0,0]},
  {n:2, teach:"A bend around the old foundation. Water doesn't mind corners — it minds gaps.",
   w:3, h:2,
   cells:["S","I","L",
          "K","I","L"],
   sol:  [1,1,2,
          1,1,3],
   start:[0,0,0, 0,3,1]},
  {n:3, teach:"The first junction. A tee splits one line into two, and both standpipes have to drink.",
   w:3, h:3,
   cells:[".","S",".",
          "K","T","K",
          ".",".","."],
   sol:  [0,2,0,
          1,0,3,
          0,0,0],
   start:[0,0,0, 0,2,0, 0,0,0]},
  {n:4, teach:"A four-way buried under the square. Every face of the cross must answer to something.",
   w:4, h:3,
   cells:[".","K",".",".",
          "S","X","I","K",
          ".","K",".","."],
   sol:  [0,2,0,0,
          1,0,1,3,
          0,0,0,0],
   start:[0,0,0,0, 0,0,0,1, 0,1,0,0]},
  {n:5, teach:"Three standpipes off one source, with dead stock still in the trench. Feed what's live; what isn't connected can stay crooked.",
   w:5, h:3,
   cells:["S",".","K",".","I",
          "L","T","T","L",".",
          ".","K",".","K","L"],
   sol:  [2,0,2,0,0,
          0,2,0,2,0,
          0,0,0,0,0],
   start:[0,0,0,0,0, 1,0,1,0,0, 0,2,0,1,0]},
  {n:6, teach:"The whole quarter at once: a cross at the heart, tees on the arms, four standpipes. The main is only done when nothing anywhere spills.",
   w:5, h:4,
   cells:[".","K",".","K",".",
          "S","T","T","L",".",
          ".",".","I",".",".",
          ".",".","K",".","."],
   sol:  [0,2,0,2,0,
          1,0,2,3,0,
          0,0,0,0,0,
          0,0,0,0,0],
   start:[0,0,0,0,0, 0,0,1,0,0, 0,0,1,0,0, 0,1,0,0,0]}
];

const PIPES_REWARD = {
  1:{desc:"water loss in the mains drops by a third of what remains"},
  2:{desc:"water loss drops again — the trench by the foundation stops weeping"},
  3:{desc:"water loss drops again — the first junction seals true"},
  4:{desc:"water loss drops again — the square stops going soft after rain"},
  5:{desc:"water loss drops again — the dead stock is cut out of the line"},
  6:{desc:"the mains run almost tight — only a trace is lost underground now"}
};

/* ============================================================
   THE LINE RUN (wires) — place salvaged junction boards to carry
   current from the source to the load. Each board face has two
   posts per side (8 posts, numbered clockwise from top-left:
   0 TL, 1 TR, 2 right-upper, 3 right-lower, 4 BR, 5 BL,
   6 left-lower, 7 left-upper). A wire joins two posts; a board
   may carry several wires but they never touch (no junctions).
   Colors must match across every joint. 90° cw turns post n into
   (n+2)%8. Each solved run cuts power transmission loss.
   inv: available boards; sol: a known solution (placements).
   ============================================================ */
const WIRES_LEVELS = [
  {n:1, teach:"One board between the source and the load. Line the posts up and the current does the rest.",
   w:3, h:1, blocks:[],
   srcs: [{x:0,y:0,node:2,c:"k"}],
   sinks:[{x:2,y:0,node:7,c:"k"}],
   inv:[{name:"straight", wires:[{c:"k",a:7,b:2}], count:1}],
   sol:[{x:1,y:0,inv:0,rot:0}]},
  {n:2, teach:"The load sits a row over. Current climbs where you give it a post to climb to.",
   w:3, h:2, blocks:[[0,0],[2,1]],
   srcs: [{x:0,y:1,node:2,c:"k"}],
   sinks:[{x:2,y:0,node:7,c:"k"}],
   inv:[{name:"riser",  wires:[{c:"k",a:7,b:1}], count:1},
        {name:"step",   wires:[{c:"k",a:4,b:2}], count:1}],
   sol:[{x:1,y:1,inv:0,rot:0},{x:1,y:0,inv:1,rot:0}]},
  {n:3, teach:"Two circuits, one trench. A board carries two wires at once — they share the tile and never touch.",
   w:3, h:2, blocks:[],
   srcs: [{x:0,y:0,node:2,c:"k"},{x:0,y:1,node:2,c:"k"}],
   sinks:[{x:2,y:0,node:7,c:"k"},{x:2,y:1,node:7,c:"k"}],
   inv:[{name:"double straight", wires:[{c:"k",a:7,b:2},{c:"k",a:6,b:3}], count:2}],
   sol:[{x:1,y:0,inv:0,rot:0},{x:1,y:1,inv:0,rot:0}]},
  {n:4, teach:"Red rides with black now, and the runs cross. Colors never mix: red posts to red, black to black, even on a shared board.",
   w:3, h:2, blocks:[],
   srcs: [{x:0,y:0,node:2,c:"k"},{x:0,y:1,node:2,c:"r"}],
   sinks:[{x:2,y:1,node:7,c:"k"},{x:2,y:0,node:7,c:"r"}],
   inv:[{name:"weave down", wires:[{c:"k",a:7,b:4},{c:"r",a:5,b:2}], count:1},
        {name:"weave up",   wires:[{c:"k",a:1,b:2},{c:"r",a:7,b:0}], count:1}],
   sol:[{x:1,y:0,inv:0,rot:0},{x:1,y:1,inv:1,rot:0}]},
  {n:5, teach:"The long way around the substation slab. Boards turn — a straight stood on end is a riser — and only one route fits the boards you have.",
   w:4, h:3, blocks:[[2,0],[2,1]],
   srcs: [{x:0,y:0,node:2,c:"k"}],
   sinks:[{x:3,y:2,node:7,c:"k"}],
   inv:[{name:"straight", wires:[{c:"k",a:7,b:2}], count:2},
        {name:"drop",     wires:[{c:"k",a:7,b:4}], count:1},
        {name:"elbow",    wires:[{c:"k",a:1,b:2}], count:1}],
   sol:[{x:1,y:0,inv:1,rot:0},{x:1,y:1,inv:0,rot:1},{x:1,y:2,inv:2,rot:0},{x:2,y:2,inv:0,rot:0}]}
];

const WIRES_REWARD = {
  1:{desc:"power loss in the lines drops by a third of what remains"},
  2:{desc:"power loss drops again — the climb to the ridge stops bleeding current"},
  3:{desc:"power loss drops again — the shared trench carries clean"},
  4:{desc:"power loss drops again — red and black each keep their own"},
  5:{desc:"the lines run almost tight — only a trace is lost between the turbine and the table"}
};


/* ============================================================
   PICROSS / SPECTRAL SCANS
   ============================================================ */

// The library of puzzle layouts (1 = filled, 0 = empty)
const PICROSS_LEVELS = [
  {
    n: 1, 
    teach: "Resolve LIDAR interference to map the heavy tool cache.",
    parts: 5,
    rewardText: "You recovered a cache of heavy tools! +5 parts.",
    grid: [
      [0,0,0,0,0,0,1,1,1,0,0,1,1,1,0,0],
      [0,0,0,0,0,1,1,0,0,0,1,1,1,0,0,0],
      [0,0,0,1,1,1,0,0,0,0,1,1,0,0,0,0],
      [0,0,1,1,1,1,0,0,0,0,1,1,0,0,0,1],
      [0,0,1,1,1,1,1,0,0,0,1,1,1,1,1,1],
      [1,1,1,1,1,1,1,0,0,1,1,1,1,1,1,0],
      [1,1,1,0,0,1,1,1,1,1,1,1,1,1,0,0],
      [1,1,0,0,0,0,1,1,1,1,1,0,0,0,0,0],
      [0,0,0,0,0,0,1,1,1,1,0,0,0,0,0,0],
      [0,0,0,0,0,1,1,1,1,1,1,0,0,0,0,0],
      [0,0,0,0,1,1,1,1,0,1,1,1,0,0,0,0],
      [0,0,0,1,1,1,1,0,0,0,1,1,1,0,0,0],
      [0,0,1,1,1,1,0,0,0,0,0,1,1,1,0,0],
      [0,1,1,1,1,0,0,0,0,0,0,0,1,1,1,0],
      [1,1,0,1,0,0,0,0,0,0,0,0,0,1,1,1],
      [1,1,1,0,0,0,0,0,0,0,0,0,0,0,1,1]
       

    ]
  },
 {
    n:2, 
    teach: "Do some stuff",
    parts:5,
    rewardText: "You got some stuff.",
    grid: [
 [0,0,0,0,0,0,0,1,1,0,0,0,0,0,0,0],
[0,0,0,0,1,1,1,1,1,1,1,1,0,0,0,0],
[0,0,1,1,0,0,0,1,1,0,0,0,1,1,0,0],
[0,0,1,1,1,1,0,0,0,0,0,0,1,1,0,0],
[0,0,1,0,0,1,1,1,1,1,1,1,1,1,0,0],
[0,0,1,0,0,0,0,0,0,0,0,0,0,1,0,0],
[0,0,1,1,1,0,0,0,0,0,0,0,1,1,0,0],
[0,0,1,0,1,1,1,1,1,1,1,1,1,1,0,0],
[0,0,1,0,0,0,0,0,0,0,1,0,0,1,0,0],
[0,0,1,0,0,0,0,0,0,1,1,0,0,1,0,0],
[0,0,1,0,0,0,0,0,1,1,0,0,0,1,0,0],
[0,0,1,0,0,0,0,1,1,0,0,0,0,1,0,0],
[0,0,1,0,0,0,1,1,0,0,0,0,0,1,0,0],
[0,0,1,1,0,0,1,0,0,0,0,0,0,1,0,0],
[0,0,0,0,1,1,1,0,0,0,0,1,1,0,0,0],
[0,0,0,0,0,0,1,1,1,1,1,1,0,0,0,0]
       ]
 }
];

const PICROSS_REWARD = {
  1: { parts: 5, desc: "a cache of heavy tools: +5 parts" }
};


export { CIRCUIT_LEVELS, CIRCUIT_REWARD, FOCUS_LEVELS, FOCUS_REWARD, PATCH_LEVELS, PATCH_REWARD, PATCH_SHAPES, PATCH_VARIANTS, PIPES_LEVELS, PIPES_REWARD, SEEDLINGS, SEED_COMPANION, SEED_LEVELS, SEED_REWARD, SEED_RIVAL, SIGNAL_LEVELS, SIGNAL_REWARD, WATER_LEVELS, WATER_PIECES, WATER_REWARD, WIRES_LEVELS, WIRES_REWARD, PICROSS_LEVELS, PICROSS_REWARD };
