import Head from 'next/head'
import { useState, useEffect } from 'react'
import ProtectedRoute from '../components/ProtectedRoute'
import Navigation from '../components/Navigation'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import { Alert, AlertDescription } from '../components/ui/alert'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { leafAPI } from '../services/api'

export default function MetricsHistory() {
  const [history, setHistory] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [startDate, setStartDate] = useState(() => {
    const date = new Date()
    date.setDate(date.getDate() - 7)
    return date.toISOString().split('T')[0]
  })
  const [endDate, setEndDate] = useState(() => {
    return new Date().toISOString().split('T')[0]
  })

  const fetchHistory = async () => {
    if (!startDate || !endDate) return

    try {
      setLoading(true)
      setError(null)
      const data = await leafAPI.getMetricsHistory(startDate, endDate, 'hour')
      setHistory(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao carregar histórico')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchHistory()
  }, [])

  return (
    <ProtectedRoute>
      <Head>
        <title>Histórico - Leaf Dashboard</title>
      </Head>
      <div className="min-h-screen bg-background">
        <Navigation />
        <div className="p-8">
          <h1 className="text-3xl font-bold mb-6">Histórico de Métricas</h1>

          <Card className="mb-6">
            <CardHeader>
              <CardTitle>Filtros</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex gap-4 items-end">
                <div className="flex-1">
                  <label className="text-sm font-medium mb-2 block">Data Inicial</label>
                  <Input
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                  />
                </div>
                <div className="flex-1">
                  <label className="text-sm font-medium mb-2 block">Data Final</label>
                  <Input
                    type="date"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                  />
                </div>
                <Button onClick={fetchHistory} disabled={loading}>
                  {loading ? 'Carregando...' : 'Buscar'}
                </Button>
              </div>
            </CardContent>
          </Card>

          {error && (
            <Alert variant="destructive">
              <AlertDescription>Erro: {error}</AlertDescription>
            </Alert>
          )}

          {loading && (
            <Alert>
              <AlertDescription>Carregando histórico...</AlertDescription>
            </Alert>
          )}

          {!loading && !error && history && (
            <Card>
              <CardHeader>
                <CardTitle>Histórico</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  <div>
                    <span className="text-sm text-muted-foreground">Período:</span>
                    <span className="ml-2 font-semibold">
                      {history.period?.start} até {history.period?.end}
                    </span>
                  </div>
                  <div>
                    <span className="text-sm text-muted-foreground">Registros:</span>
                    <span className="ml-2 font-semibold">{history.count || 0}</span>
                  </div>
                  {history.data && history.data.length > 0 && (
                    <div className="mt-4">
                      <p className="text-sm text-muted-foreground mb-2">Últimos registros:</p>
                      <div className="space-y-1">
                        {history.data.slice(0, 10).map((item, index) => (
                          <div key={index} className="text-sm p-2 bg-muted rounded">
                            {item.timestamp || item.date}: {JSON.stringify(item)}
                          </div>
                        ))}
                      </div>
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
