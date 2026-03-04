const axios = require('axios');

async function run() {
  try {
    console.log("Teste 1: Checando conexao Woovi Sandbox...");
    // /api prefix is used because of app.use('/api', wooviRoutes);
    const conn = await axios.get('http://localhost:3001/api/woovi/test-connection', { timeout: 15000 });
    console.log("✅ API conectada:", conn.data.success, "| Env:", conn.data.environment);
  } catch(e) {
    console.log("❌ Erro ao checar conexão:", e.response?.data || e.message);
  }
}
run();
