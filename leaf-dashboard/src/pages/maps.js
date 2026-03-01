import Head from 'next/head'
import { useState, useEffect } from 'react'
import ProtectedRoute from '../components/ProtectedRoute'
import Navigation from '../components/Navigation'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import { Alert, AlertDescription } from '../components/ui/alert'
import { leafAPI } from '../services/api'

export default function Maps() {
  const [locations, setLocations] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    let mounted = true
    let isFirstLoad = true

    const fetchLocations = async () => {
      try {
        if (isFirstLoad && mounted) {
          setLoading(true)
        }
        setError(null)
        const data = await leafAPI.getMapLocations('all')
        if (mounted) {
          setLocations(data)
          if (isFirstLoad) {
            setLoading(false)
            isFirstLoad = false
          }
        }
      } catch (err) {
        if (mounted) {
          setError(err instanceof Error ? err.message : 'Erro ao carregar localizações')
          if (isFirstLoad) {
            setLoading(false)
            isFirstLoad = false
          }
        }
      }
    }

    fetchLocations()
    const interval = setInterval(fetchLocations, 30000)

    return () => {
      mounted = false
      clearInterval(interval)
    }
  }, [])

  return (
    <ProtectedRoute>
      <Head>
        <title>Mapas - Leaf Dashboard</title>
      </Head>
      <div className="min-h-screen bg-background">
        <Navigation />
        <div className="p-8">
          <h1 className="text-3xl font-bold mb-6">Mapas</h1>

          {loading && (
            <Alert>
              <AlertDescription>Carregando localizações...</AlertDescription>
            </Alert>
          )}

          {error && (
            <Alert variant="destructive">
              <AlertDescription>Erro: {error}</AlertDescription>
            </Alert>
          )}

          {!loading && !error && locations && (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              <Card>
                <CardHeader>
                  <CardTitle>Motoristas</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    <div>
                      <span className="text-sm text-muted-foreground">Total:</span>
                      <span className="ml-2 font-semibold">{locations.summary?.totalDrivers || 0}</span>
                    </div>
                    <div>
                      <span className="text-sm text-muted-foreground">Disponíveis:</span>
                      <span className="ml-2 font-semibold">{locations.summary?.availableDrivers || 0}</span>
                    </div>
                    <div>
                      <span className="text-sm text-muted-foreground">Ocupados:</span>
                      <span className="ml-2 font-semibold">{locations.summary?.busyDrivers || 0}</span>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Passageiros</CardTitle>
                </CardHeader>
                <CardContent>
                  <div>
                    <span className="text-sm text-muted-foreground">Ativos:</span>
                    <span className="ml-2 font-semibold">{locations.summary?.activePassengers || 0}</span>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Corridas</CardTitle>
                </CardHeader>
                <CardContent>
                  <div>
                    <span className="text-sm text-muted-foreground">Ativas:</span>
                    <span className="ml-2 font-semibold">{locations.summary?.activeBookings || 0}</span>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Última Atualização</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-sm">
                    {locations.lastUpdate ? new Date(locations.lastUpdate).toLocaleString('pt-BR') : 'N/A'}
                  </div>
                </CardContent>
              </Card>
            </div>
          )}

          {!loading && !error && locations && (
            <Card className="mt-6">
              <CardHeader>
                <CardTitle>Visualização do Mapa</CardTitle>
              </CardHeader>
              <CardContent>
                <Alert>
                  <AlertDescription>
                    Integração com mapa (Google Maps / Leaflet) será implementada em breve.
                    Dados de localização disponíveis: {locations.locations?.drivers?.length || 0} motoristas, {locations.locations?.passengers?.length || 0} passageiros.
                  </AlertDescription>
                </Alert>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </ProtectedRoute>
  )
}
