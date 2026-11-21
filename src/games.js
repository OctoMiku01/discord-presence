// Turns Discord activities into the "Playing" list for mikubeam.de: only games (activity type 0),
// with the game's icon from Discord.

const PLAYING = 0;
const iconCache = new Map(); // application id → icon URL or null

// Public info of a Discord application (no login needed); its icon is the game's logo.
async function appIcon(appId) {
  if (iconCache.has(appId)) return iconCache.get(appId);
  let url = null;
  try {
    const res = await fetch(`https://discord.com/api/v10/applications/${appId}/rpc`, { signal: AbortSignal.timeout(5_000) });
    if (res.ok) {
      const { icon } = await res.json();
      if (icon) url = `https://cdn.discordapp.com/app-icons/${appId}/${icon}.png?size=128`;
    } else if (res.status !== 404) {
      return null; // Try again next time (rate limit, outage).
    }
  } catch {
    return null;
  }
  iconCache.set(appId, url);
  return url;
}

// The Rich Presence picture of the activity, e.g. a game's own artwork.
function assetUrl(activity) {
  const image = activity.assets?.large_image;
  if (!image) return null;
  if (image.startsWith("mp:")) return `https://media.discordapp.net/${image.slice(3)}`;
  if (/^\d+$/.test(image) && activity.application_id) {
    return `https://cdn.discordapp.com/app-assets/${activity.application_id}/${image}.png?size=128`;
  }
  return null;
}

// ignoreAppId: our own music activity, so it never shows up as a "game".
export async function extractGames(activities, ignoreAppId) {
  const games = activities.filter((a) => a.type === PLAYING && a.name && a.application_id !== ignoreAppId);
  return Promise.all(games.map(async (a) => ({
    name: a.name,
    details: a.details ?? null,
    state: a.state ?? null,
    start: a.timestamps?.start ?? a.created_at ?? null,
    icon: (a.application_id && (await appIcon(a.application_id))) || assetUrl(a),
  })));
}

// Spotify linked to Discord already shows the song; then our own activity steps aside.
export const listensToSpotify = (activities) => activities.some((a) => a.type === 2 && a.name === "Spotify");
