import { useCallback, useEffect, useRef, useState } from 'react';
import { getCachedAccountSummary, loadAccountSummary } from '../services/AccountSummaryService';

export default function useAccountSummary({ uid, role, revision, focused }) {
  const owner = JSON.stringify([uid, role, revision]);
  const ownerRef = useRef(owner);
  ownerRef.current = owner;
  const cached = uid ? getCachedAccountSummary(uid, role, revision) : null;
  const [state, setState] = useState({ owner, summary: cached, loading: !cached, error: '' });
  const stateRef = useRef(state);
  stateRef.current = state;
  const requestRef = useRef(null);
  const refresh = useCallback(async ({ forceRefresh = false } = {}) => {
    if (!uid || !focused || requestRef.current?.owner === owner) return;
    const request = { owner, cancelled: false };
    requestRef.current = request;
    const previous = stateRef.current.owner === owner ? stateRef.current.summary : null;
    setState({ owner, summary: previous || getCachedAccountSummary(uid, role, revision), loading: true, error: '' });
    try {
      const summary = await loadAccountSummary(uid, role, revision, { forceRefresh });
      if (!request.cancelled && ownerRef.current === owner) setState({ owner, summary, loading: false, error: summary.incomplete ? 'Alguns dados não foram atualizados.' : '' });
    } catch (error) {
      if (!request.cancelled && ownerRef.current === owner) setState(current => ({ ...current, loading: false, error: error.message }));
    } finally { if (requestRef.current === request) requestRef.current = null; }
  }, [focused, owner, revision, role, uid]);
  useEffect(() => {
    refresh();
    return () => {
      if (requestRef.current) requestRef.current.cancelled = true;
      requestRef.current = null;
    };
  }, [refresh]);
  const visible = state.owner === owner ? state : { owner, summary: cached, loading: Boolean(uid), error: '' };
  return { ...visible, refresh };
}
