import React, { useState } from 'react';
import {
  StyleSheet,
  View,
  Text,
  TextInput,
  Alert
} from 'react-native';
import { Button } from 'react-native-elements';
import { colors } from '../common/theme';
import i18n from '../i18n';
import { useSelector } from 'react-redux';
import { MAIN_COLOR } from '../common/sharedFunctions';
import { fonts } from '../common/font';
import { DriverBalanceService } from '../services/canonical/paymentService';
import SecurePaymentBadge from '../components/payment/SecurePaymentBadge';

export default function WithdrawMoneyScreen(props) {
  const settings = useSelector(state => state.settingsdata.settings) || {};
  const auth = useSelector(state => state.auth);
  const routeParams = props.route?.params || {};
  const userdata = routeParams.userdata || routeParams.accountData || auth?.profile || {};
  const initialBalance = Number(
    userdata.walletBalance ??
    userdata.availableBalance ??
    userdata.balance ??
    0
  );
  const [state, setState] = useState({
    userdata: userdata,
    amount: '',
    pixKey: '',
    appPassword: ''
  });
  const [withdrawRequestId, setWithdrawRequestId] = useState(null);
  const [loading,setLoading] = useState(false);

  const { t } = i18n;
  const isRTL = i18n.locale.indexOf('he') === 0 || i18n.locale.indexOf('ar') === 0;
  const currentAmount = Number(String(state.amount || '').replace(',', '.')) || 0;
  const currentBalance = Number(state.userdata.walletBalance ?? state.userdata.availableBalance ?? state.userdata.balance ?? initialBalance) || 0;
  const currentWithdrawFee = DriverBalanceService.calculateWithdrawFee(currentAmount);
  const currentTotalDebit = currentAmount + currentWithdrawFee;
  const hasAmount = String(state.amount || '').trim().length > 0;
  const exceedsAvailableBalance = hasAmount && currentAmount > 0 && currentTotalDebit > currentBalance;
  const canSubmitWithdrawal = !loading && currentAmount > 0 && currentTotalDebit <= currentBalance && Boolean(String(state.pixKey || '').trim()) && Boolean(String(state.appPassword || '').trim());

  const withdrawNow = async () => {
    const amount = currentAmount;
    const balance = currentBalance;
    const withdrawFee = currentWithdrawFee;
    const totalDebit = currentTotalDebit;
    const driverId = state.userdata.uid || state.userdata.id || auth?.profile?.uid || auth?.profile?.id;
    const pixKey = String(state.pixKey || '').trim();
    const appPassword = String(state.appPassword || '').trim();

    if (!driverId) {
      Alert.alert(t('alert'), 'Motorista não autenticado');
      return;
    }

    if (balance > 0 && amount > 0 && totalDebit <= balance) {
      if (!pixKey) {
        Alert.alert(t('alert'), 'Informe sua chave Pix');
        return;
      }
      if (!appPassword) {
        Alert.alert(t('alert'), 'Informe sua senha do app');
        return;
      }

      setLoading(true);
      const stableRequestId =
        withdrawRequestId ||
        DriverBalanceService.buildWithdrawalRequestId(driverId, amount, pixKey);
      setWithdrawRequestId(stableRequestId);
      const result = await DriverBalanceService.requestWithdrawal(
        driverId,
        amount,
        pixKey,
        appPassword,
        { requestId: stableRequestId }
      );
      setLoading(false);

      if (result?.success) {
        Alert.alert('Saque solicitado', 'Seu saque foi enviado para processamento.');
        setState(previous => ({
          ...previous,
          amount: '',
          pixKey: '',
          appPassword: ''
        }));
        setWithdrawRequestId(null);
        props.navigation.navigate('TabRoot', { screen: 'Wallet' });
        return;
      }

      Alert.alert(t('alert'), result?.error || 'Não foi possível solicitar o saque');
    } else {
      if (totalDebit > balance) {
        Alert.alert(
          t('alert'),
          `Saldo insuficiente. Este saque debita R$ ${totalDebit.toFixed(2).replace('.', ',')}${withdrawFee > 0 ? ' incluindo tarifa de R$ 1,00' : ''}.`
        );
      }
      else if (amount <= 0) {
        Alert.alert(t('alert'),t('withdraw_below_zero'));
      }else{
        Alert.alert(t('alert'),t('valid_amount'));
      }
    }
  }

  return (
    <View
      style={styles.mainView}
      testID="driver-withdraw-screen"
      accessibilityLabel="driver-withdraw-screen"
    >
      
      <View style={styles.bodyContainer}>
      {settings?.swipe_symbol === false ?
        <Text style={[styles.walletbalText,{textAlign: isRTL ? 'right': 'left'}]}>{t('Balance')} - <Text style={styles.ballance}>{settings?.symbol || ''}{state.userdata ? parseFloat(initialBalance).toFixed(settings?.decimal || 2) : ''}</Text></Text>
        :
        <Text style={[styles.walletbalText,{textAlign: isRTL ? 'right': 'left'}]}>{t('Balance')} - <Text style={styles.ballance}>{state.userdata ? parseFloat(initialBalance).toFixed(settings?.decimal || 2) : ''}{settings?.symbol || ''}</Text></Text>
      }

        <TextInput
          style={[styles.inputTextStyle,{textAlign: isRTL ? 'right': 'left'}]}
          placeholder={t('amount') + " (" + settings?.symbol || '' + ")"}
          keyboardType={'number-pad'}
          onChangeText={(text) => {
            setState({ ...state,amount: text });
            if (!loading) {
              setWithdrawRequestId(null);
            }
          }}
          value={state.amount}
          testID="driver-withdraw-amount-input"
          accessibilityLabel="driver-withdraw-amount-input"
        />
        <TextInput
          style={[styles.inputTextStyle,{textAlign: isRTL ? 'right': 'left'}]}
          placeholder="Chave Pix"
          autoCapitalize="none"
          autoCorrect={false}
          onChangeText={(text) => {
            setState({ ...state,pixKey: text });
            if (!loading) {
              setWithdrawRequestId(null);
            }
          }}
          value={state.pixKey}
          testID="driver-withdraw-pix-key-input"
          accessibilityLabel="driver-withdraw-pix-key-input"
        />
        <SecurePaymentBadge style={styles.securePaymentBadge} color="#6E7D72" />
        <TextInput
          style={[styles.inputTextStyle,{textAlign: isRTL ? 'right': 'left'}]}
          placeholder="Senha do app"
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
          textContentType="password"
          onChangeText={(text) => setState({ ...state,appPassword: text })}
          value={state.appPassword}
          testID="driver-withdraw-password-input"
          accessibilityLabel="driver-withdraw-password-input"
        />
        <View style={styles.dailyFeeRow}>
          <Text style={styles.dailyFeeLabel}>Diária por faturamento</Text>
          <Text style={styles.dailyFeeStruck}>Até R$ 14,90</Text>
          <Text style={styles.dailyFeeFree}>R$ 0,00 agora</Text>
        </View>
        {hasAmount && currentWithdrawFee > 0 && (
          <Text style={styles.withdrawFeeText}>
            Saques abaixo de R$ 500,00 têm tarifa de R$ 1,00.
          </Text>
        )}
        {exceedsAvailableBalance && (
          <Text style={styles.withdrawErrorText}>
            Saldo insuficiente para saque + tarifa.
          </Text>
        )}
        <Button
            title={t('withdraw')}
            loading={loading}
            titleStyle={styles.buttonTitle}
            onPress={withdrawNow}
            disabled={!canSubmitWithdrawal}
            buttonStyle={[styles.buttonWrapper2, !canSubmitWithdrawal && styles.buttonDisabled]}
            containerStyle={{ height: '100%' }}
            testID="driver-withdraw-submit-button"
            accessibilityLabel="driver-withdraw-submit-button"
        />
      </View>
    </View>
  );

}

const styles = StyleSheet.create({

  headerStyle: {
    backgroundColor: colors.HEADER,
    borderBottomWidth: 0
  },
  headerTitleStyle: {
    color: colors.WHITE,
    fontFamily:fonts.Bold,
    fontSize: 20
  },

  mainView: {
    flex: 1,
    backgroundColor: colors.WHITE,
  },
  bodyContainer: {
    flex: 1,
    flexDirection: 'column',
    marginTop: 10,
    paddingHorizontal: 12
  },
  walletbalText: {
    fontSize: 17,
    fontFamily:fonts.Regular
  },
  ballance: {
    fontFamily:fonts.Bold
  },
  inputTextStyle: {
    marginTop: 10,
    height: 50,
    borderBottomColor: 'gray',
    borderBottomWidth: 1,
    fontSize: 30,
    fontFamily:fonts.Regular
  },
  dailyFeeRow: {
    marginTop: 14,
    padding: 12,
    borderRadius: 8,
    backgroundColor: '#EEF8F0',
    flexDirection: 'row',
    alignItems: 'center',
  },
  securePaymentBadge: {
    marginTop: 6,
    marginLeft: 2,
  },
  dailyFeeLabel: {
    fontSize: 14,
    fontFamily: fonts.Bold,
    color: '#1F6B37',
    marginRight: 8,
  },
  dailyFeeStruck: {
    fontSize: 14,
    fontFamily: fonts.Regular,
    color: '#6E7D72',
    textDecorationLine: 'line-through',
    marginRight: 8,
  },
  dailyFeeFree: {
    fontSize: 14,
    fontFamily: fonts.Bold,
    color: MAIN_COLOR,
  },
  withdrawFeeText: {
    marginTop: 10,
    fontSize: 13,
    lineHeight: 18,
    fontFamily: fonts.Regular,
    color: '#6E7D72',
  },
  withdrawErrorText: {
    marginTop: 8,
    fontSize: 13,
    lineHeight: 18,
    fontFamily: fonts.Bold,
    color: '#B42318',
  },
  buttonWrapper2: {
    marginBottom: 10,
    marginTop: 18,
    height: 55,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: MAIN_COLOR,
    borderRadius: 8,
  },
  buttonDisabled: {
    opacity: 0.45,
  },
  buttonTitle: {
    color: colors.WHITE,
    fontSize: 18,
    fontFamily:fonts.Bold
  },
  quickMoneyContainer: {
    marginTop: 18,
    flexDirection: 'row',
    paddingVertical: 4,
    paddingLeft: 4,
  },
  boxView: {
    height: 40,
    width: 60,
    borderRadius: 6,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 8
  },
  quckMoneyText: {
    fontSize: 16,
    fontFamily:fonts.Regular
  }

});
