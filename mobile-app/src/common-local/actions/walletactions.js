import { FETCH_WALLET_HISTORY, FETCH_WALLET_HISTORY_SUCCESS, FETCH_WALLET_HISTORY_FAIL } from '../types.js';
import { database } from '../config/configureFirebase';

export const fetchWalletHistory = (userId) => async (dispatch) => {
    try {
        dispatch({ type: FETCH_WALLET_HISTORY });
        
        const walletRef = database().ref('wallet_transactions');
        const snapshot = await walletRef.orderByChild('userId').equalTo(userId).once('value');
        
        const transactions = [];
        snapshot.forEach((childSnapshot) => {
            transactions.push({
                id: childSnapshot.key,
                ...childSnapshot.val()
            });
        });

        // Ordenar transações por data (mais recentes primeiro)
        transactions.sort((a, b) => b.timestamp - a.timestamp);

        dispatch({
            type: FETCH_WALLET_HISTORY_SUCCESS,
            payload: transactions
        });

    } catch (error) {
        console.error('Error fetching wallet history:', error);
        dispatch({
            type: FETCH_WALLET_HISTORY_FAIL,
            payload: error.message
        });
    }
}; 