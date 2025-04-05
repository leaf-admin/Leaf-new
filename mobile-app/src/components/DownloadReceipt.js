import React from 'react';
import { View, Alert, StyleSheet, Text, TouchableOpacity, I18nManager } from 'react-native';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { MAIN_COLOR } from '../common/sharedFunctions';
import i18n from 'i18n-js';
import { colors } from '../common/theme';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
const DownloadReceipt = ({ booking, settings }) => {
    const { t } = i18n;
    const isRTL = i18n.locale.indexOf('he') === 0 || i18n.locale.indexOf('ar') === 0;

    const generateHtmlContent = () => {
        const bookingDate = new Date(booking.bookingDate).toLocaleString('en-US', { year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', hour12: true });

        const parseTime = (timeStr) => {
            const [hours, minutes, seconds] = timeStr.split(':').map(Number);
            const date = new Date();
            date.setHours(hours, minutes, seconds, 0);
            return date;
        };

        const pickupTime = parseTime(booking.trip_start_time).toLocaleTimeString('en-US', { hour: 'numeric', minute: 'numeric', hour12: true });
        const dropoffTime = parseTime(booking.trip_end_time).toLocaleTimeString('en-US', { hour: 'numeric', minute: 'numeric', hour12: true });

        const formatTime = (seconds) => {
            const hours = Math.floor(seconds / 3600);
            const minutes = Math.floor((seconds % 3600) / 60);
            const secs = seconds % 60;
            return `${hours ? `${hours}h ` : ''}${minutes ? `${minutes}m ` : ''}${secs}s`;
        };

        const formattedTripTime = formatTime(booking.total_trip_time);
        const distance = booking.distance ? booking.distance : 0;
        const distanceUnit = settings.convert_to_mile ? "mile" : "km";

        const waypointsHtml = booking && booking?.waypoints?.map((waypoint, index) => `
        <div class="info">
            <label>${t("marker_title_2")} ${index+1}</label>
            <span class="text">${waypoint.add}</span>
        </div>
        `).join('');

        const rtlClass = isRTL ? 'rtl' : '';

        return `
        <!DOCTYPE html>
        <html lang="en">
          <head>
            <meta charset="UTF-8" />
            <meta name="viewport" content="width=device-width, initial-scale=1.0" />
            <title>Ride Booking Receipt</title>
            <style>
              body {
                font-family: Arial, sans-serif;
                margin: 0;
                padding: 20px;
              }
              .container {
                width: 600px;
                border: 1px solid #ddd;
                border-radius: 5px;
                padding: 20px;
                margin: 0 auto;
              }
              .header {
                color: #085c91;
                font-size: 24px;
                text-align: center;
                margin-bottom: 10px;
              }
              .subheader {
                color: #333;
                font-size: 18px;
                text-align: center;
                margin-bottom: 10px;
              }
              .text {
                color: #000;
                font-size: 14px;
                line-height: 1.5;
              }
              .bold {
                font-weight: bold;
              }
              .info {
                margin-bottom: 5px;
                display:flex;
                width:100%;
                justify-content:space-between;
              }
              .info:after {
                display: table;
                clear: both;
                content: "";
              }
              .info label {
                float: left;
                color: #085c91;
                width:30%
              }
              .info span {
              width:70%
              }
              .separator {
                border-bottom: 2px solid #ddd;
                margin: 15px 0;
              }
              .small-separator {
                border-bottom: 1px solid #ddd;
                margin: 10px 0;
              }

              .rtl {
                direction: rtl;
              }
              .rtl .info {
                flex-direction: row-reverse;
              }
              .rtl .info label {
                float: right;
                text-align: right;
              }
            </style>
          </head>
          <body class="${rtlClass}">
          <div class="container">
              <h1 class="header">${settings.appName}</h1>
              <div class="subheader">${t("ride_receipt")}</div>
              <div class="text">
                Hi <span class="math-inline">${booking.customer_name},</span>
              </div>
              <div class="text">
              ${t("ride_greetings")} ${booking.reference}
              </div>
              <div class="separator"></div>
              <div class="info">
                <label>${t("date")}:</label>
                <span class="text">${bookingDate}</span>
              </div>
              <div class="bold text">
                 <label>${t("total")}:</label>
                <span class="math-inline">${settings.symbol}</span>${booking.trip_cost}
              </div>
              <div class="separator"></div>
              <div class="text">${t("ride_details")}</div>
              <div class="small-separator"></div>
              <div class="info">
                <label>${t("Discounts")}:</label>
                <span class="text"><span class="math-inline">${settings.symbol}</span>${booking.discount}</span>
              </div>
              <div class="info">
                <label>${t("Gross_trip_cost")}:</label>
                <span class="text"><span class="math-inline">${settings.symbol}</span>${booking.trip_cost}</span>
              </div>
              <div class="separator"></div>
              <div class="text">${t("payment")}</div>
              <div class="small-separator"></div>
              <div class="info">
                <span class="text bold">${t(booking.payment_mode)}</span><span class="text bold">${booking.trip_cost}</span>
              </div>
              <div class="separator"></div>
              <div class="text">${t("driver_info")}</div>
              <div class="small-separator"></div>
              <div class="info">
                <label>${t("driver_name")}:</label>
                <span class="text">${booking.driver_name}</span>
              </div>
              <div class="info">
                <label>${t("vehicle_no")}</label>
                <span class="text">${booking.vehicle_number}</span>
              </div>
              <div class="separator"></div>
              <div class="text">${t("ride_info")}</div>
              <div class="small-separator"></div>
              <div class="info">
                <label>${t("marker_title_1")}:</label>
                <span class="text">${pickupTime} | ${booking.pickupAddress}</span>
              </div>
              ${booking?.waypoints?waypointsHtml:""}
              <div class="info">
                <label>${t("marker_title_2")}:</label>
                <span class="text">${dropoffTime} | ${booking.dropAddress}</span>
              </div>
              <div class="info">
                <label>${t("distance_web")}:</label>
                <span class="text">${distance} ${distanceUnit}</span>
              </div>
              <div class="info">
                <label>${t("ride_time")}:</label>
                <span class="text">${formattedTripTime}</span>
              </div>
              <div class="separator"></div>
              <div class="text bold" style="display: flex; justify-content: center;">${t("greetings_text")}</div>
            </div>
          </body>
        </html>
        `;
    };

    const createPdf = async () => {
        try {
            const htmlContent = generateHtmlContent();
            const { uri } = await Print.printToFileAsync({ html: htmlContent });
            if (await Sharing.isAvailableAsync()) {
                await Sharing.shareAsync(uri);
            } else {
                Alert.alert(t("sharing_not_available"));
            }
        } catch (error) {
            console.error(error);
            Alert.alert('Error', t("pdf_error"));
        }
    };

    return (
        <View style={styles.container}>
            <TouchableOpacity onPress={createPdf} style={{flexDirection:isRTL?'row-reverse':'row',alignItems:'center'}}>
                <Text style={styles.buttonText}>{t("download_receipt")}</Text>
                <MaterialCommunityIcons name="file-download-outline" size={24} color={colors.INDICATOR_BLUE} />
            </TouchableOpacity>
        </View>
    );
};

const styles = StyleSheet.create({
    container: {
        justifyContent: 'center',
    },
    button: {
        padding: 12,
        borderRadius: 5,
        borderBottomWidth:1,
        borderBottomColor: MAIN_COLOR
    },
    buttonText: {
        color: colors.INDICATOR_BLUE,
        fontSize: 15,
    },
});

export default DownloadReceipt;
