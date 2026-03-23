# Paridade UI Smoke Report (2026-03-18)

- Simulacao websocket ponta a ponta: **PASS** (78288 ms)
- Cobertura de paridade (estado legado -> estado prototipo): **21/21 (100%)**
- Cobertura runtime validada (estados com stage tecnico mensuravel): **9/9 (100%)**

## Matriz

| Estado legado | Estado prototipo | Rota prototipo | Rota registrada | Entrada ligada | Smoke runtime |
|---|---|---|---|---|---|
| Mapa inicial (passageiro) | Home passageiro | RobotaxiPrototype | SIM | SIM | N/A |
| Busca de destino | Destino + sugestoes | RobotaxiPrototypeDestination | SIM | SIM | N/A |
| Resumo/confirmacao da corrida | Quote + escolha de categoria | RobotaxiPrototypeDestination | SIM | SIM | PASS |
| Pagamento | Pagamento PIX | RobotaxiPrototypePayment | SIM | SIM | PASS |
| Pagamento aprovado | Pagamento confirmado | RobotaxiPrototypePaymentSuccess | SIM | SIM | PASS |
| Pagamento recusado | Pagamento nao confirmado | RobotaxiPrototypePaymentFailed | SIM | SIM | N/A |
| Busca de motorista | Radar + expansao de raio | RobotaxiPrototypeDriverSearch | SIM | SIM | PASS |
| Sem motoristas | No drivers | RobotaxiPrototypeNoDrivers | SIM | SIM | N/A |
| Viagem em andamento | Trip passageiro | RobotaxiPrototypeTrip | SIM | SIM | PASS |
| Cancelamento de corrida | Cancellation modal | RobotaxiPrototypeCancellation | SIM | SIM | N/A |
| Recibo da corrida | Receipt + historico | RobotaxiPrototypeReceipt | SIM | SIM | PASS |
| Avaliacao | Rating | RobotaxiPrototypeRating | SIM | SIM | N/A |
| Reclamacao | Complain | RobotaxiPrototypeComplain | SIM | SIM | N/A |
| Chat | Chat da viagem | RobotaxiPrototypeChat | SIM | SIM | N/A |
| Suporte | Suporte + ticket/incidente | RobotaxiPrototypeSupport | SIM | SIM | N/A |
| Painel do motorista | Driver panel | RobotaxiPrototypeDriverPanel | SIM | SIM | PASS |
| Oferta para motorista | Driver offer | RobotaxiPrototypeDriverOffer | SIM | SIM | PASS |
| Viagem do motorista | Driver trip | RobotaxiPrototypeDriverTrip | SIM | SIM | PASS |
| Perfil | Perfil passageiro | RobotaxiPrototypeProfile | SIM | SIM | N/A |
| Configuracoes | Configuracoes | RobotaxiPrototypeSettings | SIM | SIM | N/A |
| Menu lateral | Menu funcional | RobotaxiPrototypeMenu | SIM | SIM | N/A |

## Evidencias

- [simulated-ride.json](/Users/izaakdias/Documents/Leaf-new/mobile-app/test-results/parity_smoke_2026-03-18/simulated-ride.json)
- [simulated-ride.log](/Users/izaakdias/Documents/Leaf-new/mobile-app/test-results/parity_smoke_2026-03-18/simulated-ride.log)
- [prototype-route-coverage.json](/Users/izaakdias/Documents/Leaf-new/mobile-app/test-results/parity_smoke_2026-03-18/prototype-route-coverage.json)
- [prototype-syntax-check.json](/Users/izaakdias/Documents/Leaf-new/mobile-app/test-results/parity_smoke_2026-03-18/prototype-syntax-check.json)
