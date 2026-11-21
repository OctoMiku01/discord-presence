# discord-presence

Kleines Hintergrundprogramm für Windows (Node.js ≥ 22, keine Pakete nötig):

1. **Song → Discord:** Was du gerade auf Last.fm scrobbelst, erscheint in deinem Discord-Status als „Listening to *Song*“, mit Künstler, Cover, Fortschrittsbalken (wenn Last.fm die Länge kennt) und einem „View on Last.fm“-Button. Hörst du über ein mit Discord verbundenes Spotify, tritt es zur Seite, damit der Song nicht doppelt erscheint.
2. **Discord → mikubeam.de:** Ein eigener Discord-Bot liest deinen Status mit. Die Spiele darin (z. B. Minecraft) schickt das Programm an mikubeam.de; dort stehen sie im „Right now“-Kasten als „Playing · 1 h 20 min“ mit Spiele-Icon. Bist du offline oder unsichtbar, erscheint nichts.

Beide Teile sind unabhängig: Fehlen die Angaben für einen Teil in der `config.json`, läuft nur der andere.

## Einrichtung

### 1. Discord-App und Bot

1. Auf [discord.com/developers/applications](https://discord.com/developers/applications) → **New Application**. Der Name erscheint im Profil als „Listening to *Name*“, z. B. `Music`.
2. **General Information:** *Application ID* kopieren → `discord.clientId`.
3. **Bot:** *Reset Token* → Token kopieren → `discord.botToken` (geheim halten!). Darunter unter *Privileged Gateway Intents* **Presence Intent** einschalten. *Public Bot* kann aus.
4. Bot auf einen Server einladen, auf dem du auch bist (am besten ein eigener, privater Server): **OAuth2 → URL Generator**, Scope `bot`, keine Rechte ankreuzen, Link öffnen.
5. Deine eigene Nutzer-ID: In Discord *Einstellungen → Erweitert → Entwicklermodus* an, dann Rechtsklick auf deinen Namen → *Nutzer-ID kopieren* → `discord.userId`.
6. In Discord unter *Einstellungen → Aktivitätsprivatsphäre* muss „Aktuelle Aktivität als Statusmeldung teilen“ an sein, sonst sieht der Bot keine Spiele.

### 2. Website

Eine lange Zufallszeichenfolge erzeugen, z. B. in PowerShell:

```powershell
[Convert]::ToBase64String((1..32 | ForEach-Object { Get-Random -Max 256 }) -as [byte[]])
```

Diese im Cloudflare-Dashboard unter *Worker → Settings → Variables and Secrets* als Secret **`PRESENCE_TOKEN`** eintragen und dieselbe Zeichenfolge in `site.token`. In der `config.json` der Website muss `"now": { …, "discord": true }` stehen.

### 3. Konfiguration

`config.example.json` nach `config.json` kopieren und ausfüllen. `lastfm.apiKey` ist derselbe Schlüssel wie das Secret `LASTFM_API_KEY` der Website (oder ein neuer von [last.fm/api/account/create](https://www.last.fm/api/account/create)).

```json
{
  "discord": { "clientId": "…", "botToken": "…", "userId": "…" },
  "lastfm": { "user": "OctoMiku01", "apiKey": "…" },
  "site": { "url": "https://mikubeam.de", "token": "…" }
}
```

`config.json` steht in `.gitignore` und darf nie committet werden.

## Starten

- **Zum Testen** mit Konsole: `npm start` (Beenden mit Strg+C – dann wird der Status sofort geleert).
- **Unsichtbar im Hintergrund:** `start-hidden.vbs` doppelklicken. Beim ersten Mal trägt es sich auch in den Windows-Autostart ein, danach startet das Programm bei jeder Anmeldung von selbst. Ausgaben landen in `presence.log`.
- **Autostart entfernen:** `powershell -ExecutionPolicy Bypass -File autostart.ps1 -Remove` (ohne `-Remove` trägt es ihn wieder ein, ohne zu starten).
- **Beenden:** `stop.cmd`. Die Spiele verschwinden dann spätestens nach 3 Minuten von der Website.

Es läuft immer nur eine Kopie; ein zweiter Start beendet sich sofort.

## Wie es funktioniert

- **Musik:** Alle 10 s fragt das Programm Last.fm nach dem aktuellen Song (`user.getRecentTracks`), holt einmal pro Song die Länge (`track.getInfo`) und das Cover und setzt die Aktivität über die lokale Discord-RPC-Schnittstelle (`\\.\pipe\discord-ipc-0`). Discord muss als Desktop-App laufen; wird es geschlossen und wieder geöffnet, verbindet sich das Programm von selbst neu.
- **Cover:** Das Programm fragt die Website (`GET /api/cover`, mit demselben Token). Die sucht genau wie im „Right now“-Kasten – Last.fm, iTunes, Deezer, zuletzt YouTube – und merkt sich das Ergebnis eine Woche, sodass Discord und Website dasselbe Bild zeigen und der YouTube-Schlüssel in Cloudflare bleibt. Ist die Website nicht erreichbar, sucht das Programm selbst bei Last.fm und iTunes.
- **Spiele:** Der Bot verbindet sich mit dem Discord-Gateway (nur die Intents `GUILDS` und `GUILD_PRESENCES`) und bekommt so jede Statusänderung von dir. Spiele sind Aktivitäten vom Typ „Playing“; die eigene Musik-Aktivität wird ignoriert. Das Icon kommt aus Discords öffentlichen App-Infos. Bei jeder Änderung und sonst jede Minute geht `POST /api/presence` an die Website; die Seite zeigt Spiele nur, solange die letzte Meldung höchstens 3 Minuten alt ist.
- Übertragen werden nur Status (online/idle/dnd/offline) und je Spiel Name, Details, Startzeit und Icon-URL – höchstens 3 Spiele.
