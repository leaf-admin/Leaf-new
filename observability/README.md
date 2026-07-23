# Leaf production observability

This stack is the minimum production profile for the controlled pilot.

Pinned components:

- Grafana `13.0.2`
- Prometheus `3.13.0`
- Alertmanager `0.32.1`
- Tempo `2.10.5`

All host ports bind to `127.0.0.1`. Access must be through a private network, VPN, or an authenticated reverse proxy. Grafana anonymous access is disabled and there is no default password.

## Required inputs

```bash
export GRAFANA_ADMIN_PASSWORD='use-a-secret-manager-value'
export ALERTMANAGER_SLACK_WEBHOOK_FILE='/absolute/private/path/slack-webhook-url.txt'
```

The Slack URL file must contain only the webhook URL and must not be committed. Critical alerts go directly from Alertmanager to Slack and are also copied to the Leaf backend webhook. The external route therefore remains available when the backend is unavailable.

## Validation and startup

```bash
docker compose -f docker-compose.observability.yml config --quiet
docker compose -f docker-compose.observability.yml up -d
docker compose -f docker-compose.observability.yml ps
```

Local endpoints, reachable only from the host:

- Grafana: `http://127.0.0.1:3002`
- Prometheus: `http://127.0.0.1:9090`
- Alertmanager: `http://127.0.0.1:9093`
- Tempo: `http://127.0.0.1:3200`

Backend trace configuration:

```bash
OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:4318
OTEL_SAMPLING_RATE=0.01
```

## Mandatory acceptance test

Before the pilot, submit a synthetic critical alert and verify all four steps:

1. Prometheus evaluates the rule.
2. Alertmanager receives it.
3. The external channel receives and acknowledges it.
4. The backend copy may fail without preventing step 3.

Do not mark observability ready from container health alone. Record timestamp, alert fingerprint, channel message, acknowledgment owner, and resolution in the RC evidence folder.
