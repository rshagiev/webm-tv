# Changelog

## 0.4.0

- Shared server access for protected boards and video streaming, with independent playback and history for each viewer.
- Community access recovery: solve a CAPTCHA and explicitly send one test comment to restore the server session for everyone.
- A focused recovery screen with mobile layout, progress steps, and a verified success state.
- Protected media supports seeking and client cancellation; public files stream directly from the source. No video archive is stored.
- Reply indexing prioritizes the selected thread; rapid navigation keeps playback and history consistent.

## 0.3.0

- Background startup by double-clicking WebM TV.app on macOS or Start.vbs / Start.cmd on Windows. Opens the browser when ready and reuses an already running server.
- Power button shuts down the server and its launcher; the metadata index is flushed before exit.
- Information button shows the version, localhost URL and LAN addresses, with copy controls.
- Mobile header uses swipes for navigation, without previous/next buttons.
- Updated Russian and English setup instructions and interface screenshots.
- CI covers foreground and background startup, duplicate launches and authorized shutdown on Linux, macOS and Windows.

## 0.2.0

- First public release with one-command setup and LAN playback.
- Thread-based feeds and collections, duration filters, descending video counts, bookmarks and local personalization.
- Mobile swipe navigation and desktop keyboard controls.
- Sidebar retains loaded topics during temporary connection failures.
