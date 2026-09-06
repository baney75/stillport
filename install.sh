#!/bin/sh
# Stillport installer. Downloads only from baney75/stillport GitHub releases.
set -eu
repo='baney75/stillport'
install_dir=${STILLPORT_INSTALL_DIR:-"$HOME/.local/bin"}
version=${STILLPORT_VERSION:-latest}
case "$(uname -s)" in Darwin) platform=darwin ;; Linux) platform=linux ;; *) echo 'Stillport releases support macOS and Linux.' >&2; exit 1 ;; esac
case "$(uname -m)" in arm64|aarch64) arch=arm64 ;; x86_64|amd64) arch=x64 ;; *) echo 'Unsupported CPU architecture.' >&2; exit 1 ;; esac
asset="stillport-$platform-$arch"
if [ "$version" = latest ]; then
  base="https://github.com/$repo/releases/latest/download"
else
  if ! printf '%s\n' "$version" | LC_ALL=C grep -Eq '^v[0-9]+\.[0-9]+\.[0-9]+$'; then echo 'STILLPORT_VERSION must be latest or vX.Y.Z.' >&2; exit 1; fi
  base="https://github.com/$repo/releases/download/$version"
fi
command -v curl >/dev/null 2>&1 || { echo 'Install curl first.' >&2; exit 1; }
if command -v sha256sum >/dev/null 2>&1; then checksum=sha256sum
elif command -v shasum >/dev/null 2>&1; then checksum=shasum
else echo 'Install sha256sum or shasum first.' >&2; exit 1; fi
mkdir -p "$install_dir"
# Staging on the destination filesystem permits an atomic final rename.
staging=$(mktemp -d "$install_dir/.stillport-install.XXXXXX")
trap 'rm -rf "$staging"' EXIT HUP INT TERM
printf 'Installing Stillport for %s/%s…\n' "$platform" "$arch" >&2
curl --proto '=https' --tlsv1.2 -fsSL --connect-timeout 15 --max-time 300 "$base/$asset" -o "$staging/stillport"
curl --proto '=https' --tlsv1.2 -fsSL --connect-timeout 15 --max-time 60 "$base/SHA256SUMS" -o "$staging/SHA256SUMS"
expected=$(awk -v name="$asset" '$2 == name {print $1}' "$staging/SHA256SUMS")
if ! printf '%s\n' "$expected" | LC_ALL=C grep -Eq '^[a-f0-9]{64}$'; then echo 'Missing or ambiguous release checksum. Installation stopped.' >&2; exit 1; fi
if [ "$checksum" = sha256sum ]; then actual=$(sha256sum "$staging/stillport" | awk '{print $1}')
else actual=$(shasum -a 256 "$staging/stillport" | awk '{print $1}'); fi
[ "$actual" = "$expected" ] || { echo 'Checksum mismatch. Existing installation unchanged.' >&2; exit 1; }
chmod 755 "$staging/stillport"
installed_version=$("$staging/stillport" --version)
if ! printf '%s\n' "$installed_version" | LC_ALL=C grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+$'; then echo 'Binary validation failed.' >&2; exit 1; fi
if [ "$version" != latest ] && [ "v$installed_version" != "$version" ]; then echo 'Version mismatch.' >&2; exit 1; fi
if [ -L "$install_dir/stillport" ]; then echo 'Destination is a symlink. Choose STILLPORT_INSTALL_DIR explicitly.' >&2; exit 1; fi
if [ -f "$install_dir/stillport" ]; then cp -p "$install_dir/stillport" "$staging/previous"; mv -f "$staging/previous" "$install_dir/stillport.previous"; fi
mv -f "$staging/stillport" "$install_dir/stillport"
printf '\nStillport %s installed at %s/stillport\n' "$installed_version" "$install_dir"
case ":$PATH:" in *":$install_dir:"*) ;; *) printf 'Add this directory to PATH in your shell profile: %s\n' "$install_dir" ;; esac
printf 'Try: stillport doctor\nUpdate later: stillport update\n'
