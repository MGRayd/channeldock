# ChannelDock

ChannelDock is a self-hosted linear channel builder for Plex libraries. The first development slice connects to Plex, reads libraries and collections, and saves collection-backed channel definitions.

## Local development

Requirements: Node.js 22 and npm.

```bash
npm install
npm run dev
```

Open `http://localhost:5173`. The API runs on port `4100` and Vite proxies `/api` requests to it.

## Docker Compose

```bash
docker compose up --build -d
```

Open `http://YOUR-NAS-IP:8410`. Application data is stored in `./data` beside the Compose file.

For Synology Container Manager, create a project directory such as `/volume1/docker/channeldock`, place this repository there, and build the project using `compose.yaml`.

### Synology installation from GitHub

Clone the repository into the directory used by the Container Manager project:

```bash
cd /volume1/docker
git clone https://github.com/MGRayd/channeldock.git
cd channeldock
mkdir -p data
docker compose up --build -d
```

To install later updates while retaining the database and Plex connection:

```bash
cd /volume1/docker/channeldock
git pull --ff-only
docker compose up --build -d
```

The `data` directory is excluded from Git and remains mounted at `/data` when the container is rebuilt.

## Current scope

- Link a Plex account using a time-limited code at `plex.tv/link`
- Discover authorised Plex servers and prefer a local non-relay connection
- Browse movie and TV libraries
- Browse existing Plex collections
- Create collection-backed channels using shuffled or sequential order
- Expand movie collections and TV collections into playable items
- Generate a deterministic rolling schedule from real Plex durations
- Display current and upcoming programmes on a 90-minute channel board
- Publish an M3U playlist at `/iptv/channels.m3u`
- Publish 24-hour XMLTV guide data at `/iptv/xmltv.xml`
- Serve live MPEG-TS channels at `/stream/channels/{id}.ts`
- Persist settings and channels in SQLite

YouTube sources and shared stream sessions are planned but not implemented yet. The current MPEG-TS implementation starts one FFmpeg process per viewer. `STREAM_MODE=auto` copies Plex-compatible video and audio codecs while converting incompatible video, such as HEVC, to H.264 for Plex Live TV. Use `remux` to force codec copy or `transcode` to convert both video and audio.

`VIDEO_ENCODER=auto` prefers an available NVIDIA NVENC, Intel Quick Sync, or AMD AMF H.264 encoder, then falls back to fast software encoding. A Docker deployment needs the relevant GPU device exposed to the container before hardware encoding will be detected.

## Shield TV player

The `tv-app` Android TV project provides direct original-file playback for Nvidia Shield. It reads the ChannelDock schedule, seeks into the current Plex item, and moves to the next item without FFmpeg, remuxing, or transcoding. The server proxies the untouched Plex file with byte-range support so the Plex token is never exposed to the player.

## Plex Live TV setup

ChannelDock exposes an HDHomeRun-compatible HTTP interface. In Plex Web, open **Settings → Live TV & DVR**, add a tuner manually using the ChannelDock base address, then choose the ChannelDock XMLTV URL when Plex asks for guide data.

For Docker Compose the default URLs are:

```text
Tuner: http://YOUR-NAS-IP:8410
XMLTV: http://YOUR-NAS-IP:8410/iptv/xmltv.xml
```

For local development use the computer's LAN IP with port `5173`, not `localhost`, when Plex runs on another device.

## Plex access

ChannelDock requests a short Plex PIN and directs the user to `plex.tv/link`. Once approved, it discovers the Plex servers available to that account and stores the selected server token locally in the SQLite database inside the mounted `/data` directory. Plex library requests remain read-only.
