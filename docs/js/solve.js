// solve.js — infer one silent round's results.
//
// Model. Each team gained d ∈ {0,1,2,3} points in the silent round (a 4th..1st).
// post[t] = prevPoints[t] + d[t]. The NEXT round's draw is power-paired on those
// post totals, so its rooms must tile the teams sorted by post — every team in a
// higher room scores ≥ every team in a lower room ("band stacking"). If the
// silent round's own draw is known, each of its rooms additionally constrains its
// four teams' d to a permutation of {3,2,1,0}.
//
// We enumerate ALL assignments satisfying these constraints (exact), then report
// each team's distribution over d, its expected value, and whether it's pinned.

// ---- validity: do these post-totals tile the next-round rooms as bands? ----
export function bandStackingValid(postByTeam, nextRooms) {
  const all = [];
  for (const room of nextRooms) for (const t of room) all.push(postByTeam[t]);
  all.sort((a, b) => b - a);

  // Block multisets from the sorted order (groups of 4).
  const blocks = [];
  for (let i = 0; i < all.length; i += 4) blocks.push(all.slice(i, i + 4).join(","));
  blocks.sort();

  // Room multisets from the actual draw.
  const rooms = nextRooms.map((room) =>
    room.map((t) => postByTeam[t]).sort((a, b) => b - a).join(",")
  );
  rooms.sort();

  if (blocks.length !== rooms.length) return false;
  for (let i = 0; i < blocks.length; i++) if (blocks[i] !== rooms[i]) return false;
  return true;
}

const PERMS_3210 = permutations([3, 2, 1, 0]);

// ---- exact solver with incremental pruning ----
// prevPoints: { teamId: number }
// nextRooms:  [[id,id,id,id], ...]            (the leaking draw; required)
// silentRooms:[[id,id,id,id], ...] | null     (the silent round's own draw; optional)
//
// Pruning: as each next-round room becomes fully assigned, it must be totally
// ordered against every other completed room (one room's points entirely ≥ the
// other's). That pairwise condition, held over all rooms, is exactly equivalent
// to a valid power-pairing tiling — so pruning on it stays exact while cutting
// the search drastically.
export function solveSilentRound({ prevPoints, nextRooms, silentRooms = null, maxSolutions = 500000, maxNodes = 5000000 }) {
  const teams = [...new Set(nextRooms.flat())];
  let nodes = 0, budgetExceeded = false;

  // Map each team to its next-round room, and prepare per-room bookkeeping.
  const nextRoomOf = {};
  nextRooms.forEach((room, ri) => room.forEach((t) => (nextRoomOf[t] = ri)));
  const counts = new Array(nextRooms.length).fill(0);
  const completed = []; // {min,max} for each fully-assigned next room

  const post = {};
  const tally = {};
  for (const t of teams) tally[t] = [0, 0, 0, 0];
  let solutions = 0, capped = false;

  // Assign one team; return false if it makes a completed room cross another.
  const pushedFlag = {};
  function assign(t, value) {
    post[t] = value;
    const ri = nextRoomOf[t];
    pushedFlag[t] = false;
    if (ri === undefined) return true; // team not in next draw (dropped after silent round)
    counts[ri]++;
    if (counts[ri] === 4) {
      const vals = nextRooms[ri].map((x) => post[x]);
      const mn = Math.min(...vals), mx = Math.max(...vals);
      const ok = completed.every((c) => mn >= c.max || c.min >= mx);
      completed.push({ min: mn, max: mx });
      pushedFlag[t] = true;
      if (!ok) return false;
    }
    return true;
  }
  function undo(t) {
    const ri = nextRoomOf[t];
    if (ri === undefined) return;
    if (pushedFlag[t]) completed.pop();
    counts[ri]--;
  }

  const record = () => {
    solutions++;
    for (const t of teams) tally[t][post[t] - prevPoints[t]]++;
    if (maxSolutions && solutions >= maxSolutions) capped = true;
  };

  if (silentRooms) {
    const inSilent = new Set(silentRooms.flat());
    // Teams in the next draw that didn't play the silent round sat out -> d=0.
    const satOut = teams.filter((t) => !inSilent.has(t));

    const dfsSat = (j, after) => {
      if (j === satOut.length) return after();
      const t = satOut[j];
      const feasible = assign(t, prevPoints[t]);
      if (feasible && !capped) dfsSat(j + 1, after);
      undo(t);
    };

    const dfsRooms = (ri) => {
      if (capped || budgetExceeded) return;
      if (++nodes > maxNodes) { budgetExceeded = true; return; }
      if (ri === silentRooms.length) { record(); return; }
      const room = silentRooms[ri];
      for (const perm of PERMS_3210) {
        let placed = 0, bad = false;
        for (let k = 0; k < 4; k++) {
          if (!assign(room[k], prevPoints[room[k]] + perm[k])) bad = true;
          placed++;
          if (bad) break;
        }
        if (!bad) dfsRooms(ri + 1);
        for (let k = placed - 1; k >= 0; k--) undo(room[k]);
        if (capped) return;
      }
    };

    dfsSat(0, () => dfsRooms(0));
  } else {
    const order = [...teams].sort((a, b) => prevPoints[b] - prevPoints[a]);
    const dfs = (i) => {
      if (capped || budgetExceeded) return;
      if (++nodes > maxNodes) { budgetExceeded = true; return; }
      if (i === order.length) { record(); return; }
      const t = order[i];
      for (let d = 0; d <= 3; d++) {
        const feasible = assign(t, prevPoints[t] + d);
        if (feasible && !capped) dfs(i + 1);
        undo(t);
      }
    };
    dfs(0);
  }

  const perTeam = {};
  for (const t of teams) {
    const c = tally[t];
    const dist = solutions ? c.map((x) => x / solutions) : [0, 0, 0, 0];
    const expected = dist.reduce((s, p, d) => s + p * d, 0);
    const certain = dist.filter((p) => p > 0).length === 1;
    const mostLikely = dist.indexOf(Math.max(...dist));
    perTeam[t] = { dist, expected, certain, mostLikely };
  }
  return { solutions, capped, budgetExceeded, perTeam };
}

// ---- helpers ----
function permutations(arr) {
  if (arr.length <= 1) return [arr];
  const out = [];
  for (let i = 0; i < arr.length; i++) {
    const rest = arr.slice(0, i).concat(arr.slice(i + 1));
    for (const p of permutations(rest)) out.push([arr[i], ...p]);
  }
  return out;
}

// ---- per-room prediction (no silent draw) ----
// For each next-round room, the four teams converged to near-equal totals. We
// take the tightest reading consistent with d∈{0,1,2,3}: enumerate the room's
// 4^4 delta combinations, keep those whose post-totals have the smallest spread,
// and turn them into a per-team distribution. Clean brackets pin hard; "extreme"
// rooms (too wide to converge) are flagged — those are where the global solver
// will help most. This is the modal reading the full bracket-DP must agree with.
export function predictPerRoom({ prevPoints, rooms }) {
  const perTeam = {};
  const roomInfo = [];
  for (const room of rooms) {
    const ids = room.map((t) => (typeof t === "string" ? t : t.id));
    const P = ids.map((id) => prevPoints[id]);
    let best = Infinity;
    const combos = [];
    for (let a = 0; a < 4; a++) for (let b = 0; b < 4; b++)
      for (let c = 0; c < 4; c++) for (let d = 0; d < 4; d++) {
        const ds = [a, b, c, d];
        const post = P.map((p, i) => p + ds[i]);
        const spread = Math.max(...post) - Math.min(...post);
        if (spread < best) { best = spread; combos.length = 0; }
        if (spread === best) combos.push(ds);
      }
    // tally per team over the kept (min-spread) combos
    const tally = ids.map(() => [0, 0, 0, 0]);
    for (const ds of combos) ds.forEach((d, i) => tally[i][d]++);
    ids.forEach((id, i) => {
      const dist = tally[i].map((x) => x / combos.length);
      const expected = dist.reduce((s, p, d) => s + p * d, 0);
      const mostLikely = dist.indexOf(Math.max(...dist));
      const certain = dist.filter((p) => p > 0).length === 1;
      perTeam[id] = { dist, expected, mostLikely, certain };
    });
    roomInfo.push({ ids, spread: best, extreme: best > 0 });
  }
  return { perTeam, roomInfo };
}

// ---- calibrated per-room distribution (no silent draw) ----
// Upgrade over predictPerRoom's hard "tightest spread wins": weight EVERY result
// permutation by how plausible the resulting room is under BP power-pairing with
// pullups. Per the BP draw generator, a room's post-round totals should be near
// equal, and any team sitting below the room's top is a pulled-up team whose gap
// is penalised. So weight(perm) = exp(-λ · Σ_i (topTotal − total_i)), the total
// pullup gap. λ is fitted on rounds with known results (open-round calibration);
// at the fitted value the output is well-calibrated and, by construction, never
// collapses to a false 100% (every result keeps non-zero probability).
export const PULLUP_LAMBDA = 0.4;

export function predictRoomsCalibrated({ prevPoints, rooms, lambda = PULLUP_LAMBDA }) {
  const perTeam = {};
  const roomInfo = [];
  for (const room of rooms) {
    const ids = room.map((t) => (typeof t === "string" ? t : t.id));
    const P = ids.map((id) => prevPoints[id]);

    const weights = PERMS_3210.map((perm) => {
      const totals = perm.map((s, i) => P[i] + s);
      const top = Math.max(...totals);
      const gap = totals.reduce((a, x) => a + (top - x), 0); // total pullup gap
      return Math.exp(-lambda * gap);
    });
    const Z = weights.reduce((a, b) => a + b, 0) || 1;

    const tally = ids.map(() => [0, 0, 0, 0]);
    PERMS_3210.forEach((perm, k) => perm.forEach((s, i) => { tally[i][s] += weights[k]; }));

    ids.forEach((id, i) => {
      const dist = tally[i].map((x) => x / Z);
      const expected = dist.reduce((s, p, d) => s + p * d, 0);
      const mostLikely = dist.indexOf(Math.max(...dist));
      perTeam[id] = { dist, expected, mostLikely, certain: false };
    });
    roomInfo.push({ ids, spread: Math.max(...P) - Math.min(...P) });
  }
  return { perTeam, roomInfo };
}

// ===========================================================================
// SILENT-ROUND INFERENCE (Level 0 — from the next draw only, no silent draw).
//
// A next-round room groups 4 teams who ended the silent round on ~equal points,
// so the room sits at some bracket level. If a points-group didn't divide into
// 4s, the leftover (higher) teams are carried DOWN into the room below — those
// are "pulled" teams, and they're the higher-pre teams in the room. We enumerate
// every valid arrangement of the room across its lower level B and upper level
// B+1 (k of the highest-pre teams pulled down), keep the ones where every result
// lands in {1st,2nd,3rd,4th}, and COUNT them. A team's result distribution is the
// fraction of valid arrangements giving it each placement — parameter-free, and
// because pulled and natural arrangements coexist, it never asserts a false 100%.
//   result index: 0 = 4th (0 pts) … 3 = 1st (3 pts)
// ===========================================================================

export function inferSilentRound({ prevPoints, nextRooms, silentRooms = null }) {
  const level0 = level0Read(prevPoints, nextRooms);
  if (!silentRooms || !silentRooms.length) return { perTeam: level0 };
  return { perTeam: crossCheck(prevPoints, nextRooms, silentRooms, level0) };
}

// Level 0: read each next-round room on its own (pullup counting).
function level0Read(prevPoints, nextRooms) {
  const perTeam = {};
  for (const room of nextRooms) {
    const ids = room.map((t) => (typeof t === "string" ? t : t.id));
    const p = ids.map((id) => prevPoints[id]);
    const byPre = [...ids.keys()].sort((a, b) => p[b] - p[a]);
    const lo = Math.min(...p), hi = Math.max(...p);
    const configs = [];
    for (let B = lo - 1; B <= hi + 1; B++) {
      for (let k = 0; k <= 4; k++) {
        const upper = new Set(byPre.slice(0, k));
        let ok = true;
        const res = p.map((pp, i) => { const level = upper.has(i) ? B + 1 : B; const r = level - pp; if (r < 0 || r > 3) ok = false; return r; });
        if (ok) configs.push(res);
      }
    }
    const Z = configs.length || 1;
    ids.forEach((id, i) => { const d = [0, 0, 0, 0]; for (const c of configs) d[c[i]] += 1; perTeam[id] = pullFloor(d.map((x) => x / Z)); });
  }
  return perTeam;
}

// ---------------------------------------------------------------------------
// Silent-draw cross-check (the back-and-forth cycle). Each team carries a
// running distribution over its silent-round result. We repeatedly compare it
// two ways and multiply the evidence, until a full pass changes nothing:
//   • its SILENT room — the four results are a permutation of {3,2,1,0}, so
//     impossible combinations (e.g. two teammates both 1st) get deleted;
//   • its NEXT-DRAW room — the pullup reading, now weighted by current beliefs.
// A true constraint only ever removes possibility, so this settles (fixpoint).
// ---------------------------------------------------------------------------
function crossCheck(prevPoints, nextRooms, silentRooms, level0) {
  const norm = (d) => { const s = d.reduce((a, b) => a + b, 0) || 1; return d.map((x) => x / s); };
  const mul = (a, b) => norm(a.map((x, i) => Math.max(x, 1e-6) * Math.max(b[i], 1e-6)));

  const asIds = (rm) => rm.map((t) => (typeof t === "string" ? t : t.id));
  const UNIFORM = [0.25, 0.25, 0.25, 0.25];
  const belief = {}; for (const id in level0) belief[id] = level0[id].slice();
  // A team can appear in the silent draw but not the current draw (mismatched
  // team sets — e.g. one side is a results page). Seed those with a flat prior so
  // the cycle never reads an undefined belief.
  for (const rm of silentRooms) for (const id of asIds(rm)) if (!belief[id]) belief[id] = UNIFORM.slice();

  // message from a SILENT room: keep only {3,2,1,0}-permutation assignments
  const r4Message = (prior) => {
    const acc = [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]];
    for (const perm of PERMS_3210) {
      let w = 1; for (let i = 0; i < 4; i++) w *= Math.max(prior[i][perm[i]], 1e-6);
      for (let i = 0; i < 4; i++) acc[i][perm[i]] += w;
    }
    return acc.map(norm);
  };
  // message from a NEXT-DRAW room: pullup arrangements weighted by current belief
  const r5Message = (pre, prior) => {
    const lo = Math.min(...pre), hi = Math.max(...pre);
    const byPre = [...pre.keys()].sort((a, b) => pre[b] - pre[a]);
    const acc = pre.map(() => [0, 0, 0, 0]);
    for (let B = lo - 1; B <= hi + 1; B++) for (let k = 0; k <= 4; k++) {
      const upper = new Set(byPre.slice(0, k)); let ok = true;
      const res = pre.map((pp, i) => { const L = upper.has(i) ? B + 1 : B; const r = L - pp; if (r < 0 || r > 3) ok = false; return r; });
      if (!ok) continue;
      let w = 1; for (let i = 0; i < 4; i++) w *= Math.max(prior[i][res[i]], 1e-6);
      for (let i = 0; i < 4; i++) acc[i][res[i]] += w;
    }
    return acc.map(norm);
  };

  for (let iter = 0; iter < 50; iter++) {
    const r4msg = {}, r5msg = {};
    for (const rm of silentRooms) { const ids = asIds(rm); const m = r4Message(ids.map((id) => belief[id] || UNIFORM)); ids.forEach((id, i) => r4msg[id] = m[i]); }
    for (const rm of nextRooms) { const ids = asIds(rm); const m = r5Message(ids.map((id) => prevPoints[id]), ids.map((id) => belief[id] || UNIFORM)); ids.forEach((id, i) => r5msg[id] = m[i]); }
    let maxDelta = 0; const next = {};
    for (const id in belief) {
      const c = mul(r4msg[id] || belief[id], r5msg[id] || belief[id]);
      maxDelta = Math.max(maxDelta, ...c.map((x, i) => Math.abs(x - belief[id][i])));
      next[id] = c;
    }
    Object.assign(belief, next);
    if (maxDelta < 1e-4) break;
  }
  const out = {};
  for (const id in level0) out[id] = pullFloor(belief[id] || level0[id]);
  return out;
}

// Nothing is ever fully certain: shave a hard 100% and hand it to the neighbour
// that a pull would have produced (residual pullup uncertainty).
function pullFloor(dist, cap = 0.92) {
  const m = dist.indexOf(Math.max(...dist));
  if (dist[m] <= cap) return dist;
  const excess = dist[m] - cap;
  dist[m] = cap;
  const nb = m > 0 ? m - 1 : m + 1;   // toward one adjacent placement
  dist[nb] += excess;
  return dist;
}
