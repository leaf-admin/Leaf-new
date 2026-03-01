import Head from 'next/head'
import { useState, useEffect } from 'react'
import ProtectedRoute from '../components/ProtectedRoute'
import Navigation from '../components/Navigation'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import { Alert, AlertDescription } from '../components/ui/alert'
import { leafAPI } from '../services/api'

export default function Notifications() {
  const [notifications, setNotifications] = useState(null)
  const [stats, setStats] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    let mounted = true
    let isFirstLoad = true

    const fetchNotifications = async () => {
      try {
        if (isFirstLoad && mounted) {
          setLoading(true)
        }
        setError(null)
        const [notificationsData, statsData] = await Promise.all([
          leafAPI.getNotifications(),
          leafAPI.getNotificationStats()
        ])
        if (mounted) {
          setNotifications(notificationsData)
          setStats(statsData)
          if (isFirstLoad) {
            setLoading(false)
            isFirstLoad = false
          }
        }
      } catch (err) {
        if (mounted) {
          setError(err instanceof Error ? err.message : 'Erro ao carregar notificações')
          if (isFirstLoad) {
            setLoading(false)
            isFirstLoad = false
          }
        }
      }
    }

    fetchNotifications()
    const interval = setInterval(fetchNotifications, 30000)

    return () => {
      mounted = false
      clearInterval(interval)
    }
  }, [])

  return (
    <ProtectedRoute>
      <Head>
        <title>Notificações - Leaf Dashboard</title>
      </Head>
      <div className="min-h-screen bg-background">
        <Navigation />
        <div className="p-8">
          <h1 className="text-3xl font-bold mb-6">Notificações</h1>

          {stats && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
              <Card>
                <CardContent className="pt-6">
                  <div className="text-2xl font-bold">{stats.totalSent || 0}</div>
                  <div className="text-sm text-muted-foreground">Total Enviadas</div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-6">
                  <div className="text-2xl font-bold">{stats.successful || 0}</div>
                  <div className="text-sm text-muted-foreground">Sucesso</div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-6">
                  <div className="text-2xl font-bold">{stats.failed || 0}</div>
                  <div className="text-sm text-muted-foreground">Falhas</div>
                </CardContent>
              </Card>
            </div>
          )}

          {loading && (
            <Alert>
              <AlertDescription>Carregando notificações...</AlertDescription>
            </Alert>
          )}

          {error && (
            <Alert variant="destructive">
              <AlertDescription>Erro: {error}</AlertDescription>
            </Alert>
          )}

          {!loading && !error && notifications && (
            <Card>
              <CardHeader>
                <CardTitle>Serviço de Notificações</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {notifications.data?.stats && (
                    <div>
                      <div className="text-sm font-medium mb-2">Estatísticas do Serviço</div>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        <div>
                          <div className="text-sm text-muted-foreground">Total Enviadas</div>
                          <div className="font-semibold">{notifications.data.stats.totalSent || 0}</div>
                        </div>
                        <div>
                          <div className="text-sm text-muted-foreground">Sucesso</div>
                          <div className="font-semibold">{notifications.data.stats.successful || 0}</div>
                        </div>
                        <div>
                          <div className="text-sm text-muted-foreground">Falhas</div>
                          <div className="font-semibold">{notifications.data.stats.failed || 0}</div>
                        </div>
                        <div>
                          <div className="text-sm text-muted-foreground">Taxa de Sucesso</div>
                          <div className="font-semibold">
                            {notifications.data.stats.totalSent > 0
                              ? ((notifications.data.stats.successful / notifications.data.stats.totalSent) * 100).toFixed(1)
                              : 0}%
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                  {notifications.data?.endpoints && (
                    <div>
                      <div className="text-sm font-medium mb-2">Endpoints Disponíveis</div>
                      <ul className="list-disc list-inside space-y-1 text-sm">
                        {Object.entries(notifications.data.endpoints).map(([key, value]) => (
                          <li key={key}>
                            <span className="font-mono">{key}:</span> {value}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </ProtectedRoute>
  )
}
