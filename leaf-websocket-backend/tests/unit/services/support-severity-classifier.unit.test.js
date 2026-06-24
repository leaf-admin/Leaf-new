const {
  classifySupportTicketSeverity
} = require('../../../services/support-severity-classifier');

describe('support-severity-classifier', () => {
  it('classifies safety and emergency language as N1', () => {
    expect(classifySupportTicketSeverity({
      subject: 'Emergência na corrida',
      description: 'O motorista me ameaçou e estou em risco de vida.',
      category: 'general',
      requestedPriority: 'N3'
    })).toMatchObject({
      priority: 'N1',
      severity: 'critical',
      prioritySource: 'classifier'
    });
  });

  it('classifies payment and refund problems as at least N2', () => {
    expect(classifySupportTicketSeverity({
      subject: 'Pix pago',
      description: 'Paguei e a corrida ficou travada, preciso de reembolso.',
      category: 'payment',
      requestedPriority: 'N3'
    })).toMatchObject({
      priority: 'N2',
      severity: 'elevated'
    });
  });

  it('does not trust app user priority inflation without matching severity evidence', () => {
    expect(classifySupportTicketSeverity({
      subject: 'Dúvida sobre perfil',
      description: 'Gostaria de trocar meu nome no cadastro.',
      category: 'account',
      requestedPriority: 'N1'
    })).toMatchObject({
      priority: 'N3',
      requestedPriority: 'N1',
      requestedPriorityTrusted: false
    });
  });

  it('preserves trusted operator priority when it is stricter than the classifier', () => {
    expect(classifySupportTicketSeverity({
      subject: 'Revisão manual',
      description: 'Operador marcou para acompanhamento prioritário.',
      category: 'general',
      requestedPriority: 'N1',
      requesterIsAgent: true
    })).toMatchObject({
      priority: 'N1',
      requestedPriorityTrusted: true,
      prioritySource: 'trusted_requested_priority'
    });
  });
});
