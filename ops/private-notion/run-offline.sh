#!/usr/bin/env bash
# G24: offline, read-only, owner-local Notion archive review.
# This intentionally cannot execute the G23 live Notion API probe.
set -euo pipefail
umask 077

usage() {
  printf '%s\n' \
    'Usage: bash ops/private-notion/run-offline.sh PRIVATE_VAULT INVENTORY.enc SELECTION.json CONTENT.enc NEW_RESERVED.enc' \
    'Build: docker build -f ops/private-notion/Dockerfile -t knowledge-private-offline:g24 .' >&2
  exit 64
}
if [[ $# -ne 5 ]]; then usage; fi
if ! command -v docker >/dev/null 2>&1; then
  printf 'G24_DOCKER_REQUIRED: Container runtime unavailable\n' >&2
  exit 69
fi
vault_arg=$1
shift
if [[ ! -d "$vault_arg" || -L "$vault_arg" ]]; then
  printf 'G24_UNSAFE_VAULT: Real owner-controlled directory required\n' >&2
  exit 65
fi
vault=$(realpath -e -- "$vault_arg") || exit 65
if [[ "$vault" == *','* || "$vault" == *$'\n'* || "$vault" == *$'\r'* ]]; then
  printf 'G24_UNSAFE_VAULT: Unsupported mount-path characters\n' >&2
  exit 65
fi
uid=$(id -u)
gid=$(id -g)
if [[ "$uid" == 0 ]]; then
  printf 'G24_ROOT_HOST_DENIED: Offline vault review requires a non-root account\n' >&2
  exit 65
fi
private_path() {
  local path=$1 kind=$2 owner mode
  [[ ! -L "$path" ]] || return 1
  if [[ "$kind" == directory ]]; then [[ -d "$path" ]] || return 1;
  else [[ -f "$path" ]] || return 1; fi
  owner=$(stat -c '%u' -- "$path") || return 1
  mode=$(stat -c '%a' -- "$path") || return 1
  [[ "$owner" == "$uid" && "$mode" =~ ^[0-7]{3,4}$ ]] || return 1
  (( (8#$mode & 077) == 0 )) || return 1
}
if ! private_path "$vault" directory; then
  printf 'G24_UNSAFE_VAULT: Owner-only directory (0700) required\n' >&2
  exit 65
fi
inventory=$1
selection=$2
captured=$3
reserved=$4
for name in "$inventory" "$selection" "$captured" "$reserved"; do
  if [[ ! "$name" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$ ]]; then
    printf 'G24_INVALID_NAME: Filename with separator or unsafe characters\n' >&2
    exit 65
  fi
done
[[ "$inventory" == *.enc && "$selection" == *.json &&
   "$captured" == *.enc && "$reserved" == *.enc ]] || usage
if [[ "$inventory" == "$selection" || "$inventory" == "$captured" ||
      "$inventory" == "$reserved" || "$selection" == "$captured" ||
      "$selection" == "$reserved" || "$captured" == "$reserved" ]]; then
  printf 'G24_DUPLICATE_PATH: Paths must be separate\n' >&2
  exit 65
fi
for name in "$inventory" "$selection" "$captured"; do
  if ! private_path "$vault/$name" file; then
    printf 'G24_UNSAFE_INPUT: Owner-only regular file required\n' >&2
    exit 65
  fi
done
if [[ -e "$vault/$reserved" || -L "$vault/$reserved" ]]; then
  printf 'G24_ALREADY_EXISTS: Reserved output must be absent\n' >&2
  exit 65
fi
if [[ ! -r /dev/tty ]]; then
  printf 'G24_TTY_REQUIRED: Private terminal required for passphrase\n' >&2
  exit 65
fi
IFS= read -r -s -p 'Private archive passphrase: ' passphrase < /dev/tty || exit 65
printf '\n' > /dev/tty
trap 'unset passphrase' EXIT

# No secrets as CLI args, environment variables or Docker image layers.
image=knowledge-private-offline:g24
if ! docker image inspect "$image" >/dev/null 2>&1; then
  printf 'G24_IMAGE_MISSING: Build the reviewed offline image first\n' >&2
  exit 69
fi
printf '%s' "$passphrase" | docker run --rm -i \
  --network none --read-only --cap-drop ALL \
  --security-opt no-new-privileges \
  --pids-limit 64 --memory 256m --cpus 1 \
  --user "$uid:$gid" \
  --tmpfs /tmp:rw,nosuid,nodev,noexec,size=16m,mode=0700 \
  --mount "type=bind,source=$vault,target=/vault,readonly" \
  "$image" \
  "/vault/$inventory" "/vault/$selection" \
  "/vault/$captured" "/vault/$reserved"
