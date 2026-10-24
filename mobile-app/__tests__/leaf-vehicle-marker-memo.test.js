import React from 'react';
import { act, create } from 'react-test-renderer';
import { SvgXml } from 'react-native-svg';
import LeafVehicleMarker from '../src/components/prototype/LeafVehicleMarker';

jest.mock('react-native-svg', () => ({ SvgXml: jest.fn(() => null) }));

describe('vehicle marker artwork reconciliation', () => {
  beforeEach(() => jest.clearAllMocks());
  it('keeps the SVG tree stable within the existing lighting bucket and redraws at its boundary', () => {
    let tree;
    act(() => { tree = create(<LeafVehicleMarker screenHeading={0} />); });
    for (const heading of [0.1, 1, 2, -1, 359, 360]) {
      act(() => tree.update(<LeafVehicleMarker screenHeading={heading} />));
    }
    expect(SvgXml).toHaveBeenCalledTimes(1);
    act(() => tree.update(<LeafVehicleMarker screenHeading={3} />));
    expect(SvgXml).toHaveBeenCalledTimes(2);
    act(() => tree.unmount());
  });
  it('still redraws for paint, body and size changes', () => {
    let tree;
    const props = { colorToken: 'black', shapeKey: '', size: 42, screenHeading: 0 };
    act(() => { tree = create(<LeafVehicleMarker {...props} />); });
    act(() => tree.update(<LeafVehicleMarker {...props} colorToken="red" />));
    expect(SvgXml).toHaveBeenCalledTimes(2);
    act(() => tree.update(<LeafVehicleMarker {...props} colorToken="red" shapeKey="sedan" />));
    expect(SvgXml).toHaveBeenCalledTimes(3);
    act(() => tree.update(<LeafVehicleMarker {...props} colorToken="red" shapeKey="sedan" size={56} />));
    expect(SvgXml).toHaveBeenCalledTimes(4);
    expect(SvgXml.mock.calls.at(-1)[0]).toMatchObject({ width: 56, height: 56 });
    act(() => tree.unmount());
  });
});
