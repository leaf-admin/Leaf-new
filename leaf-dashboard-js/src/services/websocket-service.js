import { io } from "socket.io-client";
import config from "@/src/config";
import { authService } from "@/src/services/auth-service";

class DashboardWsService {
  constructor() {
    this.socket = null;
    this.listeners = new Map();
    this.isAuthenticated = false;
  }

  connect() {
    if (this.socket?.connected) return Promise.resolve();

    const token = authService.getAccessToken();
    if (!token) return Promise.reject(new Error("Sem token para websocket"));

    return new Promise((resolve, reject) => {
      this.socket = io(config.ws.baseUrl, {
        auth: { jwtToken: token },
        transports: ["websocket", "polling"],
        reconnection: true,
        reconnectionAttempts: 5,
      });

      this.socket.on("connect", () => {
        this.socket.emit("authenticate", { jwtToken: token });
        resolve();
      });

      this.socket.on("authenticated", () => {
        this.isAuthenticated = true;
      });

      this.socket.on("authentication_error", (error) => {
        this.isAuthenticated = false;
        reject(new Error(error?.message || "Falha de autenticação websocket"));
      });

      this.socket.on("connect_error", (error) => {
        reject(error);
      });

      this.listeners.forEach((callbacks, event) => {
        callbacks.forEach((cb) => this.socket.on(event, cb));
      });
    });
  }

  disconnect() {
    if (this.socket) this.socket.disconnect();
    this.socket = null;
    this.isAuthenticated = false;
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
