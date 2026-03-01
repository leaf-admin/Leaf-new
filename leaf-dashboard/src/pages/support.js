import Head from 'next/head'
import { useState, useEffect, useRef } from 'react'
import ProtectedRoute from '../components/ProtectedRoute'
import Navigation from '../components/Navigation'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import { Alert, AlertDescription } from '../components/ui/alert'
import { Input } from '../components/ui/input'
import { Button } from '../components/ui/button'
import { Badge } from '../components/ui/badge'
import { leafAPI } from '../services/api'
import { wsService } from '../services/websocket-service'
import { MessageCircle, Send, User, Clock, Search } from 'lucide-react'

export default function Support() {
  const [tickets, setTickets] = useState([])
  const [selectedTicket, setSelectedTicket] = useState(null)
  const [messages, setMessages] = useState([])
  const [newMessage, setNewMessage] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [searchTerm, setSearchTerm] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const messagesEndRef = useRef(null)
  const [sending, setSending] = useState(false)
  const [userInfo, setUserInfo] = useState(null) // ✅ Informações do usuário do chat

  // Scroll para última mensagem
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  useEffect(() => {
    scrollToBottom()
  }, [messages])

  // Carregar tickets
  useEffect(() => {
    let mounted = true
    let isFirstLoad = true

    const fetchTickets = async () => {
      try {
        if (isFirstLoad && mounted) {
          setLoading(true)
        }
        setError(null)
        
        const params = {
          status: statusFilter !== 'all' ? statusFilter : undefined,
          page: 1,
          limit: 100
        }
        
        const data = await leafAPI.getSupportTickets(params)
        
        if (mounted) {
          // Ordenar tickets: mais recentes primeiro
          const sortedTickets = (data.tickets || []).sort((a, b) => {
            const dateA = new Date(a.createdAt || 0)
            const dateB = new Date(b.createdAt || 0)
            return dateB - dateA
          })
          setTickets(sortedTickets)
          if (isFirstLoad) {
            setLoading(false)
            isFirstLoad = false
          }
        }
      } catch (err) {
        if (mounted) {
          setError(err instanceof Error ? err.message : 'Erro ao carregar tickets')
          if (isFirstLoad) {
            setLoading(false)
            isFirstLoad = false
          }
        }
      }
    }

    fetchTickets()
    
    // Conectar WebSocket para receber novos tickets em tempo real
    const connectWebSocket = async () => {
      try {
        await wsService.connect()
        
        // Escutar novos tickets
        const handleNewTicket = (data) => {
          if (mounted) {
            setTickets(prev => {
              // Verificar se o ticket já existe
              const exists = prev.find(t => t.id === data.ticket.id)
              if (exists) return prev
              // Adicionar novo ticket no início da lista
              return [data.ticket, ...prev]
            })
          }
        }
        
        // Escutar atualizações de tickets
        const handleTicketUpdate = (data) => {
          if (mounted) {
            setTickets(prev => prev.map(ticket => 
              ticket.id === data.ticket.id ? { ...ticket, ...data.ticket } : ticket
            ))
          }
        }
        
        // ✅ Escutar chat em tempo real (separado de tickets)
        const handleNewChatMessage = (data) => {
          if (mounted) {
            console.log('💬 Nova mensagem de chat recebida:', data)
            // Se estiver visualizando o chat desse usuário, adicionar mensagem
            // selectedTicket pode ser um ticket OU um chat (userId)
            const currentUserId = selectedTicket?.userId || selectedTicket?.id
            if (currentUserId === data.userId) {
              setMessages(prev => {
                const exists = prev.find(m => m.id === data.message.id)
                if (exists) return prev
                return [...prev, {
                  id: data.message.id,
                  message: data.message.message,
                  senderId: data.message.userId,
                  senderType: data.message.senderType === 'user' ? 'user' : 'agent',
                  createdAt: data.message.timestamp || data.message.createdAt
                }]
              })
              scrollToBottom()
            }
          }
        }
        
        wsService.on('support:ticket:new', handleNewTicket)
        wsService.on('support:ticket:updated', handleTicketUpdate)
        wsService.on('support:chat:new', handleNewChatMessage) // ✅ Novo evento de chat
        
        return () => {
          wsService.off('support:ticket:new', handleNewTicket)
          wsService.off('support:ticket:updated', handleTicketUpdate)
          wsService.off('support:chat:new', handleNewChatMessage) // ✅ Limpar listener
        }
      } catch (err) {
        console.error('Erro ao conectar WebSocket:', err)
      }
    }

    connectWebSocket()
    
    // Fallback: polling a cada 30s (menos frequente já que temos WebSocket)
    const interval = setInterval(fetchTickets, 30000)

    return () => {
      mounted = false
      clearInterval(interval)
    }
  }, [statusFilter])

  // Carregar mensagens quando selecionar ticket ou chat
  useEffect(() => {
    if (!selectedTicket) return

    const fetchMessages = async () => {
      try {
        setError(null)
        
        // ✅ Verificar se é chat (tem userId mas não é ticket) ou ticket
        const isChat = selectedTicket.userId && !selectedTicket.id?.startsWith('TICKET')
        
        if (isChat) {
          // ✅ Buscar histórico, status e informações do usuário
          const [historyData, statusData, userData] = await Promise.all([
            leafAPI.getChatHistory(selectedTicket.userId),
            leafAPI.getChatStatus(selectedTicket.userId),
            leafAPI.getUserDetails(selectedTicket.userId).catch(() => null) // Não quebrar se falhar
          ])
          
          setMessages((historyData.messages || []).map(msg => ({
            id: msg.id,
            message: msg.message,
            senderType: msg.senderType === 'user' ? 'user' : 'agent',
            createdAt: msg.timestamp || msg.createdAt
          })))
          
          // ✅ Atualizar status do chat no selectedTicket
          if (statusData.status) {
            setSelectedTicket(prev => ({
              ...prev,
              chatStatus: statusData.status.status || 'active'
            }))
          }
          
          // ✅ Armazenar informações do usuário
          if (userData) {
            setUserInfo({
              name: userData.name || `${userData.firstName || ''} ${userData.lastName || ''}`.trim() || 'Sem nome',
              phone: userData.phone || userData.mobile || 'Não informado',
              type: userData.type || userData.usertype || 'customer',
              uid: selectedTicket.userId
            })
          } else {
            // Fallback se não conseguir buscar dados
            setUserInfo({
              name: 'Usuário',
              phone: 'Não informado',
              type: 'customer',
              uid: selectedTicket.userId
            })
          }
        } else {
          // Para tickets, limpar userInfo
          setUserInfo(null)
          // Buscar mensagens de ticket (sistema antigo)
          const data = await leafAPI.getSupportMessages(selectedTicket.id)
          setMessages(data.messages || [])
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Erro ao carregar mensagens')
      }
    }

    fetchMessages()
    
    // Conectar WebSocket para receber mensagens em tempo real
    const connectWebSocket = async () => {
      try {
        await wsService.connect()
        
        // Escutar novas mensagens (tickets)
        const handleNewMessage = (data) => {
          if (data.ticketId === selectedTicket.id) {
            setMessages(prev => {
              const exists = prev.find(m => m.id === data.message.id)
              if (exists) return prev
              return [...prev, data.message]
            })
            scrollToBottom()
          }
        }
        
        wsService.on('support:message:new', handleNewMessage)
        
        // Polling de fallback a cada 5s para mensagens (apenas tickets)
        const isChat = selectedTicket.userId && !selectedTicket.id?.startsWith('TICKET')
        let messageInterval = null
        
        if (!isChat) {
          messageInterval = setInterval(async () => {
            try {
              const data = await leafAPI.getSupportMessages(selectedTicket.id)
              setMessages(data.messages || [])
            } catch (err) {
              console.error('Erro ao atualizar mensagens:', err)
            }
          }, 5000)
        }
        
        return () => {
          wsService.off('support:message:new', handleNewMessage)
          if (messageInterval) clearInterval(messageInterval)
        }
      } catch (err) {
        console.error('Erro ao conectar WebSocket:', err)
      }
    }

    connectWebSocket()
  }, [selectedTicket])

  // Enviar mensagem (chat ou ticket)
  const handleSendMessage = async () => {
    if (!newMessage.trim() || !selectedTicket || sending) return

    try {
      setSending(true)
      const messageText = newMessage.trim()
      setNewMessage('') // Limpar input imediatamente
      
      // ✅ Verificar se é chat ou ticket
      const isChat = selectedTicket.userId && !selectedTicket.id?.startsWith('TICKET')
      
      // ✅ Verificar se chat não está encerrado
      if (isChat && selectedTicket.chatStatus === 'closed') {
        setError('Chat já está encerrado. Não é possível enviar mensagens.')
        setNewMessage(messageText) // Restaurar mensagem
        return
      }
      
      if (isChat) {
        // ✅ Enviar mensagem de chat (Redis Pub/Sub + Firestore)
        const message = await leafAPI.sendChatMessage(selectedTicket.userId, messageText)
        
        // Adicionar mensagem ao estado
        setMessages(prev => [...prev, {
          id: message.message?.id || `msg-${Date.now()}`,
          message: message.message?.message || messageText,
          senderType: 'agent',
          createdAt: message.message?.timestamp || new Date().toISOString()
        }])
        
        // ✅ Enviar via WebSocket também (para notificar o app)
        if (wsService.isConnected()) {
          wsService.emit('support:chat:message', {
            userId: selectedTicket.userId,
            message: messageText,
            senderType: 'agent'
          })
        }
      } else {
        // Enviar mensagem de ticket (sistema antigo)
        const message = await leafAPI.sendSupportMessage(
          selectedTicket.id,
          messageText,
          'text',
          []
        )
        
        setMessages(prev => [...prev, message.message || message])
        
        // Emitir via WebSocket se conectado
        if (wsService.isConnected()) {
          wsService.emit('support:message:send', {
            ticketId: selectedTicket.id,
            message: messageText
          })
        }
      }
      
      scrollToBottom()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao enviar mensagem')
      setNewMessage(messageText) // Restaurar mensagem em caso de erro
    } finally {
      setSending(false)
    }
  }

  const filteredTickets = tickets.filter(ticket => {
    if (searchTerm) {
      const search = searchTerm.toLowerCase()
      return (
        ticket.subject?.toLowerCase().includes(search) ||
        ticket.id?.toLowerCase().includes(search) ||
        ticket.userId?.toLowerCase().includes(search)
      )
    }
    return true
  })

  const getStatusBadge = (status) => {
    const variants = {
      open: 'default',
      in_progress: 'secondary',
      resolved: 'default',
      closed: 'secondary'
    }
    const labels = {
      open: 'Aberto',
      in_progress: 'Em Andamento',
      resolved: 'Resolvido',
      closed: 'Fechado'
    }
    return <Badge variant={variants[status] || 'secondary'}>{labels[status] || status}</Badge>
  }

  const getPriorityBadge = (priority) => {
    const colors = {
      N1: 'destructive',
      N2: 'default',
      N3: 'secondary'
    }
    return <Badge variant={colors[priority] || 'secondary'}>{priority}</Badge>
  }

  return (
    <ProtectedRoute>
      <Head>
        <title>Suporte - Leaf Dashboard</title>
      </Head>
      <div className="min-h-screen bg-background">
        <Navigation />
        <div className="p-8">
          <div className="flex justify-between items-center mb-6">
            <h1 className="text-3xl font-bold flex items-center gap-2">
              <MessageCircle className="h-8 w-8" />
              Suporte e Chat
            </h1>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 h-[calc(100vh-200px)]">
            {/* Lista de Tickets */}
            <Card className="lg:col-span-1 overflow-hidden flex flex-col">
              <CardHeader>
                <CardTitle>Tickets de Suporte</CardTitle>
                <div className="flex gap-2 mt-4">
                  <div className="flex-1 relative">
                    <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      placeholder="Buscar tickets..."
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      className="pl-10"
                    />
                  </div>
                </div>
                <div className="mt-2">
                  <select
                    value={statusFilter}
                    onChange={(e) => setStatusFilter(e.target.value)}
                    className="w-full px-3 py-2 border rounded-md text-sm"
                  >
                    <option value="all">Todos os Status</option>
                    <option value="open">Aberto</option>
                    <option value="in_progress">Em Andamento</option>
                    <option value="resolved">Resolvido</option>
                    <option value="closed">Fechado</option>
                  </select>
                </div>
              </CardHeader>
              <CardContent className="flex-1 overflow-y-auto">
                {loading && (
                  <Alert>
                    <AlertDescription>Carregando tickets...</AlertDescription>
                  </Alert>
                )}

                {error && (
                  <Alert variant="destructive">
                    <AlertDescription>Erro: {error}</AlertDescription>
                  </Alert>
                )}

                {!loading && !error && (
                  <div className="space-y-2">
                    {filteredTickets.length === 0 ? (
                      <Alert>
                        <AlertDescription>Nenhum ticket encontrado.</AlertDescription>
                      </Alert>
                    ) : (
                      filteredTickets.map((ticket) => (
                        <Card
                          key={ticket.id}
                          className={`cursor-pointer hover:shadow-md transition-shadow ${
                            selectedTicket?.id === ticket.id ? 'ring-2 ring-primary' : ''
                          }`}
                          onClick={() => setSelectedTicket(ticket)}
                        >
                          <CardContent className="pt-4">
                            <div className="flex justify-between items-start mb-2">
                              <div className="flex-1">
                                <div className="font-semibold text-sm mb-1 line-clamp-2">
                                  {ticket.subject || 'Sem assunto'}
                                </div>
                                <div className="text-xs text-muted-foreground mb-2">
                                  {ticket.userId || 'Usuário desconhecido'}
                                </div>
                              </div>
                            </div>
                            <div className="flex gap-2 flex-wrap">
                              {getStatusBadge(ticket.status)}
                              {getPriorityBadge(ticket.priority)}
                            </div>
                            <div className="text-xs text-muted-foreground mt-2">
                              {ticket.createdAt ? new Date(ticket.createdAt).toLocaleDateString('pt-BR') : ''}
                            </div>
                          </CardContent>
                        </Card>
                      ))
                    )}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Chat */}
            <Card className="lg:col-span-2 flex flex-col overflow-hidden">
              {selectedTicket ? (
                <>
                  <CardHeader className="border-b">
                    <div className="flex justify-between items-start">
                      <div className="flex-1">
                        <CardTitle>{selectedTicket.subject || selectedTicket.userId || 'Chat de Suporte'}</CardTitle>
                        
                        {/* ✅ Informações do usuário (apenas para chats) */}
                        {selectedTicket.userId && !selectedTicket.id?.startsWith('TICKET') && userInfo && (
                          <div className="mt-3 space-y-1 text-sm">
                            <div className="flex items-center gap-2">
                              <User className="h-4 w-4 text-muted-foreground" />
                              <span className="font-medium">{userInfo.name}</span>
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="text-muted-foreground">📱</span>
                              <span>{userInfo.phone}</span>
                            </div>
                            <div className="flex items-center gap-2">
                              <Badge variant={userInfo.type === 'driver' ? 'default' : 'secondary'}>
                                {userInfo.type === 'driver' ? 'Motorista' : 'Passageiro'}
                              </Badge>
                              <span className="text-xs text-muted-foreground">UID: {userInfo.uid}</span>
                            </div>
                          </div>
                        )}
                        
                        <div className="flex gap-2 mt-2">
                          {selectedTicket.status && getStatusBadge(selectedTicket.status)}
                          {selectedTicket.priority && getPriorityBadge(selectedTicket.priority)}
                          {/* ✅ Mostrar status do chat se for chat (não ticket) */}
                          {selectedTicket.userId && !selectedTicket.id?.startsWith('TICKET') && (
                            <Badge variant={selectedTicket.chatStatus === 'closed' ? 'secondary' : 'default'}>
                              {selectedTicket.chatStatus === 'closed' ? 'Encerrado' : 'Ativo'}
                            </Badge>
                          )}
                        </div>
                      </div>
                      {/* ✅ Botão para encerrar chat (apenas para chats, não tickets) */}
                      {selectedTicket.userId && !selectedTicket.id?.startsWith('TICKET') && selectedTicket.chatStatus !== 'closed' && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={async () => {
                            if (confirm('Deseja encerrar este chat? Todas as mensagens serão salvas no Firestore.')) {
                              try {
                                await leafAPI.closeChat(selectedTicket.userId, 'agent')
                                // Atualizar status local
                                setSelectedTicket({ ...selectedTicket, chatStatus: 'closed' })
                                alert('Chat encerrado com sucesso!')
                              } catch (err) {
                                alert('Erro ao encerrar chat: ' + (err.message || 'Erro desconhecido'))
                              }
                            }
                          }}
                        >
                          Encerrar Chat
                        </Button>
                      )}
                    </div>
                  </CardHeader>
                  <CardContent className="flex-1 flex flex-col overflow-hidden">
                    {/* Mensagens */}
                    <div className="flex-1 overflow-y-auto space-y-4 mb-4 p-4">
                      {messages.length === 0 ? (
                        <Alert>
                          <AlertDescription>Nenhuma mensagem ainda. Inicie a conversa!</AlertDescription>
                        </Alert>
                      ) : (
                        messages.map((msg) => (
                          <div
                            key={msg.id}
                            className={`flex ${msg.senderType === 'agent' ? 'justify-end' : 'justify-start'}`}
                          >
                            <div
                              className={`max-w-[70%] rounded-lg p-3 ${
                                msg.senderType === 'agent'
                                  ? 'bg-primary text-primary-foreground'
                                  : 'bg-muted'
                              }`}
                            >
                              <div className="text-sm font-medium mb-1">
                                {msg.senderType === 'agent' ? 'Você' : 'Usuário'}
                              </div>
                              <div className="text-sm">{msg.message || msg.text}</div>
                              <div className="text-xs opacity-70 mt-1">
                                {msg.createdAt
                                  ? new Date(msg.createdAt).toLocaleString('pt-BR')
                                  : ''}
                              </div>
                            </div>
                          </div>
                        ))
                      )}
                      <div ref={messagesEndRef} />
                    </div>

                    {/* Input de mensagem */}
                    <div className="flex gap-2 border-t pt-4">
                      <Input
                        placeholder={
                          selectedTicket.userId && !selectedTicket.id?.startsWith('TICKET') && selectedTicket.chatStatus === 'closed'
                            ? 'Chat encerrado'
                            : 'Digite sua mensagem...'
                        }
                        value={newMessage}
                        onChange={(e) => setNewMessage(e.target.value)}
                        onKeyPress={(e) => {
                          if (e.key === 'Enter' && !e.shiftKey) {
                            e.preventDefault()
                            handleSendMessage()
                          }
                        }}
                        disabled={
                          sending || 
                          (selectedTicket.userId && !selectedTicket.id?.startsWith('TICKET') && selectedTicket.chatStatus === 'closed')
                        }
                      />
                      <Button
                        onClick={handleSendMessage}
                        disabled={
                          !newMessage.trim() || 
                          sending ||
                          (selectedTicket.userId && !selectedTicket.id?.startsWith('TICKET') && selectedTicket.chatStatus === 'closed')
                        }
                      >
                        <Send className="h-4 w-4" />
                      </Button>
                    </div>
                  </CardContent>
                </>
              ) : (
                <CardContent className="flex-1 flex items-center justify-center">
                  <div className="text-center text-muted-foreground">
                    <MessageCircle className="h-16 w-16 mx-auto mb-4 opacity-50" />
                    <p>Selecione um ticket para iniciar o chat</p>
                  </div>
                </CardContent>
              )}
            </Card>
          </div>
        </div>
      </div>
    </ProtectedRoute>
  )
}

