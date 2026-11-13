'use strict';

const {
  REASONS,
  evaluateCnhPolicy,
  evaluateCrlvPolicy,
  parseCnhCategory,
  resolveVehicleKind
} = require('../../../services/driver-document-policy-checks');

const NOW = new Date('2026-11-13T15:00:00Z');
const CPF = '123.456.789-09';

function cnh(overrides = {}) {
  return { nome: 'FULANO', cpf: CPF, categoria: 'B', validade: '10/05/2030', ear: true, ...overrides };
}

const loaded = (overrides = {}) => ({ contextLoaded: true, accountCpf: '12345678909', ...overrides });
const byKey = (checks, key) => checks.find((item) => item.key === key);

describe('evaluateCnhPolicy', () => {
  it('aprova CNH válida, com o CPF da conta e categoria B', () => {
    const result = evaluateCnhPolicy(cnh(), loaded(), NOW);
    expect(result.failureReason).toBeNull();
    expect(result.checks.map((item) => item.status)).toEqual(['ok', 'ok', 'ok']);
  });

  it('1. reprova CNH vencida com a data na mensagem', () => {
    const result = evaluateCnhPolicy(cnh({ validade: '12/11/2026' }), loaded(), NOW);
    expect(result.failureReason).toBe(REASONS.cnhExpired('12/11/2026'));
    expect(byKey(result.checks, 'cnh_validity').status).toBe('fail');
  });

  it('1. CNH que vence hoje ainda vale e é sinalizada', () => {
    const result = evaluateCnhPolicy(cnh({ validade: '13/11/2026' }), loaded(), NOW);
    expect(result.failureReason).toBeNull();
    expect(byKey(result.checks, 'cnh_validity')).toMatchObject({ status: 'warn' });
  });

  it('1. usa a data de São Paulo, não a de UTC', () => {
    // 01:00 UTC de 14/11 ainda é 13/11 em São Paulo.
    const result = evaluateCnhPolicy(cnh({ validade: '13/11/2026' }), loaded(), new Date('2026-11-14T01:00:00Z'));
    expect(result.failureReason).toBeNull();
  });

  it('1. validade ilegível não reprova', () => {
    const result = evaluateCnhPolicy(cnh({ validade: null }), loaded(), NOW);
    expect(result.failureReason).toBeNull();
    expect(byKey(result.checks, 'cnh_validity').status).toBe('unknown');
  });

  it('2. reprova CPF diferente do da conta sem expor o CPF inteiro', () => {
    const result = evaluateCnhPolicy(cnh(), loaded({ accountCpf: '98765432100' }), NOW);
    expect(result.failureReason).toBe(REASONS.cnhCpfMismatch);
    const item = byKey(result.checks, 'cnh_cpf_account');
    expect(item.status).toBe('fail');
    expect(item.detail).not.toContain('98765432100');
  });

  it('2. conta sem CPF ou cadastro não lido não reprova', () => {
    expect(evaluateCnhPolicy(cnh(), loaded({ accountCpf: '' }), NOW).failureReason).toBeNull();
    const unread = evaluateCnhPolicy(cnh(), { contextLoaded: false }, NOW);
    expect(unread.failureReason).toBeNull();
    expect(byKey(unread.checks, 'cnh_cpf_account').status).toBe('unknown');
  });

  it('3. reprova categoria que não permite carro nem moto', () => {
    const result = evaluateCnhPolicy(cnh({ categoria: 'ACC' }), loaded(), NOW);
    expect(result.failureReason).toBe(REASONS.cnhCategoryInvalid('ACC'));
  });

  it('3. reprova CNH só A quando o CRLV lido é de carro', () => {
    const result = evaluateCnhPolicy(cnh({ categoria: 'A' }), loaded({ vehicleKind: 'car' }), NOW);
    expect(result.failureReason).toBe(REASONS.categoryMismatchCar('A'));
  });

  it('3. aceita categoria AB para moto e carro', () => {
    expect(evaluateCnhPolicy(cnh({ categoria: 'AB' }), loaded({ vehicleKind: 'moto' }), NOW).failureReason).toBeNull();
    expect(evaluateCnhPolicy(cnh({ categoria: 'AB' }), loaded({ vehicleKind: 'car' }), NOW).failureReason).toBeNull();
  });

  it('a primeira falha define o motivo', () => {
    const result = evaluateCnhPolicy(
      cnh({ validade: '01/01/2020', categoria: 'ACC' }),
      loaded({ accountCpf: '98765432100' }),
      NOW
    );
    expect(result.failureReason).toBe(REASONS.cnhExpired('01/01/2020'));
    expect(result.checks.filter((item) => item.status === 'fail')).toHaveLength(3);
  });
});

describe('evaluateCrlvPolicy', () => {
  const crlv = (overrides = {}) => ({ plate: 'ABC1D23', anoModelo: '2020', vehicleType: 'automovel', ...overrides });

  it('4. sem veículo cadastrado à mão, o CRLV define o veículo', () => {
    const result = evaluateCrlvPolicy(crlv(), loaded({ declaredVehicles: [], cnhCategory: 'B' }));
    expect(result.failureReason).toBeNull();
    expect(byKey(result.checks, 'crlv_plate_profile').status).toBe('ok');
  });

  it('4. reprova placa que não está no perfil', () => {
    const result = evaluateCrlvPolicy(crlv(), loaded({ declaredVehicles: [{ plate: 'XYZ9A87', year: 2020 }] }));
    expect(result.failureReason).toBe(REASONS.crlvPlateMismatch('ABC1D23'));
  });

  it('4. placa cadastrada passa e o ano divergente só gera atenção', () => {
    const result = evaluateCrlvPolicy(crlv(), loaded({ declaredVehicles: [{ plate: 'abc-1d23', year: 2019 }] }));
    expect(result.failureReason).toBeNull();
    expect(byKey(result.checks, 'crlv_year_profile').status).toBe('warn');
  });

  it('3. reprova moto quando a CNH não tem categoria A', () => {
    const result = evaluateCrlvPolicy(crlv({ vehicleType: 'motocicleta' }), loaded({ cnhCategory: 'B' }));
    expect(result.failureReason).toBe(REASONS.categoryMismatchMoto('B'));
  });

  it('3. tipo ou categoria desconhecidos não reprovam', () => {
    const result = evaluateCrlvPolicy(crlv({ vehicleType: null }), loaded({ cnhCategory: null }));
    expect(result.failureReason).toBeNull();
    expect(byKey(result.checks, 'crlv_cnh_category').status).toBe('unknown');
  });
});

describe('helpers', () => {
  it('lê categorias da CNH', () => {
    expect(parseCnhCategory('AB')).toMatchObject({ moto: true, car: true });
    expect(parseCnhCategory('D')).toMatchObject({ moto: false, car: true });
    expect(parseCnhCategory('ACC')).toMatchObject({ moto: false, car: false });
    expect(parseCnhCategory('')).toBeNull();
  });

  it('reconhece o tipo do veículo', () => {
    expect(resolveVehicleKind({ vehicleType: 'MOTOCICLETA' })).toBe('moto');
    expect(resolveVehicleKind({ vehicleType: 'carro' })).toBe('car');
    expect(resolveVehicleKind({ especie: 'PASSAGEIRO', tipo: 'AUTOMOVEL' })).toBe('car');
    expect(resolveVehicleKind({})).toBeNull();
  });
});
