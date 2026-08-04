#!/usr/bin/env bash
# Regenerate the Electron app icons from build/icon.svg.
# Needs rsvg-convert (brew install librsvg). iconutil is macOS-only, so the
# .icns step is skipped elsewhere; electron-builder falls back to icon.png.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="$ROOT/build/icon.svg"
OUT="$ROOT/build"

command -v rsvg-convert >/dev/null || { echo "rsvg-convert not found (brew install librsvg)" >&2; exit 1; }

rsvg-convert -w 1024 -h 1024 "$SRC" -o "$OUT/icon.png"
echo "wrote build/icon.png"

if command -v iconutil >/dev/null; then
  SET="$(mktemp -d)/icon.iconset"
  mkdir -p "$SET"
  while read -r size name; do
    rsvg-convert -w "$size" -h "$size" "$SRC" -o "$SET/$name.png"
  done <<'SIZES'
16 icon_16x16
32 icon_16x16@2x
32 icon_32x32
64 icon_32x32@2x
128 icon_128x128
256 icon_128x128@2x
256 icon_256x256
512 icon_256x256@2x
512 icon_512x512
1024 icon_512x512@2x
SIZES
  iconutil -c icns "$SET" -o "$OUT/icon.icns"
  rm -rf "$(dirname "$SET")"
  echo "wrote build/icon.icns"
fi
