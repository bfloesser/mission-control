# Running Mission Control in Docker

Suitable for NAS boxes (Synology Container Manager), home servers, or any
Docker host.

All deployment files live in [`deploy/`](../deploy/) — that directory is the
single source of truth. There is deliberately **no** `docker-compose.yml` at
the repository root: an earlier variant lived there, exposed port 4000 without
any authentication, and was silently overwritten on every deploy.

## First start

```bash
git clone https://github.com/bfloesser/mission-control.git
cd mission-control/deploy
# see deploy/README.md — create data/caddy.env with MC_BASIC_AUTH_HASH first
docker compose up -d --build
```

The stack is two containers: the Next.js app (internal only) behind a Caddy
reverse proxy that terminates TLS with an internal CA and enforces HTTP Basic
Auth. The dashboard is reachable on port **4000 over HTTPS**.

SQLite database, the arbitrage credential encryption key and `caddy.env` are
stored in `./data` on the host, so they survive container rebuilds.

> Without `data/caddy.env` the proxy refuses to start. That is intentional —
> a running proxy without a working password would be worse than an outage.

## Updating

From a machine with SSH access to the host, run the one-command update:

```powershell
cd deploy
.\update.ps1                    # deploys main
.\update.ps1 -Branch <name>     # deploys another branch
.\update.ps1 -NoRebuild         # swap code only, no image rebuild
```

It clones the branch fresh, overlays the files from `deploy/`, transfers the
tarball and rebuilds the container. Everything under `data/` is preserved.

Alternatively, in-place on the host:

```bash
cd mission-control && git pull
cd deploy && docker compose up -d --build
```

## Synology notes

- Run commands via SSH with `sudo` and the full binary path:
  `sudo /usr/local/bin/docker compose up -d --build`.
  On older DSM versions the command is `docker-compose` (with a dash).
- Port 4000 must be free — DSM's own nginx owns port 80, which is why the
  Caddyfile disables the HTTP→HTTPS redirect listener.
- The internal CA certificate is `deploy/caddy-root-ca.crt`; import it into
  your browser or OS to avoid certificate warnings.

## Configuration

Environment variables (set in `deploy/docker-compose.yml`):

| Variable              | Purpose                                                                                                     |
| --------------------- | ----------------------------------------------------------------------------------------------------------- |
| `DATABASE_PATH`       | SQLite location, defaults to `/app/data/mission-control.db`                                                  |
| `MC_BASIC_AUTH_HASH`  | bcrypt hash for the Caddy Basic Auth login. Read from `data/caddy.env`, never committed                      |
| `MC_API_TOKEN`        | Bearer token required for external API calls (recommended)                                                   |
| `ARB_ENCRYPTION_KEY`  | Fixed 64-hex-char key for credential encryption (optional; otherwise auto-generated at `/app/data/.arb-secret`) |
