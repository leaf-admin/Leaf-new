// Repassa alertas do Sentry e do UptimeRobot para os bots do OpenBot.
// Os dois provedores não sabem assinar no formato do OpenBot, então chamam o backend, que
// confere a origem, tira só o mínimo e emite um evento pelo bot-event-service.
//
// - Sentry (Internal Integration): `sentry-hook-signature` = hex(HMAC-SHA256(client secret,
//   corpo bruto)), com o secret em SENTRY_WEBHOOK_SECRET. Recursos aceitos: `issue`
//   (created/unresolved) e `event_alert` (regra de alerta disparada).
// - UptimeRobot (alert contact webhook): token secreto em `x-leaf-alert-token` ou `?token=`,
//   comparado em tempo constante com UPTIMEROBOT_WEBHOOK_TOKEN.
// Sem o segredo configurado, a rota recusa (503): nunca aceita alerta sem autenticação.
const crypto = require('crypto');
const botEventService = require('./bot-event-service');

const MONEY_PATTERN = /\b(pagamento|payment|pix|woovi|refund|estorno|reembolso|saque|withdraw\w*|ledger|financ\w*|charge|cobran\w*)\b/i;
const HOUR_MS = 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;

function safeEqual(left, right) {
  const a = Buffer.from(String(left || ''), 'utf8');
  const b = Buffer.from(String(right || ''), 'utf8');
  return a.length > 0 && a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Títulos de erro podem carregar dados de quem usou o app; o bot não precisa deles.
function maskText(value, max = 120) {
  return String(value || '')
    .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, '[email]')
    .replace(/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g, '[cpf]')
    .replace(/(\+55[\s-]?)?(\(\d{2}\)\s?|\b\d{2}[\s-])9?\d{4}[-\s]?\d{4}\b/g, '[telefone]')
    .slice(0, max);
}

function verifySentrySignature({ rawBody, signature, secret }) {
  if (!secret || !Buffer.isBuffer(rawBody) || !signature) return false;
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  return safeEqual(expected, String(signature).trim().toLowerCase());
}

// Corpo do Sentry -> evento mínimo, ou null quando não interessa aos bots.
function parseSentryAlert(resource, payload = {}) {
  const action = String(payload.action || '');
  if (resource === 'issue' && ['created', 'unresolved'].includes(action)) {
    const issue = payload.data?.issue || {};
    if (!issue.id) return null;
    return {
      dedupeKey: `issue:${action}:${issue.id}`,
      alertKind: action === 'created' ? 'novo' : 'regressao',
      issue: {
        issueId: String(issue.id),
        shortId: issue.shortId,
        title: issue.title || issue.metadata?.title,
        project: issue.project?.slug || issue.project?.name,
        level: issue.level,
        release: issue.lastRelease?.version || null,
        link: issue.permalink || issue.web_url || null,
      },
    };
  }
  if (resource === 'event_alert' && action === 'triggered') {
    const event = payload.data?.event || {};
    const issueId = event.issue_id || event.groupID;
    if (!issueId) return null;
    return {
      dedupeKey: `event_alert:${issueId}:${Math.floor(Date.now() / HOUR_MS)}`,
      alertKind: 'regra',
      issue: {
        issueId: String(issueId),
        title: event.title || event.message,
        project: event.project_slug || event.project?.slug || null,
        level: event.level,
        release: event.release || null,
        link: event.web_url || event.issue_url || null,
      },
    };
  }
  return null;
}

function sentrySeverity(level, alertKind) {
  const normalized = String(level || '').toLowerCase();
  if (normalized === 'fatal') return 'N1';
  if (normalized === 'error' || alertKind === 'regressao') return 'N2';
  return 'N3';
}

async function relaySentry({ resource, payload }) {
  const parsed = parseSentryAlert(resource, payload);
  if (!parsed) return { relayed: false, reason: 'ignored' };
  const { issue } = parsed;
  const title = maskText(issue.title);
  const result = await botEventService.emit('sentry.issue_alert', {
    issueId: issue.issueId,
    shortId: issue.shortId,
    title,
    project: issue.project,
    level: issue.level,
    release: issue.release,
    link: issue.link,
    alertKind: parsed.alertKind,
    source: 'sentry',
  }, {
    dedupeKey: parsed.dedupeKey,
    severity: sentrySeverity(issue.level, parsed.alertKind),
    money: MONEY_PATTERN.test(String(issue.title || '')),
  });
  return { relayed: true, ...result };
}

// UptimeRobot manda os campos no corpo (JSON ou formulário) ou na query, conforme o contato.
function parseUptimeAlert(input = {}) {
  const alertType = String(input.alertType ?? input.alert_type ?? '').trim();
  const monitorId = String(input.monitorID ?? input.monitorId ?? input.monitor_id ?? '').trim();
  if (!monitorId || !['1', '2'].includes(alertType)) return null;
  const duration = Number.parseInt(input.alertDuration ?? input.alert_duration, 10);
  return {
    down: alertType === '1',
    monitorId,
    monitor: maskText(input.monitorFriendlyName ?? input.monitor_friendly_name ?? '', 80),
    durationSeconds: Number.isFinite(duration) ? duration : null,
    details: maskText(input.alertDetails ?? input.alert_details ?? '', 120),
  };
}

async function relayUptime(input) {
  const parsed = parseUptimeAlert(input);
  if (!parsed) return { relayed: false, reason: 'ignored' };
  const type = parsed.down ? 'uptime.monitor_down' : 'uptime.monitor_up';
  const result = await botEventService.emit(type, {
    monitorId: parsed.monitorId,
    monitor: parsed.monitor,
    status: parsed.down ? 'down' : 'up',
    durationSeconds: parsed.durationSeconds,
    reason: parsed.details,
    source: 'uptimerobot',
  }, {
    dedupeKey: `${parsed.monitorId}:${type}:${Math.floor(Date.now() / MINUTE_MS)}`,
    severity: parsed.down ? 'N1' : 'N3',
    money: false,
  });
  return { relayed: true, ...result };
}

module.exports = {
  maskText,
  parseSentryAlert,
  parseUptimeAlert,
  relaySentry,
  relayUptime,
  safeEqual,
  verifySentrySignature,
};
