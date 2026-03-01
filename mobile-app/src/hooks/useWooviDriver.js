import { useState, useEffect } from 'react';
import WooviDriverService from '../services/WooviDriverService';

export const useWooviDriver = (driverId) => {
  const [wooviClientId, setWooviClientId] = useState(null);
  const [balance, setBalance] = useState(0);
  const [charges, setCharges] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Criar cliente Woovi para motorista aprovado
  const createWooviClient = async (driverData) => {
    setLoading(true);
    setError(null);
    
    try {
      const result = await WooviDriverService.createDriverClient(driverData);
      
      if (result.success) {
        setWooviClientId(result.wooviClientId);
        // Salvar no AsyncStorage ou estado global
        return result;
      } else {
        setError(result.error);
        return result;
      }
    } catch (err) {
      setError(err.message);
      return { success: false, error: err.message };
    } finally {
      setLoading(false);
    }
  };

  // Buscar saldo do motorista
  const fetchBalance = async () => {
    if (!wooviClientId) return;
    
    setLoading(true);
    setError(null);
    
    try {
      const result = await WooviDriverService.getDriverBalance(wooviClientId);
      
      if (result.success) {
        setBalance(result.balance);
        setCharges(result.charges);
        return result;
      } else {
        setError(result.error);
        return result;
      }
    } catch (err) {
      setError(err.message);
      return { success: false, error: err.message };
    } finally {
      setLoading(false);
    }
  };

  // Buscar cobranças do motorista
  const fetchCharges = async () => {
    if (!wooviClientId) return;
    
    setLoading(true);
    setError(null);
    
    try {
      const result = await WooviDriverService.getDriverCharges(wooviClientId);
      
      if (result.success) {
        setCharges(result.charges);
        return result;
      } else {
        setError(result.error);
        return result;
      }
    } catch (err) {
      setError(err.message);
      return { success: false, error: err.message };
    } finally {
      setLoading(false);
    }
  };

  // Atualizar dados do cliente
  const updateClient = async (updateData) => {
    if (!wooviClientId) return;
    
    setLoading(true);
    setError(null);
    
    try {
      const result = await WooviDriverService.updateDriverClient(wooviClientId, updateData);
      
      if (result.success) {
        return result;
      } else {
        setError(result.error);
        return result;
      }
    } catch (err) {
      setError(err.message);
      return { success: false, error: err.message };
    } finally {
      setLoading(false);
    }
  };

  // Carregar dados iniciais
  useEffect(() => {
    if (wooviClientId) {
      fetchBalance();
    }
  }, [wooviClientId]);

  return {
    wooviClientId,
    balance,
    charges,
    loading,
    error,
    createWooviClient,
    fetchBalance,
    fetchCharges,
    updateClient
  };
};

export default useWooviDriver;










