// discord-presence: shows the song playing on Last.fm as "Listening to …" in the Discord status, and
// sends the games from the Discord status to mikubeam.de for its "right now" box.

import { readFileSync } from "node:fs";
import net from "node:net";
import { DiscordIpc } from "./discord-ipc.js";
import { Gateway } from "./gateway.js";
import { nowPlaying } from "./lastfm.js";
import { extractGames, listensToSpotify } from "./games.js";

const MUSIC_POLL_MS = 10_000;
const SITE_HEARTBEAT_MS = 60_000; // The site forgets the games 3 minutes after the last update.

const log = (msg) => console.log(`[${new Date().toLocaleTimeString("de-DE")}] ${msg}`);

function loadConfig() {
  const file = new URL("../config.json", import.meta.url);
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch (err) {
    console.error(`Cannot read config.json (${err.message}). Copy config.example.json to config.json and fill it in.`);
    process.exit(1);
  }
}

// Only one copy may run, otherwise two of them would fight over the status.
function singleInstance() {
  const name = process.platform === "win32" ? "\\\\.\\pipe\\discord-presence-lock" : "/tmp/discord-presence.lock";
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.listen(name, () => resolve(true));
  });
}

const config = loadConfig();
if (!(await singleInstance())) {
  log("Already running – exiting.");
  process.exit(0);
}

const clientId = String(config.discord?.clientId ?? "").trim();
const musicEnabled = Boolean(clientId && config.lastfm?.user && config.lastfm?.apiKey);
const siteEnabled = Boolean(config.discord?.botToken && config.discord?.userId && config.site?.url && config.site?.token);
if (!musicEnabled && !siteEnabled) {
  console.error("Nothing to do: fill in config.json (see README.md).");
  process.exit(1);
}

// ---------- Music → Discord status ----------

let spotify = false; // Spotify linked to Discord already shows the song.
const ipc = musicEnabled ? new DiscordIpc(clientId, log) : null;

// Discord wants 2–128 characters per text field.
const field = (s) => {
  const t = String(s ?? "").trim();
  return t ? (t.length < 2 ? `${t} ` : t).slice(0, 128) : undefined;
};

function musicActivity(track, startedAt) {
  const end = track.duration ? startedAt + track.duration : null;
  const artistUrl = track.url?.includes("/_/") ? track.url.split("/_/")[0] : undefined;
  return {
    type: 2, // "Listening to"
    status_display_type: 2, // Member list shows the song instead of the app name.
    details: field(track.name),
    details_url: track.url || undefined,
    state: field(track.artist),
    state_url: artistUrl,
    // Without a known length (or once it has run out – paused, on repeat) only the elapsed time.
    timestamps: end && Date.now() < end ? { start: startedAt, end } : { start: startedAt },
    assets: track.cover ? { large_image: track.cover, large_text: field(track.album) } : undefined,
    buttons: track.url ? [{ label: "View on Last.fm", url: track.url }] : undefined,
    instance: false,
  };
}

let current = null; // { key, startedAt, track }
let sent = "null";
let polling = false;

async function updateMusic() {
  if (polling) return; // A slow Last.fm answer must not overlap with the next poll.
  polling = true;
  try {
    const track = await nowPlaying(config.lastfm.user, config.lastfm.apiKey, config.site);
    const key = track ? `${track.artist}|${track.name}` : null;
    if (key !== (current?.key ?? null)) {
      current = track ? { key, startedAt: Date.now(), track } : null;
      log(track ? `Now playing: ${track.artist} – ${track.name}` : "Music stopped");
    }
  } catch (err) {
    log(`Last.fm: ${err.message}`); // Keep the last state; the next poll tries again.
  }
  const activity = current && !spotify ? musicActivity(current.track, current.startedAt) : null;
  const json = JSON.stringify(activity);
  if (json !== sent) {
    sent = json;
    await ipc.setActivity(activity);
  }
  polling = false;
}

// ---------- Discord status → mikubeam.de ----------

let presence = null; // { status, games }
let pushed = null;
let pushError = null;
let pushTimer = null;
let presenceSeq = 0;

async function pushToSite(payload) {
  try {
    const res = await fetch(new URL("/api/presence", config.site.url), {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${config.site.token}` },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}${res.status === 401 ? " (site.token does not match PRESENCE_TOKEN)" : ""}`);
    if (pushError) log("Website: reachable again");
    pushError = null;
    const json = JSON.stringify(payload);
    if (json !== pushed) {
      pushed = json;
      log(`Website: ${payload.games.length ? payload.games.map((g) => g.name).join(", ") : "no game"} (${payload.status})`);
    }
  } catch (err) {
    if (err.message !== pushError) log(`Website: update failed – ${err.message}`);
    pushError = err.message;
  }
}

const gateway = siteEnabled
  ? new Gateway({
    token: config.discord.botToken,
    userId: String(config.discord.userId),
    log,
    onPresence: async ({ status, activities }) => {
      const wasSpotify = spotify;
      spotify = listensToSpotify(activities);
      if (musicEnabled && spotify !== wasSpotify) updateMusic();
      // Several updates often arrive at once (e.g. one per server); send only the last. The timer
      // is stopped before the icon lookup, so an older update can't slip through meanwhile.
      clearTimeout(pushTimer);
      const seq = ++presenceSeq;
      const games = await extractGames(activities, clientId);
      if (seq !== presenceSeq) return; // A newer update arrived during the lookup.
      presence = { status, games };
      pushTimer = setTimeout(() => {
        if (JSON.stringify(presence) !== pushed) pushToSite(presence);
      }, 2_000);
    },
  })
  : null;

// ---------- Start & stop ----------

if (ipc) {
  ipc.start();
  updateMusic();
  setInterval(updateMusic, MUSIC_POLL_MS);
} else {
  log("Music status off (discord.clientId or lastfm.* missing in config.json)");
}

if (gateway) {
  gateway.start();
  // Repeat the state every minute so the site knows the program is still running.
  setInterval(() => {
    if (gateway.ready && presence) pushToSite(presence);
  }, SITE_HEARTBEAT_MS);
} else {
  log("Website sync off (discord.botToken/userId or site.* missing in config.json)");
}

let stopping = false;
async function shutdown() {
  if (stopping) return;
  stopping = true;
  log("Stopping…");
  gateway?.stop();
  await Promise.allSettled([
    ipc?.stop(),
    siteEnabled ? pushToSite({ status: "offline", games: [] }) : null,
  ]);
  process.exit(0);
}
for (const signal of ["SIGINT", "SIGTERM", "SIGBREAK", "SIGHUP"]) process.on(signal, shutdown);
