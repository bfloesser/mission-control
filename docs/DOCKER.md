# Running Mission Control in Docker

Suitable for NAS boxes (Synology Container Manager), home servers, or any
Docker host.

## First start

```bash
git clone -b claude/multi-exchange-arbitrage-RtvFj https://github.com/bfloesser/mission-control.git
cd mission-control
docker compose up -d --build
```

The dashboard listens on port **4000** (plain HTTP). SQLite database and the
arbitrage credential encryption key are stored in `./data` on the host, so
they survive container rebuilds.

## Updating to the latest version

```bash
cd mission-control
git pull
docker compose up -d --build
```

That's it — Compose rebuilds the image from the current checkout and swaps
the container; the `./data` volume (DB, API keys) is untouched.

## Synology notes

- Run commands via SSH with `sudo` (`sudo docker compose up -d --build`).
  On older DSM versions the command is `docker-compose` (with a dash).
- If another service already uses port 4000, change the left side of the
  port mapping in `docker-compose.yml` (e.g. `'4400:4000'`).
- To expose the dashboard via HTTPS, add a reverse-proxy rule in
  DSM → Login Portal → Advanced → Reverse Proxy pointing to
  `http://localhost:4000`.

## Configuration

Environment variables (set in `docker-compose.yml`):

| Variable             | Purpose                                                        |
| -------------------- | -------------------------------------------------------------- |
| `DATABASE_PATH`      | SQLite location, defaults to `/data/mission-control.db`        |
| `MC_API_TOKEN`       | Bearer token required for external API calls (recommended)     |
| `ARB_ENCRYPTION_KEY` | Fixed 64-hex-char key for credential encryption (optional; otherwise auto-generated at `/data/.arb-secret`) |
