const axios = require('axios');

async function run() {
  try {
    console.log("Teste 2: Solicitando Pagamento ao Woovi Sandbox...");
    const chargeData = {
        value: 10, // 10 reais
        description: "Teste de viagem"
    };
    const conn = await axios.post('http://localhost:3001/api/woovi/create-charge', chargeData, { timeout: 15000 });
    console.log("✅ PIX Criado:", conn.data.success, "| QR Code link:", conn.data.data?.charge?.brCode);
  } catch(e) {
    console.log("❌ Erro ao gerar PIX:", e.response?.data || e.message);
  }
}
run();
