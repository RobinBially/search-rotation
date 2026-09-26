#!/bin/bash
# Release search-rotation: checks, version, package, GitHub release and the
# Homebrew formula in localfoundry/homebrew-tap.
#
# Usage:
#   VERSION=0.4.9 ./scripts/release.sh [output-dir] [--dry-run] [--publish] [--draft] [--force]
#
# Without --publish the script prepares everything: it runs the checks, bumps
# the version, points the document pins at it, commits, tags, packs the tarball
# with its checksum and writes the tap formula into the output directory.
# --publish also pushes the commit and tag, creates the GitHub release and
# updates the tap. --draft creates the release as a draft and skips the online
# tap audit; --force continues although the working tree is dirty.
#
# Environment:
#   VERSION             required, x.y.z
#   RELEASE_REPOSITORY  default RobinBially/search-rotation
#   TAP_REPOSITORY      default localfoundry/homebrew-tap
#   TAP_DIR             existing tap checkout; otherwise cloned temporarily
#   SKIP_AUDIT=1        skip brew audit after the tap push
#
# The script is self-contained: it needs node, npm and gh, but no files outside
# this repository except the tap, which it clones when no checkout is given.
set -euo pipefail
cd "$(dirname "$0")/.."

for arg in "$@"; do
    case "$arg" in
        -h|--help) sed -n '2,23p' "$0" | sed 's/^# *//'; exit 0 ;;
    esac
done

VERSION="${VERSION:?VERSION must be set (x.y.z)}"
RELEASE_REPOSITORY="${RELEASE_REPOSITORY:-RobinBially/search-rotation}"
TAP_REPOSITORY="${TAP_REPOSITORY:-localfoundry/homebrew-tap}"
TAP_FORMULA="search-rotation"
RELEASE_NOTES="docs/release-notes.md"
PACKAGE="search-rotation"

[[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "VERSION must be x.y.z, got: $VERSION" >&2; exit 1; }
[[ "$RELEASE_REPOSITORY" =~ ^[A-Za-z0-9][A-Za-z0-9-]*/[A-Za-z0-9_.-]+$ ]] || { echo "RELEASE_REPOSITORY must be owner/repo." >&2; exit 1; }

out=""
dry_run=0
publish=0
force=0
draft=0
while [[ $# -gt 0 ]]; do
    case "$1" in
        --dry-run) dry_run=1; shift ;;
        --publish) publish=1; shift ;;
        --draft) draft=1; shift ;;
        --force) force=1; shift ;;
        -h|--help) sed -n '2,23p' "$0" | sed 's/^# *//'; exit 0 ;;
        -*) echo "Unknown argument: $1" >&2; exit 1 ;;
        *) out="$1"; shift ;;
    esac
done
OUTPUT="${out:-$PWD/.build/releases}"
mkdir -p "$OUTPUT"
OUTPUT="$(cd "$OUTPUT" && pwd)"
TARBALL="$PACKAGE-$VERSION.tgz"

cleanup_tap=""
cleanup() { if [[ -n "$cleanup_tap" ]]; then rm -rf "$cleanup_tap"; fi; }
trap cleanup EXIT

# --- Voraussetzungen ---------------------------------------------------------
issues=()
command -v node >/dev/null || issues+=("node fehlt.")
command -v npm >/dev/null || issues+=("npm fehlt.")
command -v gh >/dev/null || issues+=("gh CLI fehlt.")
[[ -f "$RELEASE_NOTES" ]] || issues+=("Release notes fehlen: $RELEASE_NOTES")
if [[ $force -eq 0 ]]; then
    git diff --quiet || issues+=("Uncommitted changes; erst committen (--force überspringt).")
    [[ -z "$(git ls-files --others --exclude-standard)" ]] || issues+=("Untracked files; erst committen oder ignorieren (--force überspringt).")
fi
git rev-parse -q --verify "refs/tags/v$VERSION" >/dev/null && issues+=("Tag v$VERSION existiert lokal schon.")
git ls-remote --exit-code --tags origin "refs/tags/v$VERSION" >/dev/null 2>&1 && issues+=("Tag v$VERSION ist im Remote schon vorhanden.")

upstream="$(git rev-parse --abbrev-ref --symbolic-full-name '@{u}' 2>/dev/null || true)"
if [[ -n "$upstream" ]]; then
    git fetch --quiet origin || issues+=("git fetch origin ist fehlgeschlagen.")
    behind="$(git rev-list --count "HEAD..$upstream" 2>/dev/null || echo 0)"
    [[ "$behind" == 0 ]] || issues+=("$behind Commit(s) fehlen lokal gegenüber $upstream; erst pullen.")
fi

if [[ ${#issues[@]} -gt 0 ]]; then
    echo "Voraussetzungen nicht erfüllt:" >&2
    printf "  - %s\n" "${issues[@]}" >&2
    exit 1
fi

echo "== search-rotation $VERSION"
echo "   Repository $RELEASE_REPOSITORY"
echo "   Ausgabe    $OUTPUT"
if [[ $publish -eq 1 ]]; then echo "   Modus      veröffentlichen"; else echo "   Modus      vorbereiten (--publish veröffentlicht)"; fi

if [[ $dry_run -eq 1 ]]; then
    echo "== Probelauf: Voraussetzungen erfüllt, nichts gebaut."
    exit 0
fi

# --- Checks ------------------------------------------------------------------
echo "== Checks"
npm ci
npm run build
npm test
npm run smoke:package

# --- Version, Tag ------------------------------------------------------------
echo "== Version und Tag"
npm version "$VERSION" --no-git-tag-version --allow-same-version >/dev/null
RELEASE_TAG="v$VERSION" node scripts/verify-release.mjs
npm run sync:version-refs -- --version "v$VERSION"
git add -A
if git diff --cached --quiet; then
    echo "   Keine Versionsänderung zu committen."
else
    git commit -q -m "Release v$VERSION"
fi
SOURCE_COMMIT="$(git rev-parse HEAD)"
git tag "v$VERSION"

# --- Paket und Prüfsumme -----------------------------------------------------
echo "== Paket"
npm pack --pack-destination "$OUTPUT" >/dev/null
[[ -f "$OUTPUT/$TARBALL" ]] || { echo "Paket fehlt: $OUTPUT/$TARBALL" >&2; exit 1; }
( cd "$OUTPUT" && shasum -a 256 "$TARBALL" > SHA256SUMS )
SHA256="$( awk '{print $1}' "$OUTPUT/SHA256SUMS" )"
echo "   $TARBALL ($SHA256)"

# --- Tap-Formel --------------------------------------------------------------
echo "== Tap-Formel"
if [[ -n "${TAP_DIR:-}" && -d "${TAP_DIR}/.git" ]]; then
    tap="$TAP_DIR"
else
    cleanup_tap="$(mktemp -d)"
    git clone --quiet --depth=1 "https://github.com/$TAP_REPOSITORY.git" "$cleanup_tap"
    tap="$cleanup_tap"
fi
formula_path="$tap/Formula/$TAP_FORMULA.rb"
[[ -f "$formula_path" ]] || { echo "Formel fehlt: $formula_path" >&2; exit 1; }
python3 - "$VERSION" "$TARBALL" "$SHA256" "$formula_path" "$OUTPUT/$TAP_FORMULA.rb" <<'PYTHON'
import re, sys
from pathlib import Path
version, artifact, sha, source, destination = sys.argv[1:6]
text = Path(source).read_text()
old_url = re.search(r'url "([^"]+)"', text)
old_sha = re.search(r'sha256 "([^"]+)"', text)
if not old_url or not old_sha:
    raise SystemExit("Formel hat keine lesbare url/sha256; Abbruch.")
match = re.search(r'/v([0-9]+\.[0-9]+\.[0-9]+)/', old_url.group(1))
if not match:
    raise SystemExit("Formel-URL hat keine lesbare Version; Abbruch.")
previous = tuple(map(int, match.group(1).split(".")))
incoming = tuple(map(int, version.split(".")))
if previous > incoming:
    raise SystemExit("Im Tap liegt bereits eine neuere Version; kein Downgrade.")
if previous == incoming and old_sha.group(1) != sha:
    raise SystemExit("Gleiche Version, andere Release-Bytes; Abbruch.")
new_url = re.sub(r'/v[0-9]+\.[0-9]+\.[0-9]+/', f'/v{version}/', old_url.group(1))
new_url = re.sub(r'[^/]+$', artifact, new_url)
text = text.replace(old_url.group(0), f'url "{new_url}"', 1)
text = text.replace(old_sha.group(0), f'sha256 "{sha}"', 1)
Path(destination).write_text(text)
print("   Formel geschrieben:", destination)
PYTHON

if [[ $publish -eq 0 ]]; then
    cat <<EOF
== Fertig (vorbereitet)
   Paket    $OUTPUT/$TARBALL
   Formel   $OUTPUT/$TAP_FORMULA.rb
   Quelle   $SOURCE_COMMIT
   Zum Veröffentlichen erneut mit --publish starten.
EOF
    exit 0
fi

# --- Veröffentlichen ---------------------------------------------------------
echo "== Veröffentlichen"
git push origin HEAD
git push origin "v$VERSION"
# docs/release-notes.md sammelt alle Versionen; als Release-Body nur den
# Abschnitt dieser Version verwenden.
notes_file="$OUTPUT/release-notes-v$VERSION.md"
python3 - "$VERSION" "$RELEASE_NOTES" "$notes_file" <<'PYTHON'
import re, sys
from pathlib import Path
version, source, destination = sys.argv[1:4]
lines = Path(source).read_text().splitlines()
heading = re.compile(r'^##\s+v?' + re.escape(version) + r'(?:\s|$)')
start = next((i for i, line in enumerate(lines) if heading.match(line)), None)
if start is None:
    raise SystemExit(f"Kein Abschnitt für v{version} in {source}; Abbruch.")
end = next((i for i in range(start + 1, len(lines)) if lines[i].startswith('## ')), len(lines))
Path(destination).write_text("\n".join(lines[start:end]).strip() + "\n")
print("   Release-Notes:", destination)
PYTHON
release_args=("v$VERSION" "$OUTPUT/$TARBALL" "$OUTPUT/SHA256SUMS"
              --repo "$RELEASE_REPOSITORY" --target "$SOURCE_COMMIT"
              --title "search-rotation $VERSION" --generate-notes --notes-file "$notes_file")
if [[ $draft -eq 1 ]]; then
    release_args+=(--draft)
fi
gh release create "${release_args[@]}"

cp "$OUTPUT/$TAP_FORMULA.rb" "$formula_path"
git -C "$tap" add "Formula/$TAP_FORMULA.rb"
if git -C "$tap" diff --cached --quiet; then
    echo "   Formel unverändert."
else
    git -C "$tap" commit -q -m "Release search-rotation $VERSION"
    git -C "$tap" push origin HEAD
    echo "   Formel gepusht."
    if [[ $draft -eq 1 ]]; then
        echo "   Entwurf: Online-Audit erst nach dem Veroeffentlichen des Releases."
    elif [[ "${SKIP_AUDIT:-0}" != 1 ]] && command -v brew >/dev/null; then
        brew update -q
        brew audit --formula --strict --online "localfoundry/tap/$TAP_FORMULA"
    fi
fi

cat <<EOF
== Fertig
   Release  https://github.com/$RELEASE_REPOSITORY/releases/tag/v$VERSION
   Paket    $TARBALL (sha256 $SHA256)
   Formel   $formula_path
   Quelle   $SOURCE_COMMIT
EOF
