const mockCreateSubaccount = jest.fn();
const mockCreateDriverBaaSAccount = jest.fn();
const mockCreateDriverClient = jest.fn();

jest.mock('../../../services/woovi-driver-service', () =>
  jest.fn().mockImplementation(() => ({
    createSubaccount: mockCreateSubaccount,
    createDriverBaaSAccount: mockCreateDriverBaaSAccount,
    createDriverClient: mockCreateDriverClient
  }))
);

jest.mock('../../../utils/logger', () => ({
  logStructured: jest.fn(),
  logError: jest.fn()
}));

const docs = new Map();

function createFirestoreMock() {
  return {
    collection: (collectionName) => ({
      doc: (id) => ({
        set: async (payload, options = {}) => {
          const key = `${collectionName}/${id}`;
          const previous = docs.get(key) || {};
          docs.set(key, options.merge ? { ...previous, ...payload } : { ...payload });
        },
        get: async () => {
          const key = `${collectionName}/${id}`;
          return {
            exists: docs.has(key),
            data: () => docs.get(key)
          };
        }
      })
    })
  };
}

jest.mock('../../../firebase-config', () => ({
  getFirestore: jest.fn(() => createFirestoreMock())
}));

const DriverApprovalService = require('../../../services/driver-approval-service');
const firebaseConfig = require('../../../firebase-config');

describe('DriverApprovalService Woovi subaccount integration', () => {
  beforeEach(() => {
    docs.clear();
    jest.clearAllMocks();
    firebaseConfig.getFirestore.mockReturnValue(createFirestoreMock());
    mockCreateSubaccount.mockResolvedValue({
      success: true,
      pixKey: 'driver-pix-key',
      subaccount: {
        id: 'subaccount_1',
        pixKey: 'driver-pix-key'
      }
    });
    mockCreateDriverBaaSAccount.mockResolvedValue({
      success: false,
      useFallback: true
    });
    mockCreateDriverClient.mockResolvedValue({
      success: true,
      wooviClientId: 'customer_1'
    });
  });

  it('approves driver with Woovi subaccount when pix key is available', async () => {
    const service = new DriverApprovalService();

    const result = await service.approveDriver({
      id: 'driver_1',
      name: 'Motorista Leaf',
      email: 'driver@leaf.app.br',
      phone: '+5521999990000',
      cpf: '12345678909',
      pixKey: 'driver-pix-key'
    });

    expect(result).toMatchObject({
      success: true,
      wooviAccountId: 'subaccount_1',
      wooviSubaccountPixKey: 'driver-pix-key'
    });
    expect(mockCreateSubaccount).toHaveBeenCalledWith({
      name: 'Motorista Leaf',
      email: 'driver@leaf.app.br',
      phone: '+5521999990000',
      taxID: '12345678909',
      pixKey: 'driver-pix-key'
    });
    expect(mockCreateDriverBaaSAccount).not.toHaveBeenCalled();
    expect(docs.get('users/driver_1')).toMatchObject({
      wooviSubaccountId: 'subaccount_1',
      wooviSubaccountPixKey: 'driver-pix-key',
      baasAccountCreated: false,
      fallbackToCustomer: false,
      isApproved: true
    });
  });

  it('falls back to customer flow without creating legacy BaaS when driver pix key is missing', async () => {
    const service = new DriverApprovalService();

    const result = await service.approveDriver({
      id: 'driver_2',
      name: 'Motorista Leaf',
      email: 'driver2@leaf.app.br',
      phone: '+5521999990001',
      cpf: '12345678909'
    });

    expect(result).toMatchObject({
      success: true,
      wooviClientId: 'customer_1'
    });
    expect(mockCreateSubaccount).not.toHaveBeenCalled();
    expect(mockCreateDriverBaaSAccount).not.toHaveBeenCalled();
    expect(mockCreateDriverClient).toHaveBeenCalled();
    expect(docs.get('users/driver_2')).toMatchObject({
      baasAccountCreated: false,
      baasUpgradePending: false,
      fallbackToCustomer: true,
      isApproved: true
    });
  });
});
