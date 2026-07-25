# Mission Control — Deploy/Update auf Synology-NAS

App-Repo: `github.com/bfloesser/mission-control` · läuft als Docker-Container auf der DS1221+ unter **http://192.168.178.159:4000**

## Dateien
| Datei | Zweck |
|---|---|
| `Dockerfile` | Baut das Next.js-Image (Node 20, SQLite). |
| `docker-compose.yml` | Container-Definition (Port 4000, `data/`-Volume, restart-Policy). |
| `Caddyfile` | Login-Proxy (Basic Auth, interne TLS-CA). Passwort-Hash kommt aus der Umgebung. |
| `caddy-root-ca.crt` | Root-Zertifikat der internen Caddy-CA, zum Import im Browser/OS. |
| `.dockerignore` | Hält `.git`/`node_modules`/`.next`/`data` aus dem Image. |
| `update.ps1` | Ein-Kommando-Update: klont Branch → packt → überträgt → rebuild. |

## Einmalig einrichten: Basic-Auth-Passwort

Der Passwort-Hash steht **nicht im Repo**. Das `Caddyfile` liest ihn über
`{env.MC_BASIC_AUTH_HASH}` aus `data/caddy.env` auf der NAS. `data/` ist das einzige
Verzeichnis, das `update.ps1` beim Deployen stehen lässt — die Datei überlebt jedes Update.

Passwort setzen oder ändern — auf der NAS, im Deploy-Verzeichnis:

```sh
cd /volume1/docker/mission-control/deploy
./set-password.sh
```

Das Skript fragt das Passwort verdeckt ab, erzeugt den bcrypt-Hash, schreibt
`data/caddy.env`, erzeugt den Proxy-Container neu und prüft anschließend nach,
dass der Hash unverstümmelt im Container angekommen ist.

> ### ⚠️ Trag den Hash niemals von Hand in `caddy.env` ein
>
> bcrypt-Hashes enthalten drei `$`-Zeichen. **Docker Compose interpretiert `$` in
> einer `env_file` als Variablenreferenz** und ersetzt sie durch Leerstrings. Aus
> `$2a$14$XtuwB…` wird im Container `$2a$14…` — sechs Zeichen kürzer. Der Proxy
> lehnt dann *jedes* Passwort ab.
>
> Das Symptom ist ein endlos wiederkehrender Login-Dialog ohne Fehlermeldung, und
> `caddy.env` sieht auf der Platte völlig korrekt aus. Diese Kombination hat
> schon einmal Stunden gekostet.
>
> Deshalb muss jedes `$` im Hash verdoppelt werden (`$$`) — Compose löst das beim
> Start wieder auf. `set-password.sh` erledigt das und verifiziert das Ergebnis.
> Wenn du es doch von Hand machst, kontrollier danach:
>
> ```sh
> # muss dieselbe Länge liefern wie der erzeugte Hash (60)
> sudo /usr/local/bin/docker exec mission-control-proxy printenv MC_BASIC_AUTH_HASH | tr -d '\n' | wc -c
> ```

Fehlt `data/caddy.env` ganz, startet der Proxy-Container **nicht**. Das ist Absicht —
ein laufender Proxy ohne funktionierendes Passwort wäre schlimmer als ein Ausfall.

## Update ausführen
In PowerShell in diesem Ordner:

```powershell
.\update.ps1                    # Standard: Arbitrage-Branch neu deployen
.\update.ps1 -Branch main       # anderen Branch deployen
.\update.ps1 -NoRebuild         # nur Code tauschen, ohne Image-Rebuild
```

Der Ordner **`/volume1/docker/mission-control/data`** auf der NAS (SQLite-DB + Workspace)
bleibt bei jedem Update erhalten.

## Voraussetzungen
- SSH-Key `%USERPROFILE%\.ssh\id_ed25519_nas` (passwortlos, bereits eingerichtet)
- `git`, `tar`, `ssh`, `scp` im PATH (unter Windows 10/11 alle vorhanden)
- Passwortloses `sudo` für `c4rTman` auf der NAS (eingerichtet)
- `data/caddy.env` auf der NAS mit `MC_BASIC_AUTH_HASH` (siehe oben) — sonst startet der Proxy nicht

## Manuell auf der NAS (falls nötig)
```sh
cd /volume1/docker/mission-control
sudo /usr/local/bin/docker compose up -d --build   # neu bauen & starten
sudo /usr/local/bin/docker logs -f mission-control # Logs
sudo /usr/local/bin/docker compose down            # stoppen
```
