const React = require('react');
const { View } = require('react-native');
const { render } = require('@testing-library/react-native');

const mockKeyframeDefinitions = [];

class MockKeyframe {
  constructor(definitions) {
    mockKeyframeDefinitions.push(definitions);
  }

  duration() {
    return this;
  }

  build() {
    return () => ({ initialValues: {}, animations: {} });
  }
}

function mockCreateAnimationBuilder() {
  return {
    duration() {
      return this;
    },
    easing() {
      return this;
    },
    withInitialValues() {
      return this;
    }
  };
}

jest.mock('react-native-reanimated', () => {
  const ReactNative = require('react-native');

  return {
    __esModule: true,
    default: {
      View: ReactNative.View
    },
    Easing: {
      bezier: () => value => value
    },
    FadeIn: mockCreateAnimationBuilder(),
    FadeOut: mockCreateAnimationBuilder(),
    Keyframe: MockKeyframe,
    useReducedMotion: () => false
  };
});

const PrototypeScreenTransition = require('../src/components/prototype/PrototypeScreenTransition').default;

describe('PrototypeScreenTransition', () => {
  beforeEach(() => {
    mockKeyframeDefinitions.length = 0;
  });

  it.each(['up', 'left', 'right'])('renders %s transitions with Reanimated 4 Keyframe API', direction => {
    expect(() => {
      render(
        <PrototypeScreenTransition direction={direction}>
          <View testID="transition-child" />
        </PrototypeScreenTransition>
      );
    }).not.toThrow();

    expect(mockKeyframeDefinitions).toHaveLength(2);
    expect(mockKeyframeDefinitions.every(definitions => typeof definitions[100].easing === 'function')).toBe(true);
    expect(mockKeyframeDefinitions.every(definitions => definitions[0].easing === undefined)).toBe(true);
  });
});
