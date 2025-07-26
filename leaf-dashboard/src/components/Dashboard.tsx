import React, { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { metricsApi } from '../services/metricsApi';
import { SimpleMetrics } from '../types/metrics';
import NotificationBell from './NotificationBell';
import { 
  Car, 
  LogOut, 
  Sun, 
  Moon, 
  Settings, 
  Activity, 
  Database, 
  AlertTriangle, 
  Users, 
  UserCheck,
  TrendingUp,
  Clock,
  Zap,
  Shield,
  Globe,
  BarChart3,
  Cpu,
  DollarSign,
  TrendingDown,
  Percent,
  Target,
  Award
} from 'lucide-react';

const Dashboard: React.FC = () => {
  const { user, logout } = useAuth();
  const [metrics, setMetrics] = useState<SimpleMetrics | null>(null);
  const [userStats, setUserStats] = useState<{
    totalCustomers: number;
    customersOnline: number;
    totalDrivers: number;
    driversOnline: number;
    totalUsers: number;
    onlineUsers: number;
  } | null>(null);
  const [financialStats, setFinancialStats] = useState<{
    totalRevenue: number;
    totalCosts: number;
    totalProfit: number;
    totalTrips: number;
    averageTripValue: number;
    todayRevenue: number;
    todayTrips: number;
    todayProfit: number;
    todayAverageTrip: number;
    monthlyRevenue: number;
    monthlyTrips: number;
    monthlyProfit: number;
    monthlyAverageTrip: number;
    profitMargin: string;
    costPercentage: string;
    revenueGrowth: string;
    profitGrowth: string;
    tripsGrowth: string;
  } | null>(null);
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
    } finally {
      setIsLoading(false);
    }
  };

  // Buscar estatísticas de usuários
  const fetchUserStats = async () => {
    try {
      const data = await metricsApi.getUserStats();
      setUserStats(data.stats);
    } catch (err) {
      // Silenciar erro para não poluir o console
    }
  };

  // Buscar métricas financeiras
  const fetchFinancialStats = async () => {
    try {
      const data = await metricsApi.getFinancialStats();
      setFinancialStats(data.financial);
    } catch (err) {
      // Silenciar erro para não poluir o console
    }
  };

  // Carregar métricas iniciais
  useEffect(() => {
    fetchMetrics();
    fetchUserStats();
    fetchFinancialStats();
  }, []);

  // Atualizar métricas periodicamente
  useEffect(() => {
    const interval = setInterval(() => {
      fetchMetrics();
      fetchUserStats();
      fetchFinancialStats();
    }, 5000);
    return () => clearInterval(interval);
  }, []);

  // Reconhecer alerta
  const handleAcknowledgeAlert = (alertId: string) => {
    // Implementação futura para reconhecer alertas
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
        return 'text-emerald-600 bg-emerald-50 dark:bg-emerald-900/20 dark:text-emerald-400';
      case 'warning':
        return 'text-amber-600 bg-amber-50 dark:bg-amber-900/20 dark:text-amber-400';
      case 'error':
        return 'text-red-600 bg-red-50 dark:bg-red-900/20 dark:text-red-400';
      case 'critical':
        return 'text-red-700 bg-red-100 dark:bg-red-900/30 dark:text-red-300';
      default:
        return 'text-gray-600 bg-gray-50 dark:bg-gray-800 dark:text-gray-400';
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-100 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900 flex items-center justify-center">
        <div className="text-center">
          <div className="relative">
            <div className="w-16 h-16 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin mx-auto mb-6"></div>
            <div className="absolute inset-0 w-16 h-16 border-4 border-transparent border-t-indigo-400 rounded-full animate-spin mx-auto" style={{ animationDelay: '0.5s' }}></div>
          </div>
          <p className="text-gray-600 dark:text-gray-400 text-lg font-medium">Carregando dashboard...</p>
          <p className="text-gray-500 dark:text-gray-500 text-sm mt-2">Preparando suas métricas</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-100 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900 flex items-center justify-center">
        <div className="text-center max-w-md mx-auto p-8">
          <div className="w-20 h-20 bg-red-100 dark:bg-red-900/20 rounded-full flex items-center justify-center mx-auto mb-6">
            <AlertTriangle className="h-10 w-10 text-red-600 dark:text-red-400" />
          </div>
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-3">
            Erro ao carregar dados
          </h2>
          <p className="text-gray-600 dark:text-gray-400 mb-6">{error}</p>
          <button
            onClick={fetchMetrics}
            className="px-6 py-3 bg-gradient-to-r from-blue-600 to-indigo-600 text-white rounded-xl hover:from-blue-700 hover:to-indigo-700 transition-all duration-200 font-medium shadow-lg hover:shadow-xl transform hover:-translate-y-0.5"
          >
            Tentar novamente
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-100 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900">
      {/* Header */}
      <header className="bg-white/80 dark:bg-gray-900/80 backdrop-blur-xl border-b border-gray-200/50 dark:border-gray-700/50 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            {/* Logo e Título */}
            <div className="flex items-center space-x-4">
              <div className="relative">
                <div className="h-10 w-10 bg-gradient-to-br from-blue-600 to-indigo-600 rounded-xl flex items-center justify-center shadow-lg">
                  <Car className="h-6 w-6 text-white" />
                </div>
                <div className="absolute -top-1 -right-1 h-4 w-4 bg-emerald-500 rounded-full border-2 border-white dark:border-gray-900"></div>
              </div>
              <div>
                <h1 className="text-xl font-bold bg-gradient-to-r from-gray-900 to-gray-600 dark:from-white dark:to-gray-300 bg-clip-text text-transparent">
                  Leaf Dashboard
                </h1>
                <p className="text-xs text-gray-500 dark:text-gray-400">Sistema de Monitoramento</p>
              </div>
            </div>

            {/* Status Geral */}
            {metrics && (
              <div className="hidden md:flex items-center space-x-4">
                <div className={`px-4 py-2 rounded-full text-sm font-medium ${getStatusColor(metrics.summary?.status || 'unknown')} backdrop-blur-sm`}>
                  <div className="flex items-center space-x-2">
                    <div className={`w-2 h-2 rounded-full ${metrics.summary?.status === 'healthy' ? 'bg-emerald-500' : 'bg-amber-500'}`}></div>
                    <span>{(metrics.summary?.status || 'unknown').toUpperCase()}</span>
                  </div>
                </div>
                <div className="flex items-center space-x-2 text-sm text-gray-600 dark:text-gray-400 bg-white/50 dark:bg-gray-800/50 px-4 py-2 rounded-full backdrop-blur-sm">
                  <Clock className="h-4 w-4" />
                  <span>Uptime: {formatUptime(metrics.summary?.uptime || 0)}</span>
                </div>
              </div>
            )}

            {/* Ações do Header */}
            <div className="flex items-center space-x-3">
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
                className="p-2.5 text-gray-600 hover:text-gray-900 dark:text-gray-300 dark:hover:text-white transition-all duration-200 bg-white/50 dark:bg-gray-800/50 rounded-xl backdrop-blur-sm hover:bg-white/80 dark:hover:bg-gray-800/80"
                title={isDarkMode ? 'Modo claro' : 'Modo escuro'}
              >
                {isDarkMode ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
              </button>

              {/* Configurações */}
              <button
                className="p-2.5 text-gray-600 hover:text-gray-900 dark:text-gray-300 dark:hover:text-white transition-all duration-200 bg-white/50 dark:bg-gray-800/50 rounded-xl backdrop-blur-sm hover:bg-white/80 dark:hover:bg-gray-800/80"
                title="Configurações"
              >
                <Settings className="h-5 w-5" />
              </button>

              {/* Usuário e Logout */}
              <div className="flex items-center space-x-3">
                <div className="text-right hidden sm:block">
                  <p className="text-sm font-medium text-gray-900 dark:text-white">
                    {user?.username}
                  </p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">Administrador</p>
                </div>
                <button
                  onClick={logout}
                  className="p-2.5 text-gray-600 hover:text-red-600 dark:text-gray-300 dark:hover:text-red-400 transition-all duration-200 bg-white/50 dark:bg-gray-800/50 rounded-xl backdrop-blur-sm hover:bg-red-50 dark:hover:bg-red-900/20"
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
            {/* Cards de Status Principais */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              {/* Status Geral */}
              <div className="group relative overflow-hidden bg-white/70 dark:bg-gray-800/70 rounded-2xl shadow-xl backdrop-blur-sm border border-gray-200/50 dark:border-gray-700/50 p-6 hover:shadow-2xl transition-all duration-300 hover:-translate-y-1">
                <div className="absolute inset-0 bg-gradient-to-br from-blue-500/10 to-indigo-500/10 opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
                <div className="relative">
                  <div className="flex items-center justify-between mb-4">
                    <div className="p-3 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-xl shadow-lg">
                      <Activity className="h-6 w-6 text-white" />
                    </div>
                    <div className={`px-3 py-1 rounded-full text-xs font-medium ${getStatusColor(metrics.summary?.status || 'unknown')}`}>
                      {(metrics.summary?.status || 'unknown').toUpperCase()}
                    </div>
                  </div>
                  <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-1">
                    Status Geral
                  </h3>
                  <p className="text-2xl font-bold text-gray-900 dark:text-white">
                    Sistema Ativo
                  </p>
                  <div className="mt-4 flex items-center text-sm text-gray-600 dark:text-gray-400">
                    <TrendingUp className="h-4 w-4 mr-1" />
                    <span>Performance estável</span>
                  </div>
                </div>
              </div>

              {/* Alertas */}
              <div className="group relative overflow-hidden bg-white/70 dark:bg-gray-800/70 rounded-2xl shadow-xl backdrop-blur-sm border border-gray-200/50 dark:border-gray-700/50 p-6 hover:shadow-2xl transition-all duration-300 hover:-translate-y-1">
                <div className="absolute inset-0 bg-gradient-to-br from-amber-500/10 to-orange-500/10 opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
                <div className="relative">
                  <div className="flex items-center justify-between mb-4">
                    <div className="p-3 bg-gradient-to-br from-amber-500 to-orange-600 rounded-xl shadow-lg">
                      <AlertTriangle className="h-6 w-6 text-white" />
                    </div>
                    <div className="px-3 py-1 bg-amber-100 dark:bg-amber-900/20 text-amber-800 dark:text-amber-200 rounded-full text-xs font-medium">
                      ATIVOS
                    </div>
                  </div>
                  <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-1">
                    Alertas Ativos
                  </h3>
                  <p className="text-2xl font-bold text-gray-900 dark:text-white">
                    {metrics.summary?.totalAlerts || metrics.summary?.alerts || 0}
                  </p>
                  <div className="mt-4 flex items-center text-sm text-gray-600 dark:text-gray-400">
                    <Shield className="h-4 w-4 mr-1" />
                    <span>Sistema protegido</span>
                  </div>
                </div>
              </div>

              {/* Uptime */}
              <div className="group relative overflow-hidden bg-white/70 dark:bg-gray-800/70 rounded-2xl shadow-xl backdrop-blur-sm border border-gray-200/50 dark:border-gray-700/50 p-6 hover:shadow-2xl transition-all duration-300 hover:-translate-y-1">
                <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/10 to-green-500/10 opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
                <div className="relative">
                  <div className="flex items-center justify-between mb-4">
                    <div className="p-3 bg-gradient-to-br from-emerald-500 to-green-600 rounded-xl shadow-lg">
                      <Clock className="h-6 w-6 text-white" />
                    </div>
                    <div className="px-3 py-1 bg-emerald-100 dark:bg-emerald-900/20 text-emerald-800 dark:text-emerald-200 rounded-full text-xs font-medium">
                      ONLINE
                    </div>
                  </div>
                  <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-1">
                    Uptime
                  </h3>
                  <p className="text-2xl font-bold text-gray-900 dark:text-white">
                    {formatUptime(metrics.summary?.uptime || 0)}
                  </p>
                  <div className="mt-4 flex items-center text-sm text-gray-600 dark:text-gray-400">
                    <Zap className="h-4 w-4 mr-1" />
                    <span>Alta disponibilidade</span>
                  </div>
                </div>
              </div>

              {/* Operações */}
              <div className="group relative overflow-hidden bg-white/70 dark:bg-gray-800/70 rounded-2xl shadow-xl backdrop-blur-sm border border-gray-200/50 dark:border-gray-700/50 p-6 hover:shadow-2xl transition-all duration-300 hover:-translate-y-1">
                <div className="absolute inset-0 bg-gradient-to-br from-purple-500/10 to-pink-500/10 opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
                <div className="relative">
                  <div className="flex items-center justify-between mb-4">
                    <div className="p-3 bg-gradient-to-br from-purple-500 to-pink-600 rounded-xl shadow-lg">
                      <Database className="h-6 w-6 text-white" />
                    </div>
                    <div className="px-3 py-1 bg-purple-100 dark:bg-purple-900/20 text-purple-800 dark:text-purple-200 rounded-full text-xs font-medium">
                      ATIVAS
                    </div>
                  </div>
                  <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-1">
                    Operações
                  </h3>
                  <p className="text-2xl font-bold text-gray-900 dark:text-white">
                    {metrics.redis?.operations || 0}
                  </p>
                  <div className="mt-4 flex items-center text-sm text-gray-600 dark:text-gray-400">
                    <BarChart3 className="h-4 w-4 mr-1" />
                    <span>Processamento ativo</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Métricas de Usuários */}
            {userStats && (
              <div className="space-y-6">
                <div className="flex items-center space-x-3">
                  <div className="p-2 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-lg">
                    <Users className="h-5 w-5 text-white" />
                  </div>
                  <h2 className="text-xl font-bold text-gray-900 dark:text-white">Métricas de Usuários</h2>
                  <div className="flex-1 h-px bg-gradient-to-r from-blue-500/50 to-transparent"></div>
                </div>
                
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                  {/* Total de Customers */}
                  <div className="group relative overflow-hidden bg-white/70 dark:bg-gray-800/70 rounded-2xl shadow-xl backdrop-blur-sm border border-gray-200/50 dark:border-gray-700/50 p-6 hover:shadow-2xl transition-all duration-300 hover:-translate-y-1">
                    <div className="absolute inset-0 bg-gradient-to-br from-blue-500/10 to-cyan-500/10 opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
                    <div className="relative">
                      <div className="flex items-center justify-between mb-4">
                        <div className="p-3 bg-gradient-to-br from-blue-500 to-cyan-600 rounded-xl shadow-lg">
                          <Users className="h-6 w-6 text-white" />
                        </div>
                        <div className="px-3 py-1 bg-blue-100 dark:bg-blue-900/20 text-blue-800 dark:text-blue-200 rounded-full text-xs font-medium">
                          TOTAL
                        </div>
                      </div>
                      <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-1">
                        Total de Customers
                      </h3>
                      <p className="text-3xl font-bold text-gray-900 dark:text-white">
                        {userStats.totalCustomers}
                      </p>
                      <div className="mt-4 flex items-center text-sm text-gray-600 dark:text-gray-400">
                        <Globe className="h-4 w-4 mr-1" />
                        <span>Usuários cadastrados</span>
                      </div>
                    </div>
                  </div>

                  {/* Customers Online */}
                  <div className="group relative overflow-hidden bg-white/70 dark:bg-gray-800/70 rounded-2xl shadow-xl backdrop-blur-sm border border-gray-200/50 dark:border-gray-700/50 p-6 hover:shadow-2xl transition-all duration-300 hover:-translate-y-1">
                    <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/10 to-green-500/10 opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
                    <div className="relative">
                      <div className="flex items-center justify-between mb-4">
                        <div className="p-3 bg-gradient-to-br from-emerald-500 to-green-600 rounded-xl shadow-lg">
                          <UserCheck className="h-6 w-6 text-white" />
                        </div>
                        <div className="px-3 py-1 bg-emerald-100 dark:bg-emerald-900/20 text-emerald-800 dark:text-emerald-200 rounded-full text-xs font-medium">
                          ONLINE
                        </div>
                      </div>
                      <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-1">
                        Customers Online
                      </h3>
                      <p className="text-3xl font-bold text-gray-900 dark:text-white">
                        {userStats.customersOnline}
                      </p>
                      <div className="mt-4 flex items-center text-sm text-gray-600 dark:text-gray-400">
                        <Zap className="h-4 w-4 mr-1" />
                        <span>Ativos agora</span>
                      </div>
                    </div>
                  </div>

                  {/* Total de Drivers */}
                  <div className="group relative overflow-hidden bg-white/70 dark:bg-gray-800/70 rounded-2xl shadow-xl backdrop-blur-sm border border-gray-200/50 dark:border-gray-700/50 p-6 hover:shadow-2xl transition-all duration-300 hover:-translate-y-1">
                    <div className="absolute inset-0 bg-gradient-to-br from-purple-500/10 to-violet-500/10 opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
                    <div className="relative">
                      <div className="flex items-center justify-between mb-4">
                        <div className="p-3 bg-gradient-to-br from-purple-500 to-violet-600 rounded-xl shadow-lg">
                          <Car className="h-6 w-6 text-white" />
                        </div>
                        <div className="px-3 py-1 bg-purple-100 dark:bg-purple-900/20 text-purple-800 dark:text-purple-200 rounded-full text-xs font-medium">
                          TOTAL
                        </div>
                      </div>
                      <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-1">
                        Total de Drivers
                      </h3>
                      <p className="text-3xl font-bold text-gray-900 dark:text-white">
                        {userStats.totalDrivers}
                      </p>
                      <div className="mt-4 flex items-center text-sm text-gray-600 dark:text-gray-400">
                        <Shield className="h-4 w-4 mr-1" />
                        <span>Motoristas cadastrados</span>
                      </div>
                    </div>
                  </div>

                  {/* Drivers Online */}
                  <div className="group relative overflow-hidden bg-white/70 dark:bg-gray-800/70 rounded-2xl shadow-xl backdrop-blur-sm border border-gray-200/50 dark:border-gray-700/50 p-6 hover:shadow-2xl transition-all duration-300 hover:-translate-y-1">
                    <div className="absolute inset-0 bg-gradient-to-br from-orange-500/10 to-red-500/10 opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
                    <div className="relative">
                      <div className="flex items-center justify-between mb-4">
                        <div className="p-3 bg-gradient-to-br from-orange-500 to-red-600 rounded-xl shadow-lg">
                          <UserCheck className="h-6 w-6 text-white" />
                        </div>
                        <div className="px-3 py-1 bg-orange-100 dark:bg-orange-900/20 text-orange-800 dark:text-orange-200 rounded-full text-xs font-medium">
                          ONLINE
                        </div>
                      </div>
                      <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-1">
                        Drivers Online
                      </h3>
                      <p className="text-3xl font-bold text-gray-900 dark:text-white">
                        {userStats.driversOnline}
                      </p>
                      <div className="mt-4 flex items-center text-sm text-gray-600 dark:text-gray-400">
                        <Activity className="h-4 w-4 mr-1" />
                        <span>Disponíveis agora</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Métricas Financeiras */}
            {financialStats && (
              <div className="space-y-6">
                <div className="flex items-center space-x-3">
                  <div className="p-2 bg-gradient-to-br from-emerald-500 to-green-600 rounded-lg">
                    <DollarSign className="h-5 w-5 text-white" />
                  </div>
                  <h2 className="text-xl font-bold text-gray-900 dark:text-white">Métricas Financeiras</h2>
                  <div className="flex-1 h-px bg-gradient-to-r from-emerald-500/50 to-transparent"></div>
                </div>
                
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                  {/* Receita Total */}
                  <div className="group relative overflow-hidden bg-white/70 dark:bg-gray-800/70 rounded-2xl shadow-xl backdrop-blur-sm border border-gray-200/50 dark:border-gray-700/50 p-6 hover:shadow-2xl transition-all duration-300 hover:-translate-y-1">
                    <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/10 to-green-500/10 opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
                    <div className="relative">
                      <div className="flex items-center justify-between mb-4">
                        <div className="p-3 bg-gradient-to-br from-emerald-500 to-green-600 rounded-xl shadow-lg">
                          <DollarSign className="h-6 w-6 text-white" />
                        </div>
                        <div className="px-3 py-1 bg-emerald-100 dark:bg-emerald-900/20 text-emerald-800 dark:text-emerald-200 rounded-full text-xs font-medium">
                          {financialStats.revenueGrowth}
                        </div>
                      </div>
                      <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-1">
                        Receita Total
                      </h3>
                      <p className="text-3xl font-bold text-gray-900 dark:text-white">
                        R$ {financialStats.totalRevenue.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                      </p>
                      <div className="mt-4 flex items-center text-sm text-gray-600 dark:text-gray-400">
                        <TrendingUp className="h-4 w-4 mr-1" />
                        <span>Crescimento constante</span>
                      </div>
                    </div>
                  </div>

                  {/* Lucro Total */}
                  <div className="group relative overflow-hidden bg-white/70 dark:bg-gray-800/70 rounded-2xl shadow-xl backdrop-blur-sm border border-gray-200/50 dark:border-gray-700/50 p-6 hover:shadow-2xl transition-all duration-300 hover:-translate-y-1">
                    <div className="absolute inset-0 bg-gradient-to-br from-blue-500/10 to-indigo-500/10 opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
                    <div className="relative">
                      <div className="flex items-center justify-between mb-4">
                        <div className="p-3 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-xl shadow-lg">
                          <Award className="h-6 w-6 text-white" />
                        </div>
                        <div className="px-3 py-1 bg-blue-100 dark:bg-blue-900/20 text-blue-800 dark:text-blue-200 rounded-full text-xs font-medium">
                          {financialStats.profitGrowth}
                        </div>
                      </div>
                      <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-1">
                        Lucro Total
                      </h3>
                      <p className="text-3xl font-bold text-gray-900 dark:text-white">
                        R$ {financialStats.totalProfit.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                      </p>
                      <div className="mt-4 flex items-center text-sm text-gray-600 dark:text-gray-400">
                        <Percent className="h-4 w-4 mr-1" />
                        <span>{financialStats.profitMargin}% de margem</span>
                      </div>
                    </div>
                  </div>

                  {/* Total de Corridas */}
                  <div className="group relative overflow-hidden bg-white/70 dark:bg-gray-800/70 rounded-2xl shadow-xl backdrop-blur-sm border border-gray-200/50 dark:border-gray-700/50 p-6 hover:shadow-2xl transition-all duration-300 hover:-translate-y-1">
                    <div className="absolute inset-0 bg-gradient-to-br from-purple-500/10 to-pink-500/10 opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
                    <div className="relative">
                      <div className="flex items-center justify-between mb-4">
                        <div className="p-3 bg-gradient-to-br from-purple-500 to-pink-600 rounded-xl shadow-lg">
                          <Car className="h-6 w-6 text-white" />
                        </div>
                        <div className="px-3 py-1 bg-purple-100 dark:bg-purple-900/20 text-purple-800 dark:text-purple-200 rounded-full text-xs font-medium">
                          {financialStats.tripsGrowth}
                        </div>
                      </div>
                      <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-1">
                        Total de Corridas
                      </h3>
                      <p className="text-3xl font-bold text-gray-900 dark:text-white">
                        {financialStats.totalTrips.toLocaleString('pt-BR')}
                      </p>
                      <div className="mt-4 flex items-center text-sm text-gray-600 dark:text-gray-400">
                        <Target className="h-4 w-4 mr-1" />
                        <span>Média: R$ {financialStats.averageTripValue.toFixed(2)}</span>
                      </div>
                    </div>
                  </div>

                  {/* Custo Operacional */}
                  <div className="group relative overflow-hidden bg-white/70 dark:bg-gray-800/70 rounded-2xl shadow-xl backdrop-blur-sm border border-gray-200/50 dark:border-gray-700/50 p-6 hover:shadow-2xl transition-all duration-300 hover:-translate-y-1">
                    <div className="absolute inset-0 bg-gradient-to-br from-orange-500/10 to-red-500/10 opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
                    <div className="relative">
                      <div className="flex items-center justify-between mb-4">
                        <div className="p-3 bg-gradient-to-br from-orange-500 to-red-600 rounded-xl shadow-lg">
                          <TrendingDown className="h-6 w-6 text-white" />
                        </div>
                        <div className="px-3 py-1 bg-orange-100 dark:bg-orange-900/20 text-orange-800 dark:text-orange-200 rounded-full text-xs font-medium">
                          {financialStats.costPercentage}%
                        </div>
                      </div>
                      <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-1">
                        Custo Operacional
                      </h3>
                      <p className="text-3xl font-bold text-gray-900 dark:text-white">
                        R$ {financialStats.totalCosts.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                      </p>
                      <div className="mt-4 flex items-center text-sm text-gray-600 dark:text-gray-400">
                        <BarChart3 className="h-4 w-4 mr-1" />
                        <span>Porcentagem da receita</span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Métricas de Hoje */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  {/* Receita de Hoje */}
                  <div className="bg-white/70 dark:bg-gray-800/70 rounded-2xl shadow-xl backdrop-blur-sm border border-gray-200/50 dark:border-gray-700/50 p-6">
                    <div className="flex items-center space-x-3 mb-4">
                      <div className="p-2 bg-gradient-to-br from-emerald-500 to-green-600 rounded-lg">
                        <DollarSign className="h-5 w-5 text-white" />
                      </div>
                      <h3 className="text-lg font-bold text-gray-900 dark:text-white">
                        Receita de Hoje
                      </h3>
                    </div>
                    <p className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
                      R$ {financialStats.todayRevenue.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                    </p>
                    <p className="text-sm text-gray-600 dark:text-gray-400">
                      {financialStats.todayTrips} corridas • Média: R$ {financialStats.todayAverageTrip.toFixed(2)}
                    </p>
                  </div>

                  {/* Lucro de Hoje */}
                  <div className="bg-white/70 dark:bg-gray-800/70 rounded-2xl shadow-xl backdrop-blur-sm border border-gray-200/50 dark:border-gray-700/50 p-6">
                    <div className="flex items-center space-x-3 mb-4">
                      <div className="p-2 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-lg">
                        <Award className="h-5 w-5 text-white" />
                      </div>
                      <h3 className="text-lg font-bold text-gray-900 dark:text-white">
                        Lucro de Hoje
                      </h3>
                    </div>
                    <p className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
                      R$ {financialStats.todayProfit.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                    </p>
                    <p className="text-sm text-gray-600 dark:text-gray-400">
                      Margem: {((financialStats.todayProfit / financialStats.todayRevenue) * 100).toFixed(1)}%
                    </p>
                  </div>

                  {/* Corridas de Hoje */}
                  <div className="bg-white/70 dark:bg-gray-800/70 rounded-2xl shadow-xl backdrop-blur-sm border border-gray-200/50 dark:border-gray-700/50 p-6">
                    <div className="flex items-center space-x-3 mb-4">
                      <div className="p-2 bg-gradient-to-br from-purple-500 to-pink-600 rounded-lg">
                        <Car className="h-5 w-5 text-white" />
                      </div>
                      <h3 className="text-lg font-bold text-gray-900 dark:text-white">
                        Corridas de Hoje
                      </h3>
                    </div>
                    <p className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
                      {financialStats.todayTrips}
                    </p>
                    <p className="text-sm text-gray-600 dark:text-gray-400">
                      Média por hora: {(financialStats.todayTrips / 24).toFixed(1)}
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* Métricas Detalhadas */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
              {/* Performance */}
              <div className="bg-white/70 dark:bg-gray-800/70 rounded-2xl shadow-xl backdrop-blur-sm border border-gray-200/50 dark:border-gray-700/50 p-6">
                <div className="flex items-center space-x-3 mb-6">
                  <div className="p-2 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-lg">
                    <BarChart3 className="h-5 w-5 text-white" />
                  </div>
                  <h3 className="text-lg font-bold text-gray-900 dark:text-white">
                    Performance de Latência
                  </h3>
                </div>
                <div className="space-y-4">
                  <div className="flex justify-between items-center p-4 bg-gray-50/50 dark:bg-gray-700/50 rounded-xl">
                    <div className="flex items-center space-x-3">
                      <div className="w-3 h-3 bg-blue-500 rounded-full"></div>
                      <span className="text-gray-700 dark:text-gray-300">Latência do Redis:</span>
                    </div>
                    <span className="font-semibold text-gray-900 dark:text-white">
                      {(metrics.redis?.latency || 0).toFixed(2)}ms
                    </span>
                  </div>
                  <div className="flex justify-between items-center p-4 bg-gray-50/50 dark:bg-gray-700/50 rounded-xl">
                    <div className="flex items-center space-x-3">
                      <div className="w-3 h-3 bg-emerald-500 rounded-full"></div>
                      <span className="text-gray-700 dark:text-gray-300">Conexões Redis:</span>
                    </div>
                    <span className="font-semibold text-gray-900 dark:text-white">
                      {metrics.redis?.connections || 0}
                    </span>
                  </div>
                  <div className="flex justify-between items-center p-4 bg-gray-50/50 dark:bg-gray-700/50 rounded-xl">
                    <div className="flex items-center space-x-3">
                      <div className="w-3 h-3 bg-red-500 rounded-full"></div>
                      <span className="text-gray-700 dark:text-gray-300">Erros Redis:</span>
                    </div>
                    <span className="font-semibold text-gray-900 dark:text-white">
                      {metrics.redis?.errors || 0}
                    </span>
                  </div>
                </div>
              </div>

              {/* Recursos do Sistema */}
              <div className="bg-white/70 dark:bg-gray-800/70 rounded-2xl shadow-xl backdrop-blur-sm border border-gray-200/50 dark:border-gray-700/50 p-6">
                <div className="flex items-center space-x-3 mb-6">
                  <div className="p-2 bg-gradient-to-br from-purple-500 to-pink-600 rounded-lg">
                    <Cpu className="h-5 w-5 text-white" />
                  </div>
                  <h3 className="text-lg font-bold text-gray-900 dark:text-white">
                    Recursos do Sistema
                  </h3>
                </div>
                <div className="space-y-4">
                  <div className="flex justify-between items-center p-4 bg-gray-50/50 dark:bg-gray-700/50 rounded-xl">
                    <div className="flex items-center space-x-3">
                      <div className="w-3 h-3 bg-purple-500 rounded-full"></div>
                      <span className="text-gray-700 dark:text-gray-300">Container Status:</span>
                    </div>
                    <span className={`font-semibold ${getStatusColor(metrics.container?.status || 'unknown')}`}>
                      {(metrics.container?.status || 'unknown').toUpperCase()}
                    </span>
                  </div>
                  <div className="flex justify-between items-center p-4 bg-gray-50/50 dark:bg-gray-700/50 rounded-xl">
                    <div className="flex items-center space-x-3">
                      <div className="w-3 h-3 bg-blue-500 rounded-full"></div>
                      <span className="text-gray-700 dark:text-gray-300">CPU Usage:</span>
                    </div>
                    <span className="font-semibold text-gray-900 dark:text-white">
                      {(metrics.container?.cpu || 0).toFixed(2)}%
                    </span>
                  </div>
                  <div className="flex justify-between items-center p-4 bg-gray-50/50 dark:bg-gray-700/50 rounded-xl">
                    <div className="flex items-center space-x-3">
                      <div className="w-3 h-3 bg-green-500 rounded-full"></div>
                      <span className="text-gray-700 dark:text-gray-300">Memory Usage:</span>
                    </div>
                    <span className="font-semibold text-gray-900 dark:text-white">
                      {(metrics.container?.memory?.percentage || 0).toFixed(1)}%
                    </span>
                  </div>
                  <div className="flex justify-between items-center p-4 bg-gray-50/50 dark:bg-gray-700/50 rounded-xl">
                    <div className="flex items-center space-x-3">
                      <div className="w-3 h-3 bg-red-500 rounded-full"></div>
                      <span className="text-gray-700 dark:text-gray-300">Redis Status:</span>
                    </div>
                    <span className={`font-semibold ${metrics.redis?.status === 'connected' ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
                      {metrics.redis?.status === 'connected' ? 'Conectado' : 'Desconectado'}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* Gráficos (placeholder) */}
            <div className="bg-white/70 dark:bg-gray-800/70 rounded-2xl shadow-xl backdrop-blur-sm border border-gray-200/50 dark:border-gray-700/50 p-6">
              <div className="flex items-center space-x-3 mb-6">
                <div className="p-2 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-lg">
                  <BarChart3 className="h-5 w-5 text-white" />
                </div>
                <h3 className="text-lg font-bold text-gray-900 dark:text-white">
                  Gráficos de Performance
                </h3>
              </div>
              <div className="h-64 bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-700 dark:to-gray-800 rounded-xl flex items-center justify-center border-2 border-dashed border-gray-300 dark:border-gray-600">
                <div className="text-center">
                  <BarChart3 className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                  <p className="text-gray-500 dark:text-gray-400 font-medium">
                    Gráficos serão implementados aqui
                  </p>
                  <p className="text-sm text-gray-400 dark:text-gray-500 mt-1">
                    Visualizações em tempo real
                  </p>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="text-center py-12">
            <div className="w-20 h-20 bg-gray-100 dark:bg-gray-800 rounded-full flex items-center justify-center mx-auto mb-6">
              <Database className="h-10 w-10 text-gray-400" />
            </div>
            <p className="text-gray-500 dark:text-gray-400 text-lg">Nenhum dado disponível</p>
            <p className="text-gray-400 dark:text-gray-500 text-sm mt-2">Verifique a conexão com o servidor</p>
          </div>
        )}
      </main>
    </div>
  );
};

export default Dashboard; 