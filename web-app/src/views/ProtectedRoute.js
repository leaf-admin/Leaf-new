import React, { useState, useEffect } from 'react';
import { Navigate } from 'react-router-dom';
import CircularLoading from '../components/CircularLoading';
import ResponsiveDrawer from '../components/ResponsiveDrawer';
import AsyncStorage from '@react-native-async-storage/async-storage';

function matchUser(permit, usertype){
    let permitions = permit? permit.split(',') : [];
    let permitted = false;
    for(let i=0;i<permitions.length;i++){
        permitted = usertype === permitions[i]?true:false
        if(permitted) break;
    }
    return permitted;
}

function ProtectedRoute({ permit, children }) {
    const [authState, setAuthState] = useState({ profile: null, error: null });
    const [checkedAuth, setCheckedAuth] = useState(false);

    useEffect(() => {
        const checkAuth = async () => {
            try {
                const userData = await AsyncStorage.getItem('@user_data');
                if (userData) {
                    const profile = JSON.parse(userData);
                    setAuthState({ profile });
                }
                setCheckedAuth(true);
            } catch (error) {
                console.error('Erro ao verificar autenticação:', error);
                setAuthState({ error: { flag: true, msg: error } });
                setCheckedAuth(true);
            }
        };

        checkAuth();
    }, []);

    return (
        checkedAuth ?
            authState.profile && authState.profile.uid ?
                matchUser(permit, authState.profile.usertype) ? 
                    <ResponsiveDrawer>{children}</ResponsiveDrawer> 
                    : <Navigate to="/login" />
                : <Navigate to="/login" />
            : <CircularLoading />
    );
}

export default ProtectedRoute;
