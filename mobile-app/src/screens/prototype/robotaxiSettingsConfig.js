import { CURRENT_SURFACE_STATUS } from './currentSurfaceStatus';

export const ROBOTAXI_SETTINGS_ITEMS = Object.freeze({
  notifications: Object.freeze({
    key: 'notifications',
    status: CURRENT_SURFACE_STATUS.DISABLED,
  }),
  language: Object.freeze({
    key: 'language',
    status: CURRENT_SURFACE_STATUS.DISABLED,
  }),
  traffic: Object.freeze({
    key: 'traffic',
    status: CURRENT_SURFACE_STATUS.DISABLED,
  }),
  voice: Object.freeze({
    key: 'voice',
    status: CURRENT_SURFACE_STATUS.DISABLED,
  }),
  privacy: Object.freeze({
    key: 'privacy',
    status: CURRENT_SURFACE_STATUS.CURRENT,
  }),
  logout: Object.freeze({
    key: 'logout',
    status: CURRENT_SURFACE_STATUS.CURRENT,
  }),
  deleteAccount: Object.freeze({
    key: 'delete-account',
    status: CURRENT_SURFACE_STATUS.CURRENT,
  }),
  support: Object.freeze({
    key: 'support',
    status: CURRENT_SURFACE_STATUS.CURRENT,
  }),
});
