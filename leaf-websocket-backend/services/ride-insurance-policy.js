'use strict';

// Seguro APP (IZA, acidentes pessoais de motorista e passageiro).
// O valor entra na tarifa do passageiro e a Leaf o separa para pagar a fatura
// mensal da seguradora. O repasse do motorista não muda: o contrato com a IZA
// (cláusula 10.2) proíbe descontar o prêmio dos motoristas segurados.
// Fica desligado até a apólice e o envio das corridas à IZA estarem ativos.
const RIDE_INSURANCE_FEE_CENTS = 13;

function isRideInsuranceEnabled(env = process.env) {
  return String(env.RIDE_INSURANCE_FEE_ENABLED || 'false').trim().toLowerCase() === 'true';
}

function resolveRideInsuranceFeeCents(env = process.env) {
  return isRideInsuranceEnabled(env) ? RIDE_INSURANCE_FEE_CENTS : 0;
}

module.exports = {
  RIDE_INSURANCE_FEE_CENTS,
  isRideInsuranceEnabled,
  resolveRideInsuranceFeeCents
};
