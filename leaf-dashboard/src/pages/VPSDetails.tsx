import React, { useState, useEffect } from 'react'
import { useParams } from 'react-router-dom'
import { 
  Server, 
  Cpu, 
  HardDrive, 
  Activity,
  Wifi,
  Clock,
  AlertTriangle,
  CheckCircle,
  XCircle
} from 'lucide-react'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar } from 'recharts'

interface VPSData {
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
}

const VPSDetails: React.FC = () => {
  const { id } = useParams<{ id: string }>()
  const [vpsData, setVpsData] = useState<VPSData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // Simular dados do VPS
    const mockData: VPSData = {
      id: id || 'vultr',
      name: id === 'vultr' ? 'VPS 01 (Vultr)' : 'VPS 02 (Hostinger)',
      provider: id === 'vultr' ? 'Vultr' : 'Hostinger',
      location: id === 'vultr' ? 'São Paulo, BR' : 'São Paulo, BR',
      ip: id === 'vultr' ? '216.238.107.59' : '147.93.66.253',
      status: 'online',
      uptime: '15d 8h 32m',
      cpu: 23,
      memory: 67,
      disk: 45,
      network: 12,
      processes: 156,
      loadAverage: [0.45, 0.52, 0.48]
    }

    setTimeout(() => {
      setVpsData(mockData)
      setLoading(false)
    }, 1000)
  }, [id])

  const performanceData = [
    { time: '00:00', cpu: 23, memory: 67, disk: 45, network: 12 },
    { time: '04:00', cpu: 18, memory: 52, disk: 42, network: 8 },
    { time: '08:00', cpu: 45, memory: 78, disk: 48, network: 25 },
    { time: '12:00', cpu: 67, memory: 89, disk: 52, network: 42 },
    { time: '16:00', cpu: 34, memory: 65, disk: 47, network: 18 },
    { time: '20:00', cpu: 28, memory: 58, disk: 44, network: 15 },
    { time: '23:59', cpu: 23, memory: 67, disk: 45, network: 12 },
  ]

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

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
      </div>
    )
  }

  if (!vpsData) {
    return <div>VPS não encontrado</div>
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">{vpsData.name}</h1>
          <p className="text-gray-600 mt-2">{vpsData.provider} • {vpsData.location}</p>
        </div>
        <div className="flex items-center space-x-3">
          {getStatusIcon(vpsData.status)}
          <span className={`status-indicator ${vpsData.status === 'online' ? 'status-online' : 'status-offline'}`}>
            {vpsData.status === 'online' ? 'Online' : 'Offline'}
          </span>
        </div>
      </div>

      {/* Info Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <div className="card">
          <div className="flex items-center space-x-3">
            <Cpu className="h-8 w-8 text-primary-600" />
            <div>
              <p className="text-sm text-gray-600">CPU</p>
              <p className="text-2xl font-bold text-gray-900">{vpsData.cpu}%</p>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="flex items-center space-x-3">
            <Activity className="h-8 w-8 text-success-600" />
            <div>
              <p className="text-sm text-gray-600">Memória</p>
              <p className="text-2xl font-bold text-gray-900">{vpsData.memory}%</p>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="flex items-center space-x-3">
            <HardDrive className="h-8 w-8 text-warning-600" />
            <div>
              <p className="text-sm text-gray-600">Disco</p>
              <p className="text-2xl font-bold text-gray-900">{vpsData.disk}%</p>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="flex items-center space-x-3">
            <Wifi className="h-8 w-8 text-danger-600" />
            <div>
              <p className="text-sm text-gray-600">Rede</p>
              <p className="text-2xl font-bold text-gray-900">{vpsData.network} MB/s</p>
            </div>
          </div>
        </div>
      </div>

      {/* Performance Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <div className="card">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">CPU e Memória (24h)</h3>
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={performanceData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="time" />
              <YAxis />
              <Tooltip />
              <Line type="monotone" dataKey="cpu" stroke="#0ea5e9" strokeWidth={2} />
              <Line type="monotone" dataKey="memory" stroke="#22c55e" strokeWidth={2} />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div className="card">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Disco e Rede (24h)</h3>
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={performanceData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="time" />
              <YAxis />
              <Tooltip />
              <Line type="monotone" dataKey="disk" stroke="#f59e0b" strokeWidth={2} />
              <Line type="monotone" dataKey="network" stroke="#ef4444" strokeWidth={2} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* System Info */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <div className="card">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Informações do Sistema</h3>
          <div className="space-y-4">
            <div className="flex justify-between">
              <span className="text-gray-600">IP Address:</span>
              <span className="font-medium">{vpsData.ip}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-600">Uptime:</span>
              <span className="font-medium">{vpsData.uptime}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-600">Processos:</span>
              <span className="font-medium">{vpsData.processes}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-600">Load Average:</span>
              <span className="font-medium">{vpsData.loadAverage.join(', ')}</span>
            </div>
          </div>
        </div>

        <div className="card">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Load Average</h3>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={[
              { period: '1 min', value: vpsData.loadAverage[0] },
              { period: '5 min', value: vpsData.loadAverage[1] },
              { period: '15 min', value: vpsData.loadAverage[2] }
            ]}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="period" />
              <YAxis />
              <Tooltip />
              <Bar dataKey="value" fill="#0ea5e9" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  )
}

export default VPSDetails 