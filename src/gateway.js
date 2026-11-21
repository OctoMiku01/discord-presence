// Discord gateway connection as a bot, only to watch one user's presence (status and activities).
// The bot needs the "Presence Intent" and must share a server with that user. Uses Node's built-in
// WebSocket (Node 22+), so no packages are needed.

const GATEWAY = "wss://gateway.discord.gg/?v=10&encoding=json";
const INTENTS = (1 << 0) | (1 << 8); // GUILDS | GUILD_PRESENCES
const OP = { DISPATCH: 0, HEARTBEAT: 1, IDENTIFY: 2, RECONNECT: 7, INVALID_SESSION: 9, HELLO: 10, HEARTBEAT_ACK: 11 };
// Close codes after which reconnecting cannot help.
const FATAL = {
  4004: "bot token is wrong",
  4010: "invalid shard",
  4011: "sharding required",
  4012: "invalid API version",
  4013: "invalid intents",
  4014: "Presence Intent is not enabled for the bot (Developer Portal → Bot → Privileged Gateway Intents)",
};

export class Gateway {
  #token;
  #userId;
  #onPresence;
  #log;
  #ws = null;
  #seq = null;
  #heartbeat = null;
  #acked = true;
  #retryMs = 5_000;
  #stopped = false;
  ready = false;

  // onPresence({ status, activities }) is called with the user's presence whenever it changes.
  constructor({ token, userId, onPresence, log }) {
    this.#token = token;
    this.#userId = userId;
    this.#onPresence = onPresence;
    this.#log = log;
  }

  start() {
    this.#connect();
  }

  stop() {
    this.#stopped = true;
    clearInterval(this.#heartbeat);
    this.#ws?.close(1000);
  }

  #connect() {
    if (this.#stopped) return;
    const ws = new WebSocket(GATEWAY);
    this.#ws = ws;
    ws.addEventListener("message", (event) => {
      let msg;
      try {
        msg = JSON.parse(event.data);
      } catch {
        return;
      }
      this.#onMessage(msg);
    });
    ws.addEventListener("close", (event) => {
      clearInterval(this.#heartbeat);
      const wasReady = this.ready;
      this.ready = false;
      if (this.#ws !== ws || this.#stopped) return;
      if (FATAL[event.code]) {
        this.#log(`Discord bot: ${FATAL[event.code]} – giving up (close code ${event.code})`);
        return;
      }
      if (wasReady) this.#retryMs = 5_000;
      this.#log(`Discord bot: disconnected (${event.code}), reconnecting in ${this.#retryMs / 1000} s`);
      setTimeout(() => this.#connect(), this.#retryMs);
      this.#retryMs = Math.min(this.#retryMs * 2, 5 * 60_000);
    });
    ws.addEventListener("error", () => {}); // "close" follows and handles it.
  }

  #send(op, d) {
    if (this.#ws?.readyState === WebSocket.OPEN) this.#ws.send(JSON.stringify({ op, d }));
  }

  #onMessage({ op, d, s, t }) {
    if (s != null) this.#seq = s;
    switch (op) {
      case OP.HELLO: {
        this.#acked = true;
        clearInterval(this.#heartbeat);
        const beat = () => {
          if (!this.#acked) {
            // Zombie connection: no answer to the last heartbeat.
            this.#ws?.close(4000);
            return;
          }
          this.#acked = false;
          this.#send(OP.HEARTBEAT, this.#seq);
        };
        setTimeout(beat, d.heartbeat_interval * Math.random());
        this.#heartbeat = setInterval(beat, d.heartbeat_interval);
        this.#send(OP.IDENTIFY, {
          token: this.#token,
          intents: INTENTS,
          properties: { os: process.platform, browser: "discord-presence", device: "discord-presence" },
        });
        break;
      }
      case OP.HEARTBEAT:
        this.#send(OP.HEARTBEAT, this.#seq);
        break;
      case OP.HEARTBEAT_ACK:
        this.#acked = true;
        break;
      case OP.RECONNECT:
      case OP.INVALID_SESSION:
        this.#ws?.close(4000);
        break;
      case OP.DISPATCH:
        this.#onDispatch(t, d);
        break;
    }
  }

  #onDispatch(type, d) {
    if (type === "READY") {
      this.ready = true;
      this.#log(`Discord bot: connected as ${d.user?.username}, in ${d.guilds?.length ?? 0} server(s)`);
      if (!d.guilds?.length) this.#log("Discord bot: the bot is in no server – invite it to one you are in");
      // Offline (or invisible) users are not listed in GUILD_CREATE, so start from "offline";
      // the servers follow within a moment with the real presence.
      this.#onPresence({ status: "offline", activities: [] });
    } else if (type === "GUILD_CREATE") {
      const own = d.presences?.find((p) => p.user?.id === this.#userId);
      if (own) this.#onPresence({ status: own.status, activities: own.activities ?? [] });
    } else if (type === "PRESENCE_UPDATE" && d.user?.id === this.#userId) {
      this.#onPresence({ status: d.status, activities: d.activities ?? [] });
    }
  }
}
