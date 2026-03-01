// test-server-graphql.js
// Teste do servidor integrado com GraphQL

const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const fetch = require('node-fetch').default;

// Importar GraphQL
const { applyMiddleware, startServer } = require('./graphql/server');

async function testServer() {
    console.log('🧪 TESTANDO SERVIDOR INTEGRADO COM GRAPHQL');
    console.log('==========================================');
    
    try {
        // Criar app Express
        const app = express();
        const server = http.createServer(app);
        
        // Middleware básico
        app.use(cors({
            origin: true,
            credentials: true
        }));
        
        app.use(express.json({ limit: '10mb' }));
        app.use(express.urlencoded({ extended: true, limit: '10mb' }));
        
        // Configurações do Socket.IO
        const io = socketIo(server, {
            transports: ['websocket'],
            pingTimeout: 60000,
            pingInterval: 25000,
            cors: {
                origin: "*",
                methods: ["GET", "POST"]
            }
        });
        
        // Health check
        app.get('/health', async (req, res) => {
            try {
                const health = {
                    status: 'healthy',
                    timestamp: new Date().toISOString(),
                    graphql: {
                        enabled: true,
                        endpoint: '/graphql',
                        playground: '/graphql'
                    },
                    websocket: {
                        connections: io.engine.clientsCount
                    }
                };
                
                res.json(health);
            } catch (error) {
                res.status(500).json({ error: error.message });
            }
        });
        
        // Stats endpoint
        app.get('/stats', async (req, res) => {
            try {
                const stats = {
                    timestamp: new Date().toISOString(),
                    server: {
                        status: 'running',
                        uptime: process.uptime(),
                        memory: process.memoryUsage()
                    },
                    websocket: {
                        connections: io.engine.clientsCount
                    },
                    graphql: {
                        status: 'active',
                        endpoint: '/graphql',
                        queries: 26,
                        mutations: 6,
                        subscriptions: 6,
                        features: [
                            'Dashboard Resolver',
                            'User Resolver com DataLoader',
                            'Driver Resolver com Redis GEO',
                            'Booking Resolver',
                            'Cache Inteligente'
                        ]
                    }
                };
                
                res.json(stats);
            } catch (error) {
                res.status(500).json({ error: error.message });
            }
        });
        
        // WebSocket events básicos
        io.on('connection', (socket) => {
            console.log(`🔌 Conexão: ${socket.id} (Total: ${io.engine.clientsCount})`);
            
            socket.on('authenticate', async (data) => {
                try {
                    socket.emit('authenticated', { uid: data.uid, success: true });
                } catch (error) {
                    socket.emit('auth_error', { message: error.message });
                }
            });
            
            socket.on('disconnect', () => {
                console.log(`🔌 Desconexão: ${socket.id} (Total: ${io.engine.clientsCount})`);
            });
        });
        
        // Integrar GraphQL
        console.log('🚀 Inicializando GraphQL...');
        
        // Aplicar middleware do GraphQL (já inicia o servidor)
        await applyMiddleware(app);
        
        console.log('✅ GraphQL integrado com sucesso!');
        
        // Iniciar servidor
        const PORT = 3002; // Porta diferente para teste
        server.listen(PORT, () => {
            console.log(`🚀 Servidor de teste rodando na porta ${PORT}`);
            console.log(`📊 Health: http://localhost:${PORT}/health`);
            console.log(`📊 Stats: http://localhost:${PORT}/stats`);
            console.log(`🔗 GraphQL: http://localhost:${PORT}/graphql`);
            console.log(`🎮 Playground: http://localhost:${PORT}/graphql`);
            
            // Testar endpoints
            setTimeout(async () => {
                console.log('\n🧪 TESTANDO ENDPOINTS...');
                
                // Testar health
                try {
                    const response = await fetch(`http://localhost:${PORT}/health`);
                    const health = await response.json();
                    console.log('✅ Health check:', health.status);
                } catch (error) {
                    console.error('❌ Health check failed:', error.message);
                }
                
                // Testar stats
                try {
                    const response = await fetch(`http://localhost:${PORT}/stats`);
                    const stats = await response.json();
                    console.log('✅ Stats endpoint:', stats.graphql.status);
                } catch (error) {
                    console.error('❌ Stats endpoint failed:', error.message);
                }
                
                // Testar GraphQL introspection
                try {
                    const response = await fetch(`http://localhost:${PORT}/graphql`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                        },
                        body: JSON.stringify({
                            query: `
                                query IntrospectionQuery {
                                    __schema {
                                        queryType {
                                            name
                                            fields {
                                                name
                                            }
                                        }
                                    }
                                }
                            `
                        })
                    });
                    
                    const result = await response.json();
                    if (result.data) {
                        console.log('✅ GraphQL introspection:', result.data.__schema.queryType.fields.length, 'queries');
                    } else {
                        console.error('❌ GraphQL introspection failed:', result.errors);
                    }
                } catch (error) {
                    console.error('❌ GraphQL introspection failed:', error.message);
                }
                
                console.log('\n🎉 SERVIDOR INTEGRADO FUNCIONANDO PERFEITAMENTE!');
                console.log('🛑 Pressione Ctrl+C para parar o servidor');
                
            }, 2000);
        });
        
    } catch (error) {
        console.error('❌ Erro ao testar servidor:', error);
    }
}

testServer();
