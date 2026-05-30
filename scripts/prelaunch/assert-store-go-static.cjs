#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..', '..');
const mobileDir = path.join(rootDir, 'mobile-app');

const failures = [];
const warnings = [];
const passes = [];

const storeChecklistFiles = [
  'docs/PLANO_PRIORIDADE_ZERO_LOJAS_2026-05-13.md',
  'docs/STORE_GO_CLEANUP_GLOBAL_CHECKLIST_2026-05-13.md',
];

const storeBlockingFiles = [
  'mobile-app/docs/APP_STORE_CONNECT_READY_RESPONSES_2026-03-19.md',
  'mobile-app/docs/APP_STORE_CONNECT_READY_RESPONSES_2026-03-23.md',
  'mobile-app/docs/PLAY_CONSOLE_READY_RESPONSES_2026-03-19.md',
  'mobile-app/docs/PLAY_CONSOLE_READY_RESPONSES_2026-03-23.md',
  'mobile-app/scripts/store-console-preflight.sh',
  'mobile-app/config/AppConfig.js',
  'mobile-app/app.config.js',
  'mobile-app/eas.json',
];

const storeHistoricalFiles = [
  'mobile-app/docs/STORE_COMPLIANCE_AUDIT_2026-03-23.md',
  'docs/archive/legacy-infra-2026-05-29/mobile-app/CHECKLIST_LOJAS_APPLE_GOOGLE_2026-03-19.md',
  'mobile-app/docs/GO_LIVE_STORE_CHECKLIST_2026-03-19.md',
  'mobile-app/docs/GO_LIVE_STORE_CHECKLIST_2026-03-23.md',
  'mobile-app/docs/GO_NO_GO_BUILD_CHECKLIST_2026-03-19.md',
];

const riskyPublicHostPattern = /\b(?:localhost|127\.0\.0\.1|0\.0\.0\.0|ngrok|sslip\.io|\.local)\b/i;
const oldReviewCredentialPattern = /\+55\s*11\s*(?:99999|88888)[-\s]?\d{4}|11999999999|11888888888|teste123|Leaf@Review2026!/i;
const storeCopyRiskPattern = /\b(?:beta|em breve|mock|bypass|debug menu|sandbox|test user|usu[aá]rio de teste|concorrentes?|uber|99)\b/i;
const androidInApplePattern = /App Store[\s\S]{0,500}\bAndroid\b|Apple[\s\S]{0,500}\bAndroid\b/i;

const readText = (relativePath) => {
  const absolutePath = path.join(rootDir, relativePath);
  if (!fs.existsSync(absolutePath)) {
    warnings.push(`${relativePath}: arquivo ausente`);
    return '';
  }
  return fs.readFileSync(absolutePath, 'utf8');
};

const addMatches = (severity, label, relativePath, pattern) => {
  const text = readText(relativePath);
  if (!text) return;

  const lines = text.split(/\r?\n/);
  const hits = [];
  lines.forEach((line, index) => {
    if (pattern.test(line)) {
      hits.push(`${relativePath}:${index + 1}: ${line.trim().slice(0, 180)}`);
    }
  });

  if (hits.length === 0) {
    passes.push(`${relativePath}: ${label} ausente`);
    return;
  }

  const bucket = severity === 'fail' ? failures : warnings;
  bucket.push(`${label} encontrado em:\n  ${hits.join('\n  ')}`);
};

const requireUrl = (name, url) => {
  if (!url) {
    failures.push(`${name}: URL ausente`);
    return;
  }

  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    failures.push(`${name}: URL invalida (${url})`);
    return;
  }

  if (parsed.protocol !== 'https:') {
    failures.push(`${name}: precisa ser HTTPS (${url})`);
  }

  if (riskyPublicHostPattern.test(url)) {
    failures.push(`${name}: host temporario/local bloqueado (${url})`);
  }

  if (!/(^|\.)leaf\.app\.br$/i.test(parsed.hostname)) {
    warnings.push(`${name}: confirmar dominio final de loja (${url})`);
  } else {
    passes.push(`${name}: dominio final Leaf em HTTPS`);
  }
};

process.chdir(mobileDir);
const { AppConfig } = require(path.join(mobileDir, 'config', 'AppConfig.js'));

requireUrl('privacy_policy_url', AppConfig.privacy_policy_url);
requireUrl('terms_of_service_url', AppConfig.terms_of_service_url);
requireUrl('refund_policy_url', AppConfig.refund_policy_url);
requireUrl('account_deletion_url', AppConfig.account_deletion_url);

if (!AppConfig.support_email || !/@leaf\.app\.br$/i.test(AppConfig.support_email)) {
  failures.push(`support_email: esperado email oficial @leaf.app.br (${AppConfig.support_email || '<vazio>'})`);
} else {
  passes.push('support_email: dominio oficial Leaf');
}

const appConfigText = readText('mobile-app/app.config.js');
const easText = readText('mobile-app/eas.json');
let easConfig = {};
try {
  easConfig = JSON.parse(easText);
} catch {
  failures.push('mobile-app/eas.json: JSON invalido');
}

[
  'ACCESS_BACKGROUND_LOCATION',
  'FOREGROUND_SERVICE_LOCATION',
  'CAMERA',
].forEach((permission) => {
  if (appConfigText.includes(permission)) {
    passes.push(`app.config.js: permissao declarada para inventario: ${permission}`);
  } else {
    failures.push(`app.config.js: permissao obrigatoria para inventario nao localizada: ${permission}`);
  }
});

[
  'READ_EXTERNAL_STORAGE',
  'WRITE_EXTERNAL_STORAGE',
  'SYSTEM_ALERT_WINDOW',
].forEach((permission) => {
  const blockedLiteral = `"android.permission.${permission}"`;
  if (appConfigText.includes(blockedLiteral)) {
    passes.push(`app.config.js: permissao sensivel bloqueada: ${permission}`);
  } else {
    warnings.push(`app.config.js: confirmar bloqueio de permissao sensivel: ${permission}`);
  }
});

const unsafeFlagKeys = [
  'APP_REVIEW',
  'EXPO_PUBLIC_E2E_TEST',
  'EXPO_PUBLIC_FORCE_PAYMENT_BYPASS',
  'EXPO_PUBLIC_BYPASS_PAYMENTS',
  'EXPO_PUBLIC_ENABLE_TEST_USER_TOOLS',
];

const releaseProfiles = ['production', 'production-apk', 'release-test'];
releaseProfiles.forEach((profileName) => {
  const env = easConfig?.build?.[profileName]?.env || {};
  unsafeFlagKeys.forEach((key) => {
    const unsafeValue = /^(1|true|yes|on)$/i.test(String(env[key] || '').trim());
    if (unsafeValue) {
      failures.push(`eas.json:${profileName}.${key}: flag de review/QA/bypass ativa em perfil de release`);
    } else {
      passes.push(`eas.json:${profileName}.${key}: desligada`);
    }
  });
});

Object.entries(easConfig?.build || {}).forEach(([profileName, profile]) => {
  if (releaseProfiles.includes(profileName)) return;
  const env = profile?.env || {};
  unsafeFlagKeys.forEach((key) => {
    const unsafeValue = /^(1|true|yes|on)$/i.test(String(env[key] || '').trim());
    if (unsafeValue) {
      warnings.push(`eas.json:${profileName}.${key}: ativo fora dos perfis de release; nao usar para submissao publica`);
    }
  });
});

unsafeFlagKeys.forEach((key) => {
  const unsafeCurrentValue = /^(1|true|yes|on)$/i.test(String(process.env[key] || '').trim());
  if (unsafeCurrentValue) {
    failures.push(`${key}: flag de review/QA/bypass ativa no ambiente atual de preflight`);
  } else {
    passes.push(`${key}: nao esta ativa no ambiente atual`);
  }
});

storeChecklistFiles.forEach((relativePath) => {
  addMatches('warn', 'Host publico temporario/local citado em checklist', relativePath, riskyPublicHostPattern);
  addMatches('warn', 'Credencial antiga de review citada em checklist', relativePath, oldReviewCredentialPattern);
  addMatches('warn', 'Copy sensivel para loja', relativePath, storeCopyRiskPattern);
  addMatches('warn', 'Android em contexto Apple/App Store', relativePath, androidInApplePattern);
});

storeBlockingFiles.forEach((relativePath) => {
  addMatches('fail', 'Host publico temporario/local', relativePath, riskyPublicHostPattern);
  addMatches('fail', 'Credencial antiga de review', relativePath, oldReviewCredentialPattern);
  addMatches('warn', 'Copy sensivel para loja', relativePath, storeCopyRiskPattern);
  addMatches('warn', 'Android em contexto Apple/App Store', relativePath, androidInApplePattern);
});

storeHistoricalFiles.forEach((relativePath) => {
  addMatches('warn', 'Host publico temporario/local em doc historico', relativePath, riskyPublicHostPattern);
  addMatches('warn', 'Credencial antiga de review em doc historico', relativePath, oldReviewCredentialPattern);
  addMatches('warn', 'Copy sensivel para loja em doc historico', relativePath, storeCopyRiskPattern);
  addMatches('warn', 'Android em contexto Apple/App Store em doc historico', relativePath, androidInApplePattern);
});

const requiredDocs = [
  'privacy-data-inventory.md',
  'app-store-review-notes.md',
  'google-play-review-notes.md',
  'links-check.txt',
  'ios-testflight-smoke.md',
  'android-internal-testing-smoke.md',
];

requiredDocs.forEach((fileName) => {
  warnings.push(`Pacote final deve conter: reports/store-submit-YYYYMMDD/${fileName}`);
});

console.log('# Store GO Static Gate');
console.log('');
console.log(`Workspace: ${rootDir}`);
console.log(`Passes: ${passes.length}`);
console.log(`Warnings: ${warnings.length}`);
console.log(`Failures: ${failures.length}`);

if (passes.length) {
  console.log('\n## PASS');
  passes.forEach((item) => console.log(`- ${item}`));
}

if (warnings.length) {
  console.log('\n## WARN');
  warnings.forEach((item) => console.log(`- ${item}`));
}

if (failures.length) {
  console.log('\n## FAIL');
  failures.forEach((item) => console.log(`- ${item}`));
  console.log('\nStatus final: NO-GO');
  process.exit(2);
}

console.log('\nStatus final: GO para checklist estatico; ainda exige smoke oficial e fechamento manual nos consoles.');
