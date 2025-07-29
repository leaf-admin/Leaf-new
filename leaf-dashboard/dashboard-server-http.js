const http = require('http');
const fs = require('fs');
const path = require('path');

const server = http.createServer((req, res) => {
  let filePath = path.join(__dirname, 'dist', req.url === '/' ? 'index.html' : req.url);
  
  // Verificar se o arquivo existe
  if (!fs.existsSync(filePath)) {
    filePath = path.join(__dirname, 'dist', 'index.html');
  }
  
  const ext = path.extname(filePath);
  let contentType = 'text/html';
  
  switch (ext) {
    case '.js':
      contentType = 'text/javascript';
      break;
    case '.css':
      contentType = 'text/css';
      break;
    case '.json':
      contentType = 'application/json';
      break;
    case '.png':
      contentType = 'image/png';
      break;
    case '.jpg':
      contentType = 'image/jpg';
      break;
  }
  
  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(500);
      res.end('Error loading ' + req.url);
    } else {
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(content, 'utf-8');
    }
  });
});

const PORT = 3002;
server.listen(PORT, () => {
  console.log(`Dashboard server running on port ${PORT}`);
  console.log(`Dashboard available at: http://localhost:${PORT}`);
}); 