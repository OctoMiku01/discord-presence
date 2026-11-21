// Minimal client for the local Discord RPC pipe (\\.\pipe\discord-ipc-N), enough to set and clear
// the Rich Presence activity. Reconnects on its own when Discord is closed or restarted and sends
// the last activity again once it is back.

import net from "node:net";
import { randomUUID } from "node:crypto";

const OP = { HANDSHAKE: 0, FRAME: 1, CLOSE: 2, PING: 3, PONG: 4 };
const RETRY_MS = 15_000;
// Fields newer Discord versions understand; an older client rejects the whole activity because of them.
const NEW_FIELDS = ["status_display_type", "details_url", "state_url"];

function encode(op, data) {
  const json = Buffer.from(JSON.stringify(data), "utf8");
  const header = Buffer.alloc(8);
  header.writeInt32LE(op, 0);
  header.writeInt32LE(json.length, 4);
  return Buffer.concat([header, json]);
}

function openPipe(index) {
  const path = process.platform === "win32"
    ? `\\\\?\\pipe\\discord-ipc-${index}`
    : `${process.env.XDG_RUNTIME_DIR || process.env.TMPDIR || "/tmp"}/discord-ipc-${index}`;
  return new Promise((resolve) => {
    const socket = net.connect(path);
    socket.once("connect", () => resolve(socket));
    socket.once("error", () => resolve(null));
  });
}

export class DiscordIpc {
  #clientId;
  #log;
  #socket = null;
  #buffer = Buffer.alloc(0);
  #ready = false;
  #activity = null;
  #pending = new Map();
  #legacy = false; // Discord rejected the newer fields once: leave them out from then on.
  #retry = null;

  constructor(clientId, log) {
    this.#clientId = clientId;
    this.#log = log;
  }

  start() {
    this.#connect();
  }

  // Sets the activity (null clears it). Remembered and sent again after a reconnect.
  async setActivity(activity) {
    this.#activity = activity;
    if (this.#ready) await this.#send(activity);
  }

  async stop() {
    clearTimeout(this.#retry);
    this.#retry = "stopped";
    if (this.#ready) await this.#send(null).catch(() => {});
    this.#socket?.end();
  }

  async #connect() {
    if (this.#retry === "stopped") return;
    let socket = null;
    for (let i = 0; i < 10 && !socket; i++) socket = await openPipe(i);
    if (!socket) {
      this.#retry = setTimeout(() => this.#connect(), RETRY_MS);
      return;
    }
    this.#socket = socket;
    this.#buffer = Buffer.alloc(0);
    socket.on("data", (chunk) => this.#onData(chunk));
    socket.on("error", () => {});
    socket.on("close", () => {
      if (this.#ready && this.#retry !== "stopped") this.#log("Discord RPC: connection closed, retrying");
      this.#ready = false;
      this.#socket = null;
      for (const { reject } of this.#pending.values()) reject(new Error("connection closed"));
      this.#pending.clear();
      if (this.#retry !== "stopped") this.#retry = setTimeout(() => this.#connect(), RETRY_MS);
    });
    socket.write(encode(OP.HANDSHAKE, { v: 1, client_id: this.#clientId }));
  }

  #onData(chunk) {
    this.#buffer = Buffer.concat([this.#buffer, chunk]);
    while (this.#buffer.length >= 8) {
      const op = this.#buffer.readInt32LE(0);
      const length = this.#buffer.readInt32LE(4);
      if (this.#buffer.length < 8 + length) return;
      const body = this.#buffer.subarray(8, 8 + length).toString("utf8");
      this.#buffer = this.#buffer.subarray(8 + length);
      let message;
      try {
        message = JSON.parse(body);
      } catch {
        continue;
      }
      this.#onMessage(op, message);
    }
  }

  #onMessage(op, message) {
    if (op === OP.PING) {
      this.#socket?.write(encode(OP.PONG, message));
      return;
    }
    if (op === OP.CLOSE) {
      // Usually a wrong client ID.
      this.#log(`Discord RPC: closed by Discord (${message.code}: ${message.message})`);
      this.#socket?.end();
      return;
    }
    if (message.cmd === "DISPATCH" && message.evt === "READY") {
      this.#ready = true;
      this.#log(`Discord RPC: connected as ${message.data?.user?.username ?? "?"}`);
      if (this.#activity) this.#send(this.#activity).catch(() => {});
      return;
    }
    const waiting = message.nonce && this.#pending.get(message.nonce);
    if (waiting) {
      this.#pending.delete(message.nonce);
      if (message.evt === "ERROR") waiting.reject(new Error(message.data?.message ?? "unknown error"));
      else waiting.resolve(message.data);
    }
  }

  #request(cmd, args) {
    return new Promise((resolve, reject) => {
      const nonce = randomUUID();
      this.#pending.set(nonce, { resolve, reject });
      this.#socket.write(encode(OP.FRAME, { cmd, args, nonce }));
      setTimeout(() => {
        if (this.#pending.delete(nonce)) reject(new Error("no answer from Discord"));
      }, 10_000);
    });
  }

  async #send(activity) {
    const strip = (a) => a && Object.fromEntries(Object.entries(a).filter(([k]) => !NEW_FIELDS.includes(k)));
    try {
      await this.#request("SET_ACTIVITY", { pid: process.pid, activity: this.#legacy ? strip(activity) : activity });
    } catch (err) {
      const hasNew = activity && NEW_FIELDS.some((k) => k in activity);
      if (!this.#legacy && hasNew) {
        this.#log(`Discord RPC: activity rejected (${err.message}), trying again without newer fields`);
        this.#legacy = true;
        return this.#send(activity);
      }
      this.#log(`Discord RPC: could not set activity (${err.message})`);
    }
  }
}
