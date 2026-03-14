import Head from 'next/head'
import { useState, useEffect } from 'react'
import dynamic from 'next/dynamic'
import ProtectedRoute from '../components/ProtectedRoute'
import Navigation from '../components/Navigation'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import { Alert, AlertDescription } from '../components/ui/alert'
import { Badge } from '../components/ui/badge'
import { Activity, AlertTriangle, TrendingUp, Zap, Database, Server, Cpu, HardDrive, Network, Clock } from 'lucide-react'
import { leafAPI } from '../services/api'

// Importar ApexCharts dinamicamente
const Chart = dynamic(() => import('react-apexcharts'), { ssr: false })

export default function Observability() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [metrics, setMetrics] = useState(null)

  useEffect(() => {
    fetchMetrics()
    const interval = setInterval(fetchMetrics, 30000) // Atualizar a cada 30s
    return () => clearInterval(interval)
  }, [])

  const fetchMetrics = async () => {
    try {
      setError(null)
      // Buscar métricas do backend via API
      const data = await leafAPI.getObservabilityMetrics()
      if (data && data.success) {
        setMetrics(data)
      } else {
        throw new Error('Erro ao buscar métricas')
      }
    } catch (err) {
      console.error('Erro ao buscar métricas:', err)
      setError(err.message || 'Erro ao buscar métricas')
      // Em caso de erro, definir métricas vazias para não quebrar a UI
      setMetrics({
        redis: { operations: {}, latency: {}, operationsByType: {} },
        system: {},
        commands: { byCommand: {} },
        events: { byType: {} },
        listeners: { byListener: {} },
        otel: { enabled: false, ingest: {} }
      })
    } finally {
      setLoading(false)
    }
  }

  // Configuração do gráfico de latência Redis
  const redisLatencyChartOptions = {
    chart: {
      type: 'line',
      toolbar: { show: false },
      height: 250
    },
    stroke: {
      curve: 'smooth',
      width: 2
    },
    xaxis: {
      categories: ['Avg', 'P95', 'P99']
    },
    colors: ['#ef4444'],
    tooltip: {
      y: {
        formatter: function (val) {
          return val.toFixed(2) + 'ms'
        }
      }
    }
  }

  const redisLatencyChartSeries = metrics?.redis ? [{
    name: 'Latência',
    data: [
      metrics.redis.latency.avg,
      metrics.redis.latency.p95,
      metrics.redis.latency.p99
    ]
  }] : []

  // Configuração do gráfico de operações Redis por tipo
  const redisOpsChartOptions = {
    chart: {
      type: 'bar',
      toolbar: { show: false },
      height: 250
    },
    plotOptions: {
      bar: {
        horizontal: true
      }
    },
    colors: ['#3b82f6'],
    tooltip: {
      y: {
        formatter: function (val) {
          return val + ' ops'
        }
      }
    }
  }

  const redisOpsChartSeries = metrics?.redis?.operationsByType ? [{
    name: 'Operações',
    data: Object.values(metrics.redis.operationsByType).map(op => op.total || 0)
  }] : []

  const redisOpsCategories = metrics?.redis?.operationsByType ? Object.keys(metrics.redis.operationsByType) : []

  // Configuração do gráfico de Commands
  const commandsChartOptions = {
    chart: {
      type: 'donut',
      toolbar: { show: false },
      height: 300
    },
    labels: ['Sucesso', 'Falhas'],
    colors: ['#10b981', '#ef4444'],
    legend: {
      position: 'bottom'
    }
  }

  const commandsChartSeries = metrics?.commands ? [
    metrics.commands.success || 0,
    metrics.commands.failures || 0
  ] : []

  // Configuração do gráfico de Events
  const eventsChartOptions = {
    chart: {
      type: 'area',
      toolbar: { show: false },
      height: 250
    },
    stroke: {
      curve: 'smooth',
      width: 2
    },
    colors: ['#8b5cf6'],
    tooltip: {
      y: {
        formatter: function (val) {
          return val + ' eventos'
        }
      }
    }
  }

  const eventsChartSeries = metrics?.events ? [{
    name: 'Eventos',
    data: [
      metrics.events.published || 0,
      metrics.events.consumed || 0
    ]
  }] : []

  return (
    <ProtectedRoute>
      <Head>
        <title>Observabilidade - Leaf Dashboard</title>
      </Head>
      
      <Navigation />
      
      <div className="container mx-auto p-6">
        <div className="mb-6">
          <h1 className="text-3xl font-bold mb-2">Observabilidade</h1>
          <p className="text-gray-600">Métricas, traces e alertas do sistema em tempo real</p>
        </div>

        {error && (
          <Alert variant="destructive" className="mb-6">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {/* Cards de Links Rápidos */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Activity className="h-5 w-5" />
                Traces
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                <a 
                  href="http://localhost:3000/explore?orgId=1&left=%5B%22now-1h%22,%22now%22,%22Tempo%22,%7B%22query%22:%22%7Bresource.service.name%3D%5C%22leaf-websocket-backend%5C%22%7D%22%7D%5D"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-600 hover:underline"
                >
                  Ver no Grafana
                </a>
              </div>
              <p className="text-sm text-gray-500 mt-2">
                Visualizar traces completos de corridas
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <TrendingUp className="h-5 w-5" />
                Métricas
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                <a 
                  href="http://localhost:3000/d/leaf-commands"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-600 hover:underline"
                >
                  Dashboards
                </a>
              </div>
              <p className="text-sm text-gray-500 mt-2">
                Commands, Events, Listeners, Circuit Breakers
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <AlertTriangle className="h-5 w-5" />
                Alertas
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                <a 
                  href="http://localhost:3000/alerting/list"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-600 hover:underline"
                >
                  Ver Alertas
                </a>
              </div>
              <p className="text-sm text-gray-500 mt-2">
                Status de alertas configurados
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Zap className="h-5 w-5" />
                Prometheus
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                <a 
                  href="http://localhost:9090"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-600 hover:underline"
                >
                  Prometheus UI
                </a>
              </div>
              <p className="text-sm text-gray-500 mt-2">
                Queries e métricas brutas
              </p>
            </CardContent>
          </Card>
        </div>

        {loading ? (
          <div className="text-center py-12">
            <p className="text-gray-500">Carregando métricas...</p>
          </div>
        ) : metrics ? (
          <>
            {/* Seção Redis */}
            <div className="mb-6">
              <h2 className="text-2xl font-bold mb-4 flex items-center gap-2">
                <Database className="h-6 w-6" />
                Redis
              </h2>
              
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
                <Card>
                  <CardHeader>
                    <CardTitle>Operações</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-3">
                      <div className="flex justify-between items-center">
                        <span className="text-sm text-gray-600">Total:</span>
                        <span className="text-lg font-bold">{metrics.redis?.operations?.total || 0}</span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-sm text-gray-600">Sucesso:</span>
                        <Badge variant="default" className="bg-green-500">
                          {metrics.redis?.operations?.success || 0}
                        </Badge>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-sm text-gray-600">Erros:</span>
                        <Badge variant="destructive">
                          {metrics.redis?.operations?.errors || 0}
                        </Badge>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-sm text-gray-600">Taxa de Erro:</span>
                        <span className="text-lg font-semibold">
                          {metrics.redis?.operations?.errorRate || 0}%
                        </span>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle>Latência</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-3">
                      <div className="flex justify-between items-center">
                        <span className="text-sm text-gray-600">Média:</span>
                        <span className="text-lg font-bold">
                          {metrics.redis?.latency?.avg?.toFixed(2) || 0}ms
                        </span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-sm text-gray-600">P95:</span>
                        <span className="text-lg font-semibold">
                          {metrics.redis?.latency?.p95?.toFixed(2) || 0}ms
                        </span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-sm text-gray-600">P99:</span>
                        <span className="text-lg font-semibold">
                          {metrics.redis?.latency?.p99?.toFixed(2) || 0}ms
                        </span>
                      </div>
                    </div>
                    {typeof window !== 'undefined' && redisLatencyChartSeries.length > 0 && (
                      <Chart
                        options={redisLatencyChartOptions}
                        series={redisLatencyChartSeries}
                        type="line"
                        height={250}
                      />
                    )}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle>Operações por Tipo</CardTitle>
                  </CardHeader>
                  <CardContent>
                    {typeof window !== 'undefined' && redisOpsCategories.length > 0 && (
                      <Chart
                        options={{
                          ...redisOpsChartOptions,
                          xaxis: { categories: redisOpsCategories }
                        }}
                        series={redisOpsChartSeries}
                        type="bar"
                        height={250}
                      />
                    )}
                    {redisOpsCategories.length === 0 && (
                      <p className="text-gray-500 text-center py-8">Sem dados disponíveis</p>
                    )}
                  </CardContent>
                </Card>
              </div>
            </div>

            {/* Seção Sistema */}
            <div className="mb-6">
              <h2 className="text-2xl font-bold mb-4 flex items-center gap-2">
                <Server className="h-6 w-6" />
                Sistema
              </h2>
              
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-6 gap-6">
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Cpu className="h-5 w-5" />
                      CPU
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-3xl font-bold">
                      {metrics.system?.cpu?.toFixed(1) || 0}%
                    </div>
                    <p className="text-sm text-gray-500 mt-2">Uso de CPU</p>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <HardDrive className="h-5 w-5" />
                      Memória
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-3xl font-bold">
                      {metrics.system?.memory?.toFixed(0) || 0} MB
                    </div>
                    <p className="text-sm text-gray-500 mt-2">Uso de RAM</p>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Network className="h-5 w-5" />
                      WebSocket
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-3xl font-bold">
                      {metrics.system?.websocketConnections || 0}
                    </div>
                    <p className="text-sm text-gray-500 mt-2">Conexões ativas</p>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Clock className="h-5 w-5" />
                      Uptime
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-3xl font-bold">
                      {formatUptime(metrics.system?.uptime || 0)}
                    </div>
                    <p className="text-sm text-gray-500 mt-2">Tempo online</p>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <TrendingUp className="h-5 w-5" />
                      Throughput
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-3xl font-bold">
                      {metrics.system?.throughput || 0}
                    </div>
                    <p className="text-sm text-gray-500 mt-2">Req/seg</p>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Activity className="h-5 w-5" />
                      OTEL Ingest
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-3xl font-bold">
                      {metrics.otel?.ingest?.totalRequests || 0}
                    </div>
                    <p className="text-sm text-gray-500 mt-2">
                      endpoint: {metrics.otel?.endpoint || 'N/A'}
                    </p>
                  </CardContent>
                </Card>
              </div>
            </div>

            {/* Seção Commands */}
            <div className="mb-6">
              <h2 className="text-2xl font-bold mb-4">Commands</h2>
              
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <Card>
                  <CardHeader>
                    <CardTitle>Resumo</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-3 mb-4">
                      <div className="flex justify-between items-center">
                        <span className="text-sm text-gray-600">Total:</span>
                        <span className="text-lg font-bold">{metrics.commands?.total || 0}</span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-sm text-gray-600">Sucesso:</span>
                        <Badge variant="default" className="bg-green-500">
                          {metrics.commands?.success || 0}
                        </Badge>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-sm text-gray-600">Falhas:</span>
                        <Badge variant="destructive">
                          {metrics.commands?.failures || 0}
                        </Badge>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-sm text-gray-600">Latência Média:</span>
                        <span className="text-lg font-semibold">
                          {metrics.commands?.avgLatency?.toFixed(2) || 0}ms
                        </span>
                      </div>
                    </div>
                    {typeof window !== 'undefined' && commandsChartSeries.length > 0 && (
                      <Chart
                        options={commandsChartOptions}
                        series={commandsChartSeries}
                        type="donut"
                        height={300}
                      />
                    )}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle>Por Command</CardTitle>
                  </CardHeader>
                  <CardContent>
                    {metrics.commands?.byCommand ? (
                      <div className="space-y-3">
                        {Object.entries(metrics.commands.byCommand).map(([command, stats]) => (
                          <div key={command} className="border-b pb-3 last:border-0">
                            <div className="flex justify-between items-center mb-2">
                              <span className="font-semibold">{command}</span>
                              <Badge variant={stats.failures > 0 ? "destructive" : "default"}>
                                {stats.success}/{stats.total}
                              </Badge>
                            </div>
                            <div className="text-sm text-gray-600">
                              Sucesso: {stats.success} | Falhas: {stats.failures}
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-gray-500 text-center py-8">Sem dados disponíveis</p>
                    )}
                  </CardContent>
                </Card>
              </div>
            </div>

            {/* Seção Events */}
            <div className="mb-6">
              <h2 className="text-2xl font-bold mb-4">Events</h2>
              
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <Card>
                  <CardHeader>
                    <CardTitle>Resumo</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-3 mb-4">
                      <div className="flex justify-between items-center">
                        <span className="text-sm text-gray-600">Publicados:</span>
                        <span className="text-lg font-bold">{metrics.events?.published || 0}</span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-sm text-gray-600">Consumidos:</span>
                        <span className="text-lg font-bold">{metrics.events?.consumed || 0}</span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-sm text-gray-600">Lag Médio:</span>
                        <span className="text-lg font-semibold">
                          {metrics.events?.lag?.toFixed(2) || 0}ms
                        </span>
                      </div>
                    </div>
                    {typeof window !== 'undefined' && eventsChartSeries.length > 0 && (
                      <Chart
                        options={eventsChartOptions}
                        series={eventsChartSeries}
                        type="area"
                        height={250}
                      />
                    )}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle>Por Tipo</CardTitle>
                  </CardHeader>
                  <CardContent>
                    {metrics.events?.byType ? (
                      <div className="space-y-3">
                        {Object.entries(metrics.events.byType).map(([eventType, stats]) => (
                          <div key={eventType} className="border-b pb-3 last:border-0">
                            <div className="flex justify-between items-center mb-2">
                              <span className="font-semibold">{eventType}</span>
                              <Badge variant="default">
                                {stats.published || 0} pub / {stats.consumed || 0} cons
                              </Badge>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-gray-500 text-center py-8">Sem dados disponíveis</p>
                    )}
                  </CardContent>
                </Card>
              </div>
            </div>

            {/* Seção Listeners */}
            <div className="mb-6">
              <h2 className="text-2xl font-bold mb-4">Listeners</h2>
              
              <Card>
                <CardHeader>
                  <CardTitle>Resumo</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
                    <div>
                      <div className="text-sm text-gray-600">Total</div>
                      <div className="text-2xl font-bold">{metrics.listeners?.total || 0}</div>
                    </div>
                    <div>
                      <div className="text-sm text-gray-600">Sucesso</div>
                      <div className="text-2xl font-bold text-green-600">
                        {metrics.listeners?.success || 0}
                      </div>
                    </div>
                    <div>
                      <div className="text-sm text-gray-600">Falhas</div>
                      <div className="text-2xl font-bold text-red-600">
                        {metrics.listeners?.failures || 0}
                      </div>
                    </div>
                    <div>
                      <div className="text-sm text-gray-600">Latência Média</div>
                      <div className="text-2xl font-bold">
                        {metrics.listeners?.avgLatency?.toFixed(2) || 0}ms
                      </div>
                    </div>
                  </div>
                  
                  {metrics.listeners?.byListener ? (
                    <div className="space-y-3">
                      <h3 className="font-semibold mb-3">Por Listener</h3>
                      {Object.entries(metrics.listeners.byListener).map(([listener, stats]) => (
                        <div key={listener} className="border-b pb-3 last:border-0">
                          <div className="flex justify-between items-center mb-2">
                            <span className="font-semibold">{listener}</span>
                            <Badge variant={stats.failures > 0 ? "destructive" : "default"}>
                              {stats.success}/{stats.total}
                            </Badge>
                          </div>
                          <div className="text-sm text-gray-600">
                            Sucesso: {stats.success} | Falhas: {stats.failures}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-gray-500 text-center py-8">Sem dados disponíveis</p>
                  )}
                </CardContent>
              </Card>
            </div>
          </>
        ) : (
          <div className="text-center py-12">
            <p className="text-gray-500">Não foi possível carregar métricas</p>
          </div>
        )}
      </div>
    </ProtectedRoute>
  )
}

// Função auxiliar para formatar uptime
function formatUptime(seconds) {
  if (!seconds) return '0s'
  
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  
  if (days > 0) return `${days}d ${hours}h`
  if (hours > 0) return `${hours}h ${minutes}m`
  return `${minutes}m`
}
