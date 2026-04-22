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
import DriverBalanceService from '../services/DriverBalanceService';

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
  const [loading,setLoading] = useState(false);

  const { t } = i18n;
  const isRTL = i18n.locale.indexOf('he') === 0 || i18n.locale.indexOf('ar') === 0;

  const withdrawNow = async () => {
    const amount = Number(String(state.amount || '').replace(',', '.'));
    const balance = Number(state.userdata.walletBalance ?? state.userdata.availableBalance ?? state.userdata.balance ?? initialBalance);
    const driverId = state.userdata.uid || state.userdata.id || auth?.profile?.uid || auth?.profile?.id;
    const pixKey = String(state.pixKey || '').trim();
    const appPassword = String(state.appPassword || '').trim();

    if (!driverId) {
      Alert.alert(t('alert'), 'Motorista não autenticado');
      return;
    }

    if (balance > 0 && amount > 0 && amount <= balance) {
      if (!pixKey) {
        Alert.alert(t('alert'), 'Informe sua chave Pix');
        return;
      }
      if (!appPassword) {
        Alert.alert(t('alert'), 'Informe sua senha do app');
        return;
      }

      setLoading(true);
      const result = await DriverBalanceService.requestWithdrawal(driverId, amount, pixKey, appPassword);
      setLoading(false);

      if (result?.success) {
        Alert.alert('Saque solicitado', 'Seu saque foi enviado para processamento.');
        setState(previous => ({
          ...previous,
          amount: '',
          pixKey: '',
          appPassword: ''
        }));
        props.navigation.navigate('TabRoot', { screen: 'Wallet' });
        return;
      }

      Alert.alert(t('alert'), result?.error || 'Não foi possível solicitar o saque');
    } else {
      if (amount > balance) {
        Alert.alert(t('alert'),t('withdraw_more'));
      }
      else if (amount <= 0) {
        Alert.alert(t('alert'),t('withdraw_below_zero'));
      }else{
        Alert.alert(t('alert'),t('valid_amount'));
      }
    }
  }

  return (
    <View style={styles.mainView}>
      
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
          onChangeText={(text) => setState({ ...state,amount: text })}
          value={state.amount}
        />
        <TextInput
          style={[styles.inputTextStyle,{textAlign: isRTL ? 'right': 'left'}]}
          placeholder="Chave Pix"
          autoCapitalize="none"
          autoCorrect={false}
          onChangeText={(text) => setState({ ...state,pixKey: text })}
          value={state.pixKey}
        />
        <TextInput
          style={[styles.inputTextStyle,{textAlign: isRTL ? 'right': 'left'}]}
          placeholder="Senha do app"
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
          textContentType="password"
          onChangeText={(text) => setState({ ...state,appPassword: text })}
          value={state.appPassword}
        />
        <Button
            title={t('withdraw')}
            loading={loading}
            titleStyle={styles.buttonTitle}
            onPress={withdrawNow}
            buttonStyle={styles.buttonWrapper2}
            containerStyle={{ height: '100%' }}
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
  buttonWrapper2: {
    marginBottom: 10,
    marginTop: 18,
    height: 55,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: MAIN_COLOR,
    borderRadius: 8,
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
