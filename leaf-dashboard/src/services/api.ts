import axios from 'axios'

// Configuração base da API
const API_BASE_URL = import.meta.env.VITE_API_URL || 'https://api.leaf.app.br'
const WEBSOCKET_URL = import.meta.env.VITE_WEBSOCKET_URL || 'wss://socket.leaf.app.br'

// Instância do axios com configurações
const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 10000,
  headers: {
    'Content-Type': 'application/json',
  },
})

// Interfaces para os dados
export interface VPSMetrics {
  id: string
  name: string
  provider: string
  location: string
  ip: string
  status: 'online' | 'offline' | 'warning'
  uptime: string
  cpu: number
  memory: number
  disk: number
  network: number
  processes: number
  loadAverage: number[]
  timestamp: string
}

export interface RedisMetrics {
  memory: {
    used: number
    peak: number
    total: number
  }
  keys: {
    total: number
    expired: number
    evicted: number
  }
  opsPerSec: number
  latency: number
  connections: number
  hitRate: number
  timestamp: string
}

export interface WebSocketMetrics {
  connections: number
  messagesPerSec: number
  latency: number
  events: {
    connect: number
    disconnect: number
    message: number
    error: number
  }
  errors: number
  timestamp: string
}

export interface FirebaseMetrics {
  functions: {
    executions: number
    errors: number
    duration: number
  }
  database: {
    reads: number
    writes: number
    size: number
  }
  storage: {
    files: number
    size: number
    downloads: number
  }
  auth: {
    users: number
    sessions: number
  }
  errors: number
  timestamp: string
}

// Serviços de API
export const apiService = {
  // VPS Metrics
  async getVPSMetrics(vpsId: string): Promise<VPSMetrics> {
    try {
      const response = await api.get(`/vps/${vpsId}/metrics`)
      return response.data
    } catch (error) {
      console.error(`Erro ao buscar métricas do VPS ${vpsId}:`, error)
      throw error
    }
  },

  async getVPSPerformance(vpsId: string, period: string = '24h'): Promise<any[]> {
    try {
      const response = await api.get(`/vps/${vpsId}/performance?period=${period}`)
      return response.data
    } catch (error) {
      console.error(`Erro ao buscar performance do VPS ${vpsId}:`, error)
      throw error
    }
  },

  // Redis Metrics
  async getRedisMetrics(): Promise<RedisMetrics> {
    try {
      const response = await api.get('/redis/metrics')
      return response.data
    } catch (error) {
      console.error('Erro ao buscar métricas do Redis:', error)
      throw error
    }
  },

  async getRedisPerformance(period: string = '24h'): Promise<any[]> {
    try {
      const response = await api.get(`/redis/performance?period=${period}`)
      return response.data
    } catch (error) {
      console.error('Erro ao buscar performance do Redis:', error)
      throw error
    }
  },

  // WebSocket Metrics
  async getWebSocketMetrics(): Promise<WebSocketMetrics> {
    try {
      const response = await api.get('/websocket/metrics')
      return response.data
    } catch (error) {
      console.error('Erro ao buscar métricas do WebSocket:', error)
      throw error
    }
  },

  async getWebSocketPerformance(period: string = '24h'): Promise<any[]> {
    try {
      const response = await api.get(`/websocket/performance?period=${period}`)
      return response.data
    } catch (error) {
      console.error('Erro ao buscar performance do WebSocket:', error)
      throw error
    }
  },

  // Firebase Metrics
  async getFirebaseMetrics(): Promise<FirebaseMetrics> {
    try {
      const response = await api.get('/firebase/metrics')
      return response.data
    } catch (error) {
      console.error('Erro ao buscar métricas do Firebase:', error)
      throw error
    }
  },

  async getFirebasePerformance(period: string = '24h'): Promise<any[]> {
    try {
      const response = await api.get(`/firebase/performance?period=${period}`)
      return response.data
    } catch (error) {
      console.error('Erro ao buscar performance do Firebase:', error)
      throw error
    }
  },

  // System Health
  async getSystemHealth(): Promise<any> {
    try {
      const response = await api.get('/health')
      return response.data
    } catch (error) {
      console.error('Erro ao buscar health do sistema:', error)
      throw error
    }
  },

  // Dashboard Overview
  async getDashboardOverview(): Promise<any> {
    try {
      const response = await api.get('/dashboard/overview')
      return response.data
    } catch (error) {
      console.error('Erro ao buscar overview do dashboard:', error)
      throw error
    }
  }
}

export default apiService 