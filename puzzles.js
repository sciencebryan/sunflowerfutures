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

function circuitCap(L,x,y){
  if(L.blocked.some(b=>b[0]===x&&b[1]===y)) return 0;
  if(L.caps && L.caps[x+","+y]!==undefined) return L.caps[x+","+y];
  return 99;
}
function cKey(x,y){return x+","+y;}
function circuitAdj(a,b){return Math.abs(a[0]-b[0])+Math.abs(a[1]-b[1])===1;}

/* current on each cell = sum of amps of every path crossing it */
function circuitLoadMap(L, paths){
  const m={};
  for(const ld of L.loads){
    const path=paths[ld.name];
    if(!path||path.length<2) continue;
    for(const c of path) m[cKey(c[0],c[1])]=(m[cKey(c[0],c[1])]||0)+ld.amps;
  }
  return m;
}
function pathValid(L, ld, p){
  if(!p || p.length<2) return false;
  if(p[0][0]!==L.src[0] || p[0][1]!==L.src[1]) return false;         // must start at the bus
  const end=p[p.length-1];
  if(end[0]!==ld.p[0] || end[1]!==ld.p[1]) return false;             // must reach the load
  const seen=new Set();
  for(let i=0;i<p.length;i++){
    const k=cKey(p[i][0],p[i][1]);
    if(seen.has(k)) return false;                                     // no doubling back
    seen.add(k);
    if(circuitCap(L,p[i][0],p[i][1])===0) return false;               // no burnt cells
    if(i>0 && !circuitAdj(p[i-1],p[i])) return false;                 // contiguous
  }
  return true;
}
function circuitCheck(L, paths){
  const live={};
  for(const ld of L.loads) if(pathValid(L,ld,paths[ld.name])) live[ld.name]=paths[ld.name];
  const m=circuitLoadMap(L,live);
  const over=[];
  for(const k in m){ const [x,y]=k.split(",").map(Number); if(m[k]>circuitCap(L,x,y)) over.push(k); }
  let total=0;
  for(const ld of L.loads) if(live[ld.name]) total+=ld.amps;
  const missing=L.loads.filter(l=>l.req && !live[l.name]).map(l=>l.name);
  // junctions: relay cells that must carry AT LEAST a minimum current to energize
  const coldJunctions=[];
  if(L.junctions){
    for(const [k,need] of Object.entries(L.junctions)){
      if((m[k]||0) < need) coldJunctions.push(k);
    }
  }
  return {map:m, live, over, total, overSource: total>L.srcMax, missing, coldJunctions,
          solved: over.length===0 && total<=L.srcMax && missing.length===0 && coldJunctions.length===0};
}

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

const SCOUR_LIMIT=9;   // a channel carrying more than this scours

/* deterministic season sim: process cells high to low */
function waterSim(L, placed){
  const W=L.w,H=L.h;
  const el=(x,y)=>L.elev[y][x] + (placed[cKey(x,y)]==="berm"?3:0);
  const cells=[];
  for(let y=0;y<H;y++)for(let x=0;x<W;x++)cells.push([x,y]);
  cells.sort((a,b)=>el(b[0],b[1])-el(a[0],a[1]));

  const water={}, received={}, stored={}, scoured=[];
  const arrive={}, dirs={};
  let flooded=[];
  for(const [x,y] of cells){ water[cKey(x,y)]=L.rain; arrive[cKey(x,y)]=L.rain; }

  const bedAt=(x,y)=>L.beds.find(b=>b.p[0]===x&&b.p[1]===y);

  for(const [x,y] of cells){
    const k=cKey(x,y);
    let w=water[k]||0;
    if(w<=0) continue;
    const piece=placed[k];

    if(piece==="swale"){ const drink=Math.min(4,w); w-=drink; }
    if(piece==="cistern"){ const keep=Math.min(8,w); stored[k]=keep; w-=keep; }
    const bed=bedAt(x,y);
    if(bed){
      received[k]=(received[k]||0)+w;        // the bed gets everything that arrives
      w = Math.max(0, w - bed.max);          // it can only drink so much; the rest runs on
    }
    const isCh = piece && piece.startsWith("channel");
    if(isCh && L.scour && (water[k]||0)>SCOUR_LIMIT) scoured.push(k);

    if(w<=0) continue;
    // find downhill neighbours
    const nbrs=[[x+1,y],[x-1,y],[x,y+1],[x,y-1]].filter(([a,b])=>a>=0&&b>=0&&a<W&&b<H);
    const here=el(x,y);
    let downs=nbrs.filter(([a,b])=>el(a,b)<here);
    if(isCh && downs.length){
      // a channel sends it all one way — the way you cut it, if that way is downhill
      const dir=piece.split(":")[1];
      const D={E:[1,0],W:[-1,0],S:[0,1],N:[0,-1]}[dir];
      if(D){
        const t=[x+D[0],y+D[1]];
        const ok=downs.find(d=>d[0]===t[0]&&d[1]===t[1]);
        downs = ok ? [ok] : [downs.sort((p,q)=>el(p[0],p[1])-el(q[0],q[1]))[0]];
      } else downs=[downs.sort((p,q)=>el(p[0],p[1])-el(q[0],q[1]))[0]];
    }
    if(!downs.length){
      const onEdge = x===0||y===0||x===W-1||y===H-1;
      if(!onEdge && w>6) flooded.push(k);   // an interior sink with nowhere to go
      continue;                              // at the edge, it leaves the watershed
    }
    const share=w/downs.length;
    dirs[k]=downs.map(([a,b])=>a>x?"E":a<x?"W":b>y?"S":"N");
    for(const [a,b] of downs){ water[cKey(a,b)]=(water[cKey(a,b)]||0)+share; arrive[cKey(a,b)]=(arrive[cKey(a,b)]||0)+share; }
  }

  const bedResults=L.beds.map(b=>{
    const got=received[cKey(b.p[0],b.p[1])]||0;
    return {...b, got, ok: got>=b.min && got<=b.max, dry: got<b.min, drowned: got>b.max};
  });
  const totalStored=Object.values(stored).reduce((a,b)=>a+b,0);
  return {
    beds:bedResults, stored, totalStored, scoured, flooded, arrive, dirs,
    solved: bedResults.every(b=>b.ok) && totalStored>=L.cisternTarget && flooded.length===0 && scoured.length===0
  };
}

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

function pairHas(list,a,b){ return list.some(p=>(p[0]===a&&p[1]===b)||(p[0]===b&&p[1]===a)); }
function areCompanions(a,b){ return pairHas(SEED_COMPANION,a,b); }
function areRivals(a,b){ return pairHas(SEED_RIVAL,a,b); }

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

function seedSlotAt(L,x,y){ return L.slots.find(s=>s.p[0]===x&&s.p[1]===y); }
function seedAdj(a,b){ return Math.abs(a[0]-b[0])+Math.abs(a[1]-b[1])===1; }

/* placed: { "x,y": seedId }. Returns a full diagnosis. */
function seedCheck(L, placed){
  const filled = L.slots.filter(s=>placed[cKey(s.p[0],s.p[1])]);
  const empties = L.slots.filter(s=>!placed[cKey(s.p[0],s.p[1])]);

  // supply respected?
  const used={};
  for(const s of L.slots){ const id=placed[cKey(s.p[0],s.p[1])]; if(id) used[id]=(used[id]||0)+1; }
  const overSupply=[];
  for(const id in used) if(used[id] > (L.supply[id]||0)) overSupply.push(id);

  // light violations
  const wrongLight=[];
  for(const s of L.slots){
    const id=placed[cKey(s.p[0],s.p[1])];
    if(!id) continue;
    const [lo,hi]=SEEDLINGS[id].light;
    if(s.light<lo || s.light>hi) wrongLight.push(cKey(s.p[0],s.p[1]));
  }

  // rival adjacencies
  const rivalPairs=[];
  for(const s of L.slots){
    const id=placed[cKey(s.p[0],s.p[1])];
    if(!id) continue;
    for(const [dx,dy] of [[1,0],[0,1]]){    // check each edge once
      const nx=s.p[0]+dx, ny=s.p[1]+dy;
      const n=placed[cKey(nx,ny)];
      if(n && areRivals(id,n)) rivalPairs.push(cKey(s.p[0],s.p[1])+"|"+cKey(nx,ny));
    }
  }

  // companion satisfaction: any seed that HAS a companion type present in the
  // level's supply must sit next to at least one of that companion type.
  const lonely=[];
  for(const s of L.slots){
    const id=placed[cKey(s.p[0],s.p[1])];
    if(!id) continue;
    const partners = SEED_COMPANION.filter(p=>p.includes(id)).map(p=>p[0]===id?p[1]:p[0]);
    // only require a companion if that partner is actually in play this level
    const need = partners.filter(pt=>(L.supply[pt]||0)>0);
    if(!need.length) continue;
    let satisfied=false;
    for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]){
      const n=placed[cKey(s.p[0]+dx,s.p[1]+dy)];
      if(n && need.includes(n)){ satisfied=true; break; }
    }
    if(!satisfied) lonely.push(cKey(s.p[0],s.p[1]));
  }

  const solved = empties.length===0 && overSupply.length===0 &&
                 wrongLight.length===0 && rivalPairs.length===0 && lonely.length===0;
  return { filled:filled.length, total:L.slots.length, empties, overSupply,
           wrongLight, rivalPairs, lonely, used, solved };
}

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
function signalCheck(L, placed){
  const map={};
  for(const k of Object.keys(placed)){
    const [x,y]=k.split(",").map(Number);
    for(const [px,py] of [[x,y],[x+1,y],[x-1,y],[x,y+1],[x,y-1]]){
      if(px>=0 && px<L.w && py>=0 && py<L.h){ const pk=cKey(px,py); map[pk]=(map[pk]||0)+1; }
    }
  }
  const recStatus=L.receivers.map(r=>{
    const got=map[cKey(r.x,r.y)]||0;
    return {...r, got, match:got===r.v, under:got<r.v, over:got>r.v};
  });
  const used=Object.keys(placed).length;
  const solved = recStatus.every(r=>r.match) && used<=L.budget;
  return {map, recStatus, used, solved};
}

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
function patchCheck(L, placed){
  const map={}, used={};
  placed.forEach(p=>{
    // --- THE FIX: Map the placed shape back to its origin supply key ---
    let baseShape = p.shape;
    for (const supplyKey of Object.keys(L.supply)) {
      if (supplyKey === p.shape || (PATCH_VARIANTS[supplyKey] && PATCH_VARIANTS[supplyKey].includes(p.shape))) {
        baseShape = supplyKey;
        break;
      }
    }
    
    // Tally the base shape instead of the rotated shape
    used[baseShape] = (used[baseShape] || 0) + 1;
    // -------------------------------------------------------------------

    PATCH_SHAPES[p.shape].pts.forEach(pt=>{
      const k=cKey(p.x+pt[0], p.y+pt[1]);
      (map[k]=map[k]||[]).push(p.uid);
    });
  });

  const overlaps=[], onBlocked=[];
  for(const [k,uids] of Object.entries(map)){
    const [x,y]=k.split(",").map(Number);
    if(uids.length>1) overlaps.push(k);
    if(L.blocked.some(b=>b[0]===x&&b[1]===y)) onBlocked.push(k);
  }
  
  const leaksUncovered=L.leaks.filter(l=>{ const k=cKey(l[0],l[1]); return !map[k]||map[k].length===0; });
  
  let savedSquares = 0;
  for (const [key, total] of Object.entries(L.supply)) {
    const left = total - (used[key] || 0);
    if (left > 0 && PATCH_SHAPES[key]) {
      // Multiply the amount left by the number of coordinate points in the shape
      savedSquares += left * PATCH_SHAPES[key].pts.length;
    }
  }

  const solved = overlaps.length===0 && onBlocked.length===0 && leaksUncovered.length===0 &&
                 Object.keys(used).every(k=>used[k]<=(L.supply[k]||0));

  return {map, used, overlaps, onBlocked, leaksUncovered, solved, savedSquares};
}

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
// A level may declare a single `src`/`target` (the original format) or plural
// `srcs`/`targets`. A target is {x, y} — a boiler, which absorbs the beam —
// or {x, y, pass:true} — a lens, which must be lit but lets the beam run on.
function focusSrcs(L){ return L.srcs || [L.src]; }
function focusTargets(L){ return (L.targets || [L.target]).map(t=>({pass:false, ...t})); }

function focusCheck(L, placed){
  const srcs=focusSrcs(L), targets=focusTargets(L);
  const hit=targets.map(()=>false);
  const beams=[];
  for(const s of srcs){
    let x=s.x, y=s.y, dir=s.dir, loop=0;
    const pts=[[x,y]];
    while(loop++<400){
      if(dir==="E") x++; else if(dir==="W") x--; else if(dir==="S") y++; else if(dir==="N") y--;
      if(x<0||x>=L.w||y<0||y>=L.h) break;
      pts.push([x,y]);
      if(L.blocked.some(b=>b[0]===x&&b[1]===y)) break;
      const ti=targets.findIndex(t=>t.x===x&&t.y===y);
      if(ti>=0){
        hit[ti]=true;
        if(!targets[ti].pass) break;   // a boiler drinks the beam
        continue;                       // a lens stays lit and passes it on
      }
      const m=placed[cKey(x,y)];
      if(m==="/"){
        dir = dir==="E"?"N" : dir==="W"?"S" : dir==="N"?"E" : "W";
      } else if(m==="\\"){
        dir = dir==="E"?"S" : dir==="W"?"N" : dir==="N"?"W" : "E";
      }
    }
    beams.push(pts);
  }
  const used=Object.keys(placed).length;
  const hitAll=hit.every(Boolean);
  const solved = hitAll && used<=L.budget;
  // pts/hitTarget kept for compatibility with the single-beam shape
  return {beams, pts:beams[0], hit, hitTarget:hitAll, used, solved};
}

/* ============================================================
   PICROSS / SPECTRAL SCANS
   ============================================================ */

// The library of puzzle layouts (1 = filled, 0 = empty)
export const PICROSS_LEVELS = [
  {
    n: 1, 
    teach: "Resolve LIDAR interference to map the heavy tool cache.",
    parts: 5,
    rewardText: "You recovered a cache of heavy tools! +5 parts.",
    grid: [
      [0,0,1,1,0,0,0,0,0,0,0,0,0,0,0,0],
      [0,0,0,1,1,0,0,0,0,0,0,0,0,0,0,0],
      [1,0,0,1,1,0,0,0,0,0,0,0,0,0,0,0],
      [1,1,1,1,1,1,0,0,0,0,0,0,0,0,0,0],
      [0,1,1,1,1,1,1,0,0,0,0,0,0,0,0,0],
      [0,0,0,1,1,0,0,1,0,0,0,0,0,0,0,0],
      [0,0,0,0,1,1,0,0,1,0,0,0,0,0,0,0],
      [0,0,0,0,0,1,1,0,0,1,0,0,0,0,0,0],
      [0,0,0,0,0,0,1,1,0,0,1,0,0,0,0,0],
      [0,0,0,0,0,0,0,1,1,0,0,1,0,0,0,0],
      [0,0,0,0,0,0,0,0,1,1,1,1,1,1,0,0],
      [0,0,0,0,0,0,0,0,0,1,1,1,0,1,1,0],
      [0,0,0,0,0,0,0,0,0,0,1,0,0,0,1,0],
      [0,0,0,0,0,0,0,0,0,0,1,1,0,1,1,0],
      [0,0,0,0,0,0,0,0,0,0,0,1,1,1,0,0],
      [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0]
       
    ]
  }
];

// Generates the number clues for the top and sides based on a target grid
export function generatePicrossClues(grid) {
  const extract = (line) => {
    const runs = [];
    let current = 0;
    for (let cell of line) {
      if (cell === 1) current++;
      else if (current > 0) { runs.push(current); current = 0; }
    }
    if (current > 0) runs.push(current);
    return runs.length ? runs : [0];
  };

  const rowClues = grid.map(row => extract(row));
  // Map columns by extracting the c-th index of every row
  const colClues = Array(16).fill().map((_, c) => extract(grid.map(row => row[c])));
  
  return { rowClues, colClues };
}

export { CIRCUIT_LEVELS, FOCUS_LEVELS, PATCH_LEVELS, PATCH_SHAPES, PATCH_VARIANTS, SEEDLINGS, SEED_COMPANION, SEED_LEVELS, SEED_RIVAL, SIGNAL_LEVELS, WATER_LEVELS, WATER_PIECES, cKey, circuitAdj, circuitCap, circuitCheck, focusCheck, focusSrcs, focusTargets, patchCheck, seedCheck, seedSlotAt, signalCheck, waterSim, PICROSS_LEVELS, generatePicrossClues };
