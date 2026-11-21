// Asks the running discord-presence to shut down cleanly: it clears the Discord status and tells
// the website right away that no game is running. Used by stop.cmd.

import net from "node:net";

const LOCK = process.platform === "win32" ? "\\\\.\\pipe\\discord-presence-lock" : "/tmp/discord-presence.lock";

const socket = net.connect(LOCK);
const timer = setTimeout(() => {
  console.log("No answer from discord-presence within 15 s.");
  process.exit(1);
}, 15_000);

socket.on("connect", () => socket.write("stop\n"));
socket.on("data", () => {});
let failed = false;
socket.on("close", () => {
  clearTimeout(timer);
  if (!failed) console.log("discord-presence stopped.");
});
socket.on("error", (err) => {
  failed = true;
  clearTimeout(timer);
  console.log(err.code === "ENOENT" ? "discord-presence is not running." : `Could not reach discord-presence: ${err.message}`);
  process.exitCode = 1;
});
