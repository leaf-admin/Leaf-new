describe("DriverDocumentExtractionService runtime endpoint", () => {
  const originalEnv = { ...process.env };
  const originalFetch = global.fetch;
  const OriginalFormData = global.FormData;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
    delete process.env.EXPO_PUBLIC_API_URL;
    delete process.env.EXPO_PUBLIC_BACKEND_URL;
    delete process.env.EXPO_PUBLIC_WS_URL;
    delete process.env.EXPO_PUBLIC_SOCKET_URL;
    delete process.env.MOBILE_TEST_WS_URL;
  });

  afterEach(() => {
    jest.dontMock("expo-constants");
    jest.dontMock("@react-native-firebase/auth");
    jest.dontMock("../src/utils/Logger");
    process.env = { ...originalEnv };
    global.fetch = originalFetch;
    global.FormData = OriginalFormData;
  });

  it("envia a CNH para a API do bundle atual, nao para o lab embutido", async () => {
    process.env.EXPO_PUBLIC_API_URL = "https://api.leaf.app.br";
    process.env.EXPO_PUBLIC_WS_URL = "https://socket.leaf.app.br";

    jest.doMock("expo-constants", () => ({
      __esModule: true,
      default: {
        expoConfig: {
          extra: {
            apiUrl: "http://kyc-lab.invalid:3101",
            wsUrl: "http://kyc-lab.invalid:3101",
          },
        },
      },
    }));
    jest.doMock("@react-native-firebase/auth", () => ({
      __esModule: true,
      default: () => ({
        currentUser: {
          getIdToken: jest.fn().mockResolvedValue("test-token"),
        },
      }),
    }));
    jest.doMock("../src/utils/Logger", () => ({
      __esModule: true,
      default: {
        log: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
      },
    }));

    class TestFormData {
      append = jest.fn();
    }

    global.FormData = TestFormData;
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: jest.fn().mockResolvedValue({
        success: true,
        data: { cpf: "masked" },
      }),
    });

    const apiConfig = require("../src/config/ApiConfig");
    const extractionService = require("../src/services/DriverDocumentExtractionService").default;

    expect(apiConfig.API_URLS.selfHostedApi).toBe("https://api.leaf.app.br");
    expect(apiConfig.API_URLS.selfHostedWebSocket).toBe("https://socket.leaf.app.br");
    expect(extractionService.apiBaseUrl).toBe("https://api.leaf.app.br");

    await extractionService.extractCNHFromPDF({
      pdfAsset: {
        uri: "file:///tmp/cnh.pdf",
        name: "cnh.pdf",
        mimeType: "application/pdf",
      },
      userId: "driver-test",
    });

    expect(global.fetch).toHaveBeenCalledWith(
      "https://api.leaf.app.br/api/ocr/cnh/pdf",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer test-token",
        }),
      }),
    );
  });
});
