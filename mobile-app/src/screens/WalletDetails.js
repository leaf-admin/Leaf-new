import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Platform, StatusBar } from 'react-native';
import { Icon } from 'react-native-elements';
import { useSelector, useDispatch } from 'react-redux';
import { useTheme } from '@react-navigation/native';
import { MAIN_COLOR, SECONDORY_COLOR } from '../common-local/sharedFunctions';
import { fonts } from '../common-local/font';
import { colors } from '../common-local/theme';
import i18n from '../i18n';
import WTransactionHistory from '../components/WalletTransactionHistory';
import { fetchWalletHistory } from '../common-local/actions/walletactions';

export default function WalletDetails(props) {
    const { t } = i18n;
    const theme = useTheme();
    const dispatch = useDispatch();
    const [isDarkMode, setIsDarkMode] = useState(theme.dark);
    const auth = useSelector(state => state.auth);
    const walletHistory = useSelector(state => state.walletdata.walletHistory);
    const settings = useSelector(state => state.settingsdata.settings);

    useEffect(() => {
        dispatch(fetchWalletHistory(auth.profile.uid));
    }, []);

    return (
        <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
            <StatusBar hidden={true} />
            
            {/* Header */}
            <View style={[styles.header, { backgroundColor: theme.colors.card }]}>
                <TouchableOpacity 
                    style={[styles.headerButton, { backgroundColor: theme.colors.card }]}
                    onPress={() => props.navigation.goBack()}
                >
                    <Icon name="arrow-back" type="material" color={theme.colors.text} size={24} />
                </TouchableOpacity>
                
                <Text style={[styles.headerTitle, { color: theme.colors.text, fontFamily: fonts.Bold }]}>
                    {t('my_wallet_tile')}
                </Text>
                
                <View style={styles.headerRightContainer}>
                    <TouchableOpacity 
                        style={[styles.headerButton, { backgroundColor: theme.colors.card }]}
                        onPress={() => setIsDarkMode(!isDarkMode)}
                    >
                        <Icon 
                            name={isDarkMode ? "light-mode" : "dark-mode"} 
                            type="material" 
                            color={theme.colors.text} 
                            size={24} 
                        />
                    </TouchableOpacity>
                </View>
            </View>

            <ScrollView style={styles.scrollView}>
                {/* Balance Card */}
                <View style={[styles.balanceCard, { backgroundColor: theme.colors.card }]}>
                    <Text style={[styles.balanceLabel, { color: theme.colors.text, fontFamily: fonts.Regular }]}>
                        {t('wallet_balance')}
                    </Text>
                    <Text style={[styles.balanceAmount, { color: theme.colors.text, fontFamily: fonts.Bold }]}>
                        R$ {parseFloat(auth.profile.walletBalance).toFixed(2)}
                    </Text>
                    
                    <TouchableOpacity 
                        style={[styles.addMoneyButton, { backgroundColor: MAIN_COLOR }]}
                        onPress={() => props.navigation.navigate('addMoney')}
                    >
                        <Icon name="add" type="material" color="#FFFFFF" size={24} />
                        <Text style={[styles.addMoneyText, { fontFamily: fonts.Bold }]}>
                            {t('add_money')}
                        </Text>
                    </TouchableOpacity>
                </View>

                {/* Transaction History */}
                <View style={styles.transactionsContainer}>
                    <Text style={[styles.transactionsTitle, { color: theme.colors.text, fontFamily: fonts.Bold }]}>
                        {t('transaction_history')}
                    </Text>
                    <WTransactionHistory 
                        walletHistory={walletHistory} 
                        role={auth.profile.usertype}
                        settings={settings}
                    />
                </View>
            </ScrollView>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 16,
        paddingTop: Platform.OS === 'ios' ? 50 : 40,
        paddingBottom: 16,
        borderBottomWidth: 1,
        borderBottomColor: 'rgba(0,0,0,0.1)',
    },
    headerButton: {
        width: 40,
        height: 40,
        borderRadius: 20,
        justifyContent: 'center',
        alignItems: 'center',
    },
    headerTitle: {
        fontSize: 20,
    },
    headerRightContainer: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    scrollView: {
        flex: 1,
    },
    balanceCard: {
        margin: 16,
        padding: 20,
        borderRadius: 12,
        shadowColor: '#000',
        shadowOffset: {
            width: 0,
            height: 2,
        },
        shadowOpacity: 0.1,
        shadowRadius: 4,
        elevation: 3,
    },
    balanceLabel: {
        fontSize: 16,
        marginBottom: 8,
    },
    balanceAmount: {
        fontSize: 32,
        marginBottom: 16,
    },
    addMoneyButton: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 12,
        borderRadius: 8,
    },
    addMoneyText: {
        color: '#FFFFFF',
        fontSize: 16,
        marginLeft: 8,
    },
    transactionsContainer: {
        padding: 16,
    },
    transactionsTitle: {
        fontSize: 18,
        marginBottom: 16,
    }
});