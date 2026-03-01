import Head from 'next/head'
import { useState, useEffect } from 'react'
import dynamic from 'next/dynamic'
import ProtectedRoute from '../components/ProtectedRoute'
import Navigation from '../components/Navigation'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import { Alert, AlertDescription } from '../components/ui/alert'
import { leafAPI } from '../services/api'

// Importar ApexCharts dinamicamente (client-side only)
const Chart = dynamic(() => import('react-apexcharts'), { ssr: false })

export default function Metrics() {
  const [metrics, setMetrics] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    let mounted = true
    let isFirstLoad = true

    const fetchMetrics = async () => {
      try {
        if (isFirstLoad && mounted) {
          setLoading(true)
        }
        setError(null)
        
        const [overview, ridesDaily, financial] = await Promise.all([
          leafAPI.getMetricsOverview(),
          leafAPI.getMetricsRidesDaily(),
          leafAPI.getMetricsFinancial()
        ])

        if (mounted) {
          setMetrics({
            overview,
            ridesDaily,
            financial
          })
          if (isFirstLoad) {
            setLoading(false)
            isFirstLoad = false
          }
        }
      } catch (err) {
        if (mounted) {
          setError(err instanceof Error ? err.message : 'Erro ao carregar métricas')
          if (isFirstLoad) {
            setLoading(false)
            isFirstLoad = false
          }
        }
      }
    }

    fetchMetrics()
    const interval = setInterval(fetchMetrics, 30000)

    return () => {
      mounted = false
      clearInterval(interval)
    }
  }, [])

  // Configuração do gráfico de corridas
  const ridesChartOptions = {
    chart: {
      type: 'bar',
      toolbar: { show: false },
      height: 350
    },
    plotOptions: {
      bar: {
        horizontal: false,
        columnWidth: '55%',
        endingShape: 'rounded'
      }
    },
    dataLabels: {
      enabled: false
    },
    stroke: {
      show: true,
      width: 2,
      colors: ['transparent']
    },
    xaxis: {
      categories: ['Total', 'Completadas', 'Canceladas']
    },
    fill: {
      opacity: 1
    },
    colors: ['#3b82f6', '#10b981', '#ef4444'],
    tooltip: {
      y: {
        formatter: function (val) {
          return val + ' corridas'
        }
      }
    }
  }

  const ridesChartSeries = metrics ? [{
    name: 'Corridas',
    data: [
      metrics.ridesDaily?.totalToday || 0,
      metrics.ridesDaily?.completedToday || 0,
      metrics.ridesDaily?.cancelledAfterAcceptance || 0
    ]
  }] : []

  // Configuração do gráfico financeiro
  const financialChartOptions = {
    chart: {
      type: 'area',
      toolbar: { show: false },
      height: 350
    },
    dataLabels: {
      enabled: false
    },
    stroke: {
      curve: 'smooth',
      width: 2
    },
    xaxis: {
      categories: ['Receita Total', 'Ticket Médio']
    },
    fill: {
      type: 'gradient',
      gradient: {
        shadeIntensity: 1,
        opacityFrom: 0.7,
        opacityTo: 0.9,
        stops: [0, 100]
      }
    },
    colors: ['#10b981'],
    tooltip: {
      y: {
        formatter: function (val) {
          return 'R$ ' + val.toLocaleString('pt-BR', { minimumFractionDigits: 2 })
        }
      }
    }
  }

  const financialChartSeries = metrics ? [{
    name: 'Valores',
    data: [
      metrics.financial?.totalRevenue || 0,
      metrics.financial?.averageTicket || 0
    ]
  }] : []

  // Configuração do gráfico de pizza para visão geral
  const overviewChartOptions = {
    chart: {
      type: 'donut',
      toolbar: { show: false },
      height: 350
    },
    labels: ['Waitlist', 'Simulações'],
    colors: ['#3b82f6', '#8b5cf6'],
    legend: {
      position: 'bottom'
    },
    dataLabels: {
      enabled: true,
      formatter: function (val) {
        return val.toFixed(1) + '%'
      }
    }
  }

  const overviewChartSeries = metrics ? [
    metrics.overview?.waitlistCount || 0,
    metrics.overview?.calculatorSimulations || 0
  ] : []

  return (
    <ProtectedRoute>
      <Head>
        <title>Métricas - Leaf Dashboard</title>
      </Head>
      <div className="min-h-screen bg-background">
        <Navigation />
        <div className="p-8">
          <h1 className="text-3xl font-bold mb-6">Métricas</h1>

          {loading && (
            <Alert>
              <AlertDescription>Carregando métricas...</AlertDescription>
            </Alert>
          )}

          {error && (
            <Alert variant="destructive">
              <AlertDescription>Erro: {error}</AlertDescription>
            </Alert>
          )}

          {!loading && !error && metrics && (
            <>
              {/* Cards de resumo */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-6">
                <Card>
                  <CardHeader>
                    <CardTitle>Visão Geral</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2">
                      <div>
                        <span className="text-sm text-muted-foreground">Waitlist:</span>
                        <span className="ml-2 font-semibold">{metrics.overview?.waitlistCount || 0}</span>
                      </div>
                      <div>
                        <span className="text-sm text-muted-foreground">Simulações:</span>
                        <span className="ml-2 font-semibold">{metrics.overview?.calculatorSimulations || 0}</span>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle>Corridas Hoje</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2">
                      <div>
                        <span className="text-sm text-muted-foreground">Total:</span>
                        <span className="ml-2 font-semibold">{metrics.ridesDaily?.totalToday || 0}</span>
                      </div>
                      <div>
                        <span className="text-sm text-muted-foreground">Completadas:</span>
                        <span className="ml-2 font-semibold">{metrics.ridesDaily?.completedToday || 0}</span>
                      </div>
                      <div>
                        <span className="text-sm text-muted-foreground">Taxa de Cancelamento:</span>
                        <span className="ml-2 font-semibold">{metrics.ridesDaily?.cancellationRate || 0}%</span>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle>Financeiro</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2">
                      <div>
                        <span className="text-sm text-muted-foreground">Receita Total:</span>
                        <span className="ml-2 font-semibold">
                          R$ {metrics.financial?.totalRevenue?.toLocaleString('pt-BR', { minimumFractionDigits: 2 }) || '0,00'}
                        </span>
                      </div>
                      <div>
                        <span className="text-sm text-muted-foreground">Ticket Médio:</span>
                        <span className="ml-2 font-semibold">
                          R$ {metrics.financial?.averageTicket?.toLocaleString('pt-BR', { minimumFractionDigits: 2 }) || '0,00'}
                        </span>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>

              {/* Gráficos */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <Card>
                  <CardHeader>
                    <CardTitle>Corridas do Dia</CardTitle>
                  </CardHeader>
                  <CardContent>
                    {typeof window !== 'undefined' && (
                      <Chart
                        options={ridesChartOptions}
                        series={ridesChartSeries}
                        type="bar"
                        height={350}
                      />
                    )}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle>Análise Financeira</CardTitle>
                  </CardHeader>
                  <CardContent>
                    {typeof window !== 'undefined' && (
                      <Chart
                        options={financialChartOptions}
                        series={financialChartSeries}
                        type="area"
                        height={350}
                      />
                    )}
                  </CardContent>
                </Card>

                <Card className="lg:col-span-2">
                  <CardHeader>
                    <CardTitle>Visão Geral - Distribuição</CardTitle>
                  </CardHeader>
                  <CardContent>
                    {typeof window !== 'undefined' && (
                      <Chart
                        options={overviewChartOptions}
                        series={overviewChartSeries}
                        type="donut"
                        height={350}
                      />
                    )}
                  </CardContent>
                </Card>
              </div>
            </>
          )}
        </div>
      </div>
    </ProtectedRoute>
  )
}
