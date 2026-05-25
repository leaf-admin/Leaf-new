import { io } from "socket.io-client";
import config from "@/src/config";
import { authService } from "@/src/services/auth-service";

class DashboardWsService {
  constructor() {
    this.socket = null;
    this.listeners = new Map();
    this.isAuthenticated = false;
    this.namespace = "";
    this.pendingConnectPromise = null;
  }

  resolveSocketUrl(namespace = "") {
    const normalizedNamespace = namespace && namespace !== "/" ? namespace : "";
    return `${config.ws.baseUrl}${normalizedNamespace}`;
  }

  attachStoredListeners() {
    this.listeners.forEach((callbacks, event) => {
      callbacks.forEach((cb) => this.socket?.on(event, cb));
    });
  }

  connect(options = {}) {
    const namespace = options.namespace && options.namespace !== "/" ? options.namespace : "";

    if (this.socket?.connected && this.namespace === namespace && this.isAuthenticated) {
      return Promise.resolve(this.socket);
    }

    if (this.socket && this.namespace !== namespace) {
      this.disconnect();
    }

    if (this.pendingConnectPromise && this.namespace === namespace) {
      return this.pendingConnectPromise;
    }

    const token = authService.getAccessToken();
    if (!token) return Promise.reject(new Error("Sem token para websocket"));

    this.namespace = namespace;
    this.pendingConnectPromise = new Promise((resolve, reject) => {
      this.socket = io(this.resolveSocketUrl(namespace), {
        auth: { jwtToken: token },
        transports: config.ws.transports || ["websocket"],
        reconnection: true,
        reconnectionAttempts: 5,
      });

      this.attachStoredListeners();

      let settled = false;
      const settleResolve = (socket) => {
        if (settled) return;
        settled = true;
        resolve(socket);
      };
      const settleReject = (error) => {
        if (settled) return;
        settled = true;
        reject(error);
      };

      this.socket.on("connect", () => {
        this.isAuthenticated = false;
        this.socket.emit("authenticate", { jwtToken: token });
      });

      this.socket.on("authenticated", () => {
        this.isAuthenticated = true;
        settleResolve(this.socket);
      });

      this.socket.on("authentication_error", (error) => {
        this.isAuthenticated = false;
        settleReject(new Error(error?.message || "Falha de autenticação websocket"));
      });

      this.socket.on("auth_error", (error) => {
        this.isAuthenticated = false;
        settleReject(new Error(error?.message || "Falha de autenticação websocket"));
      });

      this.socket.on("connect_error", (error) => {
        this.isAuthenticated = false;
        settleReject(error);
      });

      this.socket.on("disconnect", () => {
        this.isAuthenticated = false;
      });
    }).finally(() => {
      this.pendingConnectPromise = null;
    });

    return this.pendingConnectPromise;
  }

  disconnect() {
    if (this.socket) this.socket.disconnect();
    this.socket = null;
    this.isAuthenticated = false;
    this.namespace = "";
    this.pendingConnectPromise = null;
  }

  on(event, cb) {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event).add(cb);
    if (this.socket?.connected) this.socket.on(event, cb);
  }

  off(event, cb) {
    this.listeners.get(event)?.delete(cb);
    if (this.socket) this.socket.off(event, cb);
  }

  emit(event, payload) {
    if (!this.socket?.connected) return;
    this.socket.emit(event, payload);
  }

  isConnected() {
    return this.socket?.connected === true && this.isAuthenticated;
  }
}

export const wsService = new DashboardWsService();
export default wsService;
