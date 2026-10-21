// Usuário administrativo "somente leitura" (adminUsers.readOnly = true), como o login dos
// bots do OpenBot: o papel define o que ele lê; qualquer escrita é recusada aqui, no
// servidor, seja qual for a rota. A política de autonomia dos bots (21/10/2026) pede que a
// restrição esteja no código, não só na instrução do agente.
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function rejectReadOnlyWrite(req, res) {
  if (req.user?.readOnly !== true) return false;
  if (SAFE_METHODS.has(String(req.method || 'GET').toUpperCase())) return false;
  res.status(403).json({ success: false, error: 'Usuário somente leitura', code: 'READ_ONLY_USER' });
  return true;
}

module.exports = { rejectReadOnlyWrite, SAFE_METHODS };
