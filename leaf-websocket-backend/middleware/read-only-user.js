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

// Leitura financeira dos bots (adminUsers.financialRead = true). Vale só para usuário
// somente leitura e só em GET/HEAD: abre a leitura das rotas financeiras sem trocar o papel
// do usuário e sem nenhuma escrita. Um usuário comum com a flag não ganha nada.
const FINANCIAL_READ_METHODS = new Set(['GET', 'HEAD']);

function allowsReadOnlyFinancial(req) {
  if (req?.user?.readOnly !== true || req.user.financialRead !== true) return false;
  return FINANCIAL_READ_METHODS.has(String(req.method || '').toUpperCase());
}

module.exports = { rejectReadOnlyWrite, allowsReadOnlyFinancial, SAFE_METHODS };
