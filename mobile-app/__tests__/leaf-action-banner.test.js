import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';

jest.mock('@expo/vector-icons', () => {
  const { View } = require('react-native');
  return { Ionicons: () => <View /> };
});

import LeafActionBanner, { LEAF_BANNER_TONES } from '../src/components/design-system/LeafActionBanner';

describe('LeafActionBanner', () => {
  it('shows title, message and the action on the banner itself', () => {
    const onAction = jest.fn();
    const { getByText, getByTestId } = render(
      <LeafActionBanner tone="action" title="Motorista chegou" message="Ele espera até 2:00" actionLabel="Estou indo" onAction={onAction} />
    );
    expect(getByText('Motorista chegou')).toBeTruthy();
    expect(getByText('Ele espera até 2:00')).toBeTruthy();
    fireEvent.press(getByTestId('leaf-action-banner-action'));
    expect(onAction).toHaveBeenCalled();
    expect(getByTestId('leaf-action-banner').props.accessibilityLabel).toBe('Motorista chegou. Ele espera até 2:00');
  });

  it('has the four approved tones and no action without a handler', () => {
    expect(Object.keys(LEAF_BANNER_TONES)).toEqual(['action', 'info', 'success', 'warning']);
    const { queryByTestId } = render(<LeafActionBanner title="Oferta expirada" actionLabel="Ver" />);
    expect(queryByTestId('leaf-action-banner-action')).toBeNull();
  });
});
