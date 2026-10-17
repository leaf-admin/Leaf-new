#!/usr/bin/env bash
# Copy the api/socket TLS certificate from Santiago to Contabo.
#
# Santiago renews api.leaf.app.br + socket.leaf.app.br (/etc/cron.d/leaf-certbot-renew).
# Contabo cannot renew them while DNS points at Santiago, but needs a valid
# copy to serve them during a failover. This copies the current lineage into
# Contabo's certbot tree (which has no renewal config for it), checks nginx
# and reloads it. A no-op when Contabo already has the same certificate.
# The private key only travels inside the two ssh sessions; nothing is
# written on the operator machine. deploy-santiago-docker.sh calls this.
set -euo pipefail

SANTIAGO_SSH="${SANTIAGO_SSH:-leaf-scl-test}"
CONTABO_SSH="${CONTABO_SSH:-leaf-vps}"
LIVE=/opt/leaf-app/certbot/conf/live/api.leaf.app.br
ARCHIVE=/opt/leaf-app/certbot/conf/archive/api.leaf.app.br

fingerprint='openssl x509 -in '"$LIVE"'/fullchain.pem -noout -fingerprint -sha256 2>/dev/null || true'
src_fp="$(ssh "$SANTIAGO_SSH" "$fingerprint")"
dst_fp="$(ssh "$CONTABO_SSH" "$fingerprint")"
[ -n "$src_fp" ] || { echo "[cert][error] no certificate on Santiago" >&2; exit 1; }
if [ "$src_fp" = "$dst_fp" ]; then
  echo "[cert] Contabo already has the current api/socket certificate"
  exit 0
fi

stamp="$(date -u +%Y%m%dT%H%M%SZ)"
echo "[cert] copying api/socket certificate Santiago -> Contabo"
ssh "$SANTIAGO_SSH" "tar chf - -C $LIVE cert.pem chain.pem fullchain.pem privkey.pem" \
  | ssh "$CONTABO_SSH" "set -e
    umask 077
    tmp=\$(mktemp -d)
    tar xf - -C \$tmp
    openssl x509 -in \$tmp/fullchain.pem -noout -checkend 86400 >/dev/null
    mkdir -p $ARCHIVE $LIVE
    for f in cert chain fullchain privkey; do install -m 600 \$tmp/\$f.pem $ARCHIVE/\$f-santiago-$stamp.pem; done
    chmod 644 $ARCHIVE/cert-santiago-$stamp.pem $ARCHIVE/chain-santiago-$stamp.pem $ARCHIVE/fullchain-santiago-$stamp.pem
    rm -rf \$tmp
    old=\$(mktemp -d)
    cp -P $LIVE/*.pem \$old/
    for f in cert chain fullchain privkey; do ln -sfn ../../archive/api.leaf.app.br/\$f-santiago-$stamp.pem $LIVE/\$f.pem; done
    if ! docker exec leaf-nginx nginx -t >/dev/null 2>&1; then
      cp -P \$old/*.pem $LIVE/
      echo '[cert][error] nginx -t failed on Contabo; previous links restored' >&2
      exit 1
    fi
    rm -rf \$old
    docker exec leaf-nginx nginx -s reload
    openssl x509 -in $LIVE/fullchain.pem -noout -enddate"
