const {
  validateCnhDocumentIdentity
} = require('../../../services/cnh-document-identity-validator');

describe('cnh document identity validator', () => {
  test('accepts CNH-like structured data with document markers', () => {
    const result = validateCnhDocumentIdentity({
      text: [
        'Carteira Nacional de Habilitacao',
        'Numero do Registro',
        'Categoria',
        'Validade',
        'EAR'
      ].join('\n'),
      data: {
        documentType: 'cnh',
        documentTypeConfidence: 0.94,
        nome: 'Motorista Teste',
        cpf: '123.456.789-09',
        numeroRegistro: '08128534616',
        categoria: 'B',
        validade: '10/10/2030',
        ear: true
      }
    });

    expect(result.valid).toBe(true);
    expect(result.signals.hasCnhNumber).toBe(true);
    expect(result.signals.hasCategory).toBe(true);
  });

  test('rejects identity document data posted as CNH', () => {
    const result = validateCnhDocumentIdentity({
      text: [
        'Registro Geral',
        'Carteira de Identidade',
        'Secretaria de Seguranca Publica',
        'Nome',
        'CPF'
      ].join('\n'),
      data: {
        documentType: 'rg',
        documentTypeConfidence: 0.91,
        nome: 'Pessoa Teste',
        cpf: '123.456.789-09',
        rg: '123456789'
      }
    });

    expect(result.valid).toBe(false);
    expect(result.reason).toContain('outro documento de identidade');
    expect(result.signals.probablyOtherIdentityDocument).toBe(true);
  });

  test('rejects generic identity data without CNH-only fields', () => {
    const result = validateCnhDocumentIdentity({
      text: 'Nome CPF data nascimento filiacao',
      data: {
        nome: 'Pessoa Teste',
        cpf: '123.456.789-09',
        dataNascimento: '10/10/1990'
      }
    });

    expect(result.valid).toBe(false);
    expect(result.reason).toContain('sinais minimos');
  });
});
