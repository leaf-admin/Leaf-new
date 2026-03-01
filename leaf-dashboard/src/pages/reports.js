import Head from 'next/head'
import { useState, useEffect } from 'react'
import ProtectedRoute from '../components/ProtectedRoute'
import Navigation from '../components/Navigation'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import { Alert, AlertDescription } from '../components/ui/alert'
import { Button } from '../components/ui/button'
import { leafAPI } from '../services/api'

export default function Reports() {
  const [reports, setReports] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    let mounted = true
    let isFirstLoad = true

    const fetchReports = async () => {
      try {
        if (isFirstLoad && mounted) {
          setLoading(true)
        }
        setError(null)
        const data = await leafAPI.getReports()
        if (mounted) {
          setReports(data.reports || [])
          if (isFirstLoad) {
            setLoading(false)
            isFirstLoad = false
          }
        }
      } catch (err) {
        if (mounted) {
          setError(err instanceof Error ? err.message : 'Erro ao carregar relatórios')
          if (isFirstLoad) {
            setLoading(false)
            isFirstLoad = false
          }
        }
      }
    }

    fetchReports()
  }, [])

  const handleGenerateReport = async (reportId, format = 'pdf') => {
    try {
      const url = `${process.env.NEXT_PUBLIC_API_URL || 'https://dashboard.leaf.app.br/api'}/reports/generate/${reportId}?format=${format}`
      window.open(url, '_blank')
    } catch (err) {
      console.error('Erro ao gerar relatório:', err)
    }
  }

  return (
    <ProtectedRoute>
      <Head>
        <title>Relatórios - Leaf Dashboard</title>
      </Head>
      <div className="min-h-screen bg-background">
        <Navigation />
        <div className="p-8">
          <h1 className="text-3xl font-bold mb-6">Relatórios</h1>

          {loading && (
            <Alert>
              <AlertDescription>Carregando relatórios...</AlertDescription>
            </Alert>
          )}

          {error && (
            <Alert variant="destructive">
              <AlertDescription>Erro: {error}</AlertDescription>
            </Alert>
          )}

          {!loading && !error && (
            <div className="space-y-4">
              {reports.length === 0 ? (
                <Alert>
                  <AlertDescription>Nenhum relatório pré-configurado disponível.</AlertDescription>
                </Alert>
              ) : (
                reports.map((report) => (
                  <Card key={report.id}>
                    <CardHeader>
                      <CardTitle>{report.name || report.title}</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-2">
                        {report.description && (
                          <p className="text-sm text-muted-foreground">{report.description}</p>
                        )}
                        <div className="flex gap-2">
                          <Button
                            onClick={() => handleGenerateReport(report.id, 'pdf')}
                            variant="outline"
                          >
                            Gerar PDF
                          </Button>
                          <Button
                            onClick={() => handleGenerateReport(report.id, 'excel')}
                            variant="outline"
                          >
                            Gerar Excel
                          </Button>
                        </div>
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
