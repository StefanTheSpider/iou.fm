#!/usr/bin/env bash
# release.sh – Ein-Befehl-Release für iou.fm.
#
# Bestimmt die nächste Versionsnummer AUTOMATISCH aus dem höchsten existierenden
# Git-Tag (lokal + remote). Es wird NIE eine Versionsnummer von Hand getippt.
# Bumpt standardmäßig die Patch-Stelle (z. B. v0.2.12 -> v0.2.13).
#
# Aufruf:
#   ./release.sh "Commit-Nachricht"        # Patch-Bump (Standard)
#   ./release.sh "Nachricht" minor         # Minor-Bump (0.2.x -> 0.3.0)
#   ./release.sh "Nachricht" major         # Major-Bump (0.x.y -> 1.0.0)
#
# Das Skript:
#   1. holt alle Tags (lokal + remote)
#   2. findet den höchsten vX.Y.Z
#   3. erhöht die gewünschte Stelle
#   4. schreibt die Version in package.json, src-tauri/Cargo.toml, src-tauri/tauri.conf.json
#   5. committet, taggt und pusht  -> löst die GitHub-Action (Build + latest.json) aus

set -euo pipefail
cd "$(dirname "$0")"

MSG="${1:-}"
BUMP="${2:-patch}"

if [ -z "$MSG" ]; then
  echo "❌ Bitte eine Commit-Nachricht angeben:  ./release.sh \"Was ist neu\""
  exit 1
fi

# --- 1. Tags holen (Fehler ignorieren, falls offline) -----------------------
git fetch --tags --quiet 2>/dev/null || echo "⚠  Konnte Remote-Tags nicht holen (offline?) – nutze lokale Tags."

# --- 2. Höchsten Tag finden -------------------------------------------------
LATEST="$(git tag --list 'v*' | grep -E '^v[0-9]+\.[0-9]+\.[0-9]+$' | sort -V | tail -1)"
if [ -z "$LATEST" ]; then LATEST="v0.0.0"; fi
echo "→ Höchster vorhandener Tag: $LATEST"

# --- 3. Nächste Version berechnen -------------------------------------------
VER="${LATEST#v}"
IFS='.' read -r MA MI PA <<< "$VER"
case "$BUMP" in
  major) MA=$((MA+1)); MI=0; PA=0 ;;
  minor) MI=$((MI+1)); PA=0 ;;
  patch) PA=$((PA+1)) ;;
  *) echo "❌ Unbekannter Bump-Typ: $BUMP (erlaubt: patch|minor|major)"; exit 1 ;;
esac
NEXT="$MA.$MI.$PA"
TAG="v$NEXT"

# Sicherheitsnetz: Tag darf noch nicht existieren
if git rev-parse "$TAG" >/dev/null 2>&1; then
  echo "❌ Tag $TAG existiert bereits. Abbruch."
  exit 1
fi
echo "→ Neue Version: $TAG"

# --- 4. Versionsdateien schreiben -------------------------------------------
# package.json (erste "version": "...")
perl -0pi -e 's/"version":\s*"[0-9]+\.[0-9]+\.[0-9]+"/"version": "'"$NEXT"'"/ if !$done++' package.json
# Cargo.toml ([package] version)
perl -0pi -e 's/^version = "[0-9]+\.[0-9]+\.[0-9]+"/version = "'"$NEXT"'"/m if !$done++' src-tauri/Cargo.toml
# tauri.conf.json
perl -0pi -e 's/"version":\s*"[0-9]+\.[0-9]+\.[0-9]+"/"version": "'"$NEXT"'"/ if !$done++' src-tauri/tauri.conf.json

echo "✓ Versionsdateien aktualisiert:"
echo "    package.json : $(grep -m1 '"version"' package.json | tr -d ' ')"
echo "    Cargo.toml   : $(grep -m1 '^version' src-tauri/Cargo.toml)"
echo "    tauri.conf   : $(grep -m1 '"version"' src-tauri/tauri.conf.json | tr -d ' ')"

# --- 5. Commit, Tag, Push ---------------------------------------------------
git add -A
git commit -m "$TAG – $MSG"
git tag "$TAG"
git push
git push origin "$TAG"

echo ""
echo "🚀 $TAG veröffentlicht. Die GitHub-Action baut jetzt mac + Windows + latest.json."
