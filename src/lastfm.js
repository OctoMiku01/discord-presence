// Current song from Last.fm (the same source as the "right now" box on mikubeam.de), plus its
// length and album art for the Discord activity. Album art comes from the same search as on the
// website (Last.fm, iTunes, Deezer, YouTube – see siteCover); only if the website can't be reached,
// a smaller search here (Last.fm, iTunes) steps in.

const API = "https://ws.audioscrobbler.com/2.0/";
const HEADERS = { "user-agent": "discord-presence" };
// Last.fm's grey star placeholder, used when it has no real artwork.
const PLACEHOLDER = "2a96cbd8b46e442fc41c2b86b821562f";

const infoCache = new Map(); // "artist|name" → { duration, cover }

async function call(params, apiKey) {
  const query = new URLSearchParams({ ...params, api_key: apiKey, format: "json" });
  const res = await fetch(`${API}?${query}`, { headers: HEADERS, signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`Last.fm: HTTP ${res.status}`);
  return res.json();
}

function image(images) {
  const url = ["extralarge", "large", "medium"]
    .map((size) => images?.find((i) => i.size === size)?.["#text"])
    .find(Boolean);
  return url && !url.includes(PLACEHOLDER) ? url : null;
}

async function itunesCover(artist, name) {
  try {
    const params = new URLSearchParams({ term: `${artist} ${name}`, entity: "song", limit: "1", country: "JP" });
    const res = await fetch(`https://itunes.apple.com/search?${params}`, { signal: AbortSignal.timeout(5_000) });
    const art = res.ok ? (await res.json()).results?.[0]?.artworkUrl100 : null;
    return art ? art.replace(/\/100x100bb\./, "/512x512bb.") : null;
  } catch {
    return null;
  }
}

// The website's cover search (GET /api/cover). Returns the URL, null for "nothing found" or
// undefined when the website can't be asked (not configured, offline, error).
async function siteCover(site, artist, name) {
  if (!site?.url || !site?.token) return undefined;
  try {
    const url = new URL("/api/cover", site.url);
    url.search = new URLSearchParams({ artist, track: name });
    const res = await fetch(url, {
      headers: { authorization: `Bearer ${site.token}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const { url: cover } = await res.json();
    return typeof cover === "string" && cover.startsWith("https://") ? cover : null;
  } catch {
    return undefined;
  }
}

// Length (ms, 0 = unknown) and a cover for songs Last.fm lists without one. Cached per song.
async function trackInfo(artist, name, cover, apiKey, site) {
  const key = `${artist}|${name}`.toLowerCase();
  if (infoCache.has(key)) return infoCache.get(key);
  // Length from Last.fm and the website's cover search at the same time.
  const [data, fromSite] = await Promise.all([
    call({ method: "track.getInfo", artist, track: name, autocorrect: "1" }, apiKey).catch(() => null),
    cover ? null : siteCover(site, artist, name),
  ]);
  const duration = Number(data?.track?.duration) || 0;
  cover ||= fromSite;
  if (cover === undefined) {
    // Website not reachable: own, smaller search.
    cover = image(data?.track?.album?.image) || (await itunesCover(artist, name));
  }
  const info = { duration, cover: cover || null };
  if (infoCache.size > 500) infoCache.clear();
  // After a website error, ask again the next time the song comes up.
  if (fromSite !== undefined || !site?.token) infoCache.set(key, info);
  return info;
}

// The song playing right now, or null. site = { url, token } for the website's cover search.
export async function nowPlaying(user, apiKey, site) {
  const data = await call({ method: "user.getrecenttracks", user, limit: "1" }, apiKey);
  const track = data.recenttracks?.track?.[0];
  if (track?.["@attr"]?.nowplaying !== "true") return null;
  const artist = track.artist?.["#text"] ?? "";
  const info = await trackInfo(artist, track.name, image(track.image), apiKey, site);
  return {
    name: track.name,
    artist,
    album: track.album?.["#text"] || null,
    url: track.url,
    cover: info.cover,
    duration: info.duration,
  };
}
