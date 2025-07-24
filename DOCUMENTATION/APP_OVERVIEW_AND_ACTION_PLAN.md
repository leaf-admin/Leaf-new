# Panorama Geral do App Mobile Leaf

## 1. Funcionalidades Implementadas

### Autenticação e Cadastro
- Login por e-mail/senha
- Login com Google (OAuth)
- Cadastro de usuário (passageiro e motorista)
- Verificação de e-mail
- Onboarding com seleção de perfil (passageiro/motorista)
- Recuperação de senha

### Perfil e Configurações
- Tela de perfil do usuário (visualização e edição)
- Edição de dados pessoais (nome, e-mail, telefone, foto)
- Troca de senha
- Logout
- Configurações de idioma e tema (dark mode)
- Notificações (push)

### Motorista
- Cadastro e gerenciamento de veículos (estrutura global, classificação automática, upload de CRLV)
- Tela de ganhos e relatórios
- Tela de viagens realizadas
- Aprovação manual de documentos (backend/admin)
- Visualização de status do veículo (em análise, aprovado, recusado)

### Passageiro
- Solicitação de corridas (imediata e agendada)
- Seleção de ponto de partida e destino
- Estimativa de valor, distância e tempo
- Visualização de motoristas próximos em tempo real (WebSocket + Redis)
- Histórico de corridas
- Avaliação de motoristas

### Pagamentos
- Integração com múltiplos gateways (Stripe, PayPal, etc)
- Pagamento em dinheiro e cartão
- Carteira digital (saldo, extrato)
- Saque via Pix (Woovi API)
- Relatórios de ganhos para motoristas

### Outras Funcionalidades
- Chat em tempo real entre passageiro e motorista
- Notificações de status de corrida
- Sistema de reclamações/SOS
- Suporte a múltiplos idiomas
- Integração com Firebase (Auth, Database, Storage)
- Integração com WebSocket/Redis para localização em tempo real

---

## 2. Funcionalidades/Pendências a Implementar

- Aprovação/reprovação de veículos via painel admin (com feedback para o motorista)
- Garantir que apenas um veículo por placa esteja ativo globalmente
- Automatizar validação de ar-condicionado e número de portas via OCR do CRLV
- Melhorias no fluxo de cadastro de veículos (ex: feedback visual de status, upload múltiplo de documentos)
- Dashboard de métricas para motoristas e passageiros
- Integração completa com sistemas de pagamento locais (ex: integração bancária direta)
- Melhorias no sistema de notificações (ex: notificações segmentadas, histórico)
- Implementar logs de auditoria para alterações de status de veículos e corridas
- Melhorias de acessibilidade (A11y)
- Testes automatizados (unitários e E2E)
- Refino do design responsivo para tablets e telas grandes
- Otimização de performance para dispositivos de entrada
- Refatoração de código legado e padronização de estilos

---

## 3. Pontos de Aprimoramento/Melhorias

- UX/UI: tornar telas mais fluidas, menos containerizadas, com feedbacks visuais claros
- Performance: otimizar carregamento de imagens, lazy loading de listas e mapas
- Segurança: reforçar validações no backend, uso de HTTPS, proteção de endpoints sensíveis
- Internacionalização: ampliar cobertura de traduções e adaptar para novos idiomas
- Modularização: separar lógicas de negócio em hooks e serviços reutilizáveis
- Documentação: manter documentação técnica e de negócio sempre atualizada
- Monitoramento: integrar ferramentas de analytics e crash reporting
- Experiência offline: melhorar fallback para conexões instáveis
- Suporte a múltiplos perfis por usuário (ex: motorista e passageiro no mesmo app)

---

## 4. Plano de Ação (Execução Passo a Passo)

### Etapa 1: Pendências Críticas
1. Implementar painel admin para aprovação/reprovação de veículos
2. Garantir unicidade de placa ativa globalmente
3. Adicionar feedback visual de status do veículo para o motorista
4. Automatizar validação de ar-condicionado/portas via OCR (opcional, futuro)

### Etapa 2: Experiência do Usuário
5. Refatorar telas para UX mais fluida e responsiva
6. Melhorar sistema de notificações e feedbacks
7. Adicionar dashboard de métricas para motoristas
8. Melhorar acessibilidade e responsividade

### Etapa 3: Performance e Qualidade
9. Otimizar carregamento de imagens e mapas
10. Implementar testes automatizados (unitários/E2E)
11. Refatorar código legado e padronizar estilos
12. Integrar ferramentas de monitoramento e analytics

### Etapa 4: Expansão e Futuro
13. Ampliar integrações de pagamento
14. Expandir internacionalização
15. Suporte a múltiplos perfis por usuário
16. Evoluir documentação e logs de auditoria

---

## Exportar como PDF
Para exportar este documento como PDF:
1. Abra este arquivo no VSCode ou editor de sua preferência
2. Use uma extensão de exportação Markdown → PDF (ex: Markdown PDF, Markdown Preview Enhanced)
3. Ou utilize um conversor online confiável

---

*Documento gerado automaticamente em 2024-06-08.* 