import React, { useCallback, useMemo, useRef } from 'react';
import { View, StyleSheet } from 'react-native';
// Temporariamente removido: import BottomSheet, { BottomSheetView, BottomSheetBackdrop } from '@gorhom/bottom-sheet';

const BottomSheetWrapper = ({ 
  children, 
  snapPoints = ['25%', '50%', '90%'],
  index = 1,
  onClose,
  enablePanDownToClose = true 
}) => {
  const bottomSheetRef = useRef(null);

  const renderBackdrop = useCallback(
    (props) => (
      <BottomSheetBackdrop
        {...props}
        disappearsOnIndex={0}
        appearsOnIndex={1}
        opacity={0.5}
      />
    ),
    []
  );

  return (
    <BottomSheet
      ref={bottomSheetRef}
      index={index}
      snapPoints={snapPoints}
      backdropComponent={renderBackdrop}
      enablePanDownToClose={enablePanDownToClose}
      onClose={onClose}
      backgroundStyle={styles.bottomSheetBackground}
      handleIndicatorStyle={styles.indicator}
    >
      <BottomSheetView style={styles.contentContainer}>
        {children}
      </BottomSheetView>
    </BottomSheet>
  );
};

const styles = StyleSheet.create({
  bottomSheetBackground: {
    backgroundColor: '#ffffff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: -2,
    },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 5,
  },
  contentContainer: {
    flex: 1,
    paddingHorizontal: 20,
    paddingTop: 10,
  },
  indicator: {
    backgroundColor: '#D1D5DB',
    width: 40,
    height: 4,
  },
});

export default BottomSheetWrapper; 