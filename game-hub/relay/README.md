# Room relay for online games

A tiny relay that lets friends play the hub's online games together while the hub itself stays a static site.

**It is written but not deployed or connected yet.** Until `RELAY_URL` in `../src/hub/config.ts` is set, the games show
"Online play is not switched on yet" and everything else works (solo play against computers needs no relay at all).

## What it does (and does not)

- Rooms are named by a five-character code. The first player in is the host, and also sets the room's size (2 to 10, the game decides: Gem Merchants asks for 4, Pit Brawl for 10); later joiners cannot change it.
- It keeps an ordered log of actions and sends each one to everybody. It never looks at what an action means: every device
  replays the same log through the same game engine, so they agree, and an illegal action changes nothing for anyone.
- A player who drops out (a phone going to sleep) comes back with a token kept in their browser tab and is sent the log.
- If the host leaves, the next player's device takes over playing the computer seats.
- All the room logic is `../src/net/roomCore.ts` (no platform code, fully unit-tested). `src/worker.ts` is only the
  Cloudflare wrapper: it checks the address, the Origin and the WebSocket upgrade, and rate-limits each connection.

## Deploy to Cloudflare (when you are ready)

You need a free Cloudflare account. Workers do not pause when idle.

```bash
cd relay
npx wrangler login
npx wrangler deploy
```

Wrangler prints a URL like `https://paper-arcade-relay.<your-subdomain>.workers.dev`. Then:

1. In `../src/hub/config.ts` set `RELAY_URL = 'wss://paper-arcade-relay.<your-subdomain>.workers.dev'`.
2. In `wrangler.toml` set `ALLOWED_ORIGINS` to the address the hub is served from (for example `https://yourname.github.io`),
   and run `npx wrangler deploy` again, so only your site can open rooms.
3. Rebuild and publish the hub.

Check the current Cloudflare free-plan limits for Workers and Durable Objects before relying on them; a turn-based card
game sends only a few messages a minute per player.

## Run it locally

```bash
npm run relay:dev          # ws://127.0.0.1:8787, the same RoomCore as the Worker
```

Then open the hub with `#/play/gem-merchants?relay=ws://127.0.0.1:8787` (the hub accepts that override only for
localhost addresses). The browser tests start this relay themselves.
