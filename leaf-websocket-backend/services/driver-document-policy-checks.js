'use strict';

// Regras de negócio da análise automática de CNH e CRLV que dependem do
// cadastro do motorista (CPF da conta, veículos declarados, a outra peça).
// Funções puras: recebem os dados extraídos e o contexto já lido e devolvem a
// lista de checagens que o painel mostra e, quando houver, o motivo da
// reprovação com a instrução de correção para o motorista.

const EXPIRING_SOON_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

const REASONS = Object.freeze({
  cnhNotRecognized:
    'O arquivo não parece ser uma CNH. Abra o app Carteira Digital de Trânsito, exporte a sua CNH em PDF e envie de novo.',
  cnhIdentityUnreadable:
    'Não conseguimos ler o nome e o CPF na sua CNH. Envie o PDF exportado do app Carteira Digital de Trânsito, sem foto ou print da tela.',
  cnhWithoutEar:
    'Sua CNH não tem a observação EAR (Exerce Atividade Remunerada), exigida para dirigir por aplicativo. Peça a inclusão do EAR no Detran do seu estado e, quando ela aparecer na Carteira Digital de Trânsito, envie o PDF de novo.',
  cnhExpired: (validade) =>
    `Sua CNH venceu em ${validade}. Renove a CNH no Detran e envie o PDF da CNH nova.`,
  cnhCpfMismatch:
    'O CPF da CNH é diferente do CPF da sua conta. Envie a sua própria CNH. Se o CPF da conta estiver errado, fale com o suporte pelo app.',
  cnhCategoryInvalid: (categoria) =>
    `Sua CNH (categoria ${categoria}) não permite dirigir carro (B) nem moto (A). Envie uma CNH com categoria A ou B.`,
  categoryMismatchMoto: (categoria) =>
    `O veículo do seu CRLV é uma moto, mas a sua CNH é categoria ${categoria} e não inclui a categoria A. Envie o CRLV de um carro ou uma CNH com categoria A.`,
  categoryMismatchCar: (categoria) =>
    `O veículo do seu CRLV é um carro, mas a sua CNH é categoria ${categoria} e não inclui a categoria B. Envie o CRLV de uma moto ou uma CNH com categoria B.`,
  crlvIncomplete:
    'Não conseguimos ler placa, RENAVAM, modelo e cor no CRLV. Envie o CRLV digital em PDF, baixado do app Carteira Digital de Trânsito.',
  crlvPlateMismatch: (plate) =>
    `A placa do CRLV (${plate}) não é de nenhum veículo cadastrado no seu perfil. Envie o CRLV do veículo cadastrado ou cadastre este veículo antes de enviar.`
});

function onlyDigits(value) {
  return String(value || '').replace(/\D/g, '');
}

function normalizePlate(value) {
  return String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function parseBrazilianDate(value) {
  const match = String(value || '').trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) return null;
  const [, dd, mm, yyyy] = match;
  const day = Number(dd);
  const month = Number(mm);
  const year = Number(yyyy);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const utc = Date.UTC(year, month - 1, day);
  const parsed = new Date(utc);
  if (parsed.getUTCDate() !== day || parsed.getUTCMonth() !== month - 1) return null;
  return utc;
}

// Dia corrente em São Paulo (UTC-3, sem horário de verão desde 2019) como
// meia-noite UTC, para comparar só datas.
function todayUtcInBrazil(now = new Date()) {
  const shifted = new Date(now.getTime() - 3 * 60 * 60 * 1000);
  return Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate());
}

function formatCpf(digits) {
  return digits.length === 11
    ? `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9)}`
    : digits;
}

function maskCpf(digits) {
  return digits.length === 11 ? `***.${digits.slice(3, 6)}.${digits.slice(6, 9)}-**` : '';
}

// Categoria da CNH -> o que ela permite. ACC (ciclomotor) não conta como moto.
function parseCnhCategory(value) {
  const raw = String(value || '').toUpperCase().replace(/[^A-Z]/g, '');
  if (!raw) return null;
  const withoutAcc = raw.replace(/ACC/g, '');
  const letters = new Set(withoutAcc.split(''));
  const known = ['A', 'B', 'C', 'D', 'E'].filter((letter) => letters.has(letter));
  if (known.length === 0 && !raw.includes('ACC')) return null;
  return {
    label: raw,
    moto: letters.has('A'),
    car: ['B', 'C', 'D', 'E'].some((letter) => letters.has(letter))
  };
}

// Tipo do veículo a partir dos campos do CRLV ou do cadastro manual.
function resolveVehicleKind(source = {}) {
  const text = [
    source.vehicleType,
    source.especie,
    source.tipo,
    source.tipoVeiculo,
    source.categoria
  ].map((value) => String(value || '').toUpperCase()).join(' ');
  if (!text.trim()) return null;
  if (/MOTO|MOTOCICLETA|MOTONETA/.test(text)) return 'moto';
  if (/CARRO|AUTOMOVEL|AUTOMÓVEL|CAMIONETA|UTILITARIO|UTILITÁRIO|PASSAGEIRO/.test(text)) return 'car';
  return null;
}

function check(key, label, status, detail) {
  return { key, label, status, detail: detail || null };
}

function categoryCompatibility(category, vehicleKind) {
  if (!category || !vehicleKind) return null;
  if (vehicleKind === 'moto' && !category.moto) {
    return { ok: false, reason: REASONS.categoryMismatchMoto(category.label) };
  }
  if (vehicleKind === 'car' && !category.car) {
    return { ok: false, reason: REASONS.categoryMismatchCar(category.label) };
  }
  return { ok: true };
}

/**
 * CNH já reconhecida, com nome, CPF e EAR. Confere validade, CPF da conta,
 * categoria e, se o CRLV já foi lido, se a categoria serve para o veículo.
 */
function evaluateCnhPolicy(data = {}, context = {}, now = new Date()) {
  const checks = [];
  let failure = null;
  const fail = (reason) => {
    if (!failure) failure = reason;
  };

  // 1. Validade
  const validade = String(data?.validade || '').trim();
  const validadeUtc = parseBrazilianDate(validade);
  if (!validadeUtc) {
    checks.push(check('cnh_validity', 'Validade', 'unknown', 'Validade não lida na CNH'));
  } else {
    const today = todayUtcInBrazil(now);
    const daysLeft = Math.round((validadeUtc - today) / DAY_MS);
    if (daysLeft < 0) {
      checks.push(check('cnh_validity', 'Validade', 'fail', `Vencida em ${validade}`));
      fail(REASONS.cnhExpired(validade));
    } else if (daysLeft <= EXPIRING_SOON_DAYS) {
      checks.push(check('cnh_validity', 'Validade', 'warn', `Vence em ${validade} (${daysLeft} dias)`));
    } else {
      checks.push(check('cnh_validity', 'Validade', 'ok', `Válida até ${validade}`));
    }
  }

  // 2. CPF da CNH x CPF da conta
  const cnhCpf = onlyDigits(data?.cpf);
  const accountCpf = onlyDigits(context.accountCpf);
  if (!context.contextLoaded) {
    checks.push(check('cnh_cpf_account', 'CPF x conta', 'unknown', 'Cadastro não consultado'));
  } else if (accountCpf.length !== 11) {
    checks.push(check('cnh_cpf_account', 'CPF x conta', 'unknown', 'Conta sem CPF'));
  } else if (cnhCpf !== accountCpf) {
    checks.push(check('cnh_cpf_account', 'CPF x conta', 'fail', `Conta tem outro CPF (${maskCpf(accountCpf)})`));
    fail(REASONS.cnhCpfMismatch);
  } else {
    checks.push(check('cnh_cpf_account', 'CPF x conta', 'ok', `Igual ao da conta (${formatCpf(accountCpf)})`));
  }

  // 3. Categoria
  const category = parseCnhCategory(data?.categoria);
  if (!category) {
    checks.push(check('cnh_category', 'Categoria', 'unknown', 'Categoria não lida na CNH'));
  } else if (!category.car && !category.moto) {
    checks.push(check('cnh_category', 'Categoria', 'fail', `${category.label}: não permite carro nem moto`));
    fail(REASONS.cnhCategoryInvalid(category.label));
  } else {
    const kinds = [category.car ? 'carro' : null, category.moto ? 'moto' : null].filter(Boolean).join(' e ');
    const compatibility = categoryCompatibility(category, context.vehicleKind);
    if (compatibility && !compatibility.ok) {
      checks.push(check('cnh_category', 'Categoria', 'fail', `${category.label}: não serve para o veículo do CRLV`));
      fail(compatibility.reason);
    } else {
      checks.push(check('cnh_category', 'Categoria', 'ok', `${category.label}: ${kinds}`));
    }
  }

  return { checks, failureReason: failure };
}

/**
 * CRLV já com placa, RENAVAM, modelo e cor. Confere a placa contra os
 * veículos cadastrados à mão e a categoria contra a CNH lida.
 */
function evaluateCrlvPolicy(data = {}, context = {}) {
  const checks = [];
  let failure = null;
  const fail = (reason) => {
    if (!failure) failure = reason;
  };

  const plate = normalizePlate(data?.plate || data?.placa);
  const declared = Array.isArray(context.declaredVehicles) ? context.declaredVehicles : [];
  const declaredWithPlate = declared.filter((vehicle) => normalizePlate(vehicle?.plate));
  const matching = declaredWithPlate.find((vehicle) => normalizePlate(vehicle.plate) === plate) || null;

  // 4. Placa e ano x veículo cadastrado
  if (!context.contextLoaded) {
    checks.push(check('crlv_plate_profile', 'Placa x cadastro', 'unknown', 'Cadastro não consultado'));
  } else if (declaredWithPlate.length === 0) {
    checks.push(check('crlv_plate_profile', 'Placa x cadastro', 'ok', 'Nenhum veículo cadastrado à mão; o CRLV define o veículo'));
  } else if (!matching) {
    const plates = declaredWithPlate.map((vehicle) => normalizePlate(vehicle.plate)).join(', ');
    checks.push(check('crlv_plate_profile', 'Placa x cadastro', 'fail', `${plate} não está no perfil (${plates})`));
    fail(REASONS.crlvPlateMismatch(plate));
  } else {
    checks.push(check('crlv_plate_profile', 'Placa x cadastro', 'ok', `${plate} cadastrada no perfil`));
    const crlvYears = [data?.anoModelo, data?.anoFabricacao, data?.year]
      .map((value) => String(value || '').trim())
      .filter(Boolean);
    const declaredYear = String(matching.year || '').trim();
    if (declaredYear && crlvYears.length > 0) {
      const sameYear = crlvYears.includes(declaredYear);
      checks.push(check(
        'crlv_year_profile',
        'Ano x cadastro',
        sameYear ? 'ok' : 'warn',
        sameYear
          ? `Ano ${declaredYear} confere`
          : `Cadastro diz ${declaredYear}, CRLV diz ${crlvYears.join('/')}`
      ));
    }
  }

  // 3. Categoria da CNH x tipo do veículo
  const vehicleKind = resolveVehicleKind(data);
  const category = parseCnhCategory(context.cnhCategory);
  const compatibility = categoryCompatibility(category, vehicleKind);
  if (!vehicleKind || !category) {
    checks.push(check(
      'crlv_cnh_category',
      'Categoria da CNH',
      'unknown',
      !vehicleKind ? 'Tipo do veículo não lido no CRLV' : 'CNH ainda sem categoria lida'
    ));
  } else if (!compatibility.ok) {
    checks.push(check('crlv_cnh_category', 'Categoria da CNH', 'fail', `${vehicleKind === 'moto' ? 'Moto' : 'Carro'} x CNH ${category.label}`));
    fail(compatibility.reason);
  } else {
    checks.push(check('crlv_cnh_category', 'Categoria da CNH', 'ok', `${vehicleKind === 'moto' ? 'Moto' : 'Carro'} x CNH ${category.label}`));
  }

  return { checks, failureReason: failure };
}

module.exports = {
  EXPIRING_SOON_DAYS,
  REASONS,
  evaluateCnhPolicy,
  evaluateCrlvPolicy,
  parseBrazilianDate,
  parseCnhCategory,
  resolveVehicleKind,
  todayUtcInBrazil
};
