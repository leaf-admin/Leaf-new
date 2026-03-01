import Head from 'next/head'
import { useState, useEffect } from 'react'
import ProtectedRoute from '../components/ProtectedRoute'
import Navigation from '../components/Navigation'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import { Alert, AlertDescription } from '../components/ui/alert'
import { Badge } from '../components/ui/badge'
import { leafAPI } from '../services/api'

export default function Waitlist() {
  const [waitlist, setWaitlist] = useState([])
  const [stats, setStats] = useState(null)
  const [pagination, setPagination] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [page, setPage] = useState(1)
  const [status, setStatus] = useState('pending')
  const limit = 20

  useEffect(() => {
    let mounted = true
    let isFirstLoad = true

    const fetchWaitlist = async () => {
      try {
        if (isFirstLoad && mounted) {
          setLoading(true)
        }
        setError(null)
        const [waitlistData, statsData] = await Promise.all([
          leafAPI.getWaitlist(page, limit, status),
          leafAPI.getWaitlistStats()
        ])
        if (mounted) {
          setWaitlist(waitlistData.drivers || [])
          setPagination(waitlistData.pagination)
          setStats(statsData)
          if (isFirstLoad) {
            setLoading(false)
            isFirstLoad = false
          }
        }
      } catch (err) {
        if (mounted) {
          setError(err instanceof Error ? err.message : 'Erro ao carregar lista de espera')
          if (isFirstLoad) {
            setLoading(false)
            isFirstLoad = false
          }
        }
      }
    }

    fetchWaitlist()
    const interval = setInterval(fetchWaitlist, 30000)

    return () => {
      mounted = false
      clearInterval(interval)
    }
  }, [page, status])

  return (
    <ProtectedRoute>
      <Head>
        <title>Lista de Espera - Leaf Dashboard</title>
      </Head>
      <div className="min-h-screen bg-background">
        <Navigation />
        <div className="p-8">
          <h1 className="text-3xl font-bold mb-6">Lista de Espera</h1>

          {stats && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
              <Card>
                <CardContent className="pt-6">
                  <div className="text-2xl font-bold">{stats.waitlistCount || 0}</div>
                  <div className="text-sm text-muted-foreground">Total na Waitlist</div>
                </CardContent>
              </Card>
            </div>
          )}

          <Card className="mb-6">
            <CardHeader>
              <CardTitle>Filtros</CardTitle>
            </CardHeader>
            <CardContent>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                className="px-3 py-2 border rounded-md"
              >
                <option value="pending">Pendentes</option>
                <option value="approved">Aprovados</option>
                <option value="rejected">Rejeitados</option>
              </select>
            </CardContent>
          </Card>

          {loading && (
            <Alert>
              <AlertDescription>Carregando lista de espera...</AlertDescription>
            </Alert>
          )}

          {error && (
            <Alert variant="destructive">
              <AlertDescription>Erro: {error}</AlertDescription>
            </Alert>
          )}

          {!loading && !error && (
            <div className="space-y-4">
              {waitlist.length === 0 ? (
                <Alert>
                  <AlertDescription>Nenhum motorista na lista de espera.</AlertDescription>
                </Alert>
              ) : (
                waitlist.map((item) => (
                  <Card key={item.id}>
                    <CardHeader>
                      <div className="flex justify-between items-start">
                        <div>
                          <CardTitle>
                            {item.driver?.firstName} {item.driver?.lastName}
                          </CardTitle>
                          <p className="text-sm text-muted-foreground mt-1">
                            {item.driver?.email} • {item.driver?.mobile}
                          </p>
                        </div>
                        <Badge variant="secondary">Posição: {item.position}</Badge>
                      </div>
                    </CardHeader>
                    <CardContent>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        <div>
                          <div className="text-sm text-muted-foreground">Status</div>
                          <div className="font-medium">{item.status}</div>
                        </div>
                        <div>
                          <div className="text-sm text-muted-foreground">Prioridade</div>
                          <div className="font-medium">{item.priority || 'normal'}</div>
                        </div>
                        <div>
                          <div className="text-sm text-muted-foreground">CNH</div>
                          <div className="font-medium">
                            {item.documents?.cnhUploaded ? '✓' : '✗'}
                          </div>
                        </div>
                        <div>
                          <div className="text-sm text-muted-foreground">Veículo</div>
                          <div className="font-medium">
                            {item.documents?.vehicleRegistered ? '✓' : '✗'}
                          </div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))
              )}
            </div>
          )}

          {pagination && pagination.pages > 1 && (
            <div className="mt-6 flex justify-center gap-2">
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page === 1}
                className="px-4 py-2 border rounded-md disabled:opacity-50"
              >
                Anterior
              </button>
              <span className="px-4 py-2">
                Página {pagination.page} de {pagination.pages}
              </span>
              <button
                onClick={() => setPage(p => Math.min(pagination.pages, p + 1))}
                disabled={page === pagination.pages}
                className="px-4 py-2 border rounded-md disabled:opacity-50"
              >
                Próxima
              </button>
            </div>
          )}
        </div>
      </div>
    </ProtectedRoute>
  )
}
