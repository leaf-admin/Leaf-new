import React, { useState, useEffect } from 'react';
import RealTimeCostMonitor from '../components/RealTimeCostMonitor';
import CostMonitorService from '../services/CostMonitorService';

const CostMonitor: React.FC = () => {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        const costData = await CostMonitorService.fetchCostData();
        const revenueData = await CostMonitorService.fetchRevenueData();
        setData({ costData, revenueData });
      } catch (err) {
        setError('Erro ao carregar dados');
        console.error('Erro:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, []);

  if (loading) {
    return (
      <div className="loading-container">
        <span className="loading-text">Carregando dados de custos...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="error-container">
        <span className="error-text">{error}</span>
      </div>
    );
  }

  return (
    <div className="cost-monitor-page">
      <div className="container">
        <h1 className="header-title">Dashboard de Custos e Sustentabilidade</h1>
        <p className="header-subtitle">Monitoramento em Tempo Real</p>

        <RealTimeCostMonitor />

        {/* Seções adicionais podem ser adicionadas aqui */}
        <div className="additional-sections">
          <div className="section">
            <h2>Alertas de Custo</h2>
            <p>Monitoramento de alertas em tempo real...</p>
          </div>
          
          <div className="section">
            <h2>Histórico de Custos</h2>
            <p>Análise histórica de custos...</p>
          </div>
          
          <div className="section">
            <h2>Recomendações</h2>
            <p>Sugestões para otimização de custos...</p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default CostMonitor; 