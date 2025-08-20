import React, { useEffect, useState, useRef } from 'react';
import { useDispatch } from 'react-redux';
import { useAuth } from '../hooks/useAuth';
import { FETCH_USER_SUCCESS } from '../common-local/types';
import database from '@react-native-firebase/database';

const AuthProvider = ({ children }) => {
  const { user, loading } = useAuth();
  const dispatch = useDispatch();
  const [isSyncing, setIsSyncing] = useState(false);
  const hasSynced = useRef(false);

  // Função para buscar dados completos do usuário no Realtime Database
  const syncUserData = async (firebaseUser) => {
    if (isSyncing || hasSynced.current) return; // Evitar múltiplas sincronizações
    
    setIsSyncing(true);
    try {
      console.log('🔄 Sincronizando dados do usuário no Realtime Database...');
      
      // Buscar dados do usuário no Realtime Database
      const userRef = database().ref(`users/${firebaseUser.uid}`);
      const snapshot = await userRef.once('value');
      
      if (snapshot.exists()) {
        const userData = snapshot.val();
        console.log('✅ Dados encontrados no Realtime Database:', userData);
        
        // Criar payload completo com dados do Firebase Auth + Realtime Database
        const completeUserData = {
          uid: firebaseUser.uid,
          email: firebaseUser.email || userData.email,
          phoneNumber: firebaseUser.phoneNumber || userData.mobile,
          // Dados do Realtime Database
          firstName: userData.firstName || '',
          lastName: userData.lastName || '',
          usertype: userData.usertype || 'customer',
          mobile: userData.mobile || firebaseUser.phoneNumber,
          profileImage: userData.profileImage || null,
          walletBalance: userData.walletBalance || 0,
          // Outros campos importantes
          ...userData,
          // Garantir que profile tenha todos os dados
          profile: {
            uid: firebaseUser.uid,
            email: firebaseUser.email || userData.email,
            phoneNumber: firebaseUser.phoneNumber || userData.mobile,
            firstName: userData.firstName || '',
            lastName: userData.lastName || '',
            usertype: userData.usertype || 'customer',
            mobile: userData.mobile || firebaseUser.phoneNumber,
            profileImage: userData.profileImage || null,
            walletBalance: userData.walletBalance || 0,
            ...userData
          }
        };
        
        // Dispatch para o Redux
        dispatch({
          type: FETCH_USER_SUCCESS,
          payload: completeUserData
        });
        
        console.log('✅ Usuário sincronizado com sucesso no Redux');
      } else {
        console.log('⚠️ Usuário não encontrado no Realtime Database, criando perfil básico');
        
        // Usuário não existe no Realtime Database, criar perfil básico
        const basicUserData = {
          uid: firebaseUser.uid,
          email: firebaseUser.email,
          phoneNumber: firebaseUser.phoneNumber,
          usertype: 'customer',
          profile: {
            uid: firebaseUser.uid,
            email: firebaseUser.email,
            phoneNumber: firebaseUser.phoneNumber,
            usertype: 'customer'
          }
        };
        
        dispatch({
          type: FETCH_USER_SUCCESS,
          payload: basicUserData
        });
      }
      
      // Marcar como sincronizado
      hasSynced.current = true;
    } catch (error) {
      console.error('❌ Erro ao sincronizar dados do usuário:', error);
      
      // Em caso de erro, usar dados básicos do Firebase Auth
      const fallbackUserData = {
        uid: firebaseUser.uid,
        email: firebaseUser.email,
        phoneNumber: firebaseUser.phoneNumber,
        usertype: 'customer',
        profile: {
          uid: firebaseUser.uid,
          email: firebaseUser.email,
          phoneNumber: firebaseUser.phoneNumber,
          usertype: 'customer'
        }
      };
      
      dispatch({
        type: FETCH_USER_SUCCESS,
        payload: fallbackUserData
      });
      
      // Marcar como sincronizado mesmo com erro
      hasSynced.current = true;
    } finally {
      setIsSyncing(false);
    }
  };

  useEffect(() => {
    if (user && !loading && !hasSynced.current) {
      // Usuário autenticado no Firebase, sincronizar dados completos apenas uma vez
      syncUserData(user);
    }
  }, [user, loading]);

  // Não renderizar nada enquanto carrega
  if (loading) {
    return null;
  }

  return children;
};

export default AuthProvider; 