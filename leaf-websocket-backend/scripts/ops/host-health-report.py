#!/usr/bin/env python3
"""Host health summary for the external uptime monitor.

Runs every minute (systemd timer leaf-host-health.timer) on each Leaf host
and writes a small JSON file that nginx serves at /health/host. The GitHub
uptime workflow alerts when the overall status is "fail" or the file is
stale. Only coarse numbers and statuses are published, no identifiers.

usage: host-health-report.py --role santiago|contabo --out <file>
       [--cert <fullchain.pem>]... [--backup-dir <dir>]
"""
import argparse
import datetime as dt
import glob
import json
import os
import shutil
import subprocess
import tempfile
import time

LEAF_CONTAINERS = {
    'santiago': [
        'leaf-redis', 'leaf-nginx', 'leaf-websocket', 'leaf-websocket-gateway-2',
        'leaf-queue-worker', 'leaf-sideeffects-worker', 'leaf-trip-location-worker',
        'leaf-billing-worker', 'leaf-pricing-baseline-worker', 'leaf-ride-health-monitor-worker',
    ],
    'contabo': [
        'leaf-redis', 'leaf-nginx', 'leaf-dashboard', 'leaf-ocr-worker',
        'deploy-face-compare-service-1', 'leaf-wg-relay-face', 'leaf-wg-relay-redis',
    ],
}
WG_INTERFACE = {'santiago': 'wg0', 'contabo': 'wg-leaf'}
RANK = {'ok': 0, 'warn': 1, 'fail': 2}


def run(cmd, timeout=10):
    try:
        out = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
        return out.returncode, out.stdout
    except Exception as error:  # noqa: BLE001 - any failure is a failed check
        return 1, str(error)


def check(status, value=None, detail=None):
    result = {'status': status}
    if value is not None:
        result['value'] = value
    if detail:
        result['detail'] = detail
    return result


def threshold(value, warn, fail, higher_is_worse=True):
    if higher_is_worse:
        return 'fail' if value >= fail else 'warn' if value >= warn else 'ok'
    return 'fail' if value <= fail else 'warn' if value <= warn else 'ok'


def disk_check():
    usage = shutil.disk_usage('/')
    pct = round(usage.used * 100 / usage.total, 1)
    return check(threshold(pct, 80, 90), pct)


def memory_check():
    info = {}
    with open('/proc/meminfo') as handle:
        for line in handle:
            key, raw = line.split(':', 1)
            info[key] = int(raw.strip().split()[0])
    pct = round(info['MemAvailable'] * 100 / info['MemTotal'], 1)
    return check(threshold(pct, 20, 10, higher_is_worse=False), pct)


def wireguard_check(role):
    code, out = run(['wg', 'show', WG_INTERFACE[role], 'latest-handshakes'])
    if code != 0 or not out.strip():
        return check('fail', detail='interface_down')
    latest = max(int(line.split()[1]) for line in out.strip().splitlines())
    age = int(time.time()) - latest if latest else None
    if age is None:
        return check('fail', detail='no_handshake')
    # Handshakes renew every ~2 min while traffic flows (keepalive 25 s).
    return check(threshold(age, 200, 300), age)


def containers_check(role):
    bad = []
    for name in LEAF_CONTAINERS[role]:
        code, out = run(['docker', 'inspect', '--format',
                         '{{.State.Status}} {{if .State.Health}}{{.State.Health.Status}}{{end}}', name])
        state = out.strip().split() if code == 0 else ['missing']
        if state[0] != 'running' or (len(state) > 1 and state[1] == 'unhealthy'):
            bad.append(f"{name}:{'/'.join(state)}")
    return check('fail' if bad else 'ok', len(LEAF_CONTAINERS[role]) - len(bad), ','.join(bad) or None)


def redis_info(section):
    code, out = run(['docker', 'exec', 'leaf-redis', 'sh', '-c',
                     f'REDISCLI_AUTH="$REDIS_PASSWORD" redis-cli --no-auth-warning INFO {section}'])
    if code != 0:
        return None
    fields = {}
    for line in out.splitlines():
        if ':' in line and not line.startswith('#'):
            key, value = line.strip().split(':', 1)
            fields[key] = value
    return fields


def redis_checks(role):
    checks = {}
    replication = redis_info('replication')
    memory = redis_info('memory')
    if replication is None or memory is None:
        return {'redis': check('fail', detail='unreachable')}
    if role == 'santiago':
        replica = replication.get('slave0', '')
        parts = dict(item.split('=', 1) for item in replica.split(',') if '=' in item)
        lag = int(parts.get('lag', '-1') or -1)
        ok = replication.get('role') == 'master' and parts.get('state') == 'online' and 0 <= lag <= 30
        checks['redisReplica'] = check('ok' if ok else 'fail', lag,
                                       None if ok else f"role={replication.get('role')},state={parts.get('state')}")
    else:
        io_age = int(replication.get('master_last_io_seconds_ago', '-1') or -1)
        ok = replication.get('role') == 'slave' and replication.get('master_link_status') == 'up' and 0 <= io_age <= 30
        checks['redisReplica'] = check('ok' if ok else 'fail', io_age,
                                       None if ok else f"role={replication.get('role')},link={replication.get('master_link_status')}")
    used = int(memory.get('used_memory', '0'))
    maximum = int(memory.get('maxmemory', '0'))
    if maximum > 0:
        pct = round(used * 100 / maximum, 1)
        checks['redisMemory'] = check(threshold(pct, 60, 85), pct)
    return checks


def cert_check(path):
    code, out = run(['openssl', 'x509', '-enddate', '-noout', '-in', path])
    if code != 0:
        return check('fail', detail='unreadable')
    end = dt.datetime.strptime(out.strip().split('=', 1)[1], '%b %d %H:%M:%S %Y %Z').replace(tzinfo=dt.timezone.utc)
    days = int((end - dt.datetime.now(dt.timezone.utc)).total_seconds() // 86400)
    return check(threshold(days, 21, 14, higher_is_worse=False), days)


def certs_check(paths):
    # Worst certificate wins; detail keeps each lineage's days left. Contabo
    # checks its dashboard certificate and the api/socket copy it needs to
    # serve during a failover (sync-api-cert-to-contabo.sh refreshes it).
    results = {}
    for path in paths:
        results[os.path.basename(os.path.dirname(path)) or path] = cert_check(path)
    worst = max(results.values(), key=lambda c: (RANK[c['status']], -(c.get('value') or 0)))
    detail = {name: c.get('value', c.get('detail')) for name, c in results.items()}
    return check(worst['status'], worst.get('value'), detail if len(results) > 1 else worst.get('detail'))


def backup_check(directory):
    files = glob.glob(os.path.join(directory, 'redis', '*.rdb.gz'))
    if not files:
        return check('fail', detail='no_backup')
    age_hours = round((time.time() - max(os.path.getmtime(f) for f in files)) / 3600, 1)
    return check(threshold(age_hours, 26, 50), age_hours)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--role', choices=sorted(LEAF_CONTAINERS), required=True)
    parser.add_argument('--out', required=True)
    parser.add_argument('--cert', action='append')
    parser.add_argument('--backup-dir')
    args = parser.parse_args()

    checks = {
        'disk': disk_check(),
        'memory': memory_check(),
        'wireguard': wireguard_check(args.role),
        'containers': containers_check(args.role),
    }
    checks.update(redis_checks(args.role))
    if args.cert:
        checks['tlsCertificate'] = certs_check(args.cert)
    if args.backup_dir:
        checks['backup'] = backup_check(args.backup_dir)

    status = max((c['status'] for c in checks.values()), key=RANK.get)
    report = {
        'role': args.role,
        'status': status,
        'generatedAt': int(time.time()),
        'checks': checks,
    }
    directory = os.path.dirname(os.path.abspath(args.out))
    os.makedirs(directory, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=directory, prefix='.host-health-')
    with os.fdopen(fd, 'w') as handle:
        json.dump(report, handle, separators=(',', ':'))
    os.chmod(tmp, 0o644)
    os.replace(tmp, args.out)


if __name__ == '__main__':
    main()
