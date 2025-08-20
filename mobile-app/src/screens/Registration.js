import React, { useState, useEffect, useRef } from 'react';
import { Registration } from '../components';
import { StyleSheet, View, Animated, Text } from 'react-native';
import { useSelector,useDispatch } from 'react-redux';
import i18n from '../i18n';
import { api } from '../common-local';

export default function RegistrationPage(props) {
  const {
    mainSignUp, 
    validateReferer,
    checkUserExists,
    editreferral
  } = api;
  const [loading, setLoading] = useState(false);
  const [snackbar, setSnackbar] = useState({ visible: false, message: '', type: 'error' });
  const snackbarAnim = useRef(new Animated.Value(0)).current;
  const useduserReferral = useSelector(state => state.usedreferralid.usedreferral);
  const { t } = i18n;
  const settings = props.route.params?.settings || useSelector(state => state.settingsdata.settings);
  const dispatch = useDispatch();

  // Função para exibir snackbar
  const showSnackbar = (message, type = 'error') => {
    setSnackbar({ visible: true, message, type });
    Animated.timing(snackbarAnim, {
      toValue: 1,
      duration: 250,
      useNativeDriver: true,
    }).start(() => {
      setTimeout(() => {
        Animated.timing(snackbarAnim, {
          toValue: 0,
          duration: 250,
          useNativeDriver: true,
        }).start(() => setSnackbar({ ...snackbar, visible: false }));
      }, 3000);
    });
  };

  const clickRegister = async (regData) => {
    setLoading(true);
    checkUserExists(regData).then((res) => {
      if(res.users && res.users.length>0){
        setLoading(false);
        showSnackbar(t('user_exists'), 'error');
      }
      else if(res.error){
        setLoading(false);
        showSnackbar(t('email_or_mobile_issue'), 'error');
      }
      else{
        if (regData.referralId && regData.referralId.length > 0) {
          validateReferer(regData.referralId).then((referralInfo)=>{
            const referrals = useduserReferral ?? [];
            for (let i = 0; i < referrals.length; i++) {
                if(referrals[i].email===regData.email){
                    showSnackbar(t("referral_email_used"), 'error');
                    setLoading(false)
                    return
                }else if(referrals[i].phone===regData.mobile){
                    showSnackbar(t("referral_number_used"), 'error');
                    setLoading(false)
                    return
                }
            }
            if (referralInfo.uid) {
              mainSignUp({...regData, signupViaReferral: referralInfo.uid}).then((res)=>{
                dispatch(editreferral({email:regData.email,phone:regData.mobile},"Add"))
                setLoading(false);
                if(res.uid){
                  showSnackbar(t('account_create_successfully'), 'success');
                  setTimeout(() => {
                    props.navigation.goBack();
                  }, 1200);
                }else{
                  showSnackbar(t('reg_error'), 'error');
                }
              })
            }else{
              setLoading(false);
              showSnackbar(t('referer_not_found'), 'error');
            }
          }).catch(() => {
            setLoading(false);
            showSnackbar(t('referer_not_found'), 'error');
          });
        } else {
          mainSignUp(regData).then((res)=>{
            setLoading(false);
            if(res.uid){
              showSnackbar(t('account_create_successfully'), 'success');
              setTimeout(() => {
                props.navigation.goBack();
              }, 1200);
            }else{
              showSnackbar(t('reg_error'), 'error');
            }
          })
        }
      }
    });
  }

  return (
    <View style={styles.containerView}>
      <Registration
        onPressRegister={(regData) => clickRegister(regData)}
        onPressBack={() => { props.navigation.goBack() }}
        loading={loading}
      />
      {/* Snackbar animado */}
      <Animated.View
        pointerEvents={snackbar.visible ? 'auto' : 'none'}
        style={[
          styles.snackbar,
          snackbar.type === 'error' ? styles.snackbarError : styles.snackbarSuccess,
          {
            opacity: snackbarAnim,
            transform: [{ translateY: snackbarAnim.interpolate({ inputRange: [0, 1], outputRange: [60, 0] }) }],
          },
        ]}
      >
        <Text style={styles.snackbarText}>{snackbar.message}</Text>
      </Animated.View>
    </View>
  );
}
const styles = StyleSheet.create({
  containerView: { flex: 1 },
  textContainer: { textAlign: "center" },
  snackbar: {
    position: 'absolute',
    left: 24,
    right: 24,
    bottom: 32,
    borderRadius: 8,
    paddingVertical: 16,
    paddingHorizontal: 24,
    alignItems: 'center',
    zIndex: 1000,
    elevation: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
  },
  snackbarError: {
    backgroundColor: '#D32F2F',
  },
  snackbarSuccess: {
    backgroundColor: '#388E3C',
  },
  snackbarText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '500',
    textAlign: 'center',
  },
});
