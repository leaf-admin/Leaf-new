# 💰 ANÁLISE DE CUSTO: PERSISTÊNCIA DE CHAT NO FIRESTORE

## 📅 Data: 16 de Dezembro de 2025

---

## 🎯 **PERGUNTA CENTRAL**

> **Por que usaríamos Firestore para chat e qual o custo?**

---

## 📊 **CENÁRIO DE USO**

### **Volume Estimado de Mensagens:**

**Cenário Conservador (MVP):**
- 10.000 corridas/dia
- 5 mensagens por corrida (média)
- **50.000 mensagens/dia**
- **1.500.000 mensagens/mês**

**Cenário Realista (Crescimento):**
- 50.000 corridas/dia
- 8 mensagens por corrida (média)
- **400.000 mensagens/dia**
- **12.000.000 mensagens/mês**

**Cenário Otimista (Escala):**
- 100.000 corridas/dia
- 10 mensagens por corrida (média)
- **1.000.000 mensagens/dia**
- **30.000.000 mensagens/mês**

---

## 💰 **CUSTO DO FIRESTORE**

### **Preços do Firestore (Google Cloud):**

#### **Writes (Escritas):**
- **Primeiros 20k writes/dia**: **GRÁTIS**
- **Acima de 20k writes/dia**: **$0.18 por 100k writes**

#### **Reads (Leituras):**
- **Primeiros 50k reads/dia**: **GRÁTIS**
- **Acima de 50k reads/dia**: **$0.06 por 100k reads**

#### **Storage (Armazenamento):**
- **Primeiros 1GB**: **GRÁTIS**
- **Acima de 1GB**: **$0.18 por GB/mês**

#### **Deletes (Exclusões):**
- **GRÁTIS** (não cobrado)

---

## 📊 **CÁLCULO DE CUSTO POR CENÁRIO**

### **CENÁRIO 1: MVP (10k corridas/dia, 5 msg/corrida)**

**Mensagens:**
- 50.000 mensagens/dia
- 1.500.000 mensagens/mês

**Writes:**
- 50.000 writes/dia (1 por mensagem)
- 1.500.000 writes/mês
- **Gratuito**: 20k writes/dia = 600k writes/mês
- **Pago**: 1.500.000 - 600.000 = **900.000 writes/mês**
- **Custo**: (900.000 / 100.000) × $0.18 = **$1.62/mês** ≈ **R$ 8,10/mês**

**Reads (estimativa):**
- 10.000 reads/dia (usuários carregando histórico)
- 300.000 reads/mês
- **Gratuito**: 50k reads/dia = 1.500.000 reads/mês
- **Custo**: **R$ 0/mês** (dentro do free tier)

**Storage:**
- Tamanho médio por mensagem: ~500 bytes
- 1.500.000 mensagens × 500 bytes = 750 MB
- **Custo**: **R$ 0/mês** (dentro do free tier de 1GB)

**TOTAL: ~R$ 8,10/mês** ✅

---

### **CENÁRIO 2: Crescimento (50k corridas/dia, 8 msg/corrida)**

**Mensagens:**
- 400.000 mensagens/dia
- 12.000.000 mensagens/mês

**Writes:**
- 400.000 writes/dia
- 12.000.000 writes/mês
- **Gratuito**: 600.000 writes/mês
- **Pago**: 12.000.000 - 600.000 = **11.400.000 writes/mês**
- **Custo**: (11.400.000 / 100.000) × $0.18 = **$20.52/mês** ≈ **R$ 102,60/mês**

**Reads:**
- 50.000 reads/dia
- 1.500.000 reads/mês
- **Custo**: **R$ 0/mês** (dentro do free tier)

**Storage:**
- 12.000.000 mensagens × 500 bytes = 6 GB
- **Gratuito**: 1 GB
- **Pago**: 6 GB - 1 GB = **5 GB**
- **Custo**: 5 × $0.18 = **$0.90/mês** ≈ **R$ 4,50/mês**

**TOTAL: ~R$ 107,10/mês** ⚠️

---

### **CENÁRIO 3: Escala (100k corridas/dia, 10 msg/corrida)**

**Mensagens:**
- 1.000.000 mensagens/dia
- 30.000.000 mensagens/mês

**Writes:**
- 1.000.000 writes/dia
- 30.000.000 writes/mês
- **Gratuito**: 600.000 writes/mês
- **Pago**: 30.000.000 - 600.000 = **29.400.000 writes/mês**
- **Custo**: (29.400.000 / 100.000) × $0.18 = **$52.92/mês** ≈ **R$ 264,60/mês**

**Reads:**
- 100.000 reads/dia
- 3.000.000 reads/mês
- **Gratuito**: 1.500.000 reads/mês
- **Pago**: 3.000.000 - 1.500.000 = **1.500.000 reads/mês**
- **Custo**: (1.500.000 / 100.000) × $0.06 = **$0.90/mês** ≈ **R$ 4,50/mês**

**Storage:**
- 30.000.000 mensagens × 500 bytes = 15 GB
- **Gratuito**: 1 GB
- **Pago**: 15 GB - 1 GB = **14 GB**
- **Custo**: 14 × $0.18 = **$2.52/mês** ≈ **R$ 12,60/mês**

**TOTAL: ~R$ 281,70/mês** ⚠️⚠️

---

## 🤔 **POR QUE USAR FIRESTORE PARA CHAT?**

### **Vantagens:**
1. ✅ **Simplicidade**: Fácil de implementar e manter
2. ✅ **Escalabilidade**: Escala automaticamente
3. ✅ **TTL Nativo**: Suporte a expiração automática
4. ✅ **Queries**: Fácil buscar mensagens por conversa
5. ✅ **Backup Automático**: Google gerencia backups
6. ✅ **Disponibilidade**: 99.95% SLA
7. ✅ **Integração**: Já está no projeto (Firebase)

### **Desvantagens:**
1. ❌ **Custo**: Pode ficar caro em escala
2. ❌ **Latência**: ~50-100ms (aceitável para chat)
3. ❌ **Limites**: 1 write/segundo por documento (não é problema para chat)

---

## 💡 **ALTERNATIVAS E ANÁLISE**

### **OPÇÃO 1: Firestore (Atual)** ⭐ RECOMENDADA PARA MVP

**Custo MVP:** ~R$ 8,10/mês  
**Custo Escala:** ~R$ 281,70/mês

**Quando usar:**
- ✅ MVP até 10k corridas/dia
- ✅ Quando simplicidade é prioridade
- ✅ Quando já está usando Firebase

---

### **OPÇÃO 2: Redis + Firestore (Híbrido)**

**Arquitetura:**
- **Redis**: Mensagens recentes (últimas 24h)
- **Firestore**: Histórico completo (com TTL)

**Custo:**
- Redis: ~R$ 50-100/mês
- Firestore: ~R$ 8-50/mês (depende do volume)
- **Total: ~R$ 58-150/mês**

**Vantagens:**
- ✅ Performance: Redis ultra-rápido
- ✅ Custo: Reduz writes no Firestore
- ✅ Histórico: Mantém no Firestore

**Desvantagens:**
- ❌ Complexidade: Dual-write
- ❌ Sincronização: Pode ter inconsistências

---

### **OPÇÃO 3: Apenas Redis (Sem Persistência)**

**Custo:** ~R$ 50-100/mês

**Vantagens:**
- ✅ Performance máxima
- ✅ Custo fixo
- ✅ Simplicidade

**Desvantagens:**
- ❌ **Sem histórico**: Mensagens perdidas se Redis cair
- ❌ **Sem auditoria**: Não há rastreabilidade
- ❌ **Sem suporte**: Impossível investigar problemas
- ❌ **LGPD**: Pode violar retenção de dados

**⚠️ NÃO RECOMENDADO para produção**

---

### **OPÇÃO 4: PostgreSQL/MySQL (Self-hosted)**

**Custo:** ~R$ 50-200/mês (VPS)

**Vantagens:**
- ✅ Custo fixo
- ✅ Controle total
- ✅ Queries SQL poderosas

**Desvantagens:**
- ❌ Manutenção: Você gerencia tudo
- ❌ Escalabilidade: Precisa sharding manual
- ❌ Backup: Você faz backup
- ❌ Complexidade: Mais complexo que Firestore

---

### **OPÇÃO 5: MongoDB Atlas**

**Custo:** ~R$ 50-300/mês (depende do tier)

**Vantagens:**
- ✅ Escalável
- ✅ TTL nativo
- ✅ Queries flexíveis

**Desvantagens:**
- ❌ Custo similar ao Firestore
- ❌ Mais complexo que Firestore
- ❌ Não está no stack atual

---

### **OPÇÃO 6: Firestore + Limpeza Agressiva**

**Estratégia:**
- Salvar apenas últimas 50 mensagens por conversa
- Limpar mensagens antigas automaticamente
- Reduzir TTL para 30 dias (ao invés de 90)

**Custo Reduzido:**
- MVP: ~R$ 4-5/mês
- Escala: ~R$ 100-150/mês

**Vantagens:**
- ✅ Mantém simplicidade do Firestore
- ✅ Reduz custo significativamente
- ✅ Ainda tem histórico útil

**Desvantagens:**
- ⚠️ Histórico limitado (apenas 30 dias)

---

## 🎯 **ANÁLISE COMPARATIVA**

| Opção | Custo MVP | Custo Escala | Simplicidade | Histórico | Recomendação |
|-------|-----------|-------------|--------------|-----------|--------------|
| **Firestore** | R$ 8/mês | R$ 282/mês | ⭐⭐⭐⭐⭐ | Completo | ⭐⭐⭐⭐ MVP |
| **Redis + Firestore** | R$ 58/mês | R$ 150/mês | ⭐⭐⭐ | Completo | ⭐⭐⭐ Escala |
| **Apenas Redis** | R$ 50/mês | R$ 100/mês | ⭐⭐⭐⭐⭐ | ❌ Nenhum | ❌ Não usar |
| **PostgreSQL** | R$ 50/mês | R$ 200/mês | ⭐⭐ | Completo | ⭐⭐ Self-hosted |
| **MongoDB Atlas** | R$ 50/mês | R$ 300/mês | ⭐⭐⭐ | Completo | ⭐⭐ Alternativa |
| **Firestore + Limpeza** | R$ 4/mês | R$ 100/mês | ⭐⭐⭐⭐⭐ | Limitado | ⭐⭐⭐⭐⭐ **MELHOR** |

---

## 💡 **RECOMENDAÇÃO FINAL**

### **Para MVP (0-10k corridas/dia):**
**✅ OPÇÃO 6: Firestore com Limpeza Agressiva**

**Justificativa:**
- ✅ Custo baixíssimo (~R$ 4-5/mês)
- ✅ Simplicidade máxima
- ✅ Histórico suficiente (30 dias)
- ✅ TTL automático
- ✅ Fácil implementar

**Implementação:**
- Salvar todas as mensagens
- TTL de 30 dias (ao invés de 90)
- Limpar mensagens antigas automaticamente
- Manter apenas últimas 50 mensagens por conversa ativa

---

### **Para Escala (10k+ corridas/dia):**
**✅ OPÇÃO 2: Redis + Firestore (Híbrido)**

**Justificativa:**
- ✅ Performance: Redis para mensagens recentes
- ✅ Histórico: Firestore para auditoria
- ✅ Custo controlado (~R$ 100-150/mês)
- ✅ Melhor dos dois mundos

**Implementação:**
- Redis: Últimas 24h de mensagens
- Firestore: Histórico completo (TTL 30 dias)
- Sincronização: Background sync

---

## 📊 **CUSTO POR MENSAGEM**

### **Firestore (com limpeza):**
- **MVP**: R$ 4/mês ÷ 1.500.000 mensagens = **R$ 0,0000027 por mensagem**
- **Escala**: R$ 100/mês ÷ 12.000.000 mensagens = **R$ 0,0000083 por mensagem**

### **Redis + Firestore:**
- **Escala**: R$ 150/mês ÷ 12.000.000 mensagens = **R$ 0,0000125 por mensagem**

**Conclusão:** Custo por mensagem é **extremamente baixo** (< R$ 0,00001)

---

## 🎯 **POR QUE USAR FIRESTORE?**

### **1. Custo Baixo para MVP**
- ✅ Primeiros 20k writes/dia = **GRÁTIS**
- ✅ MVP: ~R$ 4-8/mês
- ✅ Custo por mensagem: < R$ 0,00001

### **2. Simplicidade**
- ✅ Sem servidor para gerenciar
- ✅ Sem backup para configurar
- ✅ Escala automaticamente
- ✅ TTL nativo

### **3. Funcionalidades Necessárias**
- ✅ Queries por conversa
- ✅ Ordenação por timestamp
- ✅ Filtros (não expiradas)
- ✅ Histórico completo

### **4. Integração**
- ✅ Já está no projeto
- ✅ Mesma infraestrutura
- ✅ Mesma autenticação
- ✅ Mesmo stack

### **5. Compliance**
- ✅ LGPD: TTL automático remove dados antigos
- ✅ Auditoria: Histórico completo
- ✅ Backup: Automático pelo Google

---

## ⚠️ **QUANDO NÃO USAR FIRESTORE?**

### **Não usar se:**
- ❌ Volume > 1M mensagens/dia (custo > R$ 300/mês)
- ❌ Precisa de queries SQL complexas
- ❌ Precisa de transações complexas
- ❌ Orçamento muito limitado (< R$ 5/mês)

---

## 🔧 **OTIMIZAÇÕES DE CUSTO**

### **1. Reduzir TTL**
- 90 dias → 30 dias = **-66% de storage**

### **2. Limitar Mensagens por Conversa**
- Manter apenas últimas 50 mensagens = **-80% de writes**

### **3. Batch Writes**
- Agrupar múltiplas mensagens = **-50% de writes**

### **4. Índices Otimizados**
- Criar índices corretos = **-30% de reads**

### **5. Cache de Leitura**
- Cachear mensagens recentes = **-50% de reads**

---

## 📊 **CUSTO OTIMIZADO**

### **MVP Otimizado:**
- TTL: 30 dias
- Limite: 50 mensagens/conversa
- **Custo: ~R$ 2-4/mês** ✅

### **Escala Otimizada:**
- Redis para recentes + Firestore para histórico
- TTL: 30 dias
- **Custo: ~R$ 50-100/mês** ✅

---

## 🎯 **CONCLUSÃO**

### **Resposta à pergunta:**
> **Por que usaríamos Firestore para chat?**

**Resposta:**
1. ✅ **Custo baixo**: R$ 4-8/mês para MVP
2. ✅ **Simplicidade**: Sem infraestrutura para gerenciar
3. ✅ **Funcionalidades**: TTL, queries, histórico
4. ✅ **Integração**: Já está no projeto
5. ✅ **Compliance**: LGPD com TTL automático

### **Custo é justificável?**
**SIM**, porque:
- ✅ Custo por mensagem: < R$ 0,00001
- ✅ Custo mensal: < R$ 10/mês para MVP
- ✅ Valor agregado: Histórico, auditoria, suporte
- ✅ Alternativas não são muito mais baratas

### **Recomendação:**
**✅ USAR FIRESTORE com otimizações:**
- TTL de 30 dias (ao invés de 90)
- Limitar a 50 mensagens por conversa
- Limpeza automática de mensagens antigas

**Custo final: ~R$ 2-4/mês para MVP** ✅

---

**Última atualização:** 16/12/2025



