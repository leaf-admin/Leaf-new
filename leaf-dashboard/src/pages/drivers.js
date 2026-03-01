import Head from 'next/head'
import { useState, useEffect } from 'react'
import ProtectedRoute from '../components/ProtectedRoute'
import Navigation from '../components/Navigation'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import { Alert, AlertDescription } from '../components/ui/alert'
import { Input } from '../components/ui/input'
import { Button } from '../components/ui/button'
import { Badge } from '../components/ui/badge'
import { leafAPI } from '../services/api'
import Link from 'next/link'

export default function Drivers() {
  const [drivers, setDrivers] = useState([])
  const [summary, setSummary] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('all')
  const limit = 20

  useEffect(() => {
    let mounted = true
    let isFirstLoad = true

    const fetchDrivers = async () => {
      try {
        if (isFirstLoad && mounted) {
          setLoading(true)
        }
        setError(null)
        const data = await leafAPI.getDrivers(page, limit, status, search)
        if (mounted) {
          setDrivers(data.applications || [])
          setSummary(data.summary)
          if (isFirstLoad) {
            setLoading(false)
            isFirstLoad = false
          }
        }
      } catch (err) {
        if (mounted) {
          setError(err instanceof Error ? err.message : 'Erro ao carregar motoristas')
          if (isFirstLoad) {
            setLoading(false)
            isFirstLoad = false
          }
        }
      }
    }

    fetchDrivers()
    const interval = setInterval(fetchDrivers, 30000)

    return () => {
      mounted = false
      clearInterval(interval)
    }
  }, [page, status, search])

  const getStatusBadge = (status) => {
    const variants = {
      pending: 'secondary',
      in_review: 'default',
      approved: 'default',
      rejected: 'destructive'
    }
    const labels = {
      pending: 'Pendente',
      in_review: 'Em Análise',
      approved: 'Aprovado',
      rejected: 'Rejeitado'
    }
    return <Badge variant={variants[status] || 'secondary'}>{labels[status] || status}</Badge>
  }

  return (
    <ProtectedRoute>
      <Head>
        <title>Motoristas - Leaf Dashboard</title>
      </Head>
      <div className="min-h-screen bg-background">
        <Navigation />
        <div className="p-8">
          <h1 className="text-3xl font-bold mb-6">Motoristas</h1>

          {summary && (
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
              <Card>
                <CardContent className="pt-6">
                  <div className="text-2xl font-bold">{summary.total || 0}</div>
                  <div className="text-sm text-muted-foreground">Total</div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-6">
                  <div className="text-2xl font-bold">{summary.pending || 0}</div>
                  <div className="text-sm text-muted-foreground">Pendentes</div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-6">
                  <div className="text-2xl font-bold">{summary.approved || 0}</div>
                  <div className="text-sm text-muted-foreground">Aprovados</div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-6">
                  <div className="text-2xl font-bold">{summary.rejected || 0}</div>
                  <div className="text-sm text-muted-foreground">Rejeitados</div>
                </CardContent>
              </Card>
            </div>
          )}

          <Card className="mb-6">
            <CardHeader>
              <CardTitle>Filtros</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex gap-4">
                <Input
                  placeholder="Buscar por nome, email ou telefone..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="flex-1"
                />
                <select
                  value={status}
                  onChange={(e) => setStatus(e.target.value)}
                  className="px-3 py-2 border rounded-md"
                >
                  <option value="all">Todos</option>
                  <option value="pending">Pendentes</option>
                  <option value="approved">Aprovados</option>
                  <option value="rejected">Rejeitados</option>
                </select>
              </div>
            </CardContent>
          </Card>

          {loading && (
            <Alert>
              <AlertDescription>Carregando motoristas...</AlertDescription>
            </Alert>
          )}

          {error && (
            <Alert variant="destructive">
              <AlertDescription>Erro: {error}</AlertDescription>
            </Alert>
          )}

          {!loading && !error && (
            <div className="space-y-4">
              {drivers.length === 0 ? (
                <Alert>
                  <AlertDescription>Nenhum motorista encontrado.</AlertDescription>
                </Alert>
              ) : (
                drivers.map((driver) => (
                  <Card key={driver.id}>
                    <CardHeader>
                      <div className="flex justify-between items-start">
                        <div>
                          <CardTitle>{driver.driver?.name || 'Nome não informado'}</CardTitle>
                          <p className="text-sm text-muted-foreground mt-1">
                            {driver.driver?.email} • {driver.driver?.phone}
                          </p>
                        </div>
                        {getStatusBadge(driver.status)}
                      </div>
                    </CardHeader>
                    <CardContent>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        <div>
                          <div className="text-sm text-muted-foreground">Veículo</div>
                          <div className="font-medium">
                            {driver.vehicle?.brand} {driver.vehicle?.model}
                          </div>
                        </div>
                        <div>
                          <div className="text-sm text-muted-foreground">Placa</div>
                          <div className="font-medium">{driver.vehicle?.plate || 'N/A'}</div>
                        </div>
                        <div>
                          <div className="text-sm text-muted-foreground">Documentos</div>
                          <div className="font-medium">{driver.documents?.length || 0} documentos</div>
                        </div>
                        <div>
                          <div className="text-sm text-muted-foreground">Score</div>
                          <div className="font-medium">{driver.score || 0}%</div>
                        </div>
                      </div>
                      <div className="mt-4">
                        <Link href={`/driver-documents?id=${driver.id}`}>
                          <Button variant="outline">Ver Documentos</Button>
                        </Link>
                      </div>
                    </CardContent>
                  </Card>
                ))
              )}
            </div>
          )}
        </div>
      </div>
    </ProtectedRoute>
  )
}
