// Hook para métricas em tempo real via WebSocket

import { useState, useEffect, useCallback } from 'react'
import { wsService } from '../services/websocket-service'
import { useAuth } from '../contexts/AuthContext'

/**
 * Hook para conectar ao WebSocket e receber métricas em tempo real
 */
export function useWebSocketMetrics() {
  const { user } = useAuth()
  const [metrics, setMetrics] = useState(null)
  const [connected, setConnected] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!user) {
      return
    }

    let mounted = true

    const connect = async () => {
      try {
        setError(null)
        await wsService.connect()
        
        if (!mounted) return
        setConnected(true)

        // Escutar atualizações de métricas
        const handleMetricsUpdate = (data) => {
          if (mounted) {
            setMetrics(data)
          }
        }

        const handleUsersStatsUpdate = (data) => {
          if (mounted) {
            setMetrics(prev => ({
              ...prev,
              users: data
            }))
          }
        }

        const handleRidesStatsUpdate = (data) => {
          if (mounted) {
            setMetrics(prev => ({
              ...prev,
              rides: data
            }))
          }
        }

        const handleRevenueStatsUpdate = (data) => {
          if (mounted) {
            setMetrics(prev => ({
              ...prev,
              revenue: data
            }))
          }
        }

        const handleSystemStatusUpdate = (data) => {
          if (mounted) {
            setMetrics(prev => ({
              ...prev,
              system: data
            }))
          }
        }

        const handleActivityNew = (data) => {
          if (mounted) {
            setMetrics(prev => ({
              ...prev,
              activity: prev?.activity ? [data, ...prev.activity.slice(0, 9)] : [data]
            }))
          }
        }

        const handleDisconnect = () => {
          if (mounted) {
            setConnected(false)
          }
        }

        const handleConnect = () => {
          if (mounted) {
            setConnected(true)
            setError(null)
          }
        }

        // Registrar listeners
        wsService.on('metrics:updated', handleMetricsUpdate)
        wsService.on('users:stats:updated', handleUsersStatsUpdate)
        wsService.on('rides:stats:updated', handleRidesStatsUpdate)
        wsService.on('revenue:stats:updated', handleRevenueStatsUpdate)
        wsService.on('system:status:updated', handleSystemStatusUpdate)
        wsService.on('activity:new', handleActivityNew)
        wsService.on('disconnect', handleDisconnect)
        wsService.on('connect', handleConnect)

        // Solicitar dados iniciais
        wsService.requestLiveData()
        wsService.requestUserStats()
        wsService.requestRidesStats()
        wsService.requestRevenueStats()

        // Cleanup
        return () => {
          mounted = false
          wsService.off('metrics:updated', handleMetricsUpdate)
          wsService.off('users:stats:updated', handleUsersStatsUpdate)
          wsService.off('rides:stats:updated', handleRidesStatsUpdate)
          wsService.off('revenue:stats:updated', handleRevenueStatsUpdate)
          wsService.off('system:status:updated', handleSystemStatusUpdate)
          wsService.off('activity:new', handleActivityNew)
          wsService.off('disconnect', handleDisconnect)
          wsService.off('connect', handleConnect)
        }
      } catch (err) {
        if (mounted) {
          setError(err instanceof Error ? err.message : 'Erro ao conectar WebSocket')
          setConnected(false)
        }
      }
    }

    connect()

    return () => {
      mounted = false
      wsService.disconnect()
    }
  }, [user])

  const reconnect = useCallback(() => {
    wsService.disconnect()
    wsService.connect().catch(err => {
      setError(err instanceof Error ? err.message : 'Erro ao reconectar')
    })
  }, [])

  return {
    metrics,
    connected,
    error,
    reconnect
  }
}

/**
 * Hook para escutar eventos específicos do WebSocket
 */
export function useWebSocketEvent(eventName, enabled = true) {
  const [data, setData] = useState(null)

  useEffect(() => {
    if (!enabled) return

    const handler = (eventData) => {
      setData(eventData)
    }

    wsService.on(eventName, handler)

    return () => {
      wsService.off(eventName, handler)
    }
  }, [eventName, enabled])

  return data
}


