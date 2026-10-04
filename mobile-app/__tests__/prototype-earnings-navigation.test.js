const fs = require('fs');
const path = require('path');

describe('Robotaxi driver earnings navigation', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'screens', 'EarningsReportScreen.js'),
    'utf8',
  );

  it('renders a visible and accessible close action', () => {
    expect(source).toContain('<PrototypeMenuCloseButton');
    expect(source).toContain('onPress={handleBackPress}');
    expect(source).toContain('testID="driver-earnings-close-button"');
    expect(source).toContain('accessibilityLabel="Fechar ganhos"');
  });

  it('returns to the Robotaxi home when there is no navigation history', () => {
    expect(source).toContain("navigation.navigate('RobotaxiPrototype')");
  });

  it('does not describe an assisted pilot balance as available for withdrawal', () => {
    expect(source).toMatch(
      /withdrawalsEnabled\s*\?\s*'Disponível para saque'\s*:\s*'Saldo do motorista'/,
    );
    expect(source).toMatch(
      /\{withdrawalsEnabled\s*\?\s*\(\s*<>\s*<Text style=\{styles\.pixHint\}>PIX cadastrado para recebimento/,
    );
    expect(source).toContain(
      'Saque e repasse ficam fora do app neste piloto e serao conduzidos pela operacao assistida.',
    );
  });

  it('keeps incomplete runtime financial values visibly unknown', () => {
    expect(source).toContain('overallRuntimeTotals.netKnownCount === overallRuntimeTotals.count');
    expect(source).toContain('overallRuntimeTotals.grossKnownCount === overallRuntimeTotals.count');
    expect(source).toContain('overallRuntimeTotals.feeKnownCount === overallRuntimeTotals.count');
    expect(source).toContain('formatOptionalCurrency(summaryTotalNet)');
    expect(source).toContain('Variação indisponível');
    expect(source).toContain('Alguns repasses aguardam dados confirmados; esses períodos não são plotados.');
  });

  it('uses human accessible names for the earnings and withdrawal controls', () => {
    expect(source).not.toMatch(/accessibilityLabel=["']driver-earnings-/);
    expect(source).toContain('accessibilityLabel="Realizar saque"');
    expect(source).toContain('accessibilityLabel="Valor do saque em reais"');
    expect(source).toContain('accessibilityLabel="Chave Pix para recebimento"');
    expect(source).toContain('accessibilityLabel="Senha do aplicativo"');
    expect(source).toContain(
      'accessibilityLabel={isProcessingWithdraw ? "Confirmando saque" : "Confirmar saque"}',
    );
    expect(source).toContain('accessibilityState={{ disabled: withdrawDisabled }}');
  });
});
