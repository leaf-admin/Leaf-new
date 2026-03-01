# 📋 COMMAND HANDLERS - LEAF

## 🎯 Objetivo

Camada de comandos que processa ações e publica eventos, seguindo o padrão CQRS (Command Query Responsibility Segregation).

## 📁 Estrutura

```
commands/
├── index.js                  # Classe base Command e CommandResult
├── RequestRideCommand.js     # Criar corrida
├── AcceptRideCommand.js      # Aceitar corrida
├── StartTripCommand.js       # Iniciar viagem
├── CompleteTripCommand.js    # Finalizar viagem
└── CancelRideCommand.js      # Cancelar corrida
```

## 🔧 Uso

### Executar um command:

```javascript
const RequestRideCommand = require('./commands/RequestRideCommand');

const command = new RequestRideCommand({
    customerId: 'customer_123',
    pickupLocation: { lat: -23.5505, lng: -46.6333 },
    destinationLocation: { lat: -23.5515, lng: -46.6343 },
    estimatedFare: 25.50,
    paymentMethod: 'pix'
});

const result = await command.execute();

if (result.success) {
    console.log('Corrida criada:', result.data.bookingId);
    // Evento já foi publicado automaticamente
} else {
    console.error('Erro:', result.error);
}
```

## ✅ Regras dos Commands

1. **Commands NÃO notificam** - Notificações são responsabilidade de listeners
2. **Commands NÃO fazem socket** - Emissões WebSocket são responsabilidade de handlers
3. **Commands NÃO chamam outros serviços diretamente** - Apenas mudam estado e publicam eventos
4. **Commands validam dados** - Cada command valida seus próprios dados
5. **Commands publicam eventos** - Após processar, publicam evento canônico

## 📝 Commands Implementados

- ✅ `RequestRideCommand` - Criar corrida
- ✅ `AcceptRideCommand` - Aceitar corrida
- ✅ `StartTripCommand` - Iniciar viagem
- ✅ `CompleteTripCommand` - Finalizar viagem
- ✅ `CancelRideCommand` - Cancelar corrida

## 🚀 Próximos Passos

- [ ] Integrar commands nos handlers do `server.js`
- [ ] Criar testes unitários para cada command
- [ ] Adicionar mais commands conforme necessário

