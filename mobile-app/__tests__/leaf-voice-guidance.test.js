import React from 'react';
import { AppState, NativeModules } from 'react-native';
import { act, render } from '@testing-library/react-native';
import { buildLeafVoiceCue, isLeafVoiceAvailable } from '../src/services/LeafVoiceGuidanceService';
import useLeafVoiceGuidance from '../src/hooks/useLeafVoiceGuidance';

const model = { navigationKey: 'booking:pickup:accepted', currentStepIndex: 0, hasSteps: true, currentInstruction: 'Vire à direita', maneuverDistanceMeters: 300 };
const Harness = props => { useLeafVoiceGuidance(props); return null; };
describe('native Leaf voice guidance', () => {
  let stateListener;
  beforeEach(() => {
    AppState.currentState = 'active';
    jest.spyOn(AppState, 'addEventListener').mockImplementation((event, handler) => { stateListener = handler; return { remove: jest.fn() }; });
    NativeModules.LeafVoiceGuidance = { isAvailable: jest.fn().mockResolvedValue(true), speak: jest.fn().mockResolvedValue(true), stop: jest.fn().mockResolvedValue(true) };
  });
  afterEach(() => { delete NativeModules.LeafVoiceGuidance; jest.restoreAllMocks(); });
  it('announces distance and limits cues to three approach stages', () => {
    expect(buildLeafVoiceCue(model).text).toBe('Em 300 metros, Vire à direita');
    expect(buildLeafVoiceCue({ ...model, maneuverDistanceMeters: 250 }).key).toBe(buildLeafVoiceCue(model).key);
    expect(buildLeafVoiceCue({ ...model, maneuverDistanceMeters: 100 }).key).not.toBe(buildLeafVoiceCue(model).key);
    expect(buildLeafVoiceCue({ ...model, isOffRoute: true })).toBeNull(); expect(buildLeafVoiceCue({ ...model, hasSteps: false })).toBeNull();
  });
  it('handles earlier binaries without the new bridge honestly', async () => {
    delete NativeModules.LeafVoiceGuidance; expect(await isLeafVoiceAvailable()).toBe(false);
  });
  it('speaks each cue once, avoiding GPS jitter repetition', async () => {
    const props = { uid: 'driver', enabled: true, focused: true, navigationModel: model };
    const ui = render(<Harness {...props} />);
    ui.rerender(<Harness {...props} navigationModel={{ ...model, maneuverDistanceMeters: 250 }} />);
    expect(NativeModules.LeafVoiceGuidance.speak).toHaveBeenCalledTimes(1);
    ui.rerender(<Harness {...props} navigationModel={{ ...model, maneuverDistanceMeters: 140 }} />);
    ui.rerender(<Harness {...props} navigationModel={{ ...model, maneuverDistanceMeters: 180 }} />);
    expect(NativeModules.LeafVoiceGuidance.speak).toHaveBeenCalledTimes(2); await act(async () => {});
  });
  it('stops on mute, focus loss, background, account switch and unmount', async () => {
    const props = { uid: 'driver', enabled: true, focused: true, navigationModel: model };
    const ui = render(<Harness {...props} />);
    ui.rerender(<Harness {...props} enabled={false} />); expect(NativeModules.LeafVoiceGuidance.stop).toHaveBeenCalled();
    ui.rerender(<Harness {...props} />); await act(async () => stateListener('background'));
    const count = NativeModules.LeafVoiceGuidance.speak.mock.calls.length;
    ui.rerender(<Harness {...props} uid={null} />); expect(NativeModules.LeafVoiceGuidance.speak).toHaveBeenCalledTimes(count);
    ui.rerender(<Harness {...props} focused={false} />); ui.unmount();
    expect(NativeModules.LeafVoiceGuidance.stop.mock.calls.length).toBeGreaterThan(3);
  });
});
