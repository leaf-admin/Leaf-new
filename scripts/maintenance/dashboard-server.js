const express = require('express');
const path = require('path');
const app = express();

// Servir arquivos estáticos
app.use(express.static(path.join(__dirname, 'dist')));

// Rota para todas as páginas (SPA)
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

const PORT = 3002;
app.listen(PORT, () => {
  console.log(`Dashboard server running on port ${PORT}`);
  console.log(`Dashboard available at: http://localhost:${PORT}`);
}); 