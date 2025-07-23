import React, { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { metricsApi } from '../services/metricsApi';
import { SimpleMetrics } from '../types/metrics';
import NotificationBell from './NotificationBell';
import { Car, LogOut, Sun, Moon, Settings, Activity, Database, AlertTriangle } from 'lucide-react';

const Dashboard: React.FC = () => {
  const { user, logout } = useAuth();
  const [metrics, setMetrics] = useState<SimpleMetrics | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isDarkMode, setIsDarkMode] = useState(false);

  // Alternar tema escuro/claro
  const toggleTheme = () => {
    const newTheme = !isDarkMode;
    setIsDarkMode(newTheme);
    document.documentElement.classList.toggle('dark', newTheme);
    localStorage.setItem('leaf_dashboard_theme', newTheme ? 'dark' : 'light');
  };

  // Carregar tema salvo
  useEffect(() => {
    const savedTheme = localStorage.getItem('leaf_dashboard_theme');
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const shouldUseDark = savedTheme === 'dark' || (!savedTheme && prefersDark);
    
    setIsDarkMode(shouldUseDark);
    document.documentElement.classList.toggle('dark', shouldUseDark);
  }, []);

  // Buscar métricas
  const fetchMetrics = async () => {
    try {
      const data = await metricsApi.getMetrics();
      setMetrics(data);
      setError(null);
    } catch (err) {
      setError('Erro ao carregar métricas');
      // eslint-disable-next-line no-console
      console.error('Erro ao buscar métricas:', err);
    } finally {
      setIsLoading(false);
    }
  };

  // Carregar métricas iniciais
  useEffect(() => {
    fetchMetrics();
  }, []);

  // Atualizar métricas periodicamente
  useEffect(() => {
    const interval = setInterval(fetchMetrics, 5000);
    return () => clearInterval(interval);
  }, []);

  // Reconhecer alerta
  const handleAcknowledgeAlert = (alertId: string) => {
    // Aqui você implementaria a lógica para reconhecer o alerta
    // eslint-disable-next-line no-console
    console.log('Alerta reconhecido:', alertId);
  };

  // Formatar tempo de uptime
  const formatUptime = (seconds: number) => {
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    
    if (days > 0) return `${days}d ${hours}h`;
    if (hours > 0) return `${hours}h ${minutes}m`;
    return `${minutes}m`;
  };

  // Obter cor do status
  const getStatusColor = (status: string) => {
    switch (status) {
      case 'healthy':
        return 'text-success-600 bg-success-100 dark:bg-success-900 dark:text-success-400';
      case 'warning':
        return 'text-warning-600 bg-warning-100 dark:bg-warning-900 dark:text-warning-400';
      case 'error':
        return 'text-error-600 bg-error-100 dark:bg-error-900 dark:text-error-400';
      case 'critical':
        return 'text-critical-600 bg-critical-100 dark:bg-critical-900 dark:text-critical-400';
      default:
        return 'text-gray-600 bg-gray-100 dark:bg-gray-900 dark:text-gray-400';
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600 mx-auto mb-4"></div>
          <p className="text-gray-600 dark:text-gray-400">Carregando dashboard...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center">
        <div className="text-center">
          <AlertTriangle className="h-12 w-12 text-error-500 mx-auto mb-4" />
          <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-2">
            Erro ao carregar dados
          </h2>
          <p className="text-gray-600 dark:text-gray-400 mb-4">{error}</p>
          <button
            onClick={fetchMetrics}
            className="px-4 py-2 bg-primary-600 text-white rounded-md hover:bg-primary-700 transition-colors"
          >
            Tentar novamente
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      {/* Header */}
      <header className="bg-white dark:bg-gray-800 shadow-sm border-b border-gray-200 dark:border-gray-700">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            {/* Logo e Título */}
            <div className="flex items-center space-x-3">
              <div className="h-8 w-8 bg-primary-600 rounded-lg flex items-center justify-center">
                <Car className="h-5 w-5 text-white" />
              </div>
              <h1 className="text-xl font-bold text-gray-900 dark:text-white">
                Leaf Dashboard
              </h1>
            </div>

            {/* Status Geral */}
            {metrics && (
              <div className="hidden md:flex items-center space-x-4">
                <div className={`px-3 py-1 rounded-full text-sm font-medium ${getStatusColor(metrics.summary?.status || 'unknown')}`}>
                  {(metrics.summary?.status || 'unknown').toUpperCase()}
                </div>
                <div className="text-sm text-gray-600 dark:text-gray-400">
                  Uptime: {formatUptime(metrics.summary?.uptime || 0)}
                </div>
              </div>
            )}

            {/* Ações do Header */}
            <div className="flex items-center space-x-2">
              {/* Notificações */}
              {metrics && (
                <NotificationBell
                  resourceAlerts={metrics.alerts || []}
                  syncAlerts={[]}
                  onAcknowledgeAlert={handleAcknowledgeAlert}
                />
              )}

              {/* Toggle de Tema */}
              <button
                onClick={toggleTheme}
                className="p-2 text-gray-600 hover:text-gray-900 dark:text-gray-300 dark:hover:text-white transition-colors"
                title={isDarkMode ? 'Modo claro' : 'Modo escuro'}
              >
                {isDarkMode ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
              </button>

              {/* Configurações */}
              <button
                className="p-2 text-gray-600 hover:text-gray-900 dark:text-gray-300 dark:hover:text-white transition-colors"
                title="Configurações"
              >
                <Settings className="h-5 w-5" />
              </button>

              {/* Usuário e Logout */}
              <div className="flex items-center space-x-2">
                <span className="text-sm text-gray-700 dark:text-gray-300">
                  {user?.username}
                </span>
                <button
                  onClick={logout}
                  className="p-2 text-gray-600 hover:text-gray-900 dark:text-gray-300 dark:hover:text-white transition-colors"
                  title="Sair"
                >
                  <LogOut className="h-5 w-5" />
                </button>
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* Conteúdo Principal */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {metrics ? (
          <div className="space-y-8">
            {/* Cards de Status */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              {/* Status Geral */}
              <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-6">
                <div className="flex items-center">
                  <div className="flex-shrink-0">
                    <Activity className="h-8 w-8 text-primary-600" />
                  </div>
                  <div className="ml-4">
                    <p className="text-sm font-medium text-gray-500 dark:text-gray-400">
                      Status Geral
                    </p>
                    <p className={`text-2xl font-semibold ${getStatusColor(metrics.summary?.status || 'unknown')}`}>
                      {(metrics.summary?.status || 'unknown').toUpperCase()}
                    </p>
                  </div>
                </div>
              </div>

              {/* Alertas */}
              <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-6">
                <div className="flex items-center">
                  <div className="flex-shrink-0">
                    <AlertTriangle className="h-8 w-8 text-warning-600" />
                  </div>
                  <div className="ml-4">
                    <p className="text-sm font-medium text-gray-500 dark:text-gray-400">
                      Alertas Ativos
                    </p>
                    <p className="text-2xl font-semibold text-gray-900 dark:text-white">
                      {metrics.summary?.totalAlerts || metrics.summary?.alerts || 0}
                    </p>
                  </div>
                </div>
              </div>

              {/* Uptime */}
              <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-6">
                <div className="flex items-center">
                  <div className="flex-shrink-0">
                    <Activity className="h-8 w-8 text-success-600" />
                  </div>
                  <div className="ml-4">
                    <p className="text-sm font-medium text-gray-500 dark:text-gray-400">
                      Uptime
                    </p>
                    <p className="text-2xl font-semibold text-gray-900 dark:text-white">
                      {formatUptime(metrics.summary?.uptime || 0)}
                    </p>
                  </div>
                </div>
              </div>

              {/* Operações */}
              <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-6">
                <div className="flex items-center">
                  <div className="flex-shrink-0">
                    <Database className="h-8 w-8 text-primary-600" />
                  </div>
                  <div className="ml-4">
                    <p className="text-sm font-medium text-gray-500 dark:text-gray-400">
                      Operações
                    </p>
                    <p className="text-2xl font-semibold text-gray-900 dark:text-white">
                      {metrics.redis?.operations || 0}
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* Métricas Detalhadas */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
              {/* Latência */}
              <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-6">
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
                  Performance de Latência
                </h3>
                <div className="space-y-4">
                  <div className="flex justify-between">
                    <span className="text-gray-600 dark:text-gray-400">Latência do Redis:</span>
                    <span className="font-medium text-gray-900 dark:text-white">
                      {(metrics.redis?.latency || 0).toFixed(2)}ms
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600 dark:text-gray-400">Conexões Redis:</span>
                    <span className="font-medium text-gray-900 dark:text-white">
                      {metrics.redis?.connections || 0}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600 dark:text-gray-400">Erros Redis:</span>
                    <span className="font-medium text-gray-900 dark:text-white">
                      {metrics.redis?.errors || 0}
                    </span>
                  </div>
                </div>
              </div>

              {/* Recursos do Docker */}
              <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-6">
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
                  Recursos do Docker
                </h3>
                <div className="space-y-4">
                  <div className="flex justify-between">
                    <span className="text-gray-600 dark:text-gray-400">Container Status:</span>
                    <span className={`font-medium ${getStatusColor(metrics.container?.status || 'unknown')}`}>
                      {(metrics.container?.status || 'unknown').toUpperCase()}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600 dark:text-gray-400">CPU Usage:</span>
                    <span className="font-medium text-gray-900 dark:text-white">
                      {(metrics.container?.cpu || 0).toFixed(2)}%
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600 dark:text-gray-400">Memory Usage:</span>
                    <span className="font-medium text-gray-900 dark:text-white">
                      {(metrics.container?.memory?.percentage || 0).toFixed(1)}%
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600 dark:text-gray-400">Redis Status:</span>
                    <span className={`font-medium ${metrics.redis?.status === 'connected' ? 'text-success-600' : 'text-error-600'}`}>
                      {metrics.redis?.status === 'connected' ? 'Conectado' : 'Desconectado'}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* Gráficos (placeholder) */}
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-6">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
                Gráficos de Performance
              </h3>
              <div className="h-64 bg-gray-100 dark:bg-gray-700 rounded-lg flex items-center justify-center">
                <p className="text-gray-500 dark:text-gray-400">
                  Gráficos serão implementados aqui
                </p>
              </div>
            </div>
          </div>
        ) : (
          <div className="text-center py-12">
            <p className="text-gray-500 dark:text-gray-400">Nenhum dado disponível</p>
          </div>
        )}
      </main>
    </div>
  );
};

export default Dashboard; 