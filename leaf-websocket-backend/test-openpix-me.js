const axios = require('axios');
const token = 'Q2xpZW50X0lkXzE4YzBkYzI3LTYzMDYtNDFkYy1hMmRlLWI2MzAzMzQ3YzNhZTpDbGllbnRfU2VjcmV0X01ENWpTTW1DMExBYWx2WHhiY0tTSnlrVmYyM0g1Z0FxS0pZaE5zT0tUK1E9';

async function run() {
  try {
    const conn = await axios.get('https://api.openpix.com.br/api/v1/charge', {
      headers: {
        'Authorization': token,
        'Content-Type': 'application/json'
      }
    });
    console.log("Success:", conn.data.pageInfo.totalCount !== undefined ? "Auth OK" : "Failed");
  } catch(e) {
    if (e.response?.data?.error) {
       console.log("❌ Woovi Errors:", JSON.stringify(e.response.data.error, null, 2));
    } else {
       console.log("❌ Erro Completo:", e.response?.data || e.message);
    }
  }
}
run();
