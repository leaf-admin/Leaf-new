const fs = require('fs');
const path = require('path');

// Gateways e workers dividem a pasta logs/ do host; cada processo precisa da sua subpasta.
describe('logger per-process log directory', () => {
  const logRoot = path.resolve(__dirname, '../../../logs');
  const spies = [];
  const spy = (name, impl) => {
    const created = jest.spyOn(fs, name).mockImplementation(impl);
    spies.push(created);
    return created;
  };

  afterEach(() => {
    spies.splice(0).forEach((created) => created.mockRestore());
    delete process.env.LEAF_LOG_SCOPE;
    delete process.env.LOG_DIRECTORY_RETENTION_DAYS;
    jest.resetModules();
  });

  const loadLogger = () => {
    jest.resetModules();
    return jest.requireActual('../../../utils/logger');
  };

  it('writes file logs into its own marked subfolder', () => {
    process.env.LEAF_LOG_SCOPE = 'queue worker/1';
    spy('accessSync', () => undefined);
    const mkdir = spy('mkdirSync', () => undefined);
    const writeFile = spy('writeFileSync', () => undefined);
    spy('readdirSync', () => []);

    const { logger } = loadLogger();
    const scoped = path.join(logRoot, 'queue-worker-1');

    expect(mkdir).toHaveBeenCalledWith(scoped, { recursive: true });
    expect(writeFile).toHaveBeenCalledWith(path.join(scoped, '.leaf-log-scope'), expect.any(String));
    const fileTransports = logger.transports.filter((transport) => transport.constructor.name === 'File');
    expect(fileTransports.length).toBeGreaterThan(0);
    fileTransports.forEach((transport) => expect(transport.dirname).toBe(scoped));
    logger.close();
  });

  it('prunes only stale folders created by the logger', () => {
    process.env.LEAF_LOG_SCOPE = 'current';
    const now = Date.now();
    const old = now - 10 * 24 * 60 * 60 * 1000;
    spy('accessSync', () => undefined);
    spy('mkdirSync', () => undefined);
    spy('writeFileSync', () => undefined);
    spy('readdirSync', (dir, options) => {
      if (dir === logRoot && options?.withFileTypes) {
        return ['current', 'old-gateway', 'fresh-worker', 'runtime-full-ride-flow']
          .map((name) => ({ name, isDirectory: () => true }));
      }
      return ['.leaf-log-scope', 'combined.log'];
    });
    spy('existsSync', (target) => !String(target).includes('runtime-full-ride-flow'));
    spy('statSync', (target) => ({ mtimeMs: String(target).includes('old-gateway') ? old : now }));
    const remove = spy('rmSync', () => undefined);

    const { logger } = loadLogger();

    expect(remove).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledWith(path.join(logRoot, 'old-gateway'), { recursive: true, force: true });
    logger.close();
  });
});
