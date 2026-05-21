import apiClient from '../httpClient';

export async function loadDriverWaitlistStatus() {
  const response = await apiClient.get('/api/waitlist/status');
  return response?.data || {};
}

export async function joinDriverWaitlist({ city = 'Rio de Janeiro', notes = '' } = {}) {
  const response = await apiClient.post('/api/waitlist/join', {
    city,
    notes,
    priority: 'normal',
  });
  return response?.data || {};
}

export async function leaveDriverWaitlist() {
  const response = await apiClient.delete('/api/waitlist/leave');
  return response?.data || {};
}
