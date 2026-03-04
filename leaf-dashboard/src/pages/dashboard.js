import Head from 'next/head'
import { useState, useEffect } from 'react'
import dynamic from 'next/dynamic'
import ProtectedRoute from '../components/ProtectedRoute'
import Navigation from '../components/Navigation'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import { Button } from '../components/ui/button'
import { Badge } from '../components/ui/badge'
import { Alert, AlertDescription } from '../components/ui/alert'
import { leafAPI } from '../services/api'
import {
  Users,
  Truck,
  DollarSign,
  TrendingUp,
  Calendar,
  RefreshCw,
  UserPlus,
  ShieldAlert,
  Wallet
} from 'lucide-react'

// Importar ApexCharts dinamicamente
const Chart = dynamic(() => import('react-apexcharts'), { ssr: false })

export default function Dashboard() {
  const [period, setPeriod] = useState('24h')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  // Dados
  const [newDrivers, setNewDrivers] = useState(0)
  const [newCustomers, setNewCustomers] = useState(0)
  const [totalRides, setTotalRides] = useState(0)
  const [ridesRevenue, setRidesRevenue] = useState(0)
  const [operationalFee, setOperationalFee] = useState(0)
  const [subscriptionRevenue, setSubscriptionRevenue] = useState(0)
  const [reserveFundLosses, setReserveFundLosses] = useState(0)
  const [revenueEvolution, setRevenueEvolution] = useState([])

  useEffect(() => {
    let mounted = true
    let isFirstLoad = true

    const fetchData = async () => {
      try {
        if (isFirstLoad && mounted) {
          setLoading(true)
        }
        setError(null)

        // Mapear período para API
        const periodMap = {
          '24h': 'today',
          '3d': 'week',
          'week': 'week',
          'month': 'month'
        }
        const apiPeriod = periodMap[period] || 'today'

        // Buscar todos os dados em paralelo
        const [
          driversData,
          customersData,
          ridesData,
          feeData,
          subscriptionData
        ] = await Promise.all([
          leafAPI.getNewDrivers(period),
          leafAPI.getNewCustomers(period),
          leafAPI.getRidesStats(apiPeriod),
          leafAPI.getOperationalFeeStats(apiPeriod),
          leafAPI.getSubscriptionRevenue('30d')
        ])

        // Buscar evolução separadamente (pode ser mais lento)
        const evolutionData = await leafAPI.getRevenueEvolution(30)

        if (mounted) {
          setNewDrivers(driversData.users?.length || 0)
          setNewCustomers(customersData.users?.length || 0)
          setTotalRides(ridesData.totalRides || 0)
          setRidesRevenue(ridesData.totalValue || 0)
          setOperationalFee(feeData.totalOperationalFee || 0)
          setSubscriptionRevenue(subscriptionData.revenue?.total || 0)
          setReserveFundLosses(ridesData.reserveFundLosses || 0)
          setRevenueEvolution(evolutionData || [])

          if (isFirstLoad) {
            setLoading(false)
            isFirstLoad = false
          }
        }
      } catch (err) {
        if (mounted) {
          setError(err instanceof Error ? err.message : 'Erro ao carregar dados')
          if (isFirstLoad) {
            setLoading(false)
            isFirstLoad = false
          }
        }
      }
    }

    fetchData()
    const interval = setInterval(fetchData, 30000) // Atualizar a cada 30s

    return () => {
      mounted = false
      clearInterval(interval)
    }
  }, [period])

  // Configuração do gráfico de linha
  const chartOptions = {
    chart: {
      type: 'line',
      toolbar: { show: false },
      height: 350
    },
    stroke: {
      curve: 'smooth',
      width: 2
    },
    xaxis: {
      categories: revenueEvolution.map(d => {
        const date = new Date(d.date)
        return date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
      }),
      labels: {
        rotate: -45,
        style: {
          fontSize: '12px'
        }
      }
    },
    yaxis: {
      labels: {
        formatter: function (val) {
          return 'R$ ' + val.toLocaleString('pt-BR', { minimumFractionDigits: 0 })
        }
      }
    },
    tooltip: {
      y: {
        formatter: function (val) {
          return 'R$ ' + val.toLocaleString('pt-BR', { minimumFractionDigits: 2 })
        }
      }
    },
    colors: ['#3b82f6', '#10b981', '#8b5cf6'],
    legend: {
      position: 'top'
    },
    dataLabels: {
      enabled: false
    }
  }

  const chartSeries = [
    {
      name: 'Receita de Corridas',
      data: revenueEvolution.map(d => parseFloat(d.ridesRevenue || 0))
    },
    {
      name: 'Taxa Operacional',
      data: revenueEvolution.map(d => parseFloat(d.operationalFee || 0))
    },
    {
      name: 'Receita de Assinaturas',
      data: revenueEvolution.map(d => parseFloat(d.subscriptionRevenue || 0))
    }
  ]

  const periodLabels = {
    '24h': 'Últimas 24 horas',
    '3d': 'Últimos 3 dias',
    'week': 'Última semana',
    'month': 'Último mês'
  }

  return (
    <ProtectedRoute>
      <Head>
        <title>Dashboard - Leaf</title>
      </Head>
      <div className="min-h-screen bg-background">
        <Navigation />
        <div className="p-8">
          <div className="flex justify-between items-center mb-6">
            <h1 className="text-3xl font-bold">Dashboard</h1>
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <Calendar className="h-4 w-4 text-muted-foreground" />
                <select
                  value={period}
                  onChange={(e) => setPeriod(e.target.value)}
                  className="px-3 py-2 border rounded-md text-sm"
                >
                  <option value="24h">Últimas 24h</option>
                  <option value="3d">Últimos 3 dias</option>
                  <option value="week">Última semana</option>
                  <option value="month">Último mês</option>
                </select>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => window.location.reload()}
              >
                <RefreshCw className="h-4 w-4 mr-2" />
                Atualizar
              </Button>
            </div>
          </div>

          {loading && (
            <Alert>
              <AlertDescription>Carregando dados...</AlertDescription>
            </Alert>
          )}

          {error && (
            <Alert variant="destructive">
              <AlertDescription>Erro: {error}</AlertDescription>
            </Alert>
          )}

          {!loading && !error && (
            <>
              {/* Cards de métricas */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-6">
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between pb-2">
                    <CardTitle className="text-sm font-medium">Novos Motoristas</CardTitle>
                    <UserPlus className="h-4 w-4 text-muted-foreground" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold">{newDrivers}</div>
                    <p className="text-xs text-muted-foreground mt-1">
                      {periodLabels[period]}
                    </p>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="flex flex-row items-center justify-between pb-2">
                    <CardTitle className="text-sm font-medium">Novos Passageiros</CardTitle>
                    <Users className="h-4 w-4 text-muted-foreground" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold">{newCustomers}</div>
                    <p className="text-xs text-muted-foreground mt-1">
                      {periodLabels[period]}
                    </p>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="flex flex-row items-center justify-between pb-2">
                    <CardTitle className="text-sm font-medium">Total de Corridas</CardTitle>
                    <Truck className="h-4 w-4 text-muted-foreground" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold">{totalRides}</div>
                    <p className="text-xs text-muted-foreground mt-1">
                      {periodLabels[period]}
                    </p>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="flex flex-row items-center justify-between pb-2">
                    <CardTitle className="text-sm font-medium">Valor Total Corridas</CardTitle>
                    <DollarSign className="h-4 w-4 text-muted-foreground" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold text-green-600">
                      R$ {parseFloat(ridesRevenue).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      {periodLabels[period]}
                    </p>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="flex flex-row items-center justify-between pb-2">
                    <CardTitle className="text-sm font-medium">Lucro Taxa Operacional</CardTitle>
                    <TrendingUp className="h-4 w-4 text-muted-foreground" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold text-blue-600">
                      R$ {parseFloat(operationalFee).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      {periodLabels[period]}
                    </p>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="flex flex-row items-center justify-between pb-2">
                    <CardTitle className="text-sm font-medium">Lucro Assinaturas</CardTitle>
                    <DollarSign className="h-4 w-4 text-muted-foreground" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold text-purple-600">
                      R$ {parseFloat(subscriptionRevenue).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      Últimos 30 dias
                    </p>
                  </CardContent>
                </Card>

                <Card className="border-red-500/50 bg-red-50/50 dark:bg-red-950/20">
                  <CardHeader className="flex flex-row items-center justify-between pb-2">
                    <CardTitle className="text-sm font-medium text-red-600 dark:text-red-400">
                      Fundo de Reserva (Perda)
                    </CardTitle>
                    <ShieldAlert className="h-4 w-4 text-red-500" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold text-red-600 dark:text-red-400">
                      R$ {parseFloat(reserveFundLosses).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                    </div>
                    <p className="text-xs text-red-600/70 dark:text-red-400/70 mt-1">
                      Taxas PIX de Corridas Canceladas (Desde Início)
                    </p>
                  </CardContent>
                </Card>

                <Card className="border-primary/50 bg-primary/5">
                  <CardHeader className="flex flex-row items-center justify-between pb-2">
                    <CardTitle className="text-sm font-medium">Receita de Op. Líquida</CardTitle>
                    <Wallet className="h-4 w-4 text-primary" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-black text-primary">
                      R$ {Math.max(0, parseFloat(operationalFee) - parseFloat(reserveFundLosses)).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      Lucro da Plataforma (OpFee - Reserva)
                    </p>
                  </CardContent>
                </Card>
              </div>

              {/* Gráfico de evolução */}
              <Card>
                <CardHeader>
                  <CardTitle>Evolução de Receitas</CardTitle>
                </CardHeader>
                <CardContent>
                  {typeof window !== 'undefined' && revenueEvolution.length > 0 && (
                    <Chart
                      options={chartOptions}
                      series={chartSeries}
                      type="line"
                      height={350}
                    />
                  )}
                  {revenueEvolution.length === 0 && (
                    <Alert>
                      <AlertDescription>Carregando dados do gráfico...</AlertDescription>
                    </Alert>
                  )}
                </CardContent>
              </Card>
            </>
          )}
        </div>
      </div>
    </ProtectedRoute>
  )
}
