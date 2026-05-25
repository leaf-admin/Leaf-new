const { io } = require("socket.io-client");
const logger = require("../utils/logger");

class SocketListener {
  constructor({ url }) {
    this.url = url;
    this.socket = null;
  }

  start({ onSupportChat }) {
    if (!this.url) return;
    this.socket = io(this.url, {
      transports: ["websocket"],
      reconnection: true,
      reconnectionAttempts: Infinity,
      timeout: 8000,
    });

    this.socket.on("connect", () => {
      logger.info("Socket listener connected", { socketId: this.socket.id });
    });
    this.socket.on("connect_error", (error) => {
      logger.warn("Socket listener connection error", { error: error.message });
    });
    this.socket.on("support:chat:new", (payload) => {
      onSupportChat(payload);
    });
    this.socket.on("support:chat:message", (payload) => {
      onSupportChat(payload);
    });
  }

  stop() {
    if (!this.socket) return;
    this.socket.disconnect();
    this.socket = null;
  }
}

module.exports = SocketListener;
