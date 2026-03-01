# ⚡ EXECUÇÃO RÁPIDA - TESTES AUTOMATIZADOS

## 🚀 Início Rápido

### 1. Instalar Dependências

```bash
cd tests
npm install
```

### 2. Configurar Servidor

Edite `config/test-parameters.js` ou use variáveis de ambiente:

```bash
export WS_URL=ws://216.238.107.59:3001
export TEST_DRIVER_ID=test-driver-001
export TEST_CUSTOMER_ID=test-customer-001
```

### 3. Executar Testes

```bash
# Todos os testes
npm test

# Suite específica
node suites/01-autenticacao-identidade.test.js

# Com variáveis de ambiente inline
WS_URL=ws://seu-servidor:3001 npm test
```

## 📊 Ver Resultados

Os resultados aparecem no console e são salvos em:
- `reports/test-report-{timestamp}.json`

## 🎯 Status Atual

- ✅ **Infraestrutura:** 100% completa
- ✅ **Parâmetros:** 43/43 definidos
- ✅ **Suite de exemplo:** Autenticação (4 testes)
- ⏳ **Outras suites:** A implementar (81 testes restantes)

## 📋 Estrutura Criada

```
tests/
├── config/          ✅ Parâmetros completos
├── helpers/         ✅ Helpers prontos
├── suites/          ✅ Template + 1 suite exemplo
├── reports/         ✅ Diretório criado
└── README.md        ✅ Documentação completa
```

## 🔧 Próximos Passos

1. **Testar a suite de exemplo:**
   ```bash
   cd tests
   npm install
   node suites/01-autenticacao-identidade.test.js
   ```

2. **Implementar outras suites:**
   - Use `00-template.test.js` como base
   - Consulte `PLANO_TESTES_COMPLETO.md` para cenários
   - Veja `01-autenticacao-identidade.test.js` como exemplo

3. **Expandir conforme necessário:**
   - Adicionar mais validações
   - Criar testes de integração
   - Adicionar testes de performance

---

**Tudo pronto para começar a implementar os testes restantes! 🎉**



