// API Configuration
// Sempre usar servidor da VPS Hostinger
// Para sobrescrever, defina NEXT_PUBLIC_API_URL no .env.local
import { auth } from '../lib/firebase'
import { authService } from './auth-service'

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://147.182.204.181:3001/api'

// API Service Class
class LeafAPIService {
  constructor() {
    this.baseURL = API_BASE_URL
  }

  async getAuthToken() {
    if (typeof window === 'undefined') {
      return null
    }

    // Prioridade 1: Token JWT do authService (se disponível)
    const jwtToken = authService.getAccessToken()
    if (jwtToken) {
      return jwtToken
    }

    // Prioridade 2: Token Firebase (fallback)
    try {
      const currentUser = auth.currentUser
      if (!currentUser) return null
      return await currentUser.getIdToken()
    } catch (error) {
      console.warn('⚠️ Não foi possível obter token do Firebase:', error)
      return null
    }
  }

  getAuthHeaders() {
    // Retornar headers vazios por enquanto
    // O token será adicionado dinamicamente quando necessário
    return {}
  }

  async request(endpoint, options = {}) {
    const url = `${this.baseURL}${endpoint}`

    try {
      const token = await this.getAuthToken()
      const headers = {
        'Content-Type': 'application/json',
        ...(options.headers || {})
      }

      if (token) {
        headers['Authorization'] = `Bearer ${token}`
      }

      const response = await fetch(url, {
        ...options,
        headers
      })

      // Se token expirou (401), tentar renovar e retentar
      if (response.status === 401 && token) {
        const newToken = await authService.refreshToken()
        if (newToken) {
          // Retentar requisição com novo token
          headers['Authorization'] = `Bearer ${newToken}`
          const retryResponse = await fetch(url, {
            ...options,
            headers
          })

          if (!retryResponse.ok) {
            const error = new Error(`API Error: ${retryResponse.status} ${retryResponse.statusText}`)
            error.status = retryResponse.status
            throw error
          }

          return await retryResponse.json()
        }
      }

      if (!response.ok) {
        const error = new Error(`API Error: ${response.status} ${response.statusText}`)
        error.status = response.status
        throw error
      }

      return await response.json()
    } catch (error) {
      if (error?.status === 404) {
        console.warn(`API opcional não encontrada (${endpoint}). Exibindo dados padrão.`)
      } else {
        console.error(`API Request failed for ${endpoint}:`, error)
      }
      throw error
    }
  }

  // Dashboard Stats - SEM MOCK, APENAS DADOS REAIS
  async getDashboardStats() {
    const [userStats, rideStats, revenueStats, conversionStats] = await Promise.all([
      this.getUserStats(),
      this.getRideStats(),
      this.getRevenueStats(),
      this.getConversionStats()
    ])

    return {
      users: userStats,
      rides: rideStats,
      revenue: revenueStats,
      conversion: conversionStats
    }
  }

  async getUserStats() {
    return await this.request('/users/stats')
  }

  async getRideStats() {
    return await this.request('/rides/stats')
  }

  async getRevenueStats() {
    return await this.request('/revenue/stats')
  }

  async getConversionStats() {
    return await this.request('/conversion/stats')
  }

  // KYC Stats - SEM MOCK
  async getKYCStats() {
    return await this.request('/kyc-analytics/stats')
  }

  // System Status - SEM MOCK
  async getSystemStatus() {
    return await this.request('/system/status')
  }

  // Recent Activity - SEM MOCK
  async getRecentActivity() {
    return await this.request('/activity/recent')
  }

  // Driver Search Metrics - SEM MOCK (rota opcional, não existe no backend ainda)
  async getDriverSearchMetrics(timeframe = '7d') {
    try {
      return await this.request(`/metrics/driver-search?timeframe=${timeframe}`)
    } catch (error) {
      // Rota não existe ainda, retornar dados vazios sem erro
      console.warn('Rota /metrics/driver-search não disponível ainda')
      return {
        totalSearches: 0,
        successfulSearches: 0,
        successRate: 0,
        averageSearchTime: 0
      }
    }
  }

  // Monitoring Services
  async getMonitoringServices(service, timeframe = '1h') {
    try {
      const params = new URLSearchParams()
      if (service) params.append('service', service)
      params.append('timeframe', timeframe)
      return await this.request(`/monitoring/services?${params.toString()}`)
    } catch (error) {
      console.error('Failed to fetch monitoring services:', error)
      throw error
    }
  }

  // Alerts
  async getAlerts(severity, limit, acknowledged) {
    try {
      const params = new URLSearchParams()
      if (severity) params.append('severity', severity)
      if (limit) params.append('limit', limit.toString())
      if (acknowledged !== undefined) params.append('acknowledged', acknowledged.toString())
      return await this.request(`/alerts?${params.toString()}`)
    } catch (error) {
      console.error('Failed to fetch alerts:', error)
      throw error
    }
  }

  async getAlertsStats() {
    try {
      return await this.request('/alerts/stats')
    } catch (error) {
      console.error('Failed to fetch alerts stats:', error)
      throw error
    }
  }

  async acknowledgeAlert(alertId) {
    try {
      return await this.request(`/alerts/${alertId}/acknowledge`, {
        method: 'POST'
      })
    } catch (error) {
      console.error('Failed to acknowledge alert:', error)
      throw error
    }
  }

  // Queue Metrics - SEM MOCK
  async getQueueStatus() {
    return await this.request('/queue/status')
  }

  async getQueueMetrics(hours = 1) {
    return await this.request(`/queue/metrics?hours=${hours}`)
  }

  // Drivers - SEM MOCK
  async getDrivers(page = 1, limit = 20, status = 'all', search = '') {
    const params = new URLSearchParams()
    params.append('page', page.toString())
    params.append('limit', limit.toString())
    if (status !== 'all') params.append('status', status)
    if (search) params.append('search', search)
    return await this.request(`/drivers/applications?${params.toString()}`)
  }

  async getDriverDocuments(driverId) {
    return await this.request(`/drivers/${driverId}/documents`)
  }

  // ✅ Aprovar/Rejeitar documento de motorista
  async reviewDriverDocument(driverId, documentType, action, rejectionReason = '') {
    return await this.request(`/drivers/${driverId}/documents/${documentType}/review`, {
      method: 'POST',
      body: JSON.stringify({
        action, // 'approve' ou 'reject'
        rejectionReason,
        reviewedBy: 'admin'
      })
    })
  }

  // ✅ Aprovar/Rejeitar aplicação COMPLETA do motorista
  async approveDriverApplication(driverId, notes = '') {
    return await this.request(`/drivers/applications/${driverId}/approve`, {
      method: 'POST',
      body: JSON.stringify({ notes, adminNotes: notes })
    })
  }

  async rejectDriverApplication(driverId, rejectionReasons = [], notes = '') {
    return await this.request(`/drivers/applications/${driverId}/reject`, {
      method: 'POST',
      body: JSON.stringify({
        rejectionReasons,
        notes,
        adminNotes: notes
      })
    })
  }

  // Waitlist - SEM MOCK
  async getWaitlist(page = 1, limit = 20, status = 'pending') {
    const params = new URLSearchParams()
    params.append('page', page.toString())
    params.append('limit', limit.toString())
    params.append('status', status)
    return await this.request(`/waitlist/drivers?${params.toString()}`)
  }

  async getWaitlistStats() {
    return await this.request('/metrics/waitlist/landing')
  }

  // Notifications - SEM MOCK
  async getNotifications() {
    return await this.request('/notifications')
  }

  async getNotificationStats() {
    const data = await this.request('/notifications')
    return data?.data?.stats || {}
  }

  // Reports - SEM MOCK
  async getReports() {
    return await this.request('/reports/predefined')
  }

  // Metrics - SEM MOCK
  async getMetricsOverview() {
    return await this.request('/metrics/overview')
  }

  async getMetricsRidesDaily() {
    return await this.request('/metrics/rides/daily')
  }

  async getMetricsFinancial() {
    return await this.request('/metrics/financial/rides')
  }

  async getMetricsMapsRidesByRegion() {
    return await this.request('/metrics/maps/rides-by-region')
  }

  async getMetricsMapsDemandByRegion() {
    return await this.request('/metrics/maps/demand-by-region')
  }

  async getMetricsHistory(startDate, endDate, granularity = 'hour') {
    const params = new URLSearchParams()
    params.append('startDate', startDate)
    params.append('endDate', endDate)
    params.append('granularity', granularity)
    return await this.request(`/metrics/history?${params.toString()}`)
  }

  // ✅ SIMULADOR FINANCEIRO
  async runFinancialSimulation(drivers = 250, hours = 1) {
    const params = new URLSearchParams()
    params.append('drivers', drivers.toString())
    params.append('hours', hours.toString())
    return await this.request(`/metrics/simulation/run?${params.toString()}`)
  }

  async getMetricsHistoryCompare(period1Start, period1End, period2Start, period2End) {
    const params = new URLSearchParams()
    params.append('period1Start', period1Start)
    params.append('period1End', period1End)
    params.append('period2Start', period2Start)
    params.append('period2End', period2End)
    return await this.request(`/metrics/history/compare?${params.toString()}`)
  }

  // Maps - SEM MOCK
  async getMapLocations(type = 'all', status, bounds) {
    const params = new URLSearchParams()
    params.append('type', type)
    if (status) params.append('status', status)
    if (bounds) params.append('bounds', bounds)
    return await this.request(`/map/locations?${params.toString()}`)
  }

  async getMapHeatmap(startDate, endDate) {
    const params = new URLSearchParams()
    if (startDate) params.append('startDate', startDate)
    if (endDate) params.append('endDate', endDate)
    return await this.request(`/map/heatmap?${params.toString()}`)
  }

  async getMapTripRoute(bookingId) {
    return await this.request(`/map/trip/${bookingId}/route`)
  }

  // Users - SEM MOCK
  async getUsers(params = {}) {
    const queryParams = new URLSearchParams()
    if (params.type) queryParams.append('type', params.type)
    if (params.status) queryParams.append('status', params.status)
    if (params.dateRange) queryParams.append('dateRange', params.dateRange)
    if (params.searchTerm) queryParams.append('searchTerm', params.searchTerm)
    if (params.sortBy) queryParams.append('sortBy', params.sortBy)
    if (params.sortOrder) queryParams.append('sortOrder', params.sortOrder)
    if (params.page) queryParams.append('page', params.page.toString())
    if (params.limit) queryParams.append('limit', params.limit.toString())
    return await this.request(`/users?${queryParams.toString()}`)
  }

  async getUserDetails(userId) {
    return await this.request(`/users/${userId}`)
  }

  async getDriverComplete(driverId) {
    return await this.request(`/drivers/${driverId}/complete`)
  }

  // Support/Chat - SEM MOCK
  async getSupportTickets(params = {}) {
    const queryParams = new URLSearchParams()
    if (params.status) queryParams.append('status', params.status)
    if (params.userId) queryParams.append('userId', params.userId)
    if (params.page) {
      // Converter page para offset (se necessário)
      const limit = parseInt(params.limit || 100)
      const offset = (parseInt(params.page) - 1) * limit
      queryParams.append('offset', offset.toString())
    }
    if (params.limit) queryParams.append('limit', params.limit.toString())
    if (params.priority) queryParams.append('priority', params.priority)
    if (params.category) queryParams.append('category', params.category)

    // Usar rota de admin para ver todos os tickets (dashboard admin)
    // A rota /admin/tickets está em support.js e requer autenticação admin
    try {
      const response = await this.request(`/support/admin/tickets?${queryParams.toString()}`)
      // Garantir que a resposta tenha a estrutura esperada
      if (response && (response.tickets || response.success !== false)) {
        return response
      }
      throw new Error('Resposta inválida da API')
    } catch (err) {
      console.warn('Erro ao buscar tickets admin, tentando rota de usuário:', err.message || err)
      // Fallback para rota de usuário se admin não funcionar
      try {
        const userResponse = await this.request(`/support/tickets?${queryParams.toString()}`)
        return userResponse
      } catch (err2) {
        // Se ambas falharem, retornar estrutura vazia
        console.error('Erro ao buscar tickets:', err2.message || err2)
        return { success: true, tickets: [], total: 0, hasMore: false }
      }
    }
  }

  async getSupportTicket(ticketId) {
    return await this.request(`/support/tickets/${ticketId}`)
  }

  async getSupportMessages(ticketId) {
    const data = await this.request(`/support/tickets/${ticketId}/messages`)
    return data
  }

  async sendSupportMessage(ticketId, message, messageType = 'text', attachments = []) {
    return await this.request(`/support/tickets/${ticketId}/messages`, {
      method: 'POST',
      body: JSON.stringify({ message, messageType, attachments })
    })
  }

  async createSupportTicket(subject, description, category = 'general', priority = 'N3', userInfo = {}, metadata = {}) {
    return await this.request('/support/tickets', {
      method: 'POST',
      body: JSON.stringify({ subject, description, category, priority, userInfo, metadata })
    })
  }

  // ✅ Chat de Suporte (separado de tickets - Redis Pub/Sub + Firestore)
  async getChatHistory(userId, limit = 50) {
    return await this.request(`/support/chat/${userId}/history?limit=${limit}`)
  }

  async sendChatMessage(userId, message) {
    return await this.request(`/support/chat/${userId}/message`, {
      method: 'POST',
      body: JSON.stringify({ message, senderType: 'agent' })
    })
  }

  async markChatAsRead(userId, messageIds = []) {
    return await this.request(`/support/chat/${userId}/mark-read`, {
      method: 'POST',
      body: JSON.stringify({ messageIds })
    })
  }

  // ✅ Encerrar chat e salvar no Firestore
  async closeChat(userId, closedBy = 'agent') {
    return await this.request(`/support/chat/${userId}/close`, {
      method: 'POST',
      body: JSON.stringify({ closedBy })
    })
  }

  // ✅ Obter status do chat
  async getChatStatus(userId) {
    return await this.request(`/support/chat/${userId}/status`)
  }

  // Dashboard Home - Métricas principais
  async getNewUsersStats(period = '24h', type = 'all') {
    const params = new URLSearchParams()
    params.append('period', period)
    if (type !== 'all') params.append('type', type)
    return await this.request(`/users/stats?${params.toString()}`)
  }

  async getNewDrivers(period = '24h') {
    // Usar API de usuários com filtro de tipo driver
    const params = {
      type: 'driver',
      dateRange: this.getDateRange(period)
    }
    return await this.request(`/users?${new URLSearchParams(params).toString()}`)
  }

  async getNewCustomers(period = '24h') {
    // Usar API de usuários com filtro de tipo customer
    const params = {
      type: 'customer',
      dateRange: this.getDateRange(period)
    }
    return await this.request(`/users?${new URLSearchParams(params).toString()}`)
  }

  async getRidesStats(period = 'today') {
    return await this.request(`/metrics/financial/rides?period=${period}`)
  }

  async getOperationalFeeStats(period = 'today') {
    return await this.request(`/metrics/financial/operational-fee?period=${period}`)
  }

  async getSubscriptionRevenue(period = '30d') {
    return await this.request(`/subscriptions/analytics?period=${period}`)
  }

  async getRevenueEvolution(days = 30) {
    // Por enquanto, retornar dados vazios e o gráfico será populado com dados reais do período
    // TODO: Criar API no backend que retorne evolução diária
    const data = []
    const today = new Date()

    for (let i = days - 1; i >= 0; i--) {
      const date = new Date(today)
      date.setDate(date.getDate() - i)
      data.push({
        date: date.toISOString().split('T')[0],
        ridesRevenue: 0,
        operationalFee: 0,
        subscriptionRevenue: 0
      })
    }

    return data
  }

  getDateRange(period) {
    const today = new Date()
    const endDate = today.toISOString().split('T')[0]
    let startDate = new Date()

    switch (period) {
      case '24h':
        startDate.setDate(today.getDate() - 1)
        break
      case '3d':
        startDate.setDate(today.getDate() - 3)
        break
      case 'week':
        startDate.setDate(today.getDate() - 7)
        break
      case 'month':
        startDate = new Date(today.getFullYear(), today.getMonth(), 1)
        break
      default:
        startDate.setDate(today.getDate() - 1)
    }

    return `${startDate.toISOString().split('T')[0]},${endDate}`
  }

  // ✅ OBSERVABILIDADE: Métricas de Redis e Sistema
  async getObservabilityMetrics() {
    return await this.request('/metrics/observability')
  }
}

// Export singleton instance
export const leafAPI = new LeafAPIService()
export default leafAPI
