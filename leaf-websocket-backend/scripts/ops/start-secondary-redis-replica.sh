#!/bin/sh

set -eu

SECRET_FILE="${REDIS_PASSWORD_FILE:-/run/leaf/redis_password}"
CONFIG_FILE="/run/leaf-runtime/redis.conf"

if [ ! -s "$SECRET_FILE" ]; then
    echo "Redis password file is missing or empty" >&2
    exit 1
fi

redis_password="$(cat "$SECRET_FILE")"
escaped_password="$(printf '%s' "$redis_password" | sed 's/\\/\\\\/g; s/"/\\"/g')"
unset redis_password

umask 077
cat >"$CONFIG_FILE" <<EOF
bind 0.0.0.0
protected-mode yes
port 6379
dir /data
dbfilename dump.rdb
appendonly yes
appendfsync everysec
replicaof redis-primary-tunnel 6381
replica-read-only yes
replica-serve-stale-data yes
masterauth "$escaped_password"
requirepass "$escaped_password"
maxmemory 512mb
maxmemory-policy noeviction
EOF

unset escaped_password
chown redis:redis "$CONFIG_FILE" /run/leaf-runtime /data
exec /usr/bin/setpriv --reuid redis --regid redis --clear-groups redis-server "$CONFIG_FILE"
