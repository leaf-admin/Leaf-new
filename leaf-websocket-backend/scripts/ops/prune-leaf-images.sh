#!/usr/bin/env bash
# Removes old Leaf images so deploys do not fill the host disk.
# Each deploy leaves a ~700 MB backend image; on 2026-11-03 Santiago reached
# 100% with 936 images (40 GB) before this ran.
#
# Only Leaf repositories are touched, because Contabo also hosts other
# projects: per repository the newest KEEP_RELEASES images stay (rollback),
# older tags are removed with plain `docker rmi`, which refuses images in use.
# Untagged Leaf backend builds (they carry the Dockerfile revision label) and,
# with PRUNE_BUILD_CACHE=true (Santiago only), the build cache are pruned too.
#
# Runs on the host: by leaf-docker-prune.timer and after each Santiago deploy.
set -uo pipefail

KEEP_RELEASES="${KEEP_RELEASES:-3}"
MIN_AGE="${MIN_AGE:-72h}"
REPOS="${LEAF_IMAGE_REPOS:-ghcr.io/leaf-admin/leaf-backend leaf-app-* leaf-dashboard leaf-dashboard-js}"

before=$(df --output=pcent / | tail -1 | tr -d ' %')

for pattern in $REPOS; do
  for repo in $(docker images --filter "reference=$pattern" --format '{{.Repository}}' | sort -u); do
    # `docker images` lists newest first; skip the newest KEEP_RELEASES image IDs.
    docker images "$repo" --format '{{.ID}} {{.Tag}}' | awk -v keep="$KEEP_RELEASES" '
      !($1 in seen) { seen[$1] = ++n }
      seen[$1] > keep { print $1, $2 }' |
      while read -r id tag; do
        if [ "$tag" = "<none>" ]; then ref="$id"; else ref="$repo:$tag"; fi
        docker rmi "$ref" >/dev/null 2>&1 && echo "[prune] removed $ref"
      done
  done
done

docker image prune -f --filter "label=org.opencontainers.image.revision" --filter "until=$MIN_AGE" >/dev/null
if [ "${PRUNE_BUILD_CACHE:-false}" = "true" ]; then
  docker builder prune -a -f --filter "until=$MIN_AGE" >/dev/null
fi

after=$(df --output=pcent / | tail -1 | tr -d ' %')
echo "[prune] disk ${before}% -> ${after}% (kept newest $KEEP_RELEASES per repository)"
