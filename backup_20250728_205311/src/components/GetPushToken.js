import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { colors } from '../common/theme';
import * as Device from 'expo-device';
import { AppConfig } from '../../config/AppConfig';

export default async function GetPushToken() {

  let token;
  if (Device.isDevice) {
    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;
    if (existingStatus !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }
    if (finalStatus !== 'granted') {
      return;
    }
    const ref = { projectId: AppConfig.expo_project_id };
    token = (await Notifications.getExpoPushTokenAsync(ref)).data;
  }
  return token;
}