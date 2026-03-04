const axios = require('axios');

async function run() {
  try {
    const conn = await axios.post('http://localhost:3001/api/woovi/create-charge', { value: 10, description: "Teste" }, { timeout: 15000 });
    console.log("Response:", JSON.stringify(conn.data, null, 2));
  } catch(e) {
    if (e.response && e.response.data && e.response.data.error && e.response.data.error.errors) {
       console.log("❌ Woovi Errors:", JSON.stringify(e.response.data.error.errors, null, 2));
    } else {
       console.log("❌ Erro Completo:", e.response?.data || e.message);
    }
  }
}
run();
