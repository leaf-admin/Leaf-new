# 📝 Testes Reais Criados

## ✅ Testes Disponíveis

### 🔐 Autenticação

1. **`auth/01-login-customer-real.yaml`**
   - Login completo como customer
   - Trata usuário novo e existente
   - Captura screenshots em cada etapa

### 🚗 Corridas

1. **`rides/01-request-ride-real.yaml`**
   - Solicitar corrida completa
   - Preenche origem e destino
   - Aguarda cálculo de preço
   - Confirma solicitação

### 👨‍✈️ Motorista

1. **`driver/01-driver-go-online.yaml`**
   - Driver ficar online
   - Verifica mudança de estado
   - Confirma que está recebendo corridas

## 🎯 Como Executar

### Teste Individual

```bash
# Com visualização automática
bash scripts/run-test-with-viewer.sh .maestro/flows/auth/01-login-customer-real.yaml
```

### Todos os Testes de uma Categoria

```bash
npm run test:e2e:auth
npm run test:e2e:rides
npm run test:e2e:driver
```

## 📸 Screenshots

Todos os testes capturam screenshots automaticamente em:
```
.maestro/screenshots/test_YYYYMMDD_HHMMSS/
```

## ⚠️ Ajustes Necessários

Os testes foram criados com seletores genéricos. **Você precisa ajustar:**

1. **Textos dos botões** - Podem ter mudado
2. **IDs dos elementos** - Adicione `testID` nos componentes
3. **Timeouts** - Ajuste conforme velocidade do app
4. **Fluxos** - Adapte conforme sua lógica de negócio

## 🔧 Adicionar testID nos Componentes

Para tornar os testes mais robustos, adicione `testID`:

```javascript
// Exemplo: Botão de Login
<TouchableOpacity 
  testID="login-button"
  onPress={handleLogin}
>
  <Text>Entrar</Text>
</TouchableOpacity>
```

Depois use no teste:
```yaml
- tapOn:
    id: "login-button"
```

## 📚 Ver Documentação Completa

- `COMO_TESTAR_E_ANALISAR.md` - Guia completo
- `GUIA_TESTES_E2E.md` - Documentação técnica













