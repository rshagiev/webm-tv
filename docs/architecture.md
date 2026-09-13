# Architecture

One Node.js process serves a Vite-built React app and a Fastify API on port 4173.

- `server/source.ts` fetches public board, catalog and full-thread JSON. It extracts WebM/MP4 attachments from every post and keeps the original post link. Fetch concurrency and timeouts are bounded.
- `server/library.ts` gradually warms a persistent metadata index while the app is open. `data/` stores metadata and JSON caches, not a video archive.
- `server/feed.ts` creates cancellable feed jobs for selected branches. The client receives incremental results while scanning continues.
- `server/library-state.ts` supplies counts and samples filtered by minimum duration. The tree sorts categories, boards and threads by descending matching count.
- `src/Player.tsx` uses three video slots to retain neighboring buffers. Only the active slot contributes playback observations. Videos load directly from the source.
- `src/preferences.ts` maintains a small local interest profile. Watch completion, early skips, bookmarks and hides adjust thread weights; exploration and decay prevent a permanently fixed feed. No cross-user analytics are collected.
- `src/storage.ts` keeps preferences, bookmarks and collections in browser storage. There are no accounts or device synchronization.

`npm start` uses a dependency-free Node launcher: on first launch it runs `npm ci`, builds the UI and starts the server. `npm run serve` starts an already built installation.

LAN requests are accepted for the computer's current IPv4 addresses. Host and Origin checks do not replace authentication; this is intended for a trusted local network.

## Desktop lifecycle

`WebM TV.app` (macOS) and `Start.vbs` / `Start.cmd` (Windows) run `scripts/desktop.mjs`. It checks the health endpoint, serializes startup with a local PID lock, starts the launcher detached with output in `data/desktop.log`, waits for readiness, then opens the default browser. A second launch reuses the existing server. Node.js 22.12+ is still required; the app bundle must remain in the project directory.

`GET /api/system` returns the version, local URLs and a per-process shutdown token with `Cache-Control: no-store`. `POST /api/shutdown` requires that token in a custom header and passes the usual Host/Origin checks. Shutdown stops feed jobs, closes connections, flushes the metadata index and exits the server; its launcher then exits too. There is a five-second shutdown deadline. The information and power dialogs are available on desktop and mobile.

CI tests the foreground launch, authorization failures, shutdown and process exit, then background startup and duplicate-launch reuse on Windows, macOS and Linux.

## Public mode

`PUBLIC_ORIGIN` enables a read-only public service behind nginx. `GET /api/radio/:kind/:id/:bucket?adult=0&minimum=0` returns a shared batch of up to 96 indexed clips. Eight reusable buckets per branch keep URLs independent of viewer identity and watch history. Collections are merged in the browser from their constituent branches, so they do not create a combinatorial server cache. Previously opened clients can still use POST `/api/radio`, backed by these same snapshots.

`server/snapshots.ts` caches both the value and its serialized JSON, bounded to 128 entries and 8 MiB of JSON. Snapshots live up to a minute (five seconds for empty results). ETags and HTTP cache headers let nginx and browsers reuse responses or revalidate without downloading an unchanged body. Registry reads are deduplicated and cached in memory; crawl concurrency remains shared.

The browser retains at most 400 candidates, preserving space for each selected branch. It fetches when fewer than 24 unseen, non-hidden, non-failed candidates remain; exhausted buckets and complete small channels wait before retrying. Hidden tabs pause metadata requests. Tree and expanded-board refreshes slow to one minute once populated. Local mode retains its live polling and full feed jobs. See [hosting](hosting.md) and [performance](performance.md) for limits and measurements.
