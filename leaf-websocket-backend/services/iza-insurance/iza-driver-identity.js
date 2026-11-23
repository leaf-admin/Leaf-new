'use strict';

// Dados do motorista que a IZA exige no cadastro: CPF válido, nome igual ao
// documento e data de nascimento. O nome sai da CNH aprovada (é o que está no
// documento); o perfil só entra se a CNH não tiver nome. Depois de cadastrado na
// IZA, o nome não pode ser corrigido pela API.

const userStore = require('../user-store');
const driverDocumentStore = require('../driver-document-store');
const { digitsOnly, isValidCpfDigits } = require('../cpf-identity-registry-service');

function firstText(...values) {
  for (const value of values) {
    const text = String(value ?? '').replace(/\s+/g, ' ').trim();
    if (text) return text;
  }
  return null;
}

function normalizeBirthDate(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const ddmmyyyy = raw.match(/^(\d{2})[/-](\d{2})[/-](\d{4})$/);
  if (ddmmyyyy) return `${ddmmyyyy[3]}-${ddmmyyyy[2]}-${ddmmyyyy[1]}`;
  const iso = raw.match(/^(\d{4})[/-](\d{2})[/-](\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  return null;
}

function resolveIzaIdentity({ user = {}, cnh = {} } = {}) {
  const cpfDigits = digitsOnly(firstText(cnh.cpf, user.cpf, user.document, user.documentNumber) || '');
  const name = firstText(
    cnh.nome,
    cnh.name,
    user.fullName,
    user.name,
    [firstText(user.firstName), firstText(user.lastName)].filter(Boolean).join(' ')
  );
  const birthDate = normalizeBirthDate(
    firstText(cnh.dataNascimento, cnh.birthDate, cnh.dateOfBirth, user.birthDate, user.dateOfBirth, user.dob, user.dataNascimento)
  );

  const missing = [];
  if (!cpfDigits || !isValidCpfDigits(cpfDigits)) missing.push('cpf');
  if (!name) missing.push('name');
  if (!birthDate) missing.push('birthDate');

  return {
    ok: missing.length === 0,
    missing,
    doc: cpfDigits || null,
    name: name || null,
    birthDate,
    nameSource: firstText(cnh.nome, cnh.name) ? 'cnh' : 'profile'
  };
}

async function loadDriverIzaIdentity(firestore, driverId) {
  const [user, activation] = await Promise.all([
    userStore.readUser(firestore, driverId),
    driverDocumentStore.readActivation(firestore, driverId)
  ]);
  const cnhNode = activation?.documents?.cnh || user?.documents?.cnh || {};
  const cnh = cnhNode.data || cnhNode.extractedData || cnhNode.analysisData || {};
  return resolveIzaIdentity({ user: user || {}, cnh });
}

module.exports = {
  loadDriverIzaIdentity,
  normalizeBirthDate,
  resolveIzaIdentity
};
