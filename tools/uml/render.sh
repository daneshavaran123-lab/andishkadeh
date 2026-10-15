#!/usr/bin/env bash
# Renders the UML activity diagrams (docs/uml/*.puml) to PNG and SVG with PlantUML.
#
# Needs Java 11+ and the Vazirmatn font installed as TTF, e.g. on Linux:
#   mkdir -p ~/.fonts && cp apps/kiosk/node_modules/vazirmatn/fonts/ttf/*.ttf ~/.fonts && fc-cache -f
# (on Windows/macOS install the same TTF files by double-clicking them).
# PlantUML itself is downloaded once from Maven Central and verified by its SHA-1.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
VERSION="1.2026.7"
SHA1="99640c98b05eb58406c1614e12ef48b7df0694a2"
JAR="$ROOT/tools/uml/.cache/plantuml-$VERSION.jar"

sha1() { if command -v sha1sum >/dev/null; then sha1sum "$1" | cut -d' ' -f1; else shasum -a 1 "$1" | cut -d' ' -f1; fi; }

if [ ! -f "$JAR" ]; then
  mkdir -p "$(dirname "$JAR")"
  curl -fsSL -o "$JAR.part" "https://repo1.maven.org/maven2/net/sourceforge/plantuml/plantuml/$VERSION/plantuml-$VERSION.jar"
  if [ "$(sha1 "$JAR.part")" != "$SHA1" ]; then
    rm -f "$JAR.part"
    echo "PlantUML download failed checksum verification" >&2
    exit 1
  fi
  mv "$JAR.part" "$JAR"
fi

if command -v fc-list >/dev/null && ! fc-list : family | grep -i vazirmatn >/dev/null; then
  echo "warning: the Vazirmatn font is not installed; Persian text will be drawn with a fallback font" >&2
fi

cd "$ROOT/docs/uml"
for format in png svg; do
  java -Djava.awt.headless=true -jar "$JAR" "-t$format" -failfast2 ./*.puml
done
echo "rendered $(ls ./*.puml | wc -l) diagrams to PNG and SVG in docs/uml"
