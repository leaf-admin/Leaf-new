/**
 * REVIEW ACCOUNTS - Contas de teste para App Review
 * 
 * Estas contas são usadas exclusivamente para revisão da Apple/Google.
 * Elas pulam o fluxo de OTP conforme recomendado pelas lojas.
 * 
 * IMPORTANTE: Estas contas devem estar documentadas nos Review Notes.
 */

export const REVIEW_ACCOUNTS = {
  // Conta de passageiro para review
  PASSENGER: {
    phoneNumber: '11999999999',
    fullPhoneNumber: '+5511999999999',
    userType: 'customer', // ✅ CORRIGIDO: projeto usa 'customer', não 'passenger'
    skipOTP: true, // Pula OTP completamente
    description: 'Customer test account for App Review'
  },
  
  // Conta de motorista para review
  DRIVER: {
    phoneNumber: '11888888888',
    fullPhoneNumber: '+5511888888888',
    userType: 'driver',
    skipOTP: true, // Pula OTP completamente
    description: 'Driver test account for App Review'
  }
};

/**
 * Verifica se um número de telefone é uma conta de review
 */
export const isReviewAccount = (phoneNumber) => {
  const cleanNumber = phoneNumber.replace(/\D/g, ''); // Remove caracteres não numéricos
  const fullNumber = phoneNumber.startsWith('+') ? phoneNumber : `+55${phoneNumber}`;
  
  return (
    cleanNumber === REVIEW_ACCOUNTS.PASSENGER.phoneNumber ||
    cleanNumber === REVIEW_ACCOUNTS.DRIVER.phoneNumber ||
    fullNumber === REVIEW_ACCOUNTS.PASSENGER.fullPhoneNumber ||
    fullNumber === REVIEW_ACCOUNTS.DRIVER.fullPhoneNumber
  );
};

/**
 * Obtém informações da conta de review
 */
export const getReviewAccountInfo = (phoneNumber) => {
  const cleanNumber = phoneNumber.replace(/\D/g, '');
  const fullNumber = phoneNumber.startsWith('+') ? phoneNumber : `+55${phoneNumber}`;
  
  if (cleanNumber === REVIEW_ACCOUNTS.PASSENGER.phoneNumber || 
      fullNumber === REVIEW_ACCOUNTS.PASSENGER.fullPhoneNumber) {
    return REVIEW_ACCOUNTS.PASSENGER;
  }
  
  if (cleanNumber === REVIEW_ACCOUNTS.DRIVER.phoneNumber || 
      fullNumber === REVIEW_ACCOUNTS.DRIVER.fullPhoneNumber) {
    return REVIEW_ACCOUNTS.DRIVER;
  }
  
  return null;
};

