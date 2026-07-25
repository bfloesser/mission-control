#!/usr/bin/env bash
#
# Setzt das Basic-Auth-Passwort fuer Mission Control (Benutzer "admin").
# Auf der NAS ausfuehren:  ./set-password.sh
#
# WARUM ES DIESES SKRIPT GIBT
#   bcrypt-Hashes enthalten drei $-Zeichen. Docker Compose interpretiert $ in
#   einer env_file als Variablenreferenz und ersetzt sie durch Leerstrings --
#   der Hash kommt verstuemmelt im Container an und JEDES Passwort wird
#   abgelehnt. Das Symptom ist ein endlos wiederkehrender Login-Dialog ohne
#   jede Fehlermeldung, und der Hash sieht auf der Platte voellig korrekt aus.
#   Deshalb schreibt dieses Skript die $ verdoppelt ($$) -- Compose loest das
#   beim Start wieder zu einem einzelnen $ auf.
#
#   Trag den Hash also NICHT von Hand in caddy.env ein. Nimm dieses Skript.
#
set -euo pipefail

DOCKER=${DOCKER:-/usr/local/bin/docker}
DEPLOY_DIR=${DEPLOY_DIR:-/volume1/docker/mission-control}
ENV_FILE="$DEPLOY_DIR/data/caddy.env"
DRY_RUN=0
[ "${1:-}" = "--dry-run" ] && DRY_RUN=1

tmp=""
cleanup() { [ -n "$tmp" ] && rm -rf "$tmp"; }
trap cleanup EXIT INT TERM

[ -x "$DOCKER" ] || { echo "docker nicht gefunden: $DOCKER" >&2; exit 1; }
[ -d "$DEPLOY_DIR" ] || { echo "Verzeichnis fehlt: $DEPLOY_DIR" >&2; exit 1; }

printf 'Neues Passwort fuer Benutzer "admin": '
read -rs pw1; echo
printf 'Zur Bestaetigung wiederholen:         '
read -rs pw2; echo
[ -n "$pw1" ] || { echo "Leeres Passwort abgelehnt." >&2; exit 1; }
[ "$pw1" = "$pw2" ] || { echo "Passwoerter stimmen nicht ueberein." >&2; exit 1; }

tmp=$(mktemp -d)
chmod 700 "$tmp"
( umask 077; printf 'PW=%s\n' "$pw1" > "$tmp/env" )
unset pw1 pw2

# Das Passwort geht per --env-file in den Container und taucht damit in keiner
# Prozessliste des Hosts auf (--plaintext auf der Kommandozeile waere sichtbar).
sudo -n "$DOCKER" run --rm --env-file "$tmp/env" caddy:2 \
  sh -c 'caddy hash-password --plaintext "$PW"' > "$tmp/hash"
hash=$(tr -d '\r\n' < "$tmp/hash")

case "$hash" in
  \$2*) ;;
  *) echo "Unerwartete Ausgabe von 'caddy hash-password'." >&2; exit 1 ;;
esac

escaped=$(printf '%s' "$hash" | sed 's/\$/$$/g')

if [ "$DRY_RUN" -eq 1 ]; then
  echo "[dry-run] Hash erzeugt: ${#hash} Zeichen, escaped: ${#escaped} Zeichen."
  echo "[dry-run] $ENV_FILE unveraendert, Container nicht neu erzeugt."
  exit 0
fi

[ -f "$ENV_FILE" ] && cp -p "$ENV_FILE" "$ENV_FILE.bak"
( umask 077; printf 'MC_BASIC_AUTH_HASH=%s\n' "$escaped" > "$ENV_FILE" )
chmod 600 "$ENV_FILE"

cd "$DEPLOY_DIR"
sudo -n "$DOCKER" compose up -d --force-recreate caddy
sleep 3

# Gegenprobe: im Container muss der UNescapte Hash in voller Laenge ankommen.
actual=$(sudo -n "$DOCKER" exec mission-control-proxy printenv MC_BASIC_AUTH_HASH | tr -d '\r\n')
if [ "$actual" = "$hash" ]; then
  echo
  echo "OK - der Proxy laeuft mit dem neuen Passwort (${#actual} Zeichen)."
  echo "Test:  curl -sk -u admin -o /dev/null -w '%{http_code}\\n' https://192.168.178.159:4000/"
else
  echo "FEHLER - im Container kamen ${#actual} statt ${#hash} Zeichen an." >&2
  echo "Das Escaping hat nicht gegriffen. Backup: $ENV_FILE.bak" >&2
  exit 1
fi
