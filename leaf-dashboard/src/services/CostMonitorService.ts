/**
 * 🏦 Serviço de Monitoramento de Custos em Tempo Real
 * 
 * Este serviço busca dados reais de custos e receita para o dashboard
 */

export interface CostData {
  google_maps: number;
  firebase: number;
  redis: number;
  websocket: number;
  mobile_api: number;
  location: number;
  hosting: number;
  monitoring: number;
  security: number;
  total_cost: number;
}

export interface RevenueData {
  operational_fees: number;
  total_rides: number;
  average_fee: number;
  profit_margin: number;
}

export interface SustainabilityMetrics {
  revenue_per_ride: number;
  cost_per_ride: number;
  margin_per_ride: number;
  sustainability_rate: number;
  is_sustainable: boolean;
}

class CostMonitorService {
  private baseURL = 'https://us-central1-leaf-reactnative.cloudfunctions.net';

  /**
   * Buscar dados de custos em tempo real
   */
  async fetchCostData(): Promise<CostData> {
    try {
      // TODO: Substituir por API real
      // const response = await fetch(`${this.baseURL}/getCostData`);
      // return await response.json();
      
      // Dados simulados baseados em análise real
      const mockCostData: CostData = {
        google_maps: Math.random() * 0.15 + 0.05, // R$ 0.05 - 0.20
        firebase: Math.random() * 0.02 + 0.01, // R$ 0.01 - 0.03
        redis: Math.random() * 0.01 + 0.005, // R$ 0.005 - 0.015
        websocket: Math.random() * 0.02 + 0.01, // R$ 0.01 - 0.03
        mobile_api: Math.random() * 0.01 + 0.005, // R$ 0.005 - 0.015
        location: Math.random() * 0.01 + 0.005, // R$ 0.005 - 0.015
        hosting: Math.random() * 0.01 + 0.005, // R$ 0.005 - 0.015
        monitoring: Math.random() * 0.005 + 0.002, // R$ 0.002 - 0.007
        security: Math.random() * 0.002 + 0.001, // R$ 0.001 - 0.003
        total_cost: 0
      };

      // Calcular total
      mockCostData.total_cost = Object.values(mockCostData).reduce((sum, cost) => 
        cost !== mockCostData.total_cost ? sum + cost : sum, 0
      );

      return mockCostData;
    } catch (error) {
      console.error('Erro ao buscar dados de custos:', error);
      throw new Error('Falha ao buscar dados de custos');
    }
  }

  /**
   * Buscar dados de receita operacional
   */
  async fetchRevenueData(): Promise<RevenueData> {
    try {
      // TODO: Substituir por API real
      // const response = await fetch(`${this.baseURL}/getRevenueData`);
      // return await response.json();
      
      // Dados simulados baseados em análise real
      const mockRevenueData: RevenueData = {
        operational_fees: Math.random() * 100 + 50, // R$ 50 - 150
        total_rides: Math.floor(Math.random() * 50) + 20, // 20 - 70 corridas
        average_fee: 1.49, // Taxa operacional média
        profit_margin: 0
      };

      // Calcular margem de lucro
      const costData = await this.fetchCostData();
      mockRevenueData.profit_margin = mockRevenueData.operational_fees - costData.total_cost;

      return mockRevenueData;
    } catch (error) {
      console.error('Erro ao buscar dados de receita:', error);
      throw new Error('Falha ao buscar dados de receita');
    }
  }

  /**
   * Calcular métricas de sustentabilidade
   */
  async calculateSustainabilityMetrics(): Promise<SustainabilityMetrics> {
    try {
      const [costData, revenueData] = await Promise.all([
        this.fetchCostData(),
        this.fetchRevenueData()
      ]);

      const revenue_per_ride = revenueData.average_fee;
      const cost_per_ride = costData.total_cost;
      const margin_per_ride = revenue_per_ride - cost_per_ride;
      const sustainability_rate = (margin_per_ride / revenue_per_ride) * 100;
      const is_sustainable = margin_per_ride > 0 && sustainability_rate > 50;

      return {
        revenue_per_ride,
        cost_per_ride,
        margin_per_ride,
        sustainability_rate,
        is_sustainable
      };
    } catch (error) {
      console.error('Erro ao calcular métricas de sustentabilidade:', error);
      throw new Error('Falha ao calcular métricas de sustentabilidade');
    }
  }

  /**
   * Buscar dados de taxas operacionais por período
   */
  async fetchOperationalFeesByPeriod(period: 'day' | 'week' | 'month' = 'day'): Promise<{
    total: number;
    rides: number;
    average: number;
    period: string;
  }> {
    try {
      // TODO: Substituir por API real
      const mockData = {
        total: Math.random() * 200 + 100, // R$ 100 - 300
        rides: Math.floor(Math.random() * 100) + 50, // 50 - 150 corridas
        average: 1.49,
        period
      };

      return mockData;
    } catch (error) {
      console.error('Erro ao buscar dados de taxas operacionais:', error);
      throw new Error('Falha ao buscar dados de taxas operacionais');
    }
  }

  /**
   * Buscar histórico de custos
   */
  async fetchCostHistory(days: number = 7): Promise<{
    date: string;
    total_cost: number;
    google_maps: number;
    firebase: number;
    redis: number;
    websocket: number;
    mobile_api: number;
    location: number;
    hosting: number;
    monitoring: number;
    security: number;
  }[]> {
    try {
      // TODO: Substituir por API real
      const history = [];
      const today = new Date();

      for (let i = days - 1; i >= 0; i--) {
        const date = new Date(today);
        date.setDate(date.getDate() - i);
        
        const dailyCosts = {
          date: date.toISOString().split('T')[0],
          total_cost: Math.random() * 0.3 + 0.1, // R$ 0.1 - 0.4
          google_maps: Math.random() * 0.15 + 0.05,
          firebase: Math.random() * 0.02 + 0.01,
          redis: Math.random() * 0.01 + 0.005,
          websocket: Math.random() * 0.02 + 0.01,
          mobile_api: Math.random() * 0.01 + 0.005,
          location: Math.random() * 0.01 + 0.005,
          hosting: Math.random() * 0.01 + 0.005,
          monitoring: Math.random() * 0.005 + 0.002,
          security: Math.random() * 0.002 + 0.001
        };

        history.push(dailyCosts);
      }

      return history;
    } catch (error) {
      console.error('Erro ao buscar histórico de custos:', error);
      throw new Error('Falha ao buscar histórico de custos');
    }
  }

  /**
   * Buscar alertas de custos
   */
  async fetchCostAlerts(): Promise<{
    type: 'warning' | 'critical';
    message: string;
    cost_item: string;
    current_value: number;
    threshold: number;
  }[]> {
    try {
      const costData = await this.fetchCostData();
      const alerts: {
        type: 'warning' | 'critical';
        message: string;
        cost_item: string;
        current_value: number;
        threshold: number;
      }[] = [];

      // Verificar Google Maps (limite: R$ 0.15)
      if (costData.google_maps > 0.15) {
        alerts.push({
          type: 'critical',
          message: 'Custo do Google Maps acima do limite',
          cost_item: 'Google Maps',
          current_value: costData.google_maps,
          threshold: 0.15
        });
      }

      // Verificar Firebase (limite: R$ 0.02)
      if (costData.firebase > 0.02) {
        alerts.push({
          type: 'warning',
          message: 'Custo do Firebase próximo ao limite',
          cost_item: 'Firebase',
          current_value: costData.firebase,
          threshold: 0.02
        });
      }

      // Verificar custo total (limite: R$ 0.3)
      if (costData.total_cost > 0.3) {
        alerts.push({
          type: 'critical',
          message: 'Custo total por corrida acima do limite',
          cost_item: 'Total',
          current_value: costData.total_cost,
          threshold: 0.3
        });
      }

      return alerts;
    } catch (error) {
      console.error('Erro ao buscar alertas de custos:', error);
      throw new Error('Falha ao buscar alertas de custos');
    }
  }

  /**
   * Formatar valor monetário
   */
  formatCurrency(value: number): string {
    return `R$ ${value.toFixed(3)}`;
  }

  /**
   * Formatar porcentagem
   */
  formatPercentage(value: number): string {
    return `${value.toFixed(1)}%`;
  }

  /**
   * Determinar cor do indicador baseado no valor
   */
  getIndicatorColor(value: number, threshold: number): string {
    if (value > threshold) return '#ff4444'; // Vermelho
    if (value > threshold * 0.8) return '#ffaa00'; // Laranja
    return '#00aa00'; // Verde
  }
}

export default new CostMonitorService(); 