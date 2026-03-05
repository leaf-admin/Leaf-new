// Serviço WebSocket para Dashboard Admin
// Conecta ao namespace /dashboard e gerencia eventos em tempo real

import { io } from 'socket.io-client'
import { authService } from './auth-service'

// Converter http:// para ws:// se necessário
const getWebSocketUrl = () => {
  const url = process.env.NEXT_PUBLIC_WS_URL || process.env.NEXT_PUBLIC_API_URL || 'http://147.182.204.181:3001'
  if (url.startsWith('https://')) return url.replace('https://', 'wss://')
  if (url.startsWith('http://')) return url.replace('http://', 'ws://')
  return url
}

const WS_BASE_URL = getWebSocketUrl()

class WebSocketService {
  constructor() {
    this.socket = null
    this.reconnectAttempts = 0
    this.maxReconnectAttempts = 5
    this.reconnectDelay = 1000 // 1 segundo
    this.listeners = new Map()
    this.isConnecting = false
    this.isAuthenticated = false
  }

  /**
   * Conectar ao WebSocket
   */
  connect() {
    return new Promise((resolve, reject) => {
      if (this.socket?.connected) {
        resolve()
        return
      }

      if (this.isConnecting) {
        // Aguardar conexão existente
        const checkConnection = setInterval(() => {
          if (this.socket?.connected) {
            clearInterval(checkConnection)
            resolve()
          } else if (!this.isConnecting) {
            clearInterval(checkConnection)
            reject(new Error('Falha ao conectar'))
          }
        }, 100)
        return
      }

      this.isConnecting = true

      // Obter token JWT
      const token = authService.getAccessToken()
      if (!token) {
        this.isConnecting = false
        reject(new Error('Token não disponível'))
        return
      }

      // Criar conexão (sem namespace específico, usar o padrão)
      this.socket = io(WS_BASE_URL, {
        auth: {
          jwtToken: token
        },
        transports: ['websocket', 'polling'],
        reconnection: true,
        reconnectionDelay: this.reconnectDelay,
        reconnectionAttempts: this.maxReconnectAttempts
      })

      // Event: Conectado
      this.socket.on('connect', () => {
        console.log('✅ [WebSocket] Conectado ao dashboard')
        this.reconnectAttempts = 0
        this.isConnecting = false
        this.authenticate(token)
        resolve()
      })

      // Event: Autenticado
      this.socket.on('authenticated', () => {
        console.log('✅ [WebSocket] Autenticado')
        this.isAuthenticated = true
      })

      // Event: Erro de autenticação
      this.socket.on('authentication_error', (error) => {
        console.error('❌ [WebSocket] Erro de autenticação:', error.message)
        this.isAuthenticated = false
        this.disconnect()
        reject(new Error(error.message))
      })

      // Event: Desconectado
      this.socket.on('disconnect', (reason) => {
        console.warn('⚠️ [WebSocket] Desconectado:', reason)
        this.isAuthenticated = false
        
        if (reason === 'io server disconnect') {
          // Servidor desconectou, tentar reconectar
          this.reconnect()
        }
      })

      // Event: Erro de conexão
      this.socket.on('connect_error', (error) => {
        // Ignorar erro de namespace inválido (não crítico)
        if (error.message && error.message.includes('Invalid namespace')) {
          console.warn('⚠️ [WebSocket] Namespace inválido (ignorado):', error.message)
          // Não rejeitar, apenas avisar
          this.isConnecting = false
          return
        }
        
        console.error('❌ [WebSocket] Erro de conexão:', error.message)
        this.isConnecting = false
        this.reconnectAttempts++
        
        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
          reject(error)
        }
      })

      // Registrar listeners existentes
      this.listeners.forEach((callbacks, event) => {
        callbacks.forEach(callback => {
          this.socket?.on(event, callback)
        })
      })
    })
  }

  /**
   * Autenticar com token JWT
   */
  authenticate(token) {
    if (!this.socket || !this.socket.connected) return
    
    this.socket.emit('authenticate', { jwtToken: token })
  }

  /**
   * Desconectar
   */
  disconnect() {
    if (this.socket) {
      this.socket.disconnect()
      this.socket = null
    }
    this.isAuthenticated = false
    this.isConnecting = false
  }

  /**
   * Escutar evento
   */
  on(event, callback) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set())
    }
    this.listeners.get(event).add(callback)

    // Se socket já está conectado, registrar listener
    if (this.socket?.connected) {
      this.socket.on(event, callback)
    }
  }

  /**
   * Remover listener
   */
  off(event, callback) {
    const callbacks = this.listeners.get(event)
    if (callbacks) {
      callbacks.delete(callback)
    }

    if (this.socket) {
      this.socket.off(event, callback)
    }
  }

  /**
   * Emitir evento
   */
  emit(event, data) {
    if (!this.socket || !this.socket.connected) {
      console.warn(`⚠️ [WebSocket] Tentando emitir ${event} mas socket não está conectado`)
      return
    }

    this.socket.emit(event, data)
  }

  /**
   * Verificar se está conectado
   */
  isConnected() {
    return this.socket?.connected === true && this.isAuthenticated
  }

  /**
   * Reconectar
   */
  reconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('❌ [WebSocket] Máximo de tentativas de reconexão atingido')
      return
    }

    setTimeout(() => {
      console.log(`🔄 [WebSocket] Tentando reconectar (${this.reconnectAttempts + 1}/${this.maxReconnectAttempts})...`)
      this.connect().catch(error => {
        console.error('❌ [WebSocket] Erro ao reconectar:', error)
      })
    }, this.reconnectDelay * (this.reconnectAttempts + 1))
  }

  /**
   * Solicitar dados em tempo real
   */
  requestLiveData() {
    this.emit('request_live_data')
  }

  /**
   * Solicitar estatísticas de usuários
   */
  requestUserStats() {
    this.emit('request_user_stats')
  }

  /**
   * Solicitar estatísticas de corridas
   */
  requestRidesStats() {
    this.emit('request_rides_stats')
  }

  /**
   * Solicitar estatísticas financeiras
   */
  requestRevenueStats() {
    this.emit('request_revenue_stats')
  }

  /**
   * Solicitar métricas do dashboard
   */
  requestDashboardMetrics(data) {
    this.emit('request_dashboard_metrics', data)
  }
}

// Exportar instância singleton
export const wsService = new WebSocketService()
export default wsService
