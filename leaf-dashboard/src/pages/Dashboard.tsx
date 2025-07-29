import React, { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { 
  Server, 
  Database, 
  Zap, 
  Flame,
  TrendingUp,
  TrendingDown,
  Activity,
  AlertTriangle,
  CheckCircle,
  XCircle
} from 'lucide-react'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, AreaChart, Area } from 'recharts'
import apiService from '../services/api'
import webSocketService from '../services/websocket'

interface SystemStatus {
  id: string
  name: string
  status: 'online' | 'offline' | 'warning'
  uptime: string
  cpu: number
  memory: number
  disk: number
  network: number
}

interface MetricCardProps {
  title: string
  value: string | number
  change?: number
  icon: React.ReactNode
  color: string
}

const MetricCard: React.FC<MetricCardProps> = ({ title, value, change, icon, color }) => (
  <div className="card">
    <div className="flex items-center justify-between">
      <div>
        <p className="text-sm font-medium text-gray-600">{title}</p>
        <p className="text-2xl font-bold text-gray-900">{value}</p>
        {change !== undefined && (
          <div className="flex items-center mt-1">
            {change >= 0 ? (
              <TrendingUp className="h-4 w-4 text-success-600" />
            ) : (
              <TrendingDown className="h-4 w-4 text-danger-600" />
            )}
            <span className={`text-sm ml-1 ${change >= 0 ? 'text-success-600' : 'text-danger-600'}`}>
              {Math.abs(change)}%
            </span>
          </div>
        )}
      </div>
      <div className={`p-3 rounded-lg ${color}`}>
        {icon}
      </div>
    </div>
  </div>
)

const Dashboard: React.FC = () => {
  const [systems, setSystems] = useState<SystemStatus[]>([])
  const [overview, setOverview] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [performanceData, setPerformanceData] = useState<any[]>([])

  useEffect(() => {
    // Conectar WebSocket para atualizações em tempo real
    webSocketService.connect()
    
    // Configurar listeners do WebSocket
    webSocketService.onMetrics((data) => {
      console.log('Métricas atualizadas:', data)
      // Atualizar dados em tempo real
    })

    webSocketService.onError((error) => {
      console.error('Erro no WebSocket:', error)
    })

    // Carregar dados iniciais
    loadDashboardData()

    // Atualizar dados a cada 30 segundos
    const interval = setInterval(loadDashboardData, 30000)

    return () => {
      clearInterval(interval)
      webSocketService.disconnect()
    }
  }, [])

  const loadDashboardData = async () => {
    try {
      setLoading(true)
      
      // Carregar overview do dashboard
      const overviewData = await apiService.getDashboardOverview()
      setOverview(overviewData)

      // Carregar métricas dos VPS
      const vultrMetrics = await apiService.getVPSMetrics('vultr')
      const hostingerMetrics = await apiService.getVPSMetrics('hostinger')

      // Carregar métricas do Redis
      const redisMetrics = await apiService.getRedisMetrics()

      // Carregar métricas do WebSocket
      const websocketMetrics = await apiService.getWebSocketMetrics()

      // Carregar métricas do Firebase
      const firebaseMetrics = await apiService.getFirebaseMetrics()

      // Montar array de sistemas
      const systemsData: SystemStatus[] = [
        {
          id: 'vultr',
          name: 'VPS 01 (Vultr)',
          status: vultrMetrics.status,
          uptime: vultrMetrics.uptime,
          cpu: vultrMetrics.cpu,
          memory: vultrMetrics.memory,
          disk: vultrMetrics.disk,
          network: vultrMetrics.network
        },
        {
          id: 'hostinger',
          name: 'VPS 02 (Hostinger)',
          status: hostingerMetrics.status,
          uptime: hostingerMetrics.uptime,
          cpu: hostingerMetrics.cpu,
          memory: hostingerMetrics.memory,
          disk: hostingerMetrics.disk,
          network: hostingerMetrics.network
        },
        {
          id: 'redis',
          name: 'Redis',
          status: redisMetrics.connections > 0 ? 'online' : 'offline',
          uptime: '15d 8h 32m', // Será calculado
          cpu: 5,
          memory: redisMetrics.memory.used,
          disk: 12,
          network: 3
        },
        {
          id: 'websocket',
          name: 'WebSocket',
          status: websocketMetrics.connections > 0 ? 'online' : 'offline',
          uptime: '15d 8h 32m', // Será calculado
          cpu: 8,
          memory: 34,
          disk: 15,
          network: websocketMetrics.messagesPerSec
        },
        {
          id: 'firebase',
          name: 'Firebase',
          status: firebaseMetrics.errors < 10 ? 'online' : 'warning',
          uptime: '15d 8h 32m', // Será calculado
          cpu: 12,
          memory: 28,
          disk: 22,
          network: firebaseMetrics.functions.executions
        }
      ]

      setSystems(systemsData)

      // Carregar dados de performance
      const performance = await apiService.getVPSPerformance('vultr', '24h')
      setPerformanceData(performance)

    } catch (error) {
      console.error('Erro ao carregar dados do dashboard:', error)
    } finally {
      setLoading(false)
    }
  }

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'online':
        return <CheckCircle className="h-5 w-5 text-success-600" />
      case 'warning':
        return <AlertTriangle className="h-5 w-5 text-warning-600" />
      case 'offline':
        return <XCircle className="h-5 w-5 text-danger-600" />
      default:
        return <Activity className="h-5 w-5 text-gray-600" />
    }
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'online':
        return 'status-online'
      case 'warning':
        return 'status-warning'
      case 'offline':
        return 'status-offline'
      default:
        return 'status-offline'
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
      </div>
    )
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Dashboard</h1>
        <p className="text-gray-600 mt-2">Visão geral do sistema Leaf App</p>
      </div>

      {/* Metrics Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <MetricCard
          title="Total de VPS"
          value="2"
          change={0}
          icon={<Server className="h-6 w-6 text-white" />}
          color="bg-primary-600"
        />
        <MetricCard
          title="Uptime Médio"
          value={overview?.systems?.vps?.uptime || "N/A"}
          change={2.1}
          icon={<Activity className="h-6 w-6 text-white" />}
          color="bg-success-600"
        />
        <MetricCard
          title="CPU Médio"
          value={`${overview?.systems?.vps?.cpu || 0}%`}
          change={-1.2}
          icon={<TrendingUp className="h-6 w-6 text-white" />}
          color="bg-warning-600"
        />
        <MetricCard
          title="Memória Média"
          value={`${overview?.systems?.vps?.memory || 0}%`}
          change={0.8}
          icon={<Database className="h-6 w-6 text-white" />}
          color="bg-danger-600"
        />
      </div>

      {/* Performance Chart */}
      <div className="card">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Performance das Últimas 24h</h3>
        <ResponsiveContainer width="100%" height={300}>
          <AreaChart data={performanceData}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="time" />
            <YAxis />
            <Tooltip />
            <Area type="monotone" dataKey="cpu" stackId="1" stroke="#0ea5e9" fill="#0ea5e9" fillOpacity={0.3} />
            <Area type="monotone" dataKey="memory" stackId="1" stroke="#22c55e" fill="#22c55e" fillOpacity={0.3} />
            <Area type="monotone" dataKey="network" stackId="1" stroke="#f59e0b" fill="#f59e0b" fillOpacity={0.3} />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* Systems Status */}
      <div className="card">
        <h3 className="text-lg font-semibold text-gray-900 mb-6">Status dos Sistemas</h3>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {systems.map((system) => (
            <Link
              key={system.id}
              to={`/${system.id === 'vultr' || system.id === 'hostinger' ? 'vps' : system.id}/${system.id}`}
              className="block"
            >
              <div className="border border-gray-200 rounded-lg p-6 hover:shadow-md transition-shadow">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center space-x-3">
                    {getStatusIcon(system.status)}
                    <div>
                      <h4 className="text-lg font-semibold text-gray-900">{system.name}</h4>
                      <span className={`status-indicator ${getStatusColor(system.status)}`}>
                        {system.status === 'online' ? 'Online' : system.status === 'warning' ? 'Atenção' : 'Offline'}
                      </span>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-sm text-gray-600">Uptime</p>
                    <p className="text-sm font-medium text-gray-900">{system.uptime}</p>
                  </div>
                </div>
                
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-xs text-gray-600">CPU</p>
                    <p className="text-sm font-medium text-gray-900">{system.cpu}%</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-600">Memória</p>
                    <p className="text-sm font-medium text-gray-900">{system.memory}%</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-600">Disco</p>
                    <p className="text-sm font-medium text-gray-900">{system.disk}%</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-600">Rede</p>
                    <p className="text-sm font-medium text-gray-900">{system.network} MB/s</p>
                  </div>
                </div>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </div>
  )
}

export default Dashboard 