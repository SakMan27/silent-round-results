// sources.js — turn a pasted tournament link into fetched, parsed data.
//
// The two required inputs (current standings + current draw) live at FIXED
// public paths, so there's no round number to guess. We derive those URLs from
// whatever tournament link the user pastes, fetch them through the proxy
// Worker (CORS), and run the HTML through the parser we already have.

import { parseStandings, parseDraw, extractTablesData } from "./parse.js";
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
// tournament (e.g. ".../srbp2024/tab/current-standings/").
const PAGE_SEGMENTS = new Set([
  "draw", "tab", "standings", "participants", "results", "break", "motions",
  "feedback", "availability", "round", "info-slide", "admin", "assistant",
  "api", "privateurls",
]);

// From any page URL within a tournament, recover the tournament base.
//   .../srbp2024/                        -> .../srbp2024/
//   .../srbp2024/draw/                   -> .../srbp2024/
//   .../srbp2024/tab/current-standings/  -> .../srbp2024/   (multi-segment page)
//   example.com/tabbycat/srbp2024/draw/  -> example.com/tabbycat/srbp2024/ (path-mounted)
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
  catch { draw = { kind: "draw", round: null, rooms: [], meta: { teamsPerRoom: 0, dataRows: 0 } }; }

  const nb = nonBpDrawMessage(draw);
  if (nb) throw new Error(nb);
  if (!draw.rooms.length) {
    throw new Error("The current draw isn't released yet — the page is up, but it has no pairings to read.");
  }

  return { urls, standings, draw };
}

// Shared format check: returns a message if a parsed draw isn't a usable BP draw
// (two-team formats like WSDC, or malformed rooms), else null. Detection is by
// team-cell count, so it's independent of header wording, language, and any
// extra columns (venue, adjudicators, …).
export function nonBpDrawMessage(draw) {
  const meta = draw.meta || { teamsPerRoom: 0, dataRows: 0 };
  if (meta.dataRows > 0 && meta.teamsPerRoom && meta.teamsPerRoom !== 4) {
    return `This looks like a non-BP tournament (${meta.teamsPerRoom} teams per room) — this tool only supports British Parliamentary.`;
  }
  if (draw.rooms.length && !draw.rooms.every((r) => r.teams.length === 4)) {
    return "This looks like a non-BP tournament (rooms don't have 4 teams) — this tool only supports British Parliamentary.";
  }
  return null;
}

// Upload path: classify a saved page as standings or draw (by how many team
// cells each row has — draws have ≥2 per room, standings have 1), parse it, and
// apply the same BP checks as the link path.
export function loadFromHtml(html) {
  let tables;
  try { tables = extractTablesData(html); }
  catch { throw new Error("Couldn't read this file — is it a saved Calicotab/Tabbycat draw or standings page?"); }

  const rows = (tables[0] && tables[0].data) || [];
  const teamCellsPerRow = rows.map((row) =>
    row.filter((c) => c && typeof c.class === "string" && c.class.includes("team-name")).length
  );
  const maxTeams = teamCellsPerRow.length ? Math.max(...teamCellsPerRow) : 0;

  if (maxTeams >= 2) {
    const draw = parseDraw(html);
    const nb = nonBpDrawMessage(draw);
    if (nb) throw new Error(nb);
    if (!draw.rooms.length) throw new Error("This draw page has no pairings to read.");
    return { kind: "draw", draw };
  }

  const standings = parseStandings(html);
  if (!Object.keys(standings.teams).length) {
    throw new Error("No teams found — is this a standings page?");
  }
  return { kind: "standings", standings };
}
