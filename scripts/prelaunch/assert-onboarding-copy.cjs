#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..', '..');

const files = [
  'mobile-app/src/components/auth/steps/PhoneInputStep.js',
  'mobile-app/src/components/auth/steps/OTPStep.js',
  'mobile-app/src/components/auth/steps/ForgotPasswordStep.js',
  'mobile-app/src/components/auth/steps/ProfileDataStep.js'
];

const bannedUserFacingPatterns = [
  {
    pattern: /Usaremos\s+para\s+OTP/i,
    message: 'Troque "Usaremos para OTP" por linguagem final como "Enviaremos codigos por SMS".'
  },
  {
    pattern: /Acesso\s+principal\s+por\s+OTP/i,
    message: 'Remova "Acesso principal por OTP"; usuario final nao precisa ver essa terminologia.'
  },
  {
    pattern: /C[oó]digo\s+OTP/i,
    message: 'Troque "Codigo OTP" por "codigo recebido por SMS" ou "codigo de verificacao".'
  },
  {
    pattern: /Bypass\s+de\s+OTP/i,
    message: 'Mensagens de bypass sao tecnicas e nao devem aparecer para usuario final.'
  }
];

const failures = [];

for (const relativeFile of files) {
  const absoluteFile = path.join(rootDir, relativeFile);
  if (!fs.existsSync(absoluteFile)) {
    failures.push(`${relativeFile}: arquivo nao encontrado`);
    continue;
  }

  const content = fs.readFileSync(absoluteFile, 'utf8');
  const lines = content.split(/\r?\n/);

  lines.forEach((line, index) => {
    bannedUserFacingPatterns.forEach(({ pattern, message }) => {
      if (pattern.test(line)) {
        failures.push(`${relativeFile}:${index + 1}: ${message}`);
      }
    });
  });
}

if (failures.length > 0) {
  console.error('Falha no guard de copy do onboarding:\n');
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log('Onboarding copy guard: PASS');
