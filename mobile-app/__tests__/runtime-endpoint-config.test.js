describe("runtimeEndpointConfig", () => {
  const originalEnv = { ...process.env };

  const loadConfig = (extra = {}, constants = {}) => {
    jest.resetModules();
    jest.doMock("expo-constants", () => ({
      __esModule: true,
      default: {
        expoConfig: {
          extra,
        },
        ...constants,
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

  it("usa expoConfig como fallback standalone quando manifesto de runtime nao existe", () => {
    const config = loadConfig({
      apiUrl: "http://127.0.0.1:3001/api",
      wsUrl: "http://127.0.0.1:3001/",
    });

    expect(config.getRuntimeApiBaseUrl()).toBe("http://127.0.0.1:3001");
    expect(config.getRuntimeSocketBaseUrl()).toBe("http://127.0.0.1:3001");
  });

  it("prioriza o ambiente do bundle atual sobre expoConfig obsoleto do dev-client", () => {
    process.env.EXPO_PUBLIC_API_URL = "https://api.leaf.app.br";
    process.env.EXPO_PUBLIC_WS_URL = "https://socket.leaf.app.br";
    const config = loadConfig({
      apiUrl: "http://kyc-lab.invalid:3101",
      wsUrl: "http://kyc-lab.invalid:3101",
    });

    expect(config.getRuntimeApiBaseUrl()).toBe("https://api.leaf.app.br");
    expect(config.getRuntimeSocketBaseUrl()).toBe("https://socket.leaf.app.br");
  });

  it("nao mistura socket embutido obsoleto quando o bundle atual informa somente a API", () => {
    process.env.EXPO_PUBLIC_API_URL = "https://api.leaf.app.br";
    const config = loadConfig({
      apiUrl: "http://kyc-lab.invalid:3101",
      wsUrl: "http://kyc-lab.invalid:3101",
    });

    expect(config.getRuntimeApiBaseUrl()).toBe("https://api.leaf.app.br");
    expect(config.getRuntimeSocketBaseUrl()).toBe("https://socket.leaf.app.br");
  });

  it("prioriza o ambiente do bundle atual sobre o manifesto classico", () => {
    process.env.EXPO_PUBLIC_API_URL = "https://api.bundle.invalid";
    const config = loadConfig(
      {
        apiUrl: "https://api.embedded.invalid",
      },
      {
        manifest: {
          extra: {
            apiUrl: "https://api.classic.invalid",
          },
        },
      },
    );

    expect(config.getRuntimeApiBaseUrl()).toBe("https://api.bundle.invalid");
    expect(config.getRuntimeSocketBaseUrl()).toBe("https://socket.bundle.invalid");
  });

  it("prioriza o manifesto atual do Metro/OTA sobre expoConfig embutido obsoleto", () => {
    process.env.EXPO_PUBLIC_API_URL = "https://api.bundle.invalid";
    process.env.EXPO_PUBLIC_WS_URL = "https://socket.bundle.invalid";
    const config = loadConfig(
      {
        apiUrl: "http://kyc-lab.invalid:3101",
        wsUrl: "http://kyc-lab.invalid:3101",
      },
      {
        manifest2: {
          extra: {
            expoClient: {
              extra: {
                apiUrl: "https://api.leaf.app.br",
                wsUrl: "https://socket.leaf.app.br",
              },
            },
          },
        },
      },
    );

    expect(config.getRuntimeApiBaseUrl()).toBe("https://api.leaf.app.br");
    expect(config.getRuntimeSocketBaseUrl()).toBe("https://socket.leaf.app.br");
  });

  it("ignora uma fonte com somente WS e usa a proxima fonte que define API", () => {
    process.env.EXPO_PUBLIC_WS_URL = "https://socket.bundle.invalid";
    const config = loadConfig(
      {
        apiUrl: "https://api.embedded.invalid",
        wsUrl: "https://socket.embedded.invalid",
      },
      {
        manifest2: {
          extra: {
            expoClient: {
              extra: {
                wsUrl: "https://socket.ota.invalid",
              },
            },
          },
        },
        manifest: {
          extra: {
            apiUrl: "https://api.classic.invalid",
          },
        },
      },
    );

    expect(config.getRuntimeApiBaseUrl()).toBe("https://api.classic.invalid");
    expect(config.getRuntimeSocketBaseUrl()).toBe("https://socket.classic.invalid");
  });

  it("nao mistura socket obsoleto do expoConfig com API do manifesto atual", () => {
    const config = loadConfig(
      {
        apiUrl: "http://kyc-lab.invalid:3101",
        wsUrl: "http://kyc-lab.invalid:3101",
      },
      {
        manifest2: {
          extra: {
            expoClient: {
              extra: {
                apiUrl: "https://api.leaf.app.br",
              },
            },
          },
        },
      },
    );

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
