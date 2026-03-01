const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

// Criar aplicação Express
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

const PORT = 3003;

// Middleware básico
app.use(express.json());
app.use(cors());

// 🔐 Authentication API
app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body;
  
  console.log('📧 Login attempt:', email);
  
  if (email === 'admin@leaf.com' && password === 'admin123') {
    const token = 'dashboard_token_' + Date.now();
    res.json({
      success: true,
      token,
      user: {
        id: 'admin1',
        name: 'Administrador',
        email: 'admin@leaf.com',
        role: 'admin'
      }
    });
  } else {
    res.status(401).json({ error: 'Credenciais inválidas' });
  }
});

app.post('/api/auth/validate', (req, res) => {
  const { token } = req.body;
  
  if (token && token.startsWith('dashboard_token_')) {
    res.json({
      valid: true,
      user: {
        id: 'admin1',
        name: 'Administrador',
        email: 'admin@leaf.com',
        role: 'admin'
      }
    });
  } else {
    res.status(401).json({ valid: false });
  }
});

// 📊 Dados mock
app.get('/api/users/stats', (req, res) => {
  res.json({
    total: 1247,
    customers: 892,
    drivers: 355,
    newToday: 12,
    newThisWeek: 87,
    activeToday: 789,
    growthRate: 15.2
  });
});

app.get('/api/drivers/applications', (req, res) => {
  res.json([
    {
      id: 'app1',
      driver: { name: 'Carlos Silva', email: 'carlos@email.com' },
      status: 'pending',
      applicationDate: '2024-01-20',
      score: 8.5
    }
  ]);
});

app.get('/api/metrics/financial', (req, res) => {
  res.json({
    revenue: { total: 125400.50, growth: 15.2 },
    costs: { total: 23450.80, growth: -8.5 },
    profit: { gross: 101949.70, margin: 81.3 }
  });
});

app.get('/api/live/stats', (req, res) => {
  res.json({
    driversOnline: 245,
    driversAvailable: 120,
    passengerWaiting: 15,
    activeTrips: 67,
    avgWaitTime: 3.2,
    avgTripTime: 18.5
  });
});

// WebSocket para dashboard
const dashboardNamespace = io.of('/dashboard');

dashboardNamespace.on('connection', (socket) => {
  console.log('🎯 Dashboard conectado:', socket.id);

  // Enviar dados iniciais
  socket.emit('live_stats', {
    driversOnline: 245,
    driversAvailable: 120,
    passengerWaiting: 15,
    activeTrips: 67
  });

  socket.on('request_live_data', () => {
    socket.emit('live_stats', {
      driversOnline: 245 + Math.floor(Math.random() * 20) - 10,
      driversAvailable: 120 + Math.floor(Math.random() * 10) - 5,
      passengerWaiting: 15 + Math.floor(Math.random() * 10) - 5,
      activeTrips: 67 + Math.floor(Math.random() * 10) - 5,
      timestamp: new Date().toISOString()
    });
  });

  socket.on('disconnect', () => {
    console.log('🔌 Dashboard desconectado:', socket.id);
  });
});

// Root endpoint
app.get('/', (req, res) => {
  res.json({ 
    message: '🎯 Leaf Dashboard Backend',
    status: 'online',
    timestamp: new Date().toISOString()
  });
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'healthy' });
});

// Iniciar servidor
server.listen(PORT, () => {
  console.log(`🚀 Servidor Dashboard rodando na porta ${PORT}`);
  console.log(`📊 Dashboard: http://localhost:${PORT}`);
  console.log(`🔐 Login: admin@leaf.com / admin123`);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n🛑 Finalizando servidor...');
  server.close(() => {
    console.log('✅ Servidor finalizado');
    process.exit(0);
  });
});
