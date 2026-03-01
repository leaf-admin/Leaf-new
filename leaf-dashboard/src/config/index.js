// Configuration file for Leaf Dashboard
export const config = {
  api: {
    // Prioridade: variável de ambiente > servidor remoto (VPS Hostinger)
    baseUrl: process.env.NEXT_PUBLIC_API_URL || 'https://dashboard.leaf.app.br/api',
    timeout: 10000,
    retries: 3
  },
  app: {
    name: 'Leaf Dashboard',
    version: '1.0.0',
    description: 'Admin Dashboard for Leaf Transportation Platform'
  },
  refresh: {
    stats: 30000, // 30 seconds
    kyc: 15000,   // 15 seconds
    system: 10000, // 10 seconds
    activity: 20000 // 20 seconds
  },
  features: {
    realTimeUpdates: true,
    errorReporting: true,
    analytics: true
  }
}

export default config

