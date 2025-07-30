import React, { useState, useEffect } from 'react';

interface CostData {
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

interface RevenueData {
  operational_fees: number;
  total_rides: number;
  average_fee: number;
  profit_margin: number;
}

interface RealTimeCostMonitorProps {
  refreshInterval?: number; // em segundos
}

const RealTimeCostMonitor: React.FC<RealTimeCostMonitorProps> = ({ 
  refreshInterval = 30 
}) => {
  const [costData, setCostData] = useState<CostData>({
    google_maps: 0,
    firebase: 0,
    redis: 0,
    websocket: 0,
    mobile_api: 0,
    location: 0,
    hosting: 0,
    monitoring: 0,
    security: 0,
    total_cost: 0
  });

  const [revenueData, setRevenueData] = useState<RevenueData>({
    operational_fees: 0,
    total_rides: 0,
    average_fee: 1.49,
    profit_margin: 0
  });

  const [lastUpdate, setLastUpdate] = useState<Date>(new Date());
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Função para buscar dados de custos em tempo real
  const fetchCostData = async () => {
    try {
      setIsLoading(true);
      setError(null);

      // Simular dados reais de custos (substituir por API real)
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

      setCostData(mockCostData);
      setLastUpdate(new Date());
    } catch (err) {
      setError('Erro ao carregar dados de custos');
      console.error('Erro ao buscar dados de custos:', err);
    } finally {
      setIsLoading(false);
    }
  };

  // Função para buscar dados de receita
  const fetchRevenueData = async () => {
    try {
      // Simular dados reais de receita (substituir por API real)
      const mockRevenueData: RevenueData = {
        operational_fees: Math.random() * 100 + 50, // R$ 50 - 150
        total_rides: Math.floor(Math.random() * 50) + 20, // 20 - 70 corridas
        average_fee: 1.49,
        profit_margin: 0
      };

      // Calcular margem de lucro
      mockRevenueData.profit_margin = mockRevenueData.operational_fees - (mockRevenueData.total_rides * costData.total_cost);

      setRevenueData(mockRevenueData);
    } catch (err) {
      console.error('Erro ao buscar dados de receita:', err);
    }
  };

  // Função para buscar todos os dados
  const fetchData = async () => {
    await Promise.all([fetchCostData(), fetchRevenueData()]);
  };

  // Formatar moeda
  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL'
    }).format(value);
  };

  // Função para determinar cor do indicador
  const getIndicatorColor = (value: number, threshold: number) => {
    if (value <= threshold * 0.7) return '#00aa00'; // Verde
    if (value <= threshold) return '#ffaa00'; // Amarelo
    return '#ff4444'; // Vermelho
  };

  // Renderizar item de custo
  const renderCostItem = (title: string, value: number, threshold: number = 0.1) => {
    const color = getIndicatorColor(value, threshold);
    return (
      <div key={title} className="cost-card" style={{ borderLeftColor: color }}>
        <div className="cost-card-content">
          <div className="cost-header">
            <span className="cost-icon" style={{ color }}>💰</span>
            <span className="cost-title">{title}</span>
            <div className="cost-badge" style={{ backgroundColor: color }}>
              <span className="cost-badge-text">{formatCurrency(value)}</span>
            </div>
          </div>
          <div className="cost-details">
            <span className="cost-percentage">
              {((value / costData.total_cost) * 100).toFixed(1)}% do total
            </span>
            <span className="cost-threshold">
              Limite: {formatCurrency(threshold)}
            </span>
          </div>
        </div>
      </div>
    );
  };

  // Efeito para buscar dados periodicamente
  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, refreshInterval * 1000);
    return () => clearInterval(interval);
  }, [refreshInterval]);

  return (
    <div className="real-time-cost-monitor">
      {isLoading && (
        <div className="loading-overlay">
          <span>Carregando dados...</span>
        </div>
      )}

      {/* Header com Receita e Sustentabilidade */}
      <div className="revenue-card">
        <div className="revenue-header">
          <span className="revenue-icon">💰</span>
          <span className="revenue-title">Receita Operacional</span>
        </div>
        
        <div className="revenue-stats">
          <div className="revenue-item">
            <span className="revenue-label">Taxas Operacionais</span>
            <span className="revenue-value">
              {formatCurrency(revenueData.operational_fees)}
            </span>
          </div>
          
          <div className="revenue-item">
            <span className="revenue-label">Total de Corridas</span>
            <span className="revenue-value">{revenueData.total_rides}</span>
          </div>
          
          <div className="revenue-item">
            <span className="revenue-label">Taxa Média</span>
            <span className="revenue-value">
              {formatCurrency(revenueData.average_fee)}
            </span>
          </div>
        </div>

        <div className="sustainability-indicator">
          <span className="sustainability-label">Margem de Lucro</span>
          <div className="sustainability-value">
            <span className="sustainability-amount" style={{ 
              color: revenueData.profit_margin > 0 ? '#00aa00' : '#ff4444' 
            }}>
              {formatCurrency(revenueData.profit_margin)}
            </span>
            <span className="sustainability-icon">
              {revenueData.profit_margin > 0 ? '📈' : '📉'}
            </span>
          </div>
        </div>
      </div>

      {/* Custos em Tempo Real */}
      <div className="costs-card">
        <span className="costs-title">Custos por Corrida (Tempo Real)</span>
        <span className="costs-subtitle">
          Última atualização: {lastUpdate.toLocaleTimeString()}
        </span>
        
        <div className="costs-grid">
          {renderCostItem('Google Maps', costData.google_maps, 0.15)}
          {renderCostItem('Firebase', costData.firebase, 0.03)}
          {renderCostItem('Redis', costData.redis, 0.015)}
          {renderCostItem('WebSocket', costData.websocket, 0.03)}
          {renderCostItem('Mobile API', costData.mobile_api, 0.015)}
          {renderCostItem('Location', costData.location, 0.015)}
          {renderCostItem('Hosting', costData.hosting, 0.015)}
          {renderCostItem('Monitoramento', costData.monitoring, 0.007)}
          {renderCostItem('Segurança', costData.security, 0.003)}
        </div>

        {/* Custo Total */}
        <div className="total-cost-card" style={{ borderLeftColor: '#ff4444' }}>
          <div className="total-cost-header">
            <span className="total-cost-icon">🏦</span>
            <span className="total-cost-title">Custo Total por Corrida</span>
            <div className="total-cost-badge" style={{ backgroundColor: '#ff4444' }}>
              <span className="total-cost-badge-text">
                {formatCurrency(costData.total_cost)}
              </span>
            </div>
          </div>
          <span className="total-cost-subtitle">
            Soma de todos os custos operacionais
          </span>
        </div>
      </div>

      {/* Análise de Sustentabilidade */}
      <div className="analysis-card">
        <span className="analysis-title">Análise de Sustentabilidade</span>
        
        <div className="analysis-grid">
          <div className="analysis-item">
            <span className="analysis-label">Receita por Corrida</span>
            <span className="analysis-value">
              {formatCurrency(revenueData.average_fee)}
            </span>
          </div>
          
          <div className="analysis-item">
            <span className="analysis-label">Custo por Corrida</span>
            <span className="analysis-value">
              {formatCurrency(costData.total_cost)}
            </span>
          </div>
          
          <div className="analysis-item">
            <span className="analysis-label">Margem por Corrida</span>
            <span className="analysis-value" style={{ 
              color: revenueData.average_fee > costData.total_cost ? '#00aa00' : '#ff4444' 
            }}>
              {formatCurrency(revenueData.average_fee - costData.total_cost)}
            </span>
          </div>
          
          <div className="analysis-item">
            <span className="analysis-label">Taxa de Sustentabilidade</span>
            <span className="analysis-value" style={{ 
              color: revenueData.average_fee > costData.total_cost ? '#00aa00' : '#ff4444' 
            }}>
              {revenueData.average_fee > costData.total_cost ? '✅ Sustentável' : '❌ Insustentável'}
            </span>
          </div>
        </div>
      </div>

      {error && (
        <div className="error-card">
          <span className="error-text">{error}</span>
        </div>
      )}
    </div>
  );
};

export default RealTimeCostMonitor; 