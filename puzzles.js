import { PATCH_SHAPES, PATCH_VARIANTS, SEEDLINGS, SEED_COMPANION, SEED_RIVAL } from "./data-puzzles.js";










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


function pairHas(list,a,b){ return list.some(p=>(p[0]===a&&p[1]===b)||(p[0]===b&&p[1]===a)); }
function areCompanions(a,b){ return pairHas(SEED_COMPANION,a,b); }
function areRivals(a,b){ return pairHas(SEED_RIVAL,a,b); }


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






/* ---------- the water mains (pipes): rotate-only, junctions, many sinks ---------- */
// tile openings at rotation 0, as N=0 E=1 S=2 W=3
const PIPE_OPEN = { I:[0,2], L:[0,1], T:[0,1,3], X:[0,1,2,3], S:[0], K:[0,1,2,3] };
const DIRDX=[0,1,0,-1], DIRDY=[-1,0,1,0];

function pipeOpenings(type, rot){ return PIPE_OPEN[type].map(d=>(d+rot)%4); }

// L: {w,h,cells} (row-major, null or type letters); rots: row-major rotation array.
// Water flows from every source; an opening facing a wall, an empty cell, or a
// closed face SPILLS (a leak) if it's on the pressurized network.
function pipesCheck(L, rots){
  const idx=(x,y)=>y*L.w+x;
  const open=L.cells.map((t,i)=> (t&&t!==".")?pipeOpenings(t,rots[i]||0):null);
  const srcs=[], sinks=[];
  L.cells.forEach((t,i)=>{ if(t==="S") srcs.push(i); if(t==="K") sinks.push(i); });
  if(!srcs.length) return {seen:new Set(), leaks:0, fed:[], sinks, solved:false};
  // BFS through mutually-open faces
  const seen=new Set(srcs);
  const q=[...srcs];
  while(q.length){
    const i=q.pop(); const x=i%L.w, y=(i/L.w)|0;
    for(const d of open[i]){
      const nx=x+DIRDX[d], ny=y+DIRDY[d];
      if(nx<0||ny<0||nx>=L.w||ny>=L.h) continue;
      const j=idx(nx,ny);
      if(!open[j]) continue;
      if(!open[j].includes((d+2)%4)) continue;
      if(!seen.has(j)){ seen.add(j); q.push(j); }
    }
  }
  // leaks: any open face on a REACHED tile that isn't answered by the neighbour
  let leaks=0;
  for(const i of seen){
    const x=i%L.w, y=(i/L.w)|0;
    for(const d of open[i]){
      const nx=x+DIRDX[d], ny=y+DIRDY[d];
      const j=(nx<0||ny<0||nx>=L.w||ny>=L.h)?-1:idx(nx,ny);
      if(j<0 || !open[j] || !open[j].includes((d+2)%4)) leaks++;
    }
  }
  const fed=sinks.filter(i=>seen.has(i));
  return { seen, leaks, fed, sinks,
           solved: fed.length===sinks.length && leaks===0 };
}

/* ---------- the line run (wires): place & rotate, 8 nodes, colors ---------- */
// nodes clockwise from top-left: 0 TL, 1 TR, 2 right-upper, 3 right-lower,
// 4 BR, 5 BL, 6 left-lower, 7 left-upper. 90° cw: n -> (n+2)%8.
// abutting pairs: east neighbour 2<->7 and 3<->6; south neighbour 4<->1 and 5<->0.
function wireRot(n, rot){ return (n + 2*rot) % 8; }

// L: {w,h,blocks,srcs,sinks,inv}; placed: {"x,y":{inv,rot}}
// srcs/sinks: {x,y,node,c} — terminals on occupied endpoint cells.
// Wires conduct only where same-coloured ends meet across a cell edge.
function wiresCheck(L, placed){
  const ends=new Map();   // "x,y,node" -> color
  const links=[];         // [keyA, keyB] intra-tile wire spans
  const key=(x,y,n)=>`${x},${y},${n}`;
  for(const [pos,pl] of Object.entries(placed||{})){
    const [x,y]=pos.split(",").map(Number);
    const tile=L.inv[pl.inv]; if(!tile) continue;
    for(const w of tile.wires){
      const a=wireRot(w.a,pl.rot||0), b=wireRot(w.b,pl.rot||0);
      ends.set(key(x,y,a), w.c); ends.set(key(x,y,b), w.c);
      links.push([key(x,y,a), key(x,y,b)]);
    }
  }
  for(const t of [...L.srcs,...L.sinks]) ends.set(key(t.x,t.y,t.node), t.c);
  // union-find over endpoint keys
  const par=new Map();
  const find=k=>{ let r=k; while(par.get(r)!==undefined&&par.get(r)!==r) r=par.get(r); par.set(k,r); return r; };
  const union=(a,b)=>{ const ra=find(a), rb=find(b); if(ra!==rb) par.set(ra,rb); };
  for(const k of ends.keys()) par.set(k,k);
  for(const [a,b] of links) union(a,b);
  // cross-edge conduction where colors match; mismatches recorded, not conducted
  const AB=[[1,0,[[2,7],[3,6]]],[0,1,[[4,1],[5,0]]]];
  const mismatches=[];
  const cellHasAnything=(x,y)=> placed[`${x},${y}`]
    || L.srcs.some(t=>t.x===x&&t.y===y) || L.sinks.some(t=>t.x===x&&t.y===y);
  for(let y=0;y<L.h;y++) for(let x=0;x<L.w;x++){
    if(!cellHasAnything(x,y)) continue;
    for(const [dx,dy,pairs] of AB){
      const nx=x+dx, ny=y+dy;
      if(nx>=L.w||ny>=L.h||!cellHasAnything(nx,ny)) continue;
      for(const [m,th] of pairs){
        const ka=key(x,y,m), kb=key(nx,ny,th);
        const ca=ends.get(ka), cb=ends.get(kb);
        if(ca===undefined||cb===undefined) continue;
        if(ca===cb) union(ka,kb);
        else mismatches.push({at:[x,y],with:[nx,ny],colors:[ca,cb]});
      }
    }
  }
  // every sink must be fed by SOME source of its own color — two black
  // circuits may land on either black load, the current doesn't care
  const sinkFed = L.sinks.map(k =>
    L.srcs.some(s => s.c===k.c && find(key(s.x,s.y,s.node))===find(key(k.x,k.y,k.node))));
  const fedByColor={};
  L.sinks.forEach((k,i)=>{ fedByColor[k.c]=(fedByColor[k.c]??true)&&sinkFed[i]; });
  return { sinkFed, fedByColor, mismatches,
           solved: sinkFed.every(Boolean) };
}


/* ============================================================
   PICROSS / SPECTRAL SCANS
   ============================================================ */
function generatePicrossClues(grid) {
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



export { cKey, circuitAdj, circuitCap, circuitCheck, focusCheck, focusSrcs, focusTargets, patchCheck, pipesCheck, seedCheck, seedSlotAt, signalCheck, waterSim, wireRot, wiresCheck, generatePicrossClues };
