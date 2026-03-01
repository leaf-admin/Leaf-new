import Head from 'next/head'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/router'
import ProtectedRoute from '../components/ProtectedRoute'
import Navigation from '../components/Navigation'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import { Alert, AlertDescription } from '../components/ui/alert'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs'
import { leafAPI } from '../services/api'
import { ArrowLeft, User, Truck, FileText, Star, DollarSign, Calendar, MapPin, Shield } from 'lucide-react'

export default function UserDetails() {
  const router = useRouter()
  const { id } = router.query
  const [user, setUser] = useState(null)
  const [driverData, setDriverData] = useState(null)
  const [documents, setDocuments] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!id) return

    const fetchUserDetails = async () => {
      try {
        setLoading(true)
        setError(null)

        // Buscar dados básicos do usuário
        const userData = await leafAPI.getUserDetails(id).catch(() => null)
        
        // Se for motorista, buscar dados completos
        if (userData?.type === 'driver' || userData?.usertype === 'driver') {
          const [completeData, docsData] = await Promise.all([
            leafAPI.getDriverComplete(id).catch(() => null),
            leafAPI.getDriverDocuments(id).catch(() => null)
          ])
          setDriverData(completeData)
          setDocuments(docsData?.data || docsData)
        }

        setUser(userData)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Erro ao carregar dados do usuário')
      } finally {
        setLoading(false)
      }
    }

    fetchUserDetails()
  }, [id])

  if (!id) {
    return (
      <ProtectedRoute>
        <Head>
          <title>Detalhes do Usuário - Leaf Dashboard</title>
        </Head>
        <div className="min-h-screen bg-background">
          <Navigation />
          <div className="p-8">
            <Alert>
              <AlertDescription>ID do usuário não fornecido.</AlertDescription>
            </Alert>
          </div>
        </div>
      </ProtectedRoute>
    )
  }

  const isDriver = user?.type === 'driver' || user?.usertype === 'driver'
  const displayData = isDriver && driverData ? driverData : user

  return (
    <ProtectedRoute>
      <Head>
        <title>Detalhes do Usuário - Leaf Dashboard</title>
      </Head>
      <div className="min-h-screen bg-background">
        <Navigation />
        <div className="p-8">
          <Button
            variant="ghost"
            onClick={() => router.back()}
            className="mb-4"
          >
            <ArrowLeft className="h-4 w-4 mr-2" />
            Voltar
          </Button>

          {loading && (
            <Alert>
              <AlertDescription>Carregando dados do usuário...</AlertDescription>
            </Alert>
          )}

          {error && (
            <Alert variant="destructive">
              <AlertDescription>Erro: {error}</AlertDescription>
            </Alert>
          )}

          {!loading && !error && displayData && (
            <>
              {/* Cabeçalho do usuário */}
              <Card className="mb-6">
                <CardContent className="pt-6">
                  <div className="flex items-start gap-6">
                    {displayData.profileImage && (
                      <img
                        src={displayData.profileImage}
                        alt={displayData.name}
                        className="w-24 h-24 rounded-full object-cover"
                      />
                    )}
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-2">
                        <h1 className="text-3xl font-bold">{displayData.name || 'Sem nome'}</h1>
                        {isDriver ? (
                          <Badge variant="default">Motorista</Badge>
                        ) : (
                          <Badge variant="secondary">Cliente</Badge>
                        )}
                        {displayData.status && (
                          <Badge variant={displayData.status === 'active' ? 'default' : 'secondary'}>
                            {displayData.status === 'active' ? 'Ativo' : displayData.status}
                          </Badge>
                        )}
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
                        <div>
                          <span className="text-muted-foreground">Email:</span>
                          <span className="ml-2 font-medium">{displayData.email || 'N/A'}</span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Telefone:</span>
                          <span className="ml-2 font-medium">{displayData.phone || displayData.mobile || 'N/A'}</span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">ID:</span>
                          <span className="ml-2 font-mono text-xs">{id}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Tabs com informações detalhadas */}
              <Tabs defaultValue="overview" className="space-y-4">
                <TabsList>
                  <TabsTrigger value="overview">Visão Geral</TabsTrigger>
                  {isDriver && <TabsTrigger value="documents">Documentos</TabsTrigger>}
                  {isDriver && <TabsTrigger value="vehicle">Veículo</TabsTrigger>}
                  {isDriver && <TabsTrigger value="stats">Estatísticas</TabsTrigger>}
                  {isDriver && driverData?.plan && <TabsTrigger value="subscription">Assinatura</TabsTrigger>}
                </TabsList>

                <TabsContent value="overview">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <Card>
                      <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                          <User className="h-5 w-5" />
                          Informações Pessoais
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-2">
                        <div>
                          <span className="text-sm text-muted-foreground">Nome Completo:</span>
                          <div className="font-medium">{displayData.name || 'N/A'}</div>
                        </div>
                        <div>
                          <span className="text-sm text-muted-foreground">Email:</span>
                          <div className="font-medium">{displayData.email || 'N/A'}</div>
                        </div>
                        <div>
                          <span className="text-sm text-muted-foreground">Telefone:</span>
                          <div className="font-medium">{displayData.phone || displayData.mobile || 'N/A'}</div>
                        </div>
                        {displayData.location && (
                          <div>
                            <span className="text-sm text-muted-foreground">Localização:</span>
                            <div className="font-medium">
                              {displayData.location.city || ''} {displayData.location.state ? `- ${displayData.location.state}` : ''}
                            </div>
                          </div>
                        )}
                        <div>
                          <span className="text-sm text-muted-foreground">Data de Registro:</span>
                          <div className="font-medium">
                            {displayData.registrationDate ? new Date(displayData.registrationDate).toLocaleDateString('pt-BR') : 'N/A'}
                          </div>
                        </div>
                        <div>
                          <span className="text-sm text-muted-foreground">Última Atividade:</span>
                          <div className="font-medium">
                            {displayData.lastActivity ? new Date(displayData.lastActivity).toLocaleDateString('pt-BR') : 'N/A'}
                          </div>
                        </div>
                      </CardContent>
                    </Card>

                    <Card>
                      <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                          <Star className="h-5 w-5" />
                          Avaliações e Estatísticas
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-2">
                        {isDriver && driverData?.stats ? (
                          <>
                            <div>
                              <span className="text-sm text-muted-foreground">Avaliação Média:</span>
                              <div className="font-medium text-lg">{driverData.stats.averageRating || '0.0'} ⭐</div>
                            </div>
                            <div>
                              <span className="text-sm text-muted-foreground">Total de Corridas:</span>
                              <div className="font-medium">{driverData.stats.totalTrips || 0}</div>
                            </div>
                            <div>
                              <span className="text-sm text-muted-foreground">Corridas Completadas:</span>
                              <div className="font-medium">{driverData.stats.completedTrips || 0}</div>
                            </div>
                            <div>
                              <span className="text-sm text-muted-foreground">Total Ganho:</span>
                              <div className="font-medium text-green-600">
                                R$ {parseFloat(driverData.stats.totalEarnings || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                              </div>
                            </div>
                            <div>
                              <span className="text-sm text-muted-foreground">Saldo na Carteira:</span>
                              <div className="font-medium">
                                R$ {parseFloat(driverData.stats.walletBalance || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                              </div>
                            </div>
                          </>
                        ) : (
                          <>
                            <div>
                              <span className="text-sm text-muted-foreground">Total de Corridas:</span>
                              <div className="font-medium">{user?.totalTrips || 0}</div>
                            </div>
                            <div>
                              <span className="text-sm text-muted-foreground">Total Gasto:</span>
                              <div className="font-medium">
                                R$ {parseFloat(user?.totalSpent || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                              </div>
                            </div>
                            <div>
                              <span className="text-sm text-muted-foreground">Avaliação:</span>
                              <div className="font-medium">{user?.rating || '0.0'} ⭐</div>
                            </div>
                          </>
                        )}
                      </CardContent>
                    </Card>
                  </div>
                </TabsContent>

                {isDriver && (
                  <>
                    <TabsContent value="documents">
                      <Card>
                        <CardHeader>
                          <CardTitle className="flex items-center gap-2">
                            <FileText className="h-5 w-5" />
                            Documentos
                          </CardTitle>
                        </CardHeader>
                        <CardContent>
                          {documents && documents.documents && Object.keys(documents.documents).length > 0 ? (
                            <div className="space-y-4">
                              {Object.values(documents.documents).map((doc, index) => (
                                <Card key={index}>
                                  <CardContent className="pt-6">
                                    <div className="flex justify-between items-start">
                                      <div>
                                        <div className="font-semibold mb-2">{doc.type?.toUpperCase() || 'Documento'}</div>
                                        <Badge variant={doc.status === 'approved' ? 'default' : doc.status === 'rejected' ? 'destructive' : 'secondary'}>
                                          {doc.status === 'approved' ? 'Aprovado' : doc.status === 'rejected' ? 'Rejeitado' : 'Pendente'}
                                        </Badge>
                                        {doc.url && (
                                          <a
                                            href={doc.url}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="ml-2 text-blue-600 hover:underline text-sm"
                                          >
                                            Ver documento
                                          </a>
                                        )}
                                      </div>
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
                    </TabsContent>

                    <TabsContent value="vehicle">
                      {driverData?.vehicle ? (
                        <Card>
                          <CardHeader>
                            <CardTitle className="flex items-center gap-2">
                              <Truck className="h-5 w-5" />
                              Veículo
                            </CardTitle>
                          </CardHeader>
                          <CardContent className="space-y-2">
                            <div>
                              <span className="text-sm text-muted-foreground">Marca:</span>
                              <div className="font-medium">{driverData.vehicle.make || 'N/A'}</div>
                            </div>
                            <div>
                              <span className="text-sm text-muted-foreground">Modelo:</span>
                              <div className="font-medium">{driverData.vehicle.model || 'N/A'}</div>
                            </div>
                            <div>
                              <span className="text-sm text-muted-foreground">Placa:</span>
                              <div className="font-medium">{driverData.vehicle.plate || 'N/A'}</div>
                            </div>
                            <div>
                              <span className="text-sm text-muted-foreground">Cor:</span>
                              <div className="font-medium">{driverData.vehicle.color || 'N/A'}</div>
                            </div>
                            <div>
                              <span className="text-sm text-muted-foreground">Ano:</span>
                              <div className="font-medium">{driverData.vehicle.year || 'N/A'}</div>
                            </div>
                            {driverData.vehicle.image && (
                              <div>
                                <span className="text-sm text-muted-foreground">Imagem:</span>
                                <div className="mt-2">
                                  <img
                                    src={driverData.vehicle.image}
                                    alt="Veículo"
                                    className="max-w-md rounded-lg"
                                  />
                                </div>
                              </div>
                            )}
                          </CardContent>
                        </Card>
                      ) : (
                        <Alert>
                          <AlertDescription>Nenhum veículo cadastrado.</AlertDescription>
                        </Alert>
                      )}
                    </TabsContent>

                    <TabsContent value="stats">
                      {driverData?.stats && (
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                          <Card>
                            <CardContent className="pt-6">
                              <div className="text-2xl font-bold">{driverData.stats.totalTrips || 0}</div>
                              <div className="text-sm text-muted-foreground">Total de Corridas</div>
                            </CardContent>
                          </Card>
                          <Card>
                            <CardContent className="pt-6">
                              <div className="text-2xl font-bold">{driverData.stats.completedTrips || 0}</div>
                              <div className="text-sm text-muted-foreground">Completadas</div>
                            </CardContent>
                          </Card>
                          <Card>
                            <CardContent className="pt-6">
                              <div className="text-2xl font-bold text-green-600">
                                R$ {parseFloat(driverData.stats.totalEarnings || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                              </div>
                              <div className="text-sm text-muted-foreground">Total Ganho</div>
                            </CardContent>
                          </Card>
                          <Card>
                            <CardContent className="pt-6">
                              <div className="text-2xl font-bold">{driverData.stats.averageRating || '0.0'} ⭐</div>
                              <div className="text-sm text-muted-foreground">Avaliação Média</div>
                            </CardContent>
                          </Card>
                        </div>
                      )}
                    </TabsContent>

                    {driverData?.plan && (
                      <TabsContent value="subscription">
                        <Card>
                          <CardHeader>
                            <CardTitle className="flex items-center gap-2">
                              <Shield className="h-5 w-5" />
                              Assinatura
                            </CardTitle>
                          </CardHeader>
                          <CardContent className="space-y-2">
                            <div>
                              <span className="text-sm text-muted-foreground">Plano:</span>
                              <div className="font-medium">{driverData.plan.name || 'Sem Plano'}</div>
                            </div>
                            <div>
                              <span className="text-sm text-muted-foreground">Status:</span>
                              <Badge variant={driverData.plan.status === 'active' ? 'default' : 'secondary'}>
                                {driverData.plan.status === 'active' ? 'Ativo' : driverData.plan.status}
                              </Badge>
                            </div>
                            {driverData.plan.isFree && (
                              <div>
                                <span className="text-sm text-muted-foreground">Período Grátis:</span>
                                <div className="font-medium">{driverData.plan.freeReason}</div>
                                {driverData.plan.freeUntil && (
                                  <div className="text-sm text-muted-foreground">
                                    Até: {new Date(driverData.plan.freeUntil).toLocaleDateString('pt-BR')}
                                  </div>
                                )}
                              </div>
                            )}
                            {driverData.plan.nextRenewal && (
                              <div>
                                <span className="text-sm text-muted-foreground">Próxima Renovação:</span>
                                <div className="font-medium">
                                  {new Date(driverData.plan.nextRenewal).toLocaleDateString('pt-BR')}
                                  {driverData.plan.daysUntilRenewal && (
                                    <span className="ml-2 text-sm text-muted-foreground">
                                      ({driverData.plan.daysUntilRenewal} dias)
                                    </span>
                                  )}
                                </div>
                              </div>
                            )}
                            <div>
                              <span className="text-sm text-muted-foreground">Taxa Semanal:</span>
                              <div className="font-medium">
                                R$ {parseFloat(driverData.plan.weeklyFee || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                              </div>
                            </div>
                          </CardContent>
                        </Card>
                      </TabsContent>
                    )}
                  </>
                )}
              </Tabs>
            </>
          )}
        </div>
      </div>
    </ProtectedRoute>
  )
}

