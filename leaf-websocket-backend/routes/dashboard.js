const express = require('express')
const router = express.Router()
const os = require('os')
const { exec } = require('child_process')
const util = require('util')
const execAsync = util.promisify(exec)

// Importar autenticação
const { authenticateToken, authorizeRole } = require('./auth')

// Endpoint de teste simples
router.get('/test', (req, res) => {
  res.json({ 
    message: 'Dashboard routes working!',
    timestamp: new Date().toISOString()
  })
})

// Middleware de autenticação para todas as rotas do dashboard
router.use(authenticateToken)

// Rota para métricas gerais do dashboard
router.get('/overview', authorizeRole(['admin', 'manager', 'viewer']), async (req, res) => {
  try {
    console.log(`📊 Dashboard acessado por: ${req.user.username} (${req.user.role}) - IP: ${req.ip}`)
    
    const systems = {
      vps: {
        status: 'online',
        cpu: Math.floor(Math.random() * 30) + 10,
        memory: Math.floor(Math.random() * 40) + 30,
        disk: Math.floor(Math.random() * 30) + 20,
        uptime: '15d 8h 32m'
      },
      redis: {
        status: 'online',
        memory: Math.floor(Math.random() * 20) + 10,
        keys: Math.floor(Math.random() * 200) + 100,
        connections: Math.floor(Math.random() * 10) + 1
      },
      websocket: {
        status: 'online',
        connections: Math.floor(Math.random() * 20) + 5,
        rooms: Math.floor(Math.random() * 5) + 2
      },
      firebase: {
        status: 'online',
        connections: Math.floor(Math.random() * 15) + 5,
        documents: Math.floor(Math.random() * 1000) + 500
      }
    }

    res.json({
      systems,
      user: {
        username: req.user.username,
        role: req.user.role,
        name: req.user.name
      },
      timestamp: new Date().toISOString()
    })

  } catch (error) {
    console.error('❌ Erro no dashboard overview:', error)
    res.status(500).json({ error: 'Erro interno do servidor' })
  }
})

// Rota para métricas do VPS
router.get('/vps/:id', authorizeRole(['admin', 'manager']), async (req, res) => {
  try {
    const { id } = req.params
    console.log(`🖥️ VPS ${id} acessado por: ${req.user.username} - IP: ${req.ip}`)
    
    const vpsData = {
      id,
      status: 'online',
      cpu: Math.floor(Math.random() * 40) + 15,
      memory: Math.floor(Math.random() * 50) + 25,
      disk: Math.floor(Math.random() * 40) + 20,
      network: {
        in: Math.floor(Math.random() * 1000) + 500,
        out: Math.floor(Math.random() * 800) + 300
      },
      uptime: '15d 8h 32m'
    }

    res.json(vpsData)

  } catch (error) {
    console.error('❌ Erro nas métricas do VPS:', error)
    res.status(500).json({ error: 'Erro interno do servidor' })
  }
})

// Rota para métricas do Redis
router.get('/redis', authorizeRole(['admin', 'manager', 'viewer']), async (req, res) => {
  try {
    console.log(`🔴 Redis acessado por: ${req.user.username} - IP: ${req.ip}`)
    
    const redisData = {
      status: 'online',
      memory: Math.floor(Math.random() * 30) + 15,
      keys: Math.floor(Math.random() * 300) + 150,
      connections: Math.floor(Math.random() * 15) + 3,
      hitRate: Math.floor(Math.random() * 20) + 80
    }

    res.json(redisData)

  } catch (error) {
    console.error('❌ Erro nas métricas do Redis:', error)
    res.status(500).json({ error: 'Erro interno do servidor' })
  }
})

// Rota para métricas do WebSocket
router.get('/websocket', authorizeRole(['admin', 'manager']), async (req, res) => {
  try {
    console.log(`🔌 WebSocket acessado por: ${req.user.username} - IP: ${req.ip}`)
    
    const websocketData = {
      status: 'online',
      connections: Math.floor(Math.random() * 25) + 10,
      rooms: Math.floor(Math.random() * 8) + 3,
      latency: Math.floor(Math.random() * 50) + 10
    }

    res.json(websocketData)

  } catch (error) {
    console.error('❌ Erro nas métricas do WebSocket:', error)
    res.status(500).json({ error: 'Erro interno do servidor' })
  }
})

// Rota para métricas do Firebase
router.get('/firebase', authorizeRole(['admin']), async (req, res) => {
  try {
    console.log(`🔥 Firebase acessado por: ${req.user.username} - IP: ${req.ip}`)
    
    const firebaseData = {
      status: 'online',
      connections: Math.floor(Math.random() * 20) + 5,
      documents: Math.floor(Math.random() * 1500) + 800,
      syncStatus: 'synchronized'
    }

    res.json(firebaseData)

  } catch (error) {
    console.error('❌ Erro nas métricas do Firebase:', error)
    res.status(500).json({ error: 'Erro interno do servidor' })
  }
})

// Rota para performance
router.get('/performance', authorizeRole(['admin', 'manager']), async (req, res) => {
  try {
    console.log(`⚡ Performance acessada por: ${req.user.username} - IP: ${req.ip}`)
    
    const performanceData = {
      responseTime: Math.floor(Math.random() * 100) + 50,
      throughput: Math.floor(Math.random() * 1000) + 500,
      errorRate: Math.random() * 2,
      uptime: 99.9
    }

    res.json(performanceData)

  } catch (error) {
    console.error('❌ Erro nas métricas de performance:', error)
    res.status(500).json({ error: 'Erro interno do servidor' })
  }
})

module.exports = router 