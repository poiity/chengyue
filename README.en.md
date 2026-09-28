# Chengyue · Pixiv Light

English | [简体中文](README.md)

A lightweight Windows desktop app for browsing and downloading from Pixiv: personal recommendations, your following feed, bookmark management, animation playback and export, and batch downloads of original images. Built on Electron with no third-party runtime dependencies.

> This project is not affiliated with pixiv Inc. and is not an official client. Use it with your own account for content you are allowed to view; it does not bypass membership, age or access restrictions.

## Features

- **For you / Trending** — local tag preferences + Pixiv recommendations + daily rankings; bookmarked and already-viewed works are hidden. 18+ is off by default, and while off it also hides works tagged R-18 and works Pixiv marks as sensitive.
- **Following feed** — all new works, or works from one artist category (newest first). **Followed artists** lists artists by category.
- **My bookmarks** — filter by visibility, order, age rating, bookmark tag, artwork tags and **bookmark month (the same data as the website)**. **Manage bookmarks** makes bookmarks public / private in bulk or removes them.
- **Bookmark archive** — bookmarks you view in the app are recorded locally (title, artist, tags, thumbnail), so works later deleted or hidden by their artists still show what they were.
- **Viewer** — page navigation, arrow keys, animation playback, related works that load as you scroll, one-click bookmark, follow.
- **Search** — tags (with Japanese tag suggestions), artist UID or artwork ID; Pixiv links can be pasted.
- **Downloads** — original images, custom page ranges (e.g. `1-4,9-13`), animations as GIF or original frames; save as folders, one ZIP per work, or one combined ZIP.
- **Chinese / English** — follows the Windows display language by default; switch in Preferences.
- **Also** — light / dark / system theme, close to tray or quit, proxy and image mirror routes (e.g. i.pixiv.re), a local error log, and a blinking mascot.

## Getting started

1. Download `Chengyue-v1.0-Windows-x64.zip` from [Releases](https://github.com/poiity/chengyue/releases), extract everything, and run `PixivLight.exe` (Windows 10/11 x64, no installation).
2. Click **Sign in to Pixiv** and sign in on the official Pixiv page. The app detects the sign-in and closes the window.
3. If Pixiv is unreachable, use a system proxy / VPN, or enter a proxy address in Preferences (e.g. `http://127.0.0.1:7890`).

## Bookmark dates

Like the website, the app reads bookmark months from Pixiv's monthly summary (`/ajax/user/{id}/illusts/bookmarks/periods`; the list takes `bm=YYYYMM`, e.g. `bm=202609`). The **Bookmarked in** menu lists months with counts; the first visit to My bookmarks syncs each month once in the background and stores the month of every work locally; later visits only re-read months whose count changed.

- **Browsing bookmarks by month is a Premium feature on the Pixiv website.** For accounts without Premium, or when Pixiv provides no data, the app says so and only shows dates for works bookmarked through the app.
- Pixiv provides months, not exact days. Works bookmarked through the app also get an exact date.
- If Pixiv ignores the month filter (the returned count clearly differs from the monthly summary), the sync stops rather than assigning wrong months.

## Privacy and security

- Your password is only entered on Pixiv's official sign-in page; it never passes through this app's interface or IPC.
- The interface runs sandboxed and can only call allow-listed actions, whose caller is verified; a strict Content Security Policy blocks external scripts, network requests and embedded pages. Text from Pixiv is always escaped, and artwork IDs must be numeric.
- Sign-in detection runs in an isolated world; web permissions are denied; only one instance runs at a time.
- Bookmark and follow writes are never retried automatically; bulk removal and clearing history ask for confirmation.
- Image mirrors only receive public image addresses, never cookies or account data.
- Local data: session, settings, download history, tag preferences, bookmark dates and months, bookmark archive, error log (cookies, tokens and the Windows user name are redacted). Browsing history stays in memory and is cleared on quit.

Pixiv's web API is not a stable public API; site changes may require updates.

## Development

Requires Node.js 22.12+ and pnpm.

```powershell
pnpm install     # installs Electron only (dev dependency)
pnpm start
pnpm test        # node --test
pnpm run pack    # portable folder + ZIPs next to the project folder
```

The interface text is written in Chinese; `ui/js/locale-en.js` maps it to English and `ui/js/i18n.js` applies it. See the Chinese README for the full directory overview, and [CHANGELOG.md](CHANGELOG.md) for release notes.

## License

Released under the [MIT License](LICENSE). The mascot, Chengcheng, is an original design by the author.
