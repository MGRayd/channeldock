# ChannelDock

ChannelDock turns Plex libraries into scheduled pseudo-live channels. Its browser interface manages channels and its Android TV app provides direct playback, channel browsing and a programme guide without routing playback through Plex Live TV or a virtual tuner.

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

The local Compose file builds the backend and browser manager from the checked-out source.

### Synology Container Manager

GitHub Actions publishes the latest `main` branch as a multi-platform image at `ghcr.io/mgrayd/channeldock:latest`. Use `compose.synology.yaml` for the Container Manager project, or paste this configuration into its YAML editor:

```yaml
services:
  channeldock:
    image: ghcr.io/mgrayd/channeldock:latest
    pull_policy: always
    container_name: channeldock
    environment:
      TZ: Europe/London
      PORT: 4100
      DATA_DIR: /data
    ports:
      - "8410:4100"
    volumes:
      - /volume1/docker/Configs/channeldock/data:/data
    restart: unless-stopped
```

Create `/volume1/docker/Configs/channeldock/data` before the first start. To update, rebuild the Container Manager project so it pulls the current `latest` image. The mounted data directory preserves the database and Plex connection.

For a command-line update:

```bash
cd /volume1/docker/Configs/channeldock
docker compose -f compose.synology.yaml pull
docker compose -f compose.synology.yaml up -d
```

## Current scope

- Link a Plex account using a time-limited code at `plex.tv/link`
- Discover authorised Plex servers and prefer a local non-relay connection
- Browse complete movie and TV libraries with genre and label filters
- Build channels from selected movies, complete shows or Plex collections
- Edit channel names, numbers, logos, media, order and enabled state
- Generate a deterministic rolling schedule from real Plex durations
- Provide current programme metadata and a 24-hour guide to the Android TV app
- Play original Plex media directly without live transcoding or remuxing
- Persist settings and channels in SQLite

YouTube sources are planned but not implemented yet.

## Shield TV player

The `tv-app` Android TV project targets devices such as Nvidia Shield. It reads the ChannelDock schedule, seeks to the correct position in the current Plex item and advances between programmes. The backend proxies the original Plex file with byte-range support so the Plex token is not exposed to the player.

## Plex access

ChannelDock requests a short Plex PIN and directs the user to `plex.tv/link`. Once approved, it discovers the Plex servers available to that account and stores the selected server token locally in the SQLite database inside the mounted `/data` directory. Plex library requests remain read-only.
