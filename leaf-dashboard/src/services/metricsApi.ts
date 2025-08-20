import { SimpleMetrics, RealTimeReport } from '../types/metrics';

const API_BASE_URL = 'http://localhost:3001';

class MetricsApiService {
  private baseUrl: string;

  constructor(baseUrl: string = API_BASE_URL) {
    this.baseUrl = baseUrl;
  }

  // Buscar métricas completas
  async getMetrics(): Promise<SimpleMetrics> {
    try {
      const response = await fetch(`${this.baseUrl}/metrics`);
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      const data = await response.json();
      return data;
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('Erro ao buscar métricas:', error);
      throw error;
    }
  }

  // Buscar estatísticas de usuários (customers e drivers)
  async getUserStats(): Promise<{
    stats: {
      totalCustomers: number;
      customersOnline: number;
      totalDrivers: number;
      driversOnline: number;
      totalUsers: number;
      onlineUsers: number;
    };
  }> {
    try {
      const response = await fetch(`${this.baseUrl}/stats/users`);
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      const data = await response.json();
      return data;
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('Erro ao buscar estatísticas de usuários:', error);
      throw error;
    }
  }

  // Buscar métricas financeiras
  async getFinancialStats(): Promise<{
    financial: {
      // Métricas Gerais
      totalRevenue: number;
      totalCosts: number;
      totalProfit: number;
      totalTrips: number;
      averageTripValue: number;
      
      // Métricas de Hoje
      todayRevenue: number;
      todayTrips: number;
      todayProfit: number;
      todayAverageTrip: number;
      
      // Métricas Mensais
      monthlyRevenue: number;
      monthlyTrips: number;
      monthlyProfit: number;
      monthlyAverageTrip: number;
      
      // Percentuais
      profitMargin: string;
      costPercentage: string;
      
      // Crescimento
      revenueGrowth: string;
      profitGrowth: string;
      tripsGrowth: string;
    };
  }> {
    try {
      const response = await fetch(`${this.baseUrl}/stats/financial`);
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      const data = await response.json();
      return data;
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('Erro ao buscar métricas financeiras:', error);
      throw error;
    }
  }

  // Buscar métricas em tempo real
  async getRealTimeMetrics(): Promise<RealTimeReport> {
    try {
      const response = await fetch(`${this.baseUrl}/metrics/realtime`);
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      const data = await response.json();
      return data;
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('Erro ao buscar métricas em tempo real:', error);
      throw error;
    }
  }

  // Verificar saúde do backend
  async getHealth(): Promise<{ status: string; timestamp: string }> {
    try {
      const response = await fetch(`${this.baseUrl}/health`);
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      const data = await response.json();
      return data;
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('Erro ao verificar saúde do backend:', error);
      throw error;
    }
  }

  // Buscar motoristas próximos (exemplo de API de negócio)
  async getNearbyDrivers(lat: number, lng: number, radius: number = 5000): Promise<any> {
    try {
      const response = await fetch(
        `${this.baseUrl}/api/drivers/nearby?lat=${lat}&lng=${lng}&radius=${radius}`
      );
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      const data = await response.json();
      return data;
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('Erro ao buscar motoristas próximos:', error);
      throw error;
    }
  }

  // Buscar localização de um motorista específico
  async getDriverLocation(uid: string): Promise<any> {
    try {
      const response = await fetch(`${this.baseUrl}/api/drivers/${uid}/location`);
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      const data = await response.json();
      return data;
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('Erro ao buscar localização do motorista:', error);
      throw error;
    }
  }

  // Método para testar conectividade
  async testConnection(): Promise<boolean> {
    try {
      await this.getHealth();
      return true;
    } catch (error) {
      return false;
    }
  }

  // ===== MÉTODOS DE APROVAÇÃO DE MOTORISTAS =====

  // Buscar aprovações de motoristas
  async getDriverApprovals(status: string = 'pending', page: number = 0, limit: number = 20): Promise<{
    result: {
      approvals: any[];
      total: number;
      page: number;
      limit: number;
      hasMore: boolean;
    };
  }> {
    try {
      const response = await fetch(`${this.baseUrl}/driver-approvals?status=${status}&page=${page}&limit=${limit}`);
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      const data = await response.json();
      return data;
    } catch (error) {
      console.error('Erro ao buscar aprovações de motoristas:', error);
      throw error;
    }
  }

  // Buscar estatísticas de aprovação
  async getDriverApprovalStats(): Promise<{
    stats: {
      totalApprovals: number;
      pendingApprovals: number;
      approvedDrivers: number;
      rejectedDrivers: number;
      approvalRate: number;
    };
  }> {
    try {
      const response = await fetch(`${this.baseUrl}/driver-approval-stats`);
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      const data = await response.json();
      return data;
    } catch (error) {
      console.error('Erro ao buscar estatísticas de aprovação:', error);
      throw error;
    }
  }

  // Aprovar motorista
  async approveDriver(approvalId: string): Promise<{ success: boolean; result: any }> {
    try {
      const response = await fetch(`${this.baseUrl}/driver-approve`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ approvalId }),
      });
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      const data = await response.json();
      return data;
    } catch (error) {
      console.error('Erro ao aprovar motorista:', error);
      throw error;
    }
  }

  // Rejeitar motorista
  async rejectDriver(approvalId: string, reason: string): Promise<{ success: boolean; result: any }> {
    try {
      const response = await fetch(`${this.baseUrl}/driver-reject`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ approvalId, reason }),
      });
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      const data = await response.json();
      return data;
    } catch (error) {
      console.error('Erro ao rejeitar motorista:', error);
      throw error;
    }
  }
}

// Instância singleton
export const metricsApi = new MetricsApiService(); 

