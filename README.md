# Nyashki

A real-time watch room with a shared chat, video queue, voting, and host controls.

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/imranqq/nyashki)

## Run locally

```powershell
npm install
npm run dev
```

Open `http://localhost:5173/`. The command starts both the Vite app and the Socket.IO room server. Room state is stored in `server/data/rooms.json`, so restarting the server keeps chat, queue, votes and the selected video. Set `NYASHKI_DATA_DIR` to store it somewhere else.

## How a room works

- A new room starts empty: no sample film and no sample chat.
- Paste a video link into the player and it starts for everyone at once. YouTube, Rutube, VK Видео and direct MP4/WebM links work.
- The host is the person who joined the room last. Guests who paste a link send it to the queue instead.
- A guest without a profile name becomes `Пользователь 1`, `Пользователь 2`, and so on. The number is the lowest free one in the room, stays the same after a reload, and is reused once someone leaves. A custom name in the profile replaces it.
- Anyone can add links to the queue and vote; only the host starts playback.
- Only the host can pause, resume, seek, and skip ±10 seconds. Guests see the same timeline and controls, but disabled with a lock.

## Invite friends

**Пригласить** opens the room dialog: the share link, the room code, and a field to join another room by its code. A code can be a bare value like `71467f2a-ce5` or a whole link — the room part is taken from it.

A room lives in the `?room=` part of the URL. Opening the bare site address (no `?room=`) creates a brand new room, so a friend who typed the domain instead of using the link sits alone — send the link, or tell them the room code and use **Войти по коду**. On `localhost` the copied link only works on that computer; open the site by the tunnel address and copy the link there.

## Share a room

For a temporary internet link, install Cloudflare Tunnel once and then use the bundled command:

```powershell
npm run share
```

It starts the site if it is not running yet, opens a Quick Tunnel, and prints everything needed:

```text
Ссылка для друзей:
  https://<random>.trycloudflare.com/?room=vecher-46df

Код комнаты: vecher-46df
```

Cloudflare publishes a new hostname in DNS with a delay of one to three minutes. The command keeps checking and prints «Ссылка открывается» once the address is live. Ctrl+C stops the tunnel, and the site as well if this command started it. The address changes on every start; Quick Tunnels are temporary and are not production hosting.

The room code is stored in `.nyashki-room`, so restarting the command brings everyone back to the same room with its chat and queue. Use `npm run share -- --room=<code>` (or `NYASHKI_ROOM`) to open another room.

The manual equivalent, if you prefer separate terminal windows:

```powershell
cloudflared tunnel --url http://127.0.0.1:5173
```

## Host on Render (free)

`render.yaml` describes a free Node web service that builds the site and runs `server/index.js` on one port: the same process answers Socket.IO and serves `dist/`.

1. Push the repository to GitHub.
2. In Render open **New → Blueprint**, pick the repository, and apply. Render reads `render.yaml`, runs `npm ci && npm run build`, then `npm start`.
3. Wait for the deploy, then open `https://<service-name>.onrender.com/?room=<code>`.

The client connects to Socket.IO on its own origin, so no extra URL configuration is needed. A long-lived host also makes the microphone work without a tunnel, because the page is served over `https://`.

Free plan caveats:

- The service sleeps after about 15 minutes without visitors; the first request afterwards waits about a minute while it starts.
- The filesystem is temporary: `server/data/rooms.json` survives while the instance runs, but a deploy or restart starts from an empty state. Nothing else is lost, because playback state is rebuilt from the room itself.
- There is no persistent disk on the free plan, so a room's chat history is not guaranteed between deploys.

## Current limits

- Chat, room members, queue, votes, and playback state are shared in real time while the server is running. After a restart the room comes back with playback paused, and whoever reconnects last becomes the host.
- Synchronized play, pause, seeking and the ±10 second buttons work for YouTube, Rutube, VK Video and direct MP4/WebM. Only the host controls playback; everyone else follows and sees disabled controls. Providers without a JavaScript API fall back to their own player controls with a note.

## Voice chat

- The **Голос** tab sends your microphone straight to the other people in the room over WebRTC. The room server only relays the offers, answers and ICE candidates; audio never passes through it and is not stored.
- It needs a microphone permission and a secure page: `https://` (the Cloudflare Tunnel link) or `localhost`. Two tabs on the same machine work too.
- Mute stops your own track, so the room sees «микрофон выключен». Every strip has a live level meter and a lime ring while that person speaks.
- Connections are peer to peer with `stun.l.google.com:19302` as the only STUN server. If a strict corporate network blocks peer connections, the call can fail — there is no TURN relay yet.
- One browser tab per person: two tabs share the same room identity and will fight over the voice slot.

## Saved state

- Rooms live in `server/data/rooms.json`: the last 100 messages of each room, the queue and votes, playback position, and the time of the last activity. Oversized image attachments are dropped from the oldest messages to keep the file under 4 MB. User profile settings remain in each browser.
- Rooms are pruned automatically: a room nobody entered for 30 days is deleted, and a room with no chat, queue or video is deleted after 24 hours. A room with people inside is never pruned.
- `NYASHKI_DATA_DIR` stores the file elsewhere, `NYASHKI_ROOM_TTL_DAYS` and `NYASHKI_EMPTY_ROOM_TTL_HOURS` change the retention periods.