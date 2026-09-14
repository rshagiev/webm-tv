# Architecture

One Node.js process serves a Vite-built React app and a Fastify API on port 4173.

- `server/source.ts` fetches public board, catalog and full-thread JSON. It extracts WebM/MP4 attachments from every post and keeps the original post link. Fetch concurrency and timeouts are bounded.
- `server/library.ts` gradually warms a persistent metadata index while the app is open. `data/` stores metadata and JSON caches, not a video archive.
- `server/feed.ts` creates cancellable feed jobs for selected branches. The client receives incremental results while scanning continues.
- `server/library-state.ts` supplies counts and samples filtered by minimum duration. The tree sorts categories, boards and threads by descending matching count.
- `src/Player.tsx` uses three video slots to retain neighboring buffers. Only the active slot contributes playback observations. Next-video loading waits for active playback and a four-second buffer (or a fully buffered short clip); previous buffers are retained without speculative re-downloads. Failed prepared candidates are replaced before selection. Video slots request `/api/media/...`; without a configured source session the server redirects to the source, and with a session it streams the video.
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

## Shared clips

Mobile actions are Share → Bookmark → Hide. Sharing creates `/watch/:board/:thread/:file` on the current service origin; neither the original media URL nor viewer preferences are embedded. `GET /api/clips/:board/:thread/:file` resolves the exact attachment from the common metadata index, with strict path validation and a one-minute public cache. It does not start a separate crawl for each recipient. Missing attachments return 404, never a random substitute.

Recipients see the thread title and press Watch to start that attachment; subsequent swipes continue the normal feed. A shared 18+ attachment is labelled before playback and does not silently enable adult sources in the recipient's general feed. The direct attachment can be watched independently of their duration filter; subsequent recommendations retain their filters. Choosing a different channel cancels a pending shared-link request.

The share button calls the native [Web Share API](https://developer.mozilla.org/en-US/docs/Web/API/Navigator/share) directly from the click handler, preserving user activation. Where unavailable, it copies the service link; if clipboard access is unavailable, a selectable link appears in a native HTML dialog. Cancelling the OS share sheet is silent. Source videos are not archived: a link cannot guarantee playback after the attachment disappears from the index or source.

## Playback selection consistency

History and its selected position update together through `src/playback-history.ts`. In the previous implementation, two advances in one React batch sliced history using the same captured position but incremented the cursor twice. The cursor could point past the last clip while the imperative player had already started a video, leaving the loading screen over audible playback. The reducer appends against its latest state and derives the cursor from the resulting history length, including the 200-item limit and navigation branches.

When no clip is selected, Player invalidates pending playback promises and pauses, mutes and clears every video slot. Tests cover batched advances, history rollover, branching, resets and bounds. Mobile-size browser checks exercise repeated swipes and rapid keyboard advances; physical iPhone reproduction remains unverified.

## Shared crawl queue

`server/crawl-queue.ts` schedules full-thread reads independently of video counts in the opening post. Each board alternates never-read threads with due rechecks, ordered by discovery/read age. Catalog updates preserve the last successful read time and mark changed threads stale instead of resetting their history. Changed threads become eligible after one minute; unchanged threads after fifteen minutes. These are minimum intervals, not completion deadlines.

Background board scheduling uses weighted round-robin: the source registry's activity value gives a bounded weight from 1 to 5. Busy boards receive more turns while quiet boards retain a share. The registry is reconsidered every minute, with its source JSON cached for five minutes. Catalog eligibility is one minute for active boards and five minutes otherwise; the worker also discovers previously missing catalogs. Boards absent from the source registry are not automatically discovered.

Selecting a board or exact thread adds a shared, deduplicated request, bounded to 128 entries with a two-minute lifetime. Exact threads precede board requests; after at most two priority reads, the worker takes a background turn. A selected thread is not fetched again within one minute of its last successful read, and failures back off for one minute. One worker performs catalog and thread reads sequentially, retaining the existing global source-fetch concurrency bound. More viewers do not create additional crawlers or video downloads.

The normal tree still shows found videos. “Показать непроверенные треды” exposes the full list so a viewer can request an unverified thread. The public batch distinguishes pending indexing from a successfully checked empty result; the latter ends the loading state. Duration filters and descending video-count sorting remain applicable.

## Source session

Some source boards return an HTML “Not found” page (currently HTTP 500) to anonymous requests despite appearing in `/index.json`. A browser experiment on 2026-09-14 opened `/hc/` and `/e/` after a test post. A subsequent controlled request to `/hc/catalog.json` returned HTTP 500 without cookies and HTTP 200 with 201 threads using only `usercode_auth`, on each of `2ch.org`, `2ch.su`, and `2ch.hk`. The actual server parser also read full threads: one sampled `/e/` thread contained 73 reply videos. No other browser cookies or browser User-Agent were required in this experiment.

The crawler optionally reads `data/source-usercode.txt` (under `WEBMTV_DATA_DIR` when set), or the explicit path `SOURCE_USERCODE_FILE`. The file contains only the value of the source's `usercode_auth` cookie. It is read for each source JSON request; replacing it changes the JSON cache and in-flight request namespace. A missing default file means anonymous access. An unreadable explicit file or malformed value fails without printing the value or path. Keep this file local, outside Git, with permissions limited to the server user.

The cookie is sent only to the configured, allowlisted `SOURCE_HOST`; redirects remain disabled. It is not added to client responses. Media requests use the same server-side session. The tested Safari cookie from `2ch.org` worked with both allowlisted mirrors, including the default `2ch.hk`. Session lifetime has not been established. A fresh community session was verified from both the local machine and the public VPS on 2026-09-14. Sample media requests returned HTML/500 without the cookie and video/206 with it. Browser session extraction and automatic posting are not implemented.

Existing metadata in the shared library is retained, including after removing the cookie. In public mode, indexed clips remain part of the shared adult-source catalog under its existing opt-in rule; this is a server source session, not per-viewer authentication.

## Authenticated media streaming

`server/media.ts` handles GET/HEAD `/api/media/{board}/src/{thread}/{file}`. All three player slots use this route while history retains original source URLs. Without a source session the route redirects directly; with a session it streams the upstream body with backpressure and aborts upstream reads on client disconnect. Videos are never saved to disk. The server carries protected playback bandwidth when a session is configured, including in public mode; readable public files redirect directly.

Only validated source media paths are accepted. Redirects are limited to two and must retain the exact path on the allowlisted HTTPS mirrors, with no credentials, nonstandard ports, queries, or fragments. Only the server cookie is forwarded. Single byte ranges and If-Range are supported, along with HEAD and upstream 416 Content-Range. HTML error pages become 502; upstream Set-Cookie is never forwarded. Responses use private, no-store. A 15-second timeout covers connection/headers, not the duration of the streamed clip.

Local browser verification on 2026-09-14: authenticated MP4 decoded (`readyState=4`, advancing playback time); five rapid next actions and back recovered without the consecutive-failure banner, with one playing slot. A seek selected 57.8 seconds; duration-filter and source changes retained one playing slot. This was the in-app browser, not the user’s Safari window or a physical iPhone.

## Community recovery and shared session ownership

The source session belongs to the server. Viewer history/preferences remain browser-local. `/api/source-access` checks a protected catalog with the current server session and uses anonymous `/b/` as a control: a failed protected read with a working control requests community help, while a source outage does not invite posting. Checks are deduplicated and cached for one minute. The response exposes status and a retry time, never credentials.

`SourceRecovery` owns one expiring attempt at a time. Its cookie jar starts empty, so a contributor's personal browser session is never imported. The server requests the source's EmojiCaptcha, relays only images and keyboard choices, and forwards explicit human clicks to the captcha endpoint. `/restore-access` exposes the same recovery component independently of playback. An explicit button publishes exactly `test` to one current open thread in `/test/`; neither destination nor text can be supplied through the API. The source's bounded SHA-512 proof-of-work is computed as its first-party posting form does; the visual CAPTCHA is solved by the contributor.

The current flow is: needs-help → captcha → solved → submitted → verified, with uncertain as a possible outcome after submission. The attempt is persisted before posting, including its phase, private cookie jar, and random controller token. A submitted attempt restored after a crash becomes uncertain. Repeated submit calls only check access and never post again. An uncertain response retains any received cookie and offers read-only verification. Only a successful protected-catalog read with the candidate cookie allows an atomic 0600 replacement of the shared session file. The previous working file remains intact on failed verification. Saving succeeds before the UI reports verified. The completed attempt drops its temporary cookie jar.

Attempt state lives in `source-recovery.json` under the data directory with mode 0600; it is not a public API artifact. The controller token is kept in the contributor's sessionStorage for reload recovery and is never included in the shared status. Captcha attempts last five minutes; submission extends the verification window/cooldown to ten minutes. One active mutation is allowed; there is no automatic posting or retry loop. Custom action headers and the existing Host/Origin checks prevent cross-origin browser submissions. This is a communal facility without user accounts; application and nginx rate limits bound its use, but they cannot identify individual people behind an IP.

Authenticated media now first checks anonymous HEAD access, caching the result per exact path for five minutes (at most 2048 entries). Readable files redirect directly to the final allowlisted mirror; only protected files are streamed with the server cookie. Streaming/probe admission is capped at six requests per client IP and 32 globally. Capacity is released on finish/disconnect. Nginx trusts only its own forwarded client IP, and the app accepts forwarded addresses only from loopback in public mode. The dedicated nginx media location disables caching and disk buffering; deploying app code alone does not install this nginx change.

Tests cover one-post semantics across repeated requests and process reconstruction, refusal to save an unverified candidate, fixed post content/destination, non-disclosure of cookie values, controller ownership, direct open-media delivery, per-IP limits, and independent capacity for a second client. Live verification on 2026-09-14: the contributor solved the relayed CAPTCHA and confirmed submission, producing /test/res/247489.html#249179. The attempt reached verified, cleared its temporary cookie jar, and saved a fresh private session. This session opened both /hc/ and /e/ catalogs from the local machine and the public VPS. The recovery UI uses distinct initial, CAPTCHA, confirmation, pending, uncertain, expired, and success states.

## Unified source tree

The tree has one mode: include unread branches, hide fully checked empty branches. With a duration filter, only branches with matching videos remain visible. `indexState` is independent of video availability and duration: pending until every current thread is read and fresh, error if a read failed, complete otherwise. The muted spinner represents unfinished checking, not a guarantee of an active request at that instant; the check mark represents a fully checked snapshot. Category status includes all its boards, including those outside the search result.

## Quick reload recovery

On pagehide only, the current tab writes a bounded playback snapshot to sessionStorage: history/cursor, selected sources, current active media time, and playback intent. No timeupdate persistence or periodic tracking is added. Initialization consumes a same-path snapshot no older than five minutes; malformed, expired, or other-path snapshots are discarded. The player applies the saved offset once, on metadata for the matching clip, clamps it to duration, and drops the pending seek when the selected clip changes. Paused playback stays paused; browser autoplay rules still apply to playing snapshots. This is reload recovery, not durable watch history or crash recovery.

## Personal thread exclusions

`excludedThreads` stores board/thread identities and display titles in this browser's localStorage. The shared metadata index and other viewers are unchanged. Exclusions filter candidate selection, refill availability and prepared media; history is pruned atomically, and a blocked current clip is stopped and cleared. Excluding a directly selected thread returns to the root feed. Reload recovery filters its saved history against current exclusions; explicit shared links also respect them. The eye button still hides one clip immediately and offers a persistent, dismissible “exclude thread” action. Thread rows expose an explicit details menu; excluded rows stay identifiable and can be restored there or in Sources. Undo restores the thread, not a previously hidden individual clip.

## Local settings reset

Sources offers a confirmed settings reset. It removes only localStorage keys prefixed with `webmtv:`, preserving `webmtv:saved` bookmarks and unrelated origin data. This clears collections, hidden clips, excluded threads, interests, seen clips, filters and volume. It removes the current tab's reload checkpoint and navigates to the root to initialize defaults. A synchronous reset guard suppresses playback observations and pagehide checkpoint recovery during navigation, preventing the previous feed from being restored. Storage failures are shown in the confirmation dialog.
