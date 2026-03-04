import Head from 'next/head'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/router'
import ProtectedRoute from '../components/ProtectedRoute'
import Navigation from '../components/Navigation'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import { Alert, AlertDescription } from '../components/ui/alert'
import { Badge } from '../components/ui/badge'
import { leafAPI } from '../services/api'
import { Button } from '../components/ui/button'
import { Check, X, ArrowLeft } from 'lucide-react'
import Link from 'next/link'

export default function DriverDocuments() {
  const router = useRouter()
  const { id } = router.query
  const [documents, setDocuments] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!id) return

    const fetchDocuments = async () => {
      try {
        setLoading(true)
        setError(null)
        const data = await leafAPI.getDriverDocuments(id)
        setDocuments(data.data || data)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Erro ao carregar documentos')
      } finally {
        setLoading(false)
      }
    }

    fetchDocuments()
  }, [id])

  const handleApproveAll = async () => {
    if (!confirm('Deseja aprovar este motorista e todos os seus documentos?')) return

    try {
      setLoading(true)
      await leafAPI.approveDriverApplication(id)
      // Recarregar dados
      const data = await leafAPI.getDriverDocuments(id)
      setDocuments(data.data || data)
      alert('Motorista aprovado com sucesso!')
    } catch (err) {
      alert('Erro ao aprovar motorista: ' + (err instanceof Error ? err.message : 'Erro desconhecido'))
    } finally {
      setLoading(false)
    }
  }

  const handleReject = async () => {
    const reason = prompt('Motivo da rejeição:')
    if (!reason) return

    try {
      setLoading(true)
      await leafAPI.rejectDriverApplication(id, [reason])
      // Recarregar dados
      const data = await leafAPI.getDriverDocuments(id)
      setDocuments(data.data || data)
      alert('Motorista rejeitado.')
    } catch (err) {
      alert('Erro ao rejeitar motorista: ' + (err instanceof Error ? err.message : 'Erro desconhecido'))
    } finally {
      setLoading(false)
    }
  }

  const getStatusBadge = (status) => {
    const variants = {
      approved: 'default',
      pending: 'secondary',
      rejected: 'destructive',
      analyzing: 'default'
    }
    const labels = {
      approved: 'Aprovado',
      pending: 'Pendente',
      rejected: 'Rejeitado',
      analyzing: 'Em Análise'
    }
    return <Badge variant={variants[status] || 'secondary'}>{labels[status] || status}</Badge>
  }

  if (!id) {
    return (
      <ProtectedRoute>
        <Head>
          <title>Documentos - Leaf Dashboard</title>
        </Head>
        <div className="min-h-screen bg-background">
          <Navigation />
          <div className="p-8">
            <Alert>
              <AlertDescription>ID do motorista não fornecido.</AlertDescription>
            </Alert>
          </div>
        </div>
      </ProtectedRoute>
    )
  }

  return (
    <ProtectedRoute>
      <Head>
        <title>Documentos - Leaf Dashboard</title>
      </Head>
      <div className="min-h-screen bg-background">
        <Navigation />
        <div className="p-8">
          <div className="flex justify-between items-center mb-6">
            <h1 className="text-3xl font-bold">Documentos de Motorista</h1>
            <div className="flex gap-2">
              <Button
                variant="default"
                className="bg-green-600 hover:bg-green-700 gap-2"
                onClick={handleApproveAll}
                disabled={loading || documents?.driver?.status === 'approved'}
              >
                <Check className="h-4 w-4" />
                Aprovar Motorista
              </Button>
              <Button
                variant="destructive"
                className="gap-2"
                onClick={handleReject}
                disabled={loading || documents?.driver?.status === 'rejected'}
              >
                <X className="h-4 w-4" />
                Rejeitar Motorista
              </Button>
            </div>
          </div>

          {loading && (
            <Alert>
              <AlertDescription>Carregando documentos...</AlertDescription>
            </Alert>
          )}

          {error && (
            <Alert variant="destructive">
              <AlertDescription>Erro: {error}</AlertDescription>
            </Alert>
          )}

          {!loading && !error && documents && (
            <>
              <Card className="mb-6">
                <CardHeader>
                  <CardTitle>Informações do Motorista</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div>
                      <div className="text-sm text-muted-foreground">Nome</div>
                      <div className="font-medium">{documents.driver?.name || 'N/A'}</div>
                    </div>
                    <div>
                      <div className="text-sm text-muted-foreground">Email</div>
                      <div className="font-medium">{documents.driver?.email || 'N/A'}</div>
                    </div>
                    <div>
                      <div className="text-sm text-muted-foreground">Telefone</div>
                      <div className="font-medium">{documents.driver?.phone || 'N/A'}</div>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Documentos ({documents.totalDocuments || 0})</CardTitle>
                </CardHeader>
                <CardContent>
                  {documents.documents && Object.keys(documents.documents).length > 0 ? (
                    <div className="space-y-4">
                      {Object.values(documents.documents).map((doc, index) => (
                        <Card key={index}>
                          <CardContent className="pt-6">
                            <div className="flex justify-between items-start">
                              <div>
                                <div className="font-semibold">{doc.type?.toUpperCase() || 'Documento'}</div>
                                {doc.url && (
                                  <a
                                    href={doc.url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-sm text-blue-600 hover:underline"
                                  >
                                    Ver documento
                                  </a>
                                )}
                              </div>
                              {getStatusBadge(doc.status)}
                            </div>
                            {doc.rejectionReason && (
                              <Alert variant="destructive" className="mt-2">
                                <AlertDescription>Motivo da rejeição: {doc.rejectionReason}</AlertDescription>
                              </Alert>
                            )}
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  ) : (
                    <Alert>
                      <AlertDescription>Nenhum documento encontrado.</AlertDescription>
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
