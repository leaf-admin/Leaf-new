// Mock do módulo uuid para testes
const v4 = jest.fn(() => 'test-uuid-123456789');

module.exports = {
  v4,
  v4: v4
};

