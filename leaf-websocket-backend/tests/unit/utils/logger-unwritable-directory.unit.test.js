const fs = require('fs');

// Nos containers a pasta de logs não aceita escrita. Com transportes de arquivo criados
// mesmo assim, o winston parava de entregar para o console depois de encher o buffer.
describe('logger with an unwritable log directory', () => {
  let accessSpy;

  afterEach(() => {
    accessSpy?.mockRestore();
    jest.resetModules();
    delete process.env.LOG_TO_FILES;
  });

  const loadLogger = () => {
    jest.resetModules();
    return jest.requireActual('../../../utils/logger');
  };

  const transportNames = (logger) => logger.transports.map((transport) => transport.constructor.name);

  it('creates no file transport when the directory cannot be written', () => {
    accessSpy = jest.spyOn(fs, 'accessSync').mockImplementation(() => {
      const error = new Error('EACCES');
      error.code = 'EACCES';
      throw error;
    });

    const { logger } = loadLogger();

    expect(transportNames(logger)).toEqual(['Console']);
  });

  it('creates no file transport when LOG_TO_FILES=false', () => {
    process.env.LOG_TO_FILES = 'false';
    accessSpy = jest.spyOn(fs, 'accessSync').mockImplementation(() => undefined);

    const { logger } = loadLogger();

    expect(transportNames(logger)).toEqual(['Console']);
  });

  it('keeps file transports when the directory is writable', () => {
    accessSpy = jest.spyOn(fs, 'accessSync').mockImplementation(() => undefined);

    const { logger } = loadLogger();

    expect(transportNames(logger)).toContain('File');
    logger.close();
  });
});
