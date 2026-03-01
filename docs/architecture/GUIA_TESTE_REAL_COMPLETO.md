# 🧪 GUIA COMPLETO PARA TESTE REAL - LEAF APP

## 🎯 **USUÁRIOS DE TESTE REAIS DISPONÍVEIS**

### **👤 PASSAGEIRO DE TESTE:**
- **📞 Telefone**: `11999999999`
- **📧 Email**: `joao.teste@leaf.com`
- **🔐 Senha**: `teste123`
- **👤 Nome**: João Silva Teste
- **🆔 CPF**: 12345678901
- **📋 Tipo**: customer
- **✅ Status**: Aprovado automaticamente
- **🆔 UID Firebase**: `gyEGB07CssbnsACPJlywos40yaK2`

### **🚗 MOTORISTA DE TESTE:**
- **📞 Telefone**: `11888888888`
- **📧 Email**: `maria.teste@leaf.com`
- **🔐 Senha**: `teste123`
- **👤 Nome**: Maria Santos Teste
- **🆔 CPF**: 98765432109
- **📋 Tipo**: driver
- **✅ Status**: Aprovado (isApproved: true)
- **🚗 Veículo**: Honda Civic 2020
- **🚙 Placa**: ABC1234
- **✅ Veículo**: Aprovado (carApproved: true)
- **🆔 UID Firebase**: `G62Nd6i22GhxhFm9R3PT08d0Ouw2`

---

## 🚀 **COMO FAZER LOGIN NO APP**

### **Método 1 - Login por Telefone:**
1. Abra o app no dispositivo
2. Vá para tela de "Entrar"
3. Digite o telefone: `11999999999` (passageiro) ou `11888888888` (motorista)
4. Digite a senha: `teste123`
5. Clique em "Entrar"

### **Método 2 - Login por Email:**
1. Abra o app no dispositivo
2. Vá para tela de "Entrar"
3. Digite o email: `joao.teste@leaf.com` (passageiro) ou `maria.teste@leaf.com` (motorista)
4. Digite a senha: `teste123`
5. Clique em "Entrar"

---

## 🎯 **CENÁRIOS DE TESTE REAL**

### **📱 CENÁRIO 1: FLUXO COMPLETO DE CORRIDA**

#### **Passo 1: Login do Passageiro**
- Use: `11999999999` / `teste123`
- Verifique se entra como "customer"
- Confirme que está na tela principal

#### **Passo 2: Login do Motorista (em outro dispositivo)**
- Use: `11888888888` / `teste123`
- Verifique se entra como "driver"
- Confirme que está no dashboard do motorista
- Verifique se o status está "online"

#### **Passo 3: Solicitar Corrida (Passageiro)**
1. Na tela do mapa, toque em "Solicitar Corrida"
2. Defina origem e destino
3. Escolha tipo de corrida (Standard)
4. Confirme o pagamento (PIX)
5. **OBSERVE**: O sistema deve buscar motoristas automaticamente

#### **Passo 4: Aceitar Corrida (Motorista)**
1. **OBSERVE**: Deve aparecer notificação de nova corrida
2. Toque na notificação ou vá para o dashboard
3. Veja os detalhes da corrida
4. Toque em "Aceitar Corrida"
5. **OBSERVE**: Passageiro deve receber confirmação

#### **Passo 5: Iniciar Viagem**
1. Motorista vai até o local de origem
2. Toque em "Iniciar Viagem"
3. **OBSERVE**: Passageiro deve receber notificação

#### **Passo 6: Finalizar Viagem**
1. Motorista vai até o destino
2. Toque em "Finalizar Viagem"
3. **OBSERVE**: Sistema deve calcular valor final
4. Confirme o pagamento

#### **Passo 7: Avaliação**
1. Passageiro avalia o motorista
2. Motorista avalia o passageiro
3. **OBSERVE**: Avaliações devem ser salvas

---

### **📱 CENÁRIO 2: TESTE DE NOTIFICAÇÕES**

#### **Teste de Notificações Push:**
1. Faça login com ambos os usuários
2. Solicite uma corrida
3. **OBSERVE**: Motorista deve receber notificação push
4. Aceite a corrida
5. **OBSERVE**: Passageiro deve receber notificação de aceitação

#### **Teste de Notificações WebSocket:**
1. Mantenha ambos os apps abertos
2. Execute ações (solicitar, aceitar, iniciar, finalizar)
3. **OBSERVE**: Mudanças devem aparecer em tempo real
4. Verifique se não há delay entre ações

---

### **📱 CENÁRIO 3: TESTE DE FUNCIONALIDADES AVANÇADAS**

#### **Teste de Chat:**
1. Durante uma corrida ativa
2. Toque em "Chat" no app do passageiro
3. Envie uma mensagem
4. **OBSERVE**: Motorista deve receber a mensagem
5. Motorista responde
6. **OBSERVE**: Passageiro deve receber a resposta

#### **Teste de Localização em Tempo Real:**
1. Durante uma corrida ativa
2. Motorista se move pelo mapa
3. **OBSERVE**: Passageiro deve ver o motorista se movendo
4. Verifique se a localização é atualizada em tempo real

#### **Teste de Cancelamento:**
1. Solicite uma corrida
2. Antes do motorista aceitar, cancele
3. **OBSERVE**: Sistema deve processar cancelamento
4. Verifique se o reembolso é automático

---

## 🔧 **VERIFICAÇÕES TÉCNICAS**

### **✅ WebSocket Connection:**
- Verifique se ambos os apps estão conectados ao WebSocket
- Olhe no console do servidor para ver conexões ativas
- Teste desconectar/reconectar

### **✅ Firebase Integration:**
- Verifique se os dados são salvos no Firebase
- Confirme se as notificações push funcionam
- Teste login/logout múltiplas vezes

### **✅ Performance:**
- Meça tempo de resposta das ações
- Verifique se não há travamentos
- Teste com conexão lenta

---

## 🚨 **PROBLEMAS COMUNS E SOLUÇÕES**

### **❌ Problema: Login não funciona**
**Solução:**
1. Verifique se o telefone está correto (com +55)
2. Confirme se a senha é `teste123`
3. Tente login por email como alternativa

### **❌ Problema: Notificações não chegam**
**Solução:**
1. Verifique se as notificações estão habilitadas no dispositivo
2. Confirme se o FCM está configurado
3. Teste notificações manuais

### **❌ Problema: WebSocket não conecta**
**Solução:**
1. Verifique se o servidor está rodando
2. Confirme se a URL do WebSocket está correta
3. Teste conexão de rede

### **❌ Problema: Dados não salvam**
**Solução:**
1. Verifique conexão com Firebase
2. Confirme se as credenciais estão corretas
3. Teste com dados simples primeiro

---

## 📊 **MÉTRICAS PARA AVALIAR**

### **🎯 Performance:**
- Tempo de login: < 3 segundos
- Tempo de busca de motoristas: < 5 segundos
- Tempo de notificação: < 2 segundos
- Tempo de atualização de localização: < 1 segundo

### **🎯 Confiabilidade:**
- Taxa de sucesso do login: > 95%
- Taxa de entrega de notificações: > 90%
- Taxa de conexão WebSocket: > 98%
- Taxa de salvamento de dados: > 99%

### **🎯 Usabilidade:**
- Interface responsiva
- Feedback visual adequado
- Mensagens de erro claras
- Fluxo intuitivo

---

## 🎉 **RESULTADOS ESPERADOS**

### **✅ Se tudo funcionar perfeitamente:**
- Login rápido e confiável
- Notificações push funcionando
- WebSocket em tempo real
- Chat funcionando
- Localização em tempo real
- Pagamentos processados
- Avaliações salvas
- Dados persistindo no Firebase

### **🎯 Sistema pronto para produção!**

---

## 📞 **SUPORTE**

Se encontrar problemas durante os testes:
1. Verifique os logs do servidor WebSocket
2. Confirme se o Firebase está funcionando
3. Teste com dados simples primeiro
4. Use o sistema de logs implementado para debug

**Boa sorte com os testes! 🚀**






