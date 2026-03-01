const express = require('express');
const app = express();

app.use(express.json());

// Rota simples de teste
app.post('/auth/login', (req, res) => {
    console.log('🔍 Rota /auth/login chamada!');
    res.json({ success: true, message: 'Funcionando!' });
});

app.get('/health', (req, res) => {
    res.json({ status: 'healthy' });
});

const PORT = 3005;
app.listen(PORT, () => {
    console.log(`🚀 Servidor teste rodando na porta ${PORT}`);
});