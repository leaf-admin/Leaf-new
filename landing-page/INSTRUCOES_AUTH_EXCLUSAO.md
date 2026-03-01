# 🔐 Instruções: Autenticação na Página de Exclusão de Conta

## 📋 O que foi implementado:

A página `excluir-conta.html` agora **exige autenticação** antes de permitir a exclusão de conta.

### Funcionalidades de segurança:

1. ✅ **Verificação de autenticação** ao carregar a página
2. ✅ **Token de autenticação** enviado no header `Authorization: Bearer <token>`
3. ✅ **Tela de login necessário** se usuário não estiver autenticado
4. ✅ **Validação de token** antes de processar exclusão
5. ✅ **Tratamento de erro 401/403** (não autenticado/sem permissão)

---

## 🔧 Como funciona:

### 1. Verificação de Autenticação

A página verifica autenticação em **3 formas** (prioridade nesta ordem):

1. **Token na URL**: `excluir-conta.html?token=SEU_TOKEN_AQUI`
2. **localStorage**: `localStorage.getItem('leaf_auth_token')`
3. **sessionStorage**: `sessionStorage.getItem('leaf_auth_token')`

### 2. Validação com Backend

Após obter o token, a página valida com o endpoint:
```
GET /api/auth/verify
Headers:
  Authorization: Bearer <token>
```

### 3. Requisição de Exclusão

A exclusão de conta envia:
```
POST /api/account/delete
Headers:
  Authorization: Bearer <token>
  Content-Type: application/json
Body:
  {
    "reason": "motivo-selecionado",
    "additionalInfo": "texto adicional",
    "phone": "11999999999",
    "password": "senha-do-usuario"
  }
```

---

## 🛠️ Backend - O que você precisa implementar:

### Endpoint 1: Verificação de Token

```javascript
// GET /api/auth/verify
// Verifica se token é válido

router.get('/api/auth/verify', async (req, res) => {
    try {
        const token = req.headers.authorization?.replace('Bearer ', '');
        
        if (!token) {
            return res.json({ authenticated: false });
        }
        
        // Validar token (JWT, Firebase, etc.)
        const decoded = await verifyToken(token); // Sua função de verificação
        const user = await getUserById(decoded.uid);
        
        if (user) {
            return res.json({ 
                authenticated: true, 
                token: token,
                user: {
                    uid: user.uid,
                    email: user.email,
                    phone: user.phone
                }
            });
        }
        
        return res.json({ authenticated: false });
    } catch (error) {
        console.error('Erro ao verificar token:', error);
        return res.status(401).json({ authenticated: false });
    }
});
```

### Endpoint 2: Exclusão de Conta (COM AUTENTICAÇÃO)

```javascript
// POST /api/account/delete
// Exclui conta do usuário autenticado

router.post('/api/account/delete', authenticateMiddleware, async (req, res) => {
    try {
        // req.user vem do middleware de autenticação
        const userId = req.user.uid; // ou req.user.id
        const { reason, additionalInfo, phone, password } = req.body;
        
        // 1. Verificar se telefone corresponde ao usuário logado
        const user = await getUserById(userId);
        if (!user || user.phone !== phone.replace(/\D/g, '')) {
            return res.status(400).json({ 
                success: false,
                message: 'Número de telefone não corresponde à sua conta.'
            });
        }
        
        // 2. Verificar senha
        const isPasswordValid = await verifyPassword(userId, password);
        if (!isPasswordValid) {
            return res.status(400).json({ 
                success: false,
                message: 'Senha incorreta.'
            });
        }
        
        // 3. Processar exclusão
        await deleteUserAccount(userId);
        
        // 4. Log do motivo (opcional)
        await logAccountDeletion(userId, reason, additionalInfo);
        
        return res.json({ 
            success: true,
            message: 'Conta excluída com sucesso.'
        });
        
    } catch (error) {
        console.error('Erro ao excluir conta:', error);
        return res.status(500).json({ 
            success: false,
            message: 'Erro interno ao excluir conta.'
        });
    }
});
```

### Middleware de Autenticação

```javascript
// middleware/authenticate.js
const authenticateMiddleware = async (req, res, next) => {
    try {
        const token = req.headers.authorization?.replace('Bearer ', '');
        
        if (!token) {
            return res.status(401).json({ 
                success: false,
                message: 'Token de autenticação não fornecido.'
            });
        }
        
        // Validar token
        const decoded = await verifyToken(token);
        
        // Adicionar usuário à requisição
        req.user = {
            uid: decoded.uid,
            email: decoded.email,
            // ... outros dados
        };
        
        next();
    } catch (error) {
        return res.status(401).json({ 
            success: false,
            message: 'Token inválido ou expirado.'
        });
    }
};
```

---

## 🔄 Fluxo Completo:

### 1. Usuário acessa página (sem login)
```
→ Verifica token → Não encontrado
→ Mostra tela "Autenticação Necessária"
```

### 2. Usuário vem do app logado
```
→ App passa token na URL: excluir-conta.html?token=ABC123
→ Página valida token com /api/auth/verify
→ Token válido → Mostra formulário
```

### 3. Usuário preenche e submete
```
→ Valida campos (telefone, senha)
→ Mostra confirmação
→ Usuário confirma
→ Envia POST /api/account/delete com Authorization header
→ Backend valida token, telefone e senha
→ Exclui conta
→ Retorna sucesso
```

### 4. Tratamento de erros
```
→ 401/403 → Mostra erro, limpa token, pede login novamente
→ 400 → Mostra erro de validação (senha/telefone incorretos)
→ 500 → Mostra erro interno
```

---

## 📱 Integração com App Mobile:

### Opção 1: Deep Link com Token

```javascript
// No app mobile (React Native)
import { Linking } from 'react-native';

const openDeleteAccountPage = async () => {
    const token = await getAuthToken(); // Token Firebase ou JWT
    const url = `https://seu-dominio.com/excluir-conta.html?token=${token}`;
    await Linking.openURL(url);
};
```

### Opção 2: WebView com Token

```javascript
// No app mobile
import { WebView } from 'react-native-webview';

const DeleteAccountScreen = () => {
    const [token, setToken] = useState(null);
    
    useEffect(() => {
        getAuthToken().then(setToken);
    }, []);
    
    return (
        <WebView
            source={{ 
                uri: `https://seu-dominio.com/excluir-conta.html?token=${token}`
            }}
            // Ou injetar token via JavaScript
            injectedJavaScript={`
                localStorage.setItem('leaf_auth_token', '${token}');
            `}
        />
    );
};
```

---

## ✅ Checklist de Implementação:

- [ ] Criar endpoint `/api/auth/verify` no backend
- [ ] Criar endpoint `/api/account/delete` com autenticação
- [ ] Implementar middleware de autenticação
- [ ] Validar telefone do usuário logado
- [ ] Validar senha antes de excluir
- [ ] Processar exclusão de conta no banco de dados
- [ ] Logar motivo da exclusão (opcional)
- [ ] Testar fluxo completo

---

## 🔒 Segurança Adicional (Recomendado):

1. **Rate limiting**: Limitar tentativas de exclusão por IP/usuário
2. **Confirmação por email**: Enviar email de confirmação antes de excluir
3. **Período de espera**: Excluir após X dias (período de reconsideração)
4. **2FA**: Se implementado, requerer também código 2FA
5. **Audit log**: Registrar todas as tentativas de exclusão

---

**🎉 Pronto! A página está segura e pronta para uso!**















