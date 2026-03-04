const axios = require('axios');

async function run() {
  try {
    const conn = await axios.post('http://localhost:3001/api/woovi/create-charge', { value: 10, description: "Teste" }, { timeout: 15000 });
    console.log("Response:", JSON.stringify(conn.data, null, 2));
  } catch(e) {
    console.log("❌ Erro:", e.response?.data || e.message);
  }
}
run();
