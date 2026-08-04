jest.mock('../../../utils/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  }
}));

describe('report-service XLSX security gate', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
  });

  it('blocks XLSX generation even when a stale flag enables it', async () => {
    process.env.NODE_ENV = 'production';
    process.env.ENABLE_XLSX_REPORT_EXPORT = 'true';
    const ReportService = require('../../../services/report-service');
    const service = new ReportService();

    expect(service.isExcelExportEnabled()).toBe(false);
    await expect(service.generateExcelReport({ title: 'Security test', data: [] }))
      .rejects.toMatchObject({ code: 'XLSX_EXPORT_DISABLED_SECURITY' });
  });

  it('keeps XLSX disabled outside production until a safe replacement is approved', () => {
    process.env.NODE_ENV = 'test';
    process.env.ENABLE_XLSX_REPORT_EXPORT = 'true';
    const ReportService = require('../../../services/report-service');

    expect(new ReportService().isExcelExportEnabled()).toBe(false);
  });
});
