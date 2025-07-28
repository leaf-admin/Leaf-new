# 💰 DISCRIMINAÇÃO DETALHADA DE CUSTOS POR CORRIDA

## 📅 Data da Análise
**26/07/2025, 16:20:10**

## 🎯 OBJETIVO
Discriminar detalhadamente o custo total de **R$ 0,90** por corrida de R$ 30,00, baseado na simulação completa executada.

## 📊 CUSTO TOTAL: R$ 0,902100

### **🗺️ Google Maps: R$ 0,400000 (44,3%)**
| **Operação** | **Quantidade** | **Custo Unitário** | **Custo Total** |
|--------------|----------------|-------------------|-----------------|
| **Geocoding** | 1 request | R$ 0,025 | R$ 0,025 |
| **Directions** | 15 requests | R$ 0,025 | R$ 0,375 |
| **Total Google Maps** | **16 requests** | - | **R$ 0,400** |

**Detalhamento:**
- **Fase 1 (Busca):** 1 geocoding = R$ 0,025
- **Fase 3 (Viagem):** 15 directions (1 a cada minuto) = R$ 0,375
- **Total:** R$ 0,400

### **🔥 Firebase: R$ 0,001602 (0,2%)**
| **Operação** | **Quantidade** | **Custo Unitário** | **Custo Total** |
|--------------|----------------|-------------------|-----------------|
| **Functions** | 2 execuções | R$ 0,000801 | R$ 0,001602 |
| **Database Reads** | 8 operações | R$ 0,0000003 | R$ 0,0000024 |
| **Database Writes** | 8 operações | R$ 0,0000009 | R$ 0,0000072 |
| **Total Firebase** | - | - | **R$ 0,001602** |

**Detalhamento:**
- **Fase 2:** 1 function (update_booking) = R$ 0,000320
- **Fase 4:** 1 function (complete_trip) = R$ 0,001280
- **Database:** 16 operações total = R$ 0,0000096
- **Total:** R$ 0,001602

### **💳 APIs de Pagamento: R$ 0,500000 (55,4%)**
| **Operação** | **Quantidade** | **Custo Unitário** | **Custo Total** |
|--------------|----------------|-------------------|-----------------|
| **Woovi PIX** | 1 transação | R$ 0,50 | R$ 0,50 |
| **Total Payment APIs** | **1 transação** | - | **R$ 0,50** |

**Detalhamento:**
- **Taxa Woovi:** 0,8% de R$ 30,00 = R$ 0,24
- **Taxa mínima aplicada:** R$ 0,50 (maior que 0,8%)
- **Observação:** Taxa debitada do valor da corrida, não impacta nosso lucro
- **Total:** R$ 0,50

### **🔴 Redis: R$ 0,000086 (0,01%)**
| **Operação** | **Quantidade** | **Custo Unitário** | **Custo Total** |
|--------------|----------------|-------------------|-----------------|
| **Operações** | 85 ops | R$ 0,000005 | R$ 0,000425 |
| **Conexões** | 1 conn | R$ 0,0005 | R$ 0,0005 |
| **Total Redis** | - | - | **R$ 0,000086** |

**Detalhamento:**
- **Fase 1:** 10 operações + 1 conexão = R$ 0,000550
- **Fase 3:** 75 operações (5 por minuto × 15 minutos) = R$ 0,000375
- **Total:** R$ 0,000086

### **🔌 WebSocket: R$ 0,000360 (0,04%)**
| **Operação** | **Quantidade** | **Custo Unitário** | **Custo Total** |
|--------------|----------------|-------------------|-----------------|
| **Conexões** | 2 conns | R$ 0,0005 | R$ 0,001 |
| **Mensagens** | 70 msgs | R$ 0,000005 | R$ 0,00035 |
| **Total WebSocket** | - | - | **R$ 0,000360** |

**Detalhamento:**
- **Fase 2:** 2 conexões + 10 mensagens = R$ 0,001050
- **Fase 3:** 60 mensagens (4 por minuto × 15 minutos) = R$ 0,000300
- **Total:** R$ 0,000360

### **📱 Mobile API: R$ 0,000018 (0,002%)**
| **Operação** | **Quantidade** | **Custo Unitário** | **Custo Total** |
|--------------|----------------|-------------------|-----------------|
| **Chamadas API** | 18 calls | R$ 0,000005 | R$ 0,000090 |
| **Dados transferidos** | 9,5KB | - | - |
| **Total Mobile API** | - | - | **R$ 0,000018** |

**Detalhamento:**
- **Fase 1:** 3 chamadas = R$ 0,000015
- **Fase 3:** 15 chamadas (1 por minuto) = R$ 0,000075
- **Total:** R$ 0,000018

### **📍 Location Updates: R$ 0,000034 (0,004%)**
| **Operação** | **Quantidade** | **Custo Unitário** | **Custo Total** |
|--------------|----------------|-------------------|-----------------|
| **Atualizações** | 34 updates | R$ 0,000005 | R$ 0,000170 |
| **Total Location** | - | - | **R$ 0,000034** |

**Detalhamento:**
- **Fase 1:** 4 atualizações = R$ 0,000020
- **Fase 3:** 30 atualizações (2 por minuto × 15 minutos) = R$ 0,000150
- **Total:** R$ 0,000034

## 📋 RESUMO POR FASE DA VIAGEM

### **🚀 FASE 1: BUSCA DE VIAGEM (2 minutos)**
- **Google Maps:** R$ 0,025 (geocoding)
- **Firebase:** R$ 0,000000 (database reads)
- **Redis:** R$ 0,000011 (10 ops + 1 conn)
- **Mobile API:** R$ 0,000003 (3 calls)
- **Location:** R$ 0,000004 (4 updates)
- **Subtotal Fase 1:** R$ 0,025018

### **✅ FASE 2: ACEITAÇÃO DA VIAGEM (30 segundos)**
- **Firebase:** R$ 0,000321 (1 function + database)
- **WebSocket:** R$ 0,000300 (2 conns + 10 msgs)
- **Subtotal Fase 2:** R$ 0,000621

### **🚗 FASE 3: VIAGEM EM ANDAMENTO (15 minutos)**
- **Google Maps:** R$ 0,375 (15 directions)
- **Redis:** R$ 0,000075 (75 ops)
- **WebSocket:** R$ 0,000060 (60 msgs)
- **Mobile API:** R$ 0,000015 (15 calls)
- **Location:** R$ 0,000030 (30 updates)
- **Subtotal Fase 3:** R$ 0,375180

### **💳 FASE 4: FINALIZAÇÃO E PAGAMENTO (2 minutos)**
- **Firebase:** R$ 0,001281 (1 function + database)
- **Woovi PIX:** R$ 0,500000 (pagamento)
- **Subtotal Fase 4:** R$ 0,501281

## 🎯 ANÁLISE DE CUSTOS POR CATEGORIA

### **🔝 TOP 5 MAIORES CUSTOS:**
1. **💳 Payment APIs (Woovi):** R$ 0,50 (55,4%) - *Não impacta nosso lucro*
2. **🗺️ Google Maps:** R$ 0,40 (44,3%)
3. **🔥 Firebase Functions:** R$ 0,0016 (0,2%)
4. **🔌 WebSocket:** R$ 0,00036 (0,04%)
5. **🔴 Redis:** R$ 0,000086 (0,01%)

### **📊 DISTRIBUIÇÃO PERCENTUAL:**
- **APIs Externas:** 99,7% (Woovi + Google Maps)
- **Infraestrutura:** 0,3% (Firebase + Redis + WebSocket)
- **Mobile:** 0,006% (API calls + Location)

### **💰 IMPACTO NO NOSSO LUCRO:**
- **Custos que impactam nosso lucro:** R$ 0,402086 (Google Maps + Firebase + Redis + WebSocket + Mobile)
- **Custos que NÃO impactam nosso lucro:** R$ 0,50 (Woovi PIX - debitado do valor da corrida)

## 💡 INSIGHTS E RECOMENDAÇÕES

### **🔴 ALTA PRIORIDADE:**
1. **Google Maps (44,3%):** 16 requests por corrida
   - **Recomendação:** Implementar cache local de rotas comuns
   
2. **Woovi PIX:** Taxa mínima de R$ 0,50
   - **Observação:** Não impacta nosso lucro (debitada do valor da corrida)
   - **Recomendação:** Negociar volume para reduzir taxa mínima

### **🟡 MÉDIA PRIORIDADE:**
3. **Firebase Functions (0,2%):** Custo baixo mas pode escalar
   - **Recomendação:** Otimizar execuções e cold starts

### **🟢 BAIXA PRIORIDADE:**
4. **WebSocket (0,04%):** Custo muito baixo
5. **Redis (0,01%):** Custo insignificante
6. **Mobile API (0,002%):** Custo mínimo

## 🏆 CONCLUSÃO

**O custo de R$ 0,90 por corrida é composto por:**
- **R$ 0,40** em Google Maps (44,3%)
- **R$ 0,50** em Woovi PIX (55,4%) - *NÃO impacta nosso lucro*

**Custos que impactam nosso lucro: R$ 0,40**
- **Google Maps:** R$ 0,40 (99,5% dos custos que impactam nosso lucro)
- **Infraestrutura:** R$ 0,002 (0,5% dos custos que impactam nosso lucro)

**O modelo é altamente eficiente, com custos operacionais mínimos e foco em serviços externos especializados.** 