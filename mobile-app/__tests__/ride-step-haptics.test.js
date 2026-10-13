import React from 'react';
import { render } from '@testing-library/react-native';
import useRideStepHaptics from '../src/hooks/useRideStepHaptics';

const mockTrigger = jest.fn();
jest.mock('../src/hooks/useHapticFeedback', () => ({
  useHapticFeedback: () => mockTrigger,
}));

function Probe({ step }) {
  useRideStepHaptics(step, { accepted: 'success', arrived: 'heavy' });
  return null;
}

describe('ride step haptics', () => {
  beforeEach(() => mockTrigger.mockClear());

  it('stays silent for the step the screen opens on', () => {
    render(<Probe step="arrived" />);
    expect(mockTrigger).not.toHaveBeenCalled();
  });

  it('fires once when the ride moves to a step with a cue', () => {
    const view = render(<Probe step="searching" />);
    view.rerender(<Probe step="accepted" />);
    view.rerender(<Probe step="accepted" />);
    expect(mockTrigger).toHaveBeenCalledTimes(1);
    expect(mockTrigger).toHaveBeenCalledWith('success');

    view.rerender(<Probe step="arrived" />);
    expect(mockTrigger).toHaveBeenLastCalledWith('heavy');
  });

  it('does nothing for steps without a cue', () => {
    const view = render(<Probe step="accepted" />);
    view.rerender(<Probe step="completed" />);
    expect(mockTrigger).not.toHaveBeenCalled();
  });
});
