describe("runtimeEndpointConfig", () => {
  const originalEnv = { ...process.env };

  const loadConfig = (extra = {}) => {
    jest.resetModules();
    jest.doMock("expo-constants", () => ({
      __esModule: true,
      default: {
        expoConfig: {
          extra,
        },
      },
    }));
    return require("../src/config/runtimeEndpointConfig");
  };

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.EXPO_PUBLIC_API_URL;
    delete process.env.EXPO_PUBLIC_BACKEND_URL;
    delete process.env.EXPO_PUBLIC_WS_URL;
    delete process.env.EXPO_PUBLIC_SOCKET_URL;
    delete process.env.MOBILE_TEST_WS_URL;
  });

  afterEach(() => {
    jest.dontMock("expo-constants");
    process.env = { ...originalEnv };
  });

  it("usa apiUrl/wsUrl embutidos no Expo extra quando env nao esta disponivel", () => {
    const config = loadConfig({
      apiUrl: "http://127.0.0.1:3001/api",
      wsUrl: "http://127.0.0.1:3001/",
    });

    expect(config.getRuntimeApiBaseUrl()).toBe("http://127.0.0.1:3001");
    expect(config.getRuntimeSocketBaseUrl()).toBe("http://127.0.0.1:3001");
  });

  it("prioriza Expo extra sobre env para evitar dotenv obsoleto no Metro", () => {
    process.env.EXPO_PUBLIC_API_URL = "http://127.0.0.1:3001";
    process.env.EXPO_PUBLIC_WS_URL = "http://127.0.0.1:3001";
    const config = loadConfig({
      apiUrl: "https://api.leaf.app.br",
      wsUrl: "https://socket.leaf.app.br",
    });

    expect(config.getRuntimeApiBaseUrl()).toBe("https://api.leaf.app.br");
    expect(config.getRuntimeSocketBaseUrl()).toBe("https://socket.leaf.app.br");
  });

  it("deriva socket a partir da API quando wsUrl nao foi informado", () => {
    const config = loadConfig({
      apiUrl: "https://api.leaf.app.br",
    });

    expect(config.getRuntimeSocketBaseUrl()).toBe("https://socket.leaf.app.br");
  });
});
