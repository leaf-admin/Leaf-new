const express = require('express');
const app = express();

// Middleware básico
app.use(express.json());

// Rota de teste
app.get('/test', (req, res) => {
  res.json({ message: 'Server working!' });
});

// Rota do dashboard
app.get('/dashboard/test', (req, res) => {
  res.json({ 
    message: 'Dashboard test working!',
    timestamp: new Date().toISOString()
  });
});

// Rota do dashboard overview
app.get('/dashboard/overview', (req, res) => {
  res.json({
    systems: {
      vps: {
        status: 'online',
        cpu: 25,
        memory: 65,
        disk: 45,
        uptime: '15d 8h 32m'
      },
      redis: {
        status: 'online',
        memory: 23,
        keys: 156,
        connections: 3
      },
      websocket: {
        status: 'online',
        connections: 5,
        rooms: 2
      }
    },
    timestamp: new Date().toISOString()
  });
});

const PORT = 3003;
app.listen(PORT, () => {
  console.log(`Test server running on port ${PORT}`);
  console.log(`Test endpoints:`);
  console.log(`- http://localhost:${PORT}/test`);
  console.log(`- http://localhost:${PORT}/dashboard/test`);
  console.log(`- http://localhost:${PORT}/dashboard/overview`);
}); 