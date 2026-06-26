// sources.js — turn a pasted tournament link into fetched, parsed data.
//
// The two required inputs (current standings + current draw) live at FIXED
// public paths, so there's no round number to guess. We derive those URLs from
// whatever tournament link the user pastes, fetch them through the proxy
// Worker (CORS), and run the HTML through the parser we already have.

import { parseStandings, parseDraw } from "./parse.js";
import { WORKER_URL } from "./config.js";

// Fixed public paths, relative to the tournament base ".../<slug>/".
// (These match Calicotab's standard public pages; adjust here if an instance
// differs, and we fall back to manual upload either way.)
const PATHS = {
  standings: "tab/current-standings/",
  draw: "draw/",
  participants: "participants/list/",
};

// Known Tabbycat page segments that appear *after* the tournament base. If the
// pasted link already points into one of these, we cut back to the base before
// it — so we never blindly append to a URL that's already a page within the
// tournament (e.g. ".../tournament/tab/current-standings/").
const PAGE_SEGMENTS = new Set([
  "draw", "tab", "standings", "participants", "results", "break", "motions",
  "feedback", "availability", "round", "info-slide", "admin", "assistant",
  "api", "privateurls",
]);

// From any page URL within a tournament, recover the tournament base.
//   .../tournament/                        -> .../tournament/
//   .../tournament/draw/                   -> .../tournament/
//   .../tournament/tab/current-standings/  -> .../tournament/   (multi-segment page)
//   example.com/tabbycat/tournament/draw/  -> example.com/tabbycat/tournament/ (path-mounted)
export function tournamentBase(pastedUrl) {
  let u;
  try { u = new URL(pastedUrl.trim()); }
  catch { throw new Error("That doesn't look like a valid link."); }

  const segments = u.pathname.split("/").filter(Boolean);

  // Everything before the first recognised page segment is the base path
  // (origin + any mount path + the tournament slug).
  const cut = segments.findIndex((s) => PAGE_SEGMENTS.has(s.toLowerCase()));
  const baseSegments = cut === -1 ? segments : segments.slice(0, cut);

  const path = baseSegments.length ? "/" + baseSegments.join("/") + "/" : "/";
  return u.origin + path;
}

export function derivedUrls(pastedUrl) {
  const base = tournamentBase(pastedUrl);
  return {
    base,
    standings: base + PATHS.standings,
    draw: base + PATHS.draw,
    participants: base + PATHS.participants,
  };
}

// Fetch a target page through the proxy Worker.
export async function fetchViaWorker(workerUrl, targetUrl) {
  const endpoint = workerUrl.replace(/\/+$/, "") + "/?url=" + encodeURIComponent(targetUrl);
  let res;
  try { res = await fetch(endpoint); }
  catch (e) { throw new Error("Couldn't reach the proxy. Is the Worker URL correct? (" + e + ")"); }
  if (!res.ok) {
    let detail = "";
    try { detail = (await res.json()).error || ""; } catch { /* ignore */ }
    throw new Error(`Fetch failed (${res.status})${detail ? ": " + detail : ""}`);
  }
  return await res.text();
}

// Diagnostic: fetch + parse ONLY the standings from a link. Standings exist
// even when no draw is live, so this confirms the link→fetch→parse path works
// on real data without needing a mid-competition tournament.
export async function loadStandingsOnly(pastedUrl, workerUrl = WORKER_URL) {
  const urls = derivedUrls(pastedUrl);
  const html = await fetchViaWorker(workerUrl, urls.standings);
  return { url: urls.standings, standings: parseStandings(html) };
}

// Load the two required pages from a pasted link and parse them.
export async function loadTournament(pastedUrl, workerUrl = WORKER_URL) {
  if (!workerUrl) throw new Error("No proxy configured yet — set WORKER_URL in config.js, or upload the pages instead.");
  const urls = derivedUrls(pastedUrl);

  // Fetch independently so we can say exactly which page is missing, and so a
  // missing draw doesn't hide a perfectly good standings page.
  const [standingsRes, drawRes] = await Promise.allSettled([
    fetchViaWorker(workerUrl, urls.standings),
    fetchViaWorker(workerUrl, urls.draw),
  ]);

  if (standingsRes.status === "rejected") {
    throw new Error("Couldn't load the standings page (" + standingsRes.reason.message +
      "). Check the tournament link, or that public standings are enabled.");
  }
  if (drawRes.status === "rejected") {
    throw new Error("Couldn't load the current draw (" + drawRes.reason.message +
      "). This tournament may not have a draw released right now.");
  }

  // Pages can load (HTTP 200) but contain no table — e.g. a "draw not released"
  // placeholder, or standings that aren't public. Detect that and say so.
  let standings, draw;
  try { standings = parseStandings(standingsRes.value); }
  catch { throw new Error("The standings page loaded, but public standings don't seem to be available for this tournament."); }

  try { draw = parseDraw(drawRes.value); }
  catch { draw = { kind: "draw", round: null, rooms: [], meta: { bpColumns: 0, dataRows: 0 } }; }

  if (!draw.rooms.length) {
    const meta = draw.meta || { bpColumns: 0, dataRows: 0 };
    // Table had rooms but none in OG/OO/CG/CO format -> not BP (e.g. WSDC).
    if (meta.dataRows > 0 && meta.bpColumns < 4) {
      throw new Error("This looks like a non-BP tournament (the draw isn't in OG/OO/CG/CO format) — this tool only supports British Parliamentary.");
    }
    throw new Error("The current draw isn't released yet — the page is up, but it has no pairings to read.");
  }
  // Safety net: BP rooms must have 4 teams.
  if (!draw.rooms.every((r) => r.teams.length === 4)) {
    throw new Error("This looks like a non-BP tournament (rooms don't have 4 teams) — this tool only supports British Parliamentary.");
  }

  return { urls, standings, draw };
}
