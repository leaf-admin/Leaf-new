/// <reference types="vite/client" />

import { io, Socket } from 'socket.io-client'

// Configuração do WebSocket
const WEBSOCKET_URL = import.meta.env.VITE_WEBSOCKET_URL || 'wss://socket.leaf.app.br'

// Tipos para eventos do WebSocket
export interface WebSocketEvent {
  type: string
  data: any
  timestamp: string
}

export interface MetricsUpdate {
  vps?: any
  redis?: any
  websocket?: any
  firebase?: any
  timestamp: string
}

class WebSocketService {
  private socket: Socket | null = null
  private reconnectAttempts = 0
  private maxReconnectAttempts = 5
  private reconnectDelay = 1000

  // Callbacks para diferentes tipos de eventos
  private callbacks: {
    metrics?: (data: MetricsUpdate) => void
    vps?: (data: any) => void
    redis?: (data: any) => void
    websocket?: (data: any) => void
    firebase?: (data: any) => void
    error?: (error: any) => void
    connect?: () => void
    disconnect?: () => void
  } = {}

  connect() {
    try {
      this.socket = io(WEBSOCKET_URL, {
        transports: ['websocket'],
        timeout: 10000,
        reconnection: true,
        reconnectionAttempts: this.maxReconnectAttempts,
        reconnectionDelay: this.reconnectDelay,
      })

      this.setupEventListeners()
    } catch (error) {
      console.error('Erro ao conectar WebSocket:', error)
    }
  }

  private setupEventListeners() {
    if (!this.socket) return

    // Evento de conexão
    this.socket.on('connect', () => {
      console.log('WebSocket conectado')
      this.reconnectAttempts = 0
      if (this.callbacks.connect) {
        this.callbacks.connect()
      }
    })

    // Evento de desconexão
    this.socket.on('disconnect', (reason) => {
      console.log('WebSocket desconectado:', reason)
      if (this.callbacks.disconnect) {
        this.callbacks.disconnect()
      }
    })

    // Evento de erro
    this.socket.on('connect_error', (error) => {
      console.error('Erro de conexão WebSocket:', error)
      if (this.callbacks.error) {
        this.callbacks.error(error)
      }
    })

    // Eventos de métricas
    this.socket.on('metrics_update', (data: MetricsUpdate) => {
      if (this.callbacks.metrics) {
        this.callbacks.metrics(data)
      }
    })

    this.socket.on('vps_update', (data: any) => {
      if (this.callbacks.vps) {
        this.callbacks.vps(data)
      }
    })

    this.socket.on('redis_update', (data: any) => {
      if (this.callbacks.redis) {
        this.callbacks.redis(data)
      }
    })

    this.socket.on('websocket_update', (data: any) => {
      if (this.callbacks.websocket) {
        this.callbacks.websocket(data)
      }
    })

    this.socket.on('firebase_update', (data: any) => {
      if (this.callbacks.firebase) {
        this.callbacks.firebase(data)
      }
    })
  }

  // Métodos para registrar callbacks
  onMetrics(callback: (data: MetricsUpdate) => void) {
    this.callbacks.metrics = callback
  }

  onVPSUpdate(callback: (data: any) => void) {
    this.callbacks.vps = callback
  }

  onRedisUpdate(callback: (data: any) => void) {
    this.callbacks.redis = callback
  }

  onWebSocketUpdate(callback: (data: any) => void) {
    this.callbacks.websocket = callback
  }

  onFirebaseUpdate(callback: (data: any) => void) {
    this.callbacks.firebase = callback
  }

  onError(callback: (error: any) => void) {
    this.callbacks.error = callback
  }

  onConnect(callback: () => void) {
    this.callbacks.connect = callback
  }

  onDisconnect(callback: () => void) {
    this.callbacks.disconnect = callback
  }

  // Métodos para enviar eventos
  emit(event: string, data: any) {
    if (this.socket && this.socket.connected) {
      this.socket.emit(event, data)
    }
  }

  // Métodos para solicitar dados específicos
  requestVPSMetrics(vpsId: string) {
    this.emit('request_vps_metrics', { vpsId })
  }

  requestRedisMetrics() {
    this.emit('request_redis_metrics', {})
  }

  requestWebSocketMetrics() {
    this.emit('request_websocket_metrics', {})
  }

  requestFirebaseMetrics() {
    this.emit('request_firebase_metrics', {})
  }

  // Métodos de controle
  disconnect() {
    if (this.socket) {
      this.socket.disconnect()
      this.socket = null
    }
  }

  isConnected(): boolean {
    return this.socket ? this.socket.connected : false
  }

  getConnectionState(): string {
    if (!this.socket) return 'disconnected'
    return this.socket.connected ? 'connected' : 'disconnected'
  }
}

// Instância singleton
const webSocketService = new WebSocketService()

export default webSocketService 