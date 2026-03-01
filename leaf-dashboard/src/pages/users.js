import Head from 'next/head'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/router'
import ProtectedRoute from '../components/ProtectedRoute'
import Navigation from '../components/Navigation'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import { Alert, AlertDescription } from '../components/ui/alert'
import { Input } from '../components/ui/input'
import { Button } from '../components/ui/button'
import { Badge } from '../components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../components/ui/dialog'
import { leafAPI } from '../services/api'
import { Users, Search, Filter, FileText, Check, X, Star, Shield } from 'lucide-react'

export default function UsersPage() {
  const router = useRouter()
  const [users, setUsers] = useState([])
  const [pagination, setPagination] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  
  // Filtros
  const [type, setType] = useState('all')
  const [status, setStatus] = useState('all')
  const [searchTerm, setSearchTerm] = useState('')
  const [sortBy, setSortBy] = useState('registrationDate')
  const [sortOrder, setSortOrder] = useState('desc')
  const [page, setPage] = useState(1)
  const [dateRange, setDateRange] = useState('')
  const limit = 20

  // Modal de documentos
  const [selectedDriver, setSelectedDriver] = useState(null)
  const [documents, setDocuments] = useState(null)
  const [documentsLoading, setDocumentsLoading] = useState(false)
  const [reviewingDoc, setReviewingDoc] = useState(null)
  const [rejectionReason, setRejectionReason] = useState('')

  useEffect(() => {
    let mounted = true
    let isFirstLoad = true

    const fetchUsers = async () => {
      try {
        if (isFirstLoad && mounted) {
          setLoading(true)
        }
        setError(null)
        
        const params = {
          type: type !== 'all' ? type : undefined,
          status: status !== 'all' ? status : undefined,
          searchTerm: searchTerm || undefined,
          sortBy,
          sortOrder,
          page,
          limit,
          dateRange: dateRange || undefined
        }
        
        const data = await leafAPI.getUsers(params)
        
        if (mounted) {
          setUsers(data.users || [])
          setPagination(data.pagination)
          if (isFirstLoad) {
            setLoading(false)
            isFirstLoad = false
          }
        }
      } catch (err) {
        if (mounted) {
          setError(err instanceof Error ? err.message : 'Erro ao carregar usuários')
          if (isFirstLoad) {
            setLoading(false)
            isFirstLoad = false
          }
        }
      }
    }

    fetchUsers()
    const interval = setInterval(fetchUsers, 30000)

    return () => {
      mounted = false
      clearInterval(interval)
    }
  }, [type, status, searchTerm, sortBy, sortOrder, page, dateRange])

  // Carregar documentos quando abrir modal
  const handleViewDocuments = async (user) => {
    if (user.type !== 'driver') return
    
    setSelectedDriver(user)
    setDocumentsLoading(true)
    setDocuments(null)
    
    try {
      const data = await leafAPI.getDriverDocuments(user.id)
      setDocuments(data.data || data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao carregar documentos')
    } finally {
      setDocumentsLoading(false)
    }
  }

  // Aprovar/Rejeitar documento
  const handleReviewDocument = async (documentType, action, reason = '') => {
    if (!selectedDriver) return
    
    setReviewingDoc(documentType)
    
    try {
      await leafAPI.reviewDriverDocument(selectedDriver.id, documentType, action, reason)
      
      // Recarregar documentos
      const data = await leafAPI.getDriverDocuments(selectedDriver.id)
      setDocuments(data.data || data)
      setRejectionReason('')
      setReviewingDoc(null)
      
      // Recarregar lista de usuários
      const usersData = await leafAPI.getUsers({
        type: type !== 'all' ? type : undefined,
        status: status !== 'all' ? status : undefined,
        searchTerm: searchTerm || undefined,
        sortBy,
        sortOrder,
        page,
        limit,
        dateRange: dateRange || undefined
      })
      setUsers(usersData.users || [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao revisar documento')
      setReviewingDoc(null)
    }
  }

  const getTypeBadge = (type) => {
    return type === 'driver' ? (
      <Badge variant="default" className="gap-1">
        <Shield className="h-3 w-3" />
        Motorista
      </Badge>
    ) : (
      <Badge variant="secondary">Cliente</Badge>
    )
  }

  const getStatusBadge = (status) => {
    const variants = {
      active: 'default',
      pending: 'secondary',
      suspended: 'destructive'
    }
    const labels = {
      active: 'Ativo',
      pending: 'Pendente',
      suspended: 'Suspenso'
    }
    return <Badge variant={variants[status] || 'secondary'}>{labels[status] || status}</Badge>
  }

  const getDocumentStatusBadge = (status) => {
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

  return (
    <ProtectedRoute>
      <Head>
        <title>Usuários - Leaf Dashboard</title>
      </Head>
      <div className="min-h-screen bg-background">
        <Navigation />
        <div className="p-8">
          <div className="flex justify-between items-center mb-6">
            <h1 className="text-3xl font-bold">Usuários</h1>
            <div className="flex items-center gap-2">
              <Users className="h-6 w-6" />
              <span className="text-sm text-muted-foreground">
                {pagination?.total || 0} usuários
              </span>
            </div>
          </div>

          {/* Filtros */}
          <Card className="mb-6">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Filter className="h-5 w-5" />
                Filtros
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
                <div>
                  <label className="text-sm font-medium mb-2 block">Tipo</label>
                  <select
                    value={type}
                    onChange={(e) => { setType(e.target.value); setPage(1) }}
                    className="w-full px-3 py-2 border rounded-md"
                  >
                    <option value="all">Todos</option>
                    <option value="driver">Motoristas</option>
                    <option value="customer">Clientes</option>
                  </select>
                </div>
                <div>
                  <label className="text-sm font-medium mb-2 block">Status</label>
                  <select
                    value={status}
                    onChange={(e) => { setStatus(e.target.value); setPage(1) }}
                    className="w-full px-3 py-2 border rounded-md"
                  >
                    <option value="all">Todos</option>
                    <option value="active">Ativo</option>
                    <option value="pending">Pendente</option>
                    <option value="suspended">Suspenso</option>
                  </select>
                </div>
                <div>
                  <label className="text-sm font-medium mb-2 block">Ordenar por</label>
                  <select
                    value={sortBy}
                    onChange={(e) => { setSortBy(e.target.value); setPage(1) }}
                    className="w-full px-3 py-2 border rounded-md"
                  >
                    <option value="registrationDate">Data de Registro</option>
                    <option value="lastActivity">Última Atividade</option>
                    <option value="totalTrips">Total de Corridas</option>
                    <option value="rating">Avaliação</option>
                    <option value="totalSpent">Total Gasto</option>
                  </select>
                </div>
                <div>
                  <label className="text-sm font-medium mb-2 block">Ordem</label>
                  <select
                    value={sortOrder}
                    onChange={(e) => { setSortOrder(e.target.value); setPage(1) }}
                    className="w-full px-3 py-2 border rounded-md"
                  >
                    <option value="desc">Decrescente</option>
                    <option value="asc">Crescente</option>
                  </select>
                </div>
                <div>
                  <label className="text-sm font-medium mb-2 block">Período</label>
                  <Input
                    type="date"
                    value={dateRange ? dateRange.split(',')[0] : ''}
                    onChange={(e) => {
                      const start = e.target.value
                      const end = dateRange.split(',')[1] || ''
                      setDateRange(start && end ? `${start},${end}` : start)
                      setPage(1)
                    }}
                    placeholder="Data inicial"
                  />
                </div>
              </div>
              <div className="mt-4">
                <div className="flex gap-2">
                  <div className="flex-1 relative">
                    <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      placeholder="Buscar por nome, email ou telefone..."
                      value={searchTerm}
                      onChange={(e) => { setSearchTerm(e.target.value); setPage(1) }}
                      className="pl-10"
                    />
                  </div>
                  {dateRange && (
                    <Button
                      variant="outline"
                      onClick={() => { setDateRange(''); setPage(1) }}
                    >
                      Limpar Filtros
                    </Button>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>

          {loading && (
            <Alert>
              <AlertDescription>Carregando usuários...</AlertDescription>
            </Alert>
          )}

          {error && (
            <Alert variant="destructive">
              <AlertDescription>Erro: {error}</AlertDescription>
            </Alert>
          )}

          {!loading && !error && (
            <>
              {/* Lista de usuários */}
              <div className="space-y-4">
                {users.length === 0 ? (
                  <Alert>
                    <AlertDescription>Nenhum usuário encontrado.</AlertDescription>
                  </Alert>
                ) : (
                  users.map((user) => (
                    <Card
                      key={user.id}
                      className="hover:shadow-md transition-shadow"
                    >
                      <CardContent className="pt-6">
                        <div className="flex justify-between items-start">
                          <div className="flex-1">
                            <div className="flex items-center gap-3 mb-2">
                              <h3 className="text-lg font-semibold">{user.name || 'Sem nome'}</h3>
                              {getTypeBadge(user.type)}
                              {getStatusBadge(user.status)}
                              {user.type === 'driver' && user.rating && (
                                <Badge variant="outline" className="gap-1">
                                  <Star className="h-3 w-3 fill-yellow-400 text-yellow-400" />
                                  {parseFloat(user.rating || 0).toFixed(1)}
                                </Badge>
                              )}
                            </div>
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm text-muted-foreground">
                              <div>
                                <span className="font-medium">Email:</span> {user.email || 'N/A'}
                              </div>
                              <div>
                                <span className="font-medium">Telefone:</span> {user.phone || 'N/A'}
                              </div>
                              <div>
                                <span className="font-medium">Corridas:</span> {user.totalTrips || 0}
                              </div>
                              {user.type === 'driver' ? (
                                <div>
                                  <span className="font-medium">Ganhos:</span> R$ {parseFloat(user.totalEarned || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                                </div>
                              ) : (
                                <div>
                                  <span className="font-medium">Gastos:</span> R$ {parseFloat(user.totalSpent || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                                </div>
                              )}
                            </div>
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm text-muted-foreground mt-2">
                              <div>
                                <span className="font-medium">Registrado:</span> {user.registrationDate ? new Date(user.registrationDate).toLocaleDateString('pt-BR') : 'N/A'}
                              </div>
                              <div>
                                <span className="font-medium">Última Atividade:</span> {user.lastActivity ? new Date(user.lastActivity).toLocaleDateString('pt-BR') : 'N/A'}
                              </div>
                              {user.type === 'driver' && user.documents && (
                                <div>
                                  <span className="font-medium">Documentos:</span> {user.documents.verified ? 'Verificado' : 'Pendente'}
                                </div>
                              )}
                            </div>
                          </div>
                          <div className="flex flex-col gap-2">
                            {user.type === 'driver' && (
                              <Button 
                                variant="outline" 
                                size="sm"
                                onClick={() => handleViewDocuments(user)}
                                className="gap-2"
                              >
                                <FileText className="h-4 w-4" />
                                Ver Documentos
                              </Button>
                            )}
                            <Button 
                              variant="outline" 
                              size="sm"
                              onClick={() => router.push(`/user-details?id=${user.id}`)}
                            >
                              Ver Detalhes
                            </Button>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))
                )}
              </div>

              {/* Paginação */}
              {pagination && pagination.pages > 1 && (
                <div className="mt-6 flex justify-center items-center gap-2">
                  <Button
                    variant="outline"
                    onClick={() => setPage(p => Math.max(1, p - 1))}
                    disabled={page === 1}
                  >
                    Anterior
                  </Button>
                  <span className="px-4 py-2 text-sm">
                    Página {pagination.page} de {pagination.pages}
                  </span>
                  <Button
                    variant="outline"
                    onClick={() => setPage(p => Math.min(pagination.pages, p + 1))}
                    disabled={page === pagination.pages}
                  >
                    Próxima
                  </Button>
                </div>
              )}
            </>
          )}

          {/* Modal de Documentos */}
          <Dialog open={!!selectedDriver} onOpenChange={(open) => !open && setSelectedDriver(null)}>
            <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>Documentos - {selectedDriver?.name}</DialogTitle>
                <DialogDescription>
                  {selectedDriver?.phone} • {selectedDriver?.email}
                </DialogDescription>
              </DialogHeader>
              
              {documentsLoading ? (
                <Alert>
                  <AlertDescription>Carregando documentos...</AlertDescription>
                </Alert>
              ) : documents && documents.documents ? (
                <div className="space-y-4">
                  {Object.entries(documents.documents).map(([docType, doc]) => (
                    <Card key={docType}>
                      <CardContent className="pt-6">
                        <div className="flex justify-between items-start mb-4">
                          <div>
                            <div className="font-semibold text-lg mb-1">
                              {docType.toUpperCase().replace('_', ' ')}
                            </div>
                            {doc.url && (
                              <a
                                href={doc.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-sm text-blue-600 hover:underline flex items-center gap-1"
                              >
                                <FileText className="h-4 w-4" />
                                Ver documento
                              </a>
                            )}
                          </div>
                          {getDocumentStatusBadge(doc.status)}
                        </div>
                        
                        {doc.rejectionReason && (
                          <Alert variant="destructive" className="mb-4">
                            <AlertDescription>
                              <strong>Motivo da rejeição:</strong> {doc.rejectionReason}
                            </AlertDescription>
                          </Alert>
                        )}
                        
                        {doc.status === 'pending' && (
                          <div className="flex gap-2">
                            <Button
                              size="sm"
                              onClick={() => handleReviewDocument(docType, 'approve')}
                              disabled={reviewingDoc === docType}
                              className="gap-2"
                            >
                              <Check className="h-4 w-4" />
                              Aprovar
                            </Button>
                            <Button
                              variant="destructive"
                              size="sm"
                              onClick={() => {
                                const reason = prompt('Motivo da rejeição:')
                                if (reason) {
                                  handleReviewDocument(docType, 'reject', reason)
                                }
                              }}
                              disabled={reviewingDoc === docType}
                              className="gap-2"
                            >
                              <X className="h-4 w-4" />
                              Rejeitar
                            </Button>
                          </div>
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
            </DialogContent>
          </Dialog>
        </div>
      </div>
    </ProtectedRoute>
  )
}
