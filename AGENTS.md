# Project Summary

Spooty is a self-hosted Spotify downloader. It uses Spotify metadata to find tracks on YouTube, then downloads and tags audio locally. The app is split into a NestJS backend and an Angular frontend, with real-time updates over WebSockets.

## Architecture

- Monorepo with npm workspaces: `src/backend` (NestJS) and `src/frontend` (Angular).
- Backend modules: playlist + track modules backed by TypeORM entities (`PlaylistEntity`, `TrackEntity`) stored in SQLite.
- Background processing via BullMQ queues (search + download) with Redis.
- Scheduled jobs check subscribed playlists hourly for new tracks.
- Backend serves the built frontend via `ServeStaticModule` and exposes REST APIs under `/api`.
- WebSocket events (socket.io) push playlist/track updates to the UI.

## Key Features

- Accepts Spotify playlist or track URLs; auto-detects single-track vs playlist (SpotifyApiService.isTrackUrl).
- Pulls Spotify metadata and playlist tracks via Spotify API; falls back to `spotify-url-info` when needed.
- Searches YouTube (yt-search) for each track and queues downloads via BullMQ.
- Downloads audio using `ytdlp-nodejs`, writes ID3 tags and cover art via `node-id3`.
- Stores download files under DOWNLOADS_PATH, with per‑playlist folders and safe filenames.
- Tracks status lifecycle: New → Searching → Queued → Downloading → Completed/Error.
- Retry failed tracks and delete tracks/playlists.
- Subscription mode for playlists (periodic refresh) with active toggle.
- Frontend shows playlists and tracks with progress counts, status badges, and live updates.

## Frontend

- Angular standalone app in src/frontend/src.
- State management with @ngneat/elf stores for playlists/tracks and UI state.
- REST calls to /api/playlist and /api/track plus socket.io live updates (ngx-socket-io).
- UI components: playlist list (with collapse), track list, status badges, retry/delete actions.

## Data flow (happy path)

1. User submits Spotify URL in UI → POST /api/playlist.
1. Backend resolves Spotify metadata and creates playlist/track records.
1. Track search job runs → YouTube URL discovered → download job queued.
1. Download job runs → audio saved → status updated.
1. WebSocket events update frontend lists and progress instantly.
