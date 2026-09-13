# WebM TV — self-hosted 2ch video player

[Русский](README.md) · [Releases](https://github.com/rshagiev/webm-tv/releases) · [Quick start](#quick-start) · [Watch on your phone](#watch-on-your-phone)

Random WebM and MP4 videos from 2ch.hk threads and replies. Choose the whole site, a board or a thread, then browse with keyboard controls or mobile swipes.

![WebM TV: desktop interface and thread navigation](docs/images/desktop.png)

## Quick start

Install **[Node.js LTS](https://nodejs.org/), version 22.12 or newer**. npm comes with Node.js.

1. [Download the ZIP](https://github.com/rshagiev/webm-tv/releases/latest/download/webm-tv.zip) and extract it.
2. Open a terminal in the extracted folder and run:

```sh
npm start
```

The first launch installs dependencies and builds the interface. Open **http://localhost:4173**. Keep the terminal running; press `Ctrl+C` to stop.

On macOS you can open `Start.command`; on Windows, `Start.cmd`. If macOS blocks the downloaded launcher, use the terminal command above. Installation and video playback require internet access.

Or use Git:

```sh
git clone https://github.com/rshagiev/webm-tv.git
cd webm-tv
npm start
```

## Watch on your phone

The mobile player fills the screen. Swipe up for the next clip and down for the previous one; tap the video to pause. Open the top-left menu to choose a board, thread or collection. Browse the combined feed, then stay in a thread you like.

<p>
  <img src="docs/images/mobile.png" width="260" alt="WebM TV mobile start screen and player controls">
  <img src="docs/images/mobile-channels.png" width="260" alt="Mobile channel browser with minimum-duration filter">
</p>

*Start screen and channel browser at a 390 px viewport width.*

No phone app installation is needed. Open the site in your browser while the server runs on your computer:

Connect your computer and phone to the same Wi-Fi network. The server prints addresses such as:

```text
This computer: http://localhost:4173
Local network: http://192.168.1.20:4173
```

Open **the Local network address printed on your computer** on your phone. The address above is an example. `localhost` on your phone refers to the phone itself.

Keep the computer awake and the server running. If several addresses appear, use Wi-Fi/Ethernet rather than VPN. Check the computer firewall and guest-network device isolation if the connection fails.

## Controls and features

- Browse **category → board → thread**, or play any branch as a combined feed. Attachments from replies are included.
- Swipe up / press `→` for next; swipe down / press `←` for previous. Space pauses, `F` expands the player and `M` toggles sound.
- Stay in the current thread without restarting the playing video.
- Filter videos by minimum duration: 1, 3, 5 or 10 minutes. Counts and descending tree order reflect the filter.
- Combine sources into collections; bookmark or hide clips.
- Personalization is local to this browser and can be disabled or reset in Sources. Interface labels currently use Russian.

The adult category is excluded from the root feed by default. Source categories are not a content-safety classifier; other boards may also contain adult material.

## FAQ

**Do I need a video archive?** No. The server gradually indexes metadata in `data/`; media streams directly from the source. A fresh installation needs time to populate the tree.

**Why does a video fail?** Files may be deleted, the source unavailable, or a codec unsupported. WebM/MP4 container support does not guarantee every codec. The player skips failed clips and reports repeated failures.

**Why is sound muted on my phone?** Browser autoplay policies can require a separate tap to enable audio.

**Where are my bookmarks?** In this browser's local storage. Devices and different site addresses have separate settings; there is no sync.

**Port 4173 is busy?** WebM TV might already be running. Open http://localhost:4173 or stop the previous process.

**Can I expose it publicly?** This version is intended for your computer and a trusted LAN. It has no authentication or public-hosting setup.

## Development

React, TypeScript and Vite with a small Fastify server. No database or separate media server required.

```sh
npm ci
npm test
npm run build
npm run serve
```

For development, run `npm run dev` and `npm run dev:ui` in separate terminals. The UI development server uses port 5173. `npm start` rebuilds the interface on each launch.

Optional environment variables: `HOST=127.0.0.1` restricts access to this computer; `SOURCE_HOST=2ch.su` selects the alternate supported mirror; `LOG_REQUESTS=1` enables HTTP request logs. Defaults work without configuration and listen on local IPv4 interfaces at port 4173.

[Architecture](docs/architecture.md) · [MIT license](LICENSE)

Inspired by [Karasiq/webm-tv](https://github.com/Karasiq/webm-tv). An independent TypeScript implementation, not an official 2ch client. Source videos and posts belong to their respective authors and are not bundled.
