const mockTasksRef = {
  off: jest.fn(),
  on: jest.fn((event, callback) => callback({ val: () => null })),
};

jest.mock('../src/services/canonical/firebaseConfig', () => ({
  firebase: {
    auth: {
      currentUser: { uid: 'driver-1' },
    },
    tasksRef: jest.fn(() => mockTasksRef),
  },
}));

jest.mock('../src/state/appStore', () => ({
  __esModule: true,
  default: {
    getState: () => ({
      languagedata: {
        defaultLanguage: {
          no_tasks: 'Nenhuma tarefa encontrada',
        },
      },
    }),
  },
}));

jest.mock('../src/services/canonical/profileService', () => ({
  updateProfile: jest.fn(() => jest.fn()),
}));

jest.mock('../src/services/canonical/pushNotificationFunction', () => ({
  RequestPushMsg: jest.fn(),
}));

import { fetchTasks } from '../src/services/canonical/driverTaskActions';

describe('driverTaskActions', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('emits failed task state when the driver has no requested tasks', () => {
    const dispatch = jest.fn();

    fetchTasks()(dispatch);

    expect(mockTasksRef.off).toHaveBeenCalledTimes(1);
    expect(mockTasksRef.on).toHaveBeenCalledWith('value', expect.any(Function));
    expect(dispatch).toHaveBeenNthCalledWith(1, {
      type: 'FETCH_TASKS',
      payload: null,
    });
    expect(dispatch).toHaveBeenNthCalledWith(2, {
      type: 'FETCH_TASKS_FAILED',
      payload: 'Nenhuma tarefa encontrada',
    });
  });
});
