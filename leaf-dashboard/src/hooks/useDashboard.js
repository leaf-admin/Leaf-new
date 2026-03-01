import { useState, useEffect } from 'react'
import { leafAPI } from '../services/api'
import { useWebSocketMetrics } from './useWebSocketMetrics'

// Custom hook for dashboard stats
// Agora usa WebSocket em tempo real com fallback para polling
export function useDashboardStats() {
  const [stats, setStats] = useState({
    users: null,
    rides: null,
    revenue: null,
    conversion: null
  })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  // ✅ NOVO: WebSocket em tempo real
  const { metrics: wsMetrics, connected: wsConnected } = useWebSocketMetrics()

  // Atualizar stats quando receber dados do WebSocket
  useEffect(() => {
    if (wsMetrics && wsConnected) {
      setStats(prevStats => ({
        users: wsMetrics.users || prevStats.users,
        rides: wsMetrics.rides || prevStats.rides,
        revenue: wsMetrics.revenue || prevStats.revenue,
        conversion: wsMetrics.conversion || prevStats.conversion
      }))
      setLoading(false)
    }
  }, [wsMetrics, wsConnected])

  // Fallback: Polling HTTP se WebSocket não estiver conectado
  useEffect(() => {
    let isFirstLoad = true
    let mounted = true

    if (wsConnected) {
      // WebSocket conectado, não precisa de polling
      return
    }

    const fetchStats = async () => {
      try {
        // Só seta loading na primeira carga, não nas atualizações
        if (isFirstLoad && mounted) {
          setLoading(true)
        }
        setError(null)
        const data = await leafAPI.getDashboardStats()
        if (mounted) {
          setStats(data)
          if (isFirstLoad) {
            setLoading(false)
            isFirstLoad = false
          }
        }
      } catch (err) {
        if (mounted) {
          setError(err instanceof Error ? err.message : 'Failed to fetch stats')
          if (isFirstLoad) {
            setLoading(false)
            isFirstLoad = false
          }
        }
      }
    }

    fetchStats()
    
    // Refresh every 30 seconds (fallback quando WebSocket não está disponível)
    const interval = setInterval(fetchStats, 30000)
    return () => {
      mounted = false
      clearInterval(interval)
    }
  }, [wsConnected])

  return { 
    stats, 
    loading, 
    error, 
    wsConnected, // ✅ NOVO: Indicador de conexão WebSocket
    refetch: () => {
      const fetchStats = async () => {
        try {
          setLoading(true)
          setError(null)
          const data = await leafAPI.getDashboardStats()
          setStats(data)
        } catch (err) {
          setError(err instanceof Error ? err.message : 'Failed to fetch stats')
        } finally {
          setLoading(false)
        }
      }
      fetchStats()
    }
  }
}

// Custom hook for KYC stats
export function useKYCStats() {
  const [kycStats, setKycStats] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    let isFirstLoad = true
    let mounted = true

    const fetchKYCStats = async () => {
      try {
        // Só seta loading na primeira carga
        if (isFirstLoad && mounted) {
          setLoading(true)
        }
        setError(null)
        const data = await leafAPI.getKYCStats()
        if (mounted) {
          setKycStats(data)
          if (isFirstLoad) {
            setLoading(false)
            isFirstLoad = false
          }
        }
      } catch (err) {
        if (mounted) {
          setError(err instanceof Error ? err.message : 'Failed to fetch KYC stats')
          if (isFirstLoad) {
            setLoading(false)
            isFirstLoad = false
          }
        }
      }
    }

    fetchKYCStats()
    
    // Refresh every 15 seconds for real-time KYC updates
    const interval = setInterval(fetchKYCStats, 15000)
    return () => {
      mounted = false
      clearInterval(interval)
    }
  }, [])

  return { kycStats, loading, error, refetch: () => {
    const fetchKYCStats = async () => {
      try {
        setLoading(true)
        setError(null)
        const data = await leafAPI.getKYCStats()
        setKycStats(data)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to fetch KYC stats')
      } finally {
        setLoading(false)
      }
    }
    fetchKYCStats()
  }}
}

// Custom hook for system status
export function useSystemStatus() {
  const [systemStatus, setSystemStatus] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    let isFirstLoad = true
    let mounted = true

    const fetchSystemStatus = async () => {
      try {
        // Só seta loading na primeira carga
        if (isFirstLoad && mounted) {
          setLoading(true)
        }
        setError(null)
        const data = await leafAPI.getSystemStatus()
        if (mounted) {
          setSystemStatus(data)
          if (isFirstLoad) {
            setLoading(false)
            isFirstLoad = false
          }
        }
      } catch (err) {
        if (mounted) {
          setError(err instanceof Error ? err.message : 'Failed to fetch system status')
          if (isFirstLoad) {
            setLoading(false)
            isFirstLoad = false
          }
        }
      }
    }

    fetchSystemStatus()
    
    // Refresh every 10 seconds for real-time system monitoring
    const interval = setInterval(fetchSystemStatus, 10000)
    return () => {
      mounted = false
      clearInterval(interval)
    }
  }, [])

  return { systemStatus, loading, error, refetch: () => {
    const fetchSystemStatus = async () => {
      try {
        setLoading(true)
        setError(null)
        const data = await leafAPI.getSystemStatus()
        setSystemStatus(data)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to fetch system status')
      } finally {
        setLoading(false)
      }
    }
    fetchSystemStatus()
  }}
}

// Custom hook for recent activity
export function useRecentActivity() {
  const [activities, setActivities] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    let isFirstLoad = true
    let mounted = true

    const fetchActivities = async () => {
      try {
        // Só seta loading na primeira carga
        if (isFirstLoad && mounted) {
          setLoading(true)
        }
        setError(null)
        const data = await leafAPI.getRecentActivity()
        if (mounted) {
          setActivities(data)
          if (isFirstLoad) {
            setLoading(false)
            isFirstLoad = false
          }
        }
      } catch (err) {
        if (mounted) {
          setError(err instanceof Error ? err.message : 'Failed to fetch activities')
          if (isFirstLoad) {
            setLoading(false)
            isFirstLoad = false
          }
        }
      }
    }

    fetchActivities()
    
    // Refresh every 20 seconds for real-time activity updates
    const interval = setInterval(fetchActivities, 20000)
    return () => {
      mounted = false
      clearInterval(interval)
    }
  }, [])

  return { activities, loading, error }
}

// Custom hook for real-time updates
export function useRealTimeUpdates() {
  const [lastUpdate, setLastUpdate] = useState(new Date())

  useEffect(() => {
    const interval = setInterval(() => {
      setLastUpdate(new Date())
    }, 1000)

    return () => clearInterval(interval)
  }, [])

  const formatLastUpdate = (date) => {
    const now = new Date()
    const diff = Math.floor((now - date) / 1000)
    
    if (diff < 60) return `${diff}s atrás`
    if (diff < 3600) return `${Math.floor(diff / 60)}min atrás`
    return `${Math.floor(diff / 3600)}h atrás`
  }

  return { lastUpdate, formatLastUpdate }
}

// Custom hook for driver search metrics (rota opcional)
export function useDriverSearchMetrics(timeframe = '7d') {
  const [metrics, setMetrics] = useState(null)
  const [loading, setLoading] = useState(false) // Não mostrar loading para rota opcional
  const [error, setError] = useState(null)

  useEffect(() => {
    const fetchMetrics = async () => {
      try {
        setError(null)
        const data = await leafAPI.getDriverSearchMetrics(timeframe)
        setMetrics(data)
      } catch (err) {
        // Não mostrar erro para rota opcional
        setMetrics({
          totalSearches: 0,
          successfulSearches: 0,
          successRate: 0,
          averageSearchTime: 0
        })
      }
    }

    fetchMetrics()
  }, [timeframe])

  return { metrics, loading, error }
}

// Custom hook for monitoring services
export function useMonitoringServices(service, timeframe = '1h') {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true)
        setError(null)
        const result = await leafAPI.getMonitoringServices(service, timeframe)
        setData(result)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to fetch monitoring data')
      } finally {
        setLoading(false)
      }
    }

    fetchData()
  }, [service, timeframe])

  return { data, loading, error }
}

// Custom hook for alerts
export function useAlerts(severity, limit, acknowledged) {
  const [alerts, setAlerts] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const fetchAlerts = async () => {
    try {
      setLoading(true)
      setError(null)
      const result = await leafAPI.getAlerts(severity, limit, acknowledged)
      setAlerts(result)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch alerts')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchAlerts()
  }, [severity, limit, acknowledged])

  return { alerts, loading, error, refetch: fetchAlerts }
}

// Custom hook for alerts stats
export function useAlertsStats() {
  const [stats, setStats] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    const fetchStats = async () => {
      try {
        setLoading(true)
        setError(null)
        const data = await leafAPI.getAlertsStats()
        setStats(data)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to fetch alerts stats')
      } finally {
        setLoading(false)
      }
    }

    fetchStats()
  }, [])

  return { stats, loading, error }
}

// Custom hook for queue metrics
export function useQueueMetrics(hours = 1) {
  const [status, setStatus] = useState(null)
  const [metrics, setMetrics] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true)
        setError(null)
        const [queueStatus, queueMetrics] = await Promise.all([
          leafAPI.getQueueStatus(),
          leafAPI.getQueueMetrics(hours)
        ])
        setStatus(queueStatus.status)
        setMetrics(queueMetrics)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to fetch queue data')
      } finally {
        setLoading(false)
      }
    }

    fetchData()
  }, [hours])

  return { status, metrics, loading, error }
}


