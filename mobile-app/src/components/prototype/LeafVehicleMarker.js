import React, { useId, useMemo } from 'react';
import { SvgXml } from 'react-native-svg';
import { createLeafMapMarkerSvg, resolveVehicleArtworkPose } from './leafVehicleArtwork';

const LeafVehicleMarker = React.memo(function LeafVehicleMarker({
  colorToken = 'black',
  shapeKey = '',
  screenHeading = 0,
}) {
  const id = useId();
  const poseHeading = resolveVehicleArtworkPose(screenHeading).heading;
  const xml = useMemo(() => createLeafMapMarkerSvg({
    colorToken,
    shapeKey,
    screenHeading: poseHeading,
    idPrefix: `leaf-vehicle-${id}`,
  }), [colorToken, id, poseHeading, shapeKey]);

  return <SvgXml xml={xml} width={42} height={42} testID="leaf-vehicle-vector" />;
});

export default LeafVehicleMarker;
