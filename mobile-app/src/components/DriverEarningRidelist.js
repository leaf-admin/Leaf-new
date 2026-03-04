import React, { useState, useEffect } from 'react';
import { View, Text, FlatList, StyleSheet, Dimensions, Animated } from 'react-native';
import { colors } from '../common/theme';
import i18n from '../i18n';
import { useSelector } from 'react-redux';
import SegmentedControlTab from 'react-native-segmented-control-tab';
import { MAIN_COLOR } from '../common/sharedFunctions';
var { width, height } = Dimensions.get('window');
import moment from 'moment/min/moment-with-locales';
import { fonts } from '../common/font';
import { Ionicons, AntDesign, Feather, MaterialCommunityIcons } from '@expo/vector-icons';
import Typography from './design-system/Typography';
import { useTheme } from '../common-local/theme';

export default function DriverEarningRidelist(props) {
    const { t } = i18n;
    const isRTL = i18n.locale && (i18n.locale.indexOf('he') === 0 || i18n.locale.indexOf('ar') === 0);
    const settings = useSelector(state => state.settingsdata.settings);
    const [tabIndex, setTabIndex] = useState(props.tabIndex);
    const auth = useSelector(state => state.auth);


    const [scaleAnim] = useState(new Animated.Value(0))
    useEffect(() => {
        Animated.spring(
            scaleAnim,
            {
                toValue: 1,
                friction: 3,
                useNativeDriver: true
            }
        ).start();
    }, [])

    const [role, setRole] = useState();

    useEffect(() => {
        if (auth.profile && auth.profile.usertype) {
            setRole(auth.profile.usertype);
        } else {
            setRole(null);
        }
    }, [auth.profile]);

    const { theme, isDarkMode } = useTheme();

    const renderData = ({ item, index }) => {
        return (
            <View activeOpacity={0.8} style={[styles.BookingContainer, { backgroundColor: theme.card, borderColor: theme.border, borderWidth: 1 }]} >
                <View style={[styles.box, { backgroundColor: 'transparent', padding: 5 },]}>
                    <View style={{ flexDirection: isRTL ? 'row-reverse' : 'row', flex: 1, margin: 10, justifyContent: 'space-between' }}>
                        <View style={{ justifyContent: 'center' }}>
                            <Typography variant="body" weight="bold" color={theme.text}>
                                {item.endTime ? moment(item.endTime).format('lll') : ''}
                            </Typography>
                        </View>
                        <View style={{ justifyContent: 'center' }}>
                            {item.payment_mode == 'cash' ?
                                <MaterialCommunityIcons name="cash" size={28} color={theme.text} />
                                : item.payment_mode == 'card' ?
                                    <Feather name="credit-card" size={24} color={theme.text} />
                                    :
                                    <AntDesign name="wallet" size={24} color={theme.text} />
                            }
                        </View>
                        <View style={{ justifyContent: 'center' }}>
                            {settings.swipe_symbol === false ?
                                <Typography variant="body" weight="bold" color={theme.leafGreen || '#4CAF50'}>
                                    {settings.symbol}{item.driver_share ? parseFloat(item.driver_share).toFixed(settings.decimal) : '0'}
                                </Typography>
                                :
                                <Typography variant="body" weight="bold" color={theme.leafGreen || '#4CAF50'}>
                                    {item.driver_share ? parseFloat(item.driver_share).toFixed(settings.decimal) : '0'}{settings.symbol}
                                </Typography>
                            }
                        </View>
                    </View>
                    <View style={{ flexDirection: isRTL ? 'row-reverse' : 'row', flex: 1, marginTop: 5 }}>
                        <View style={{ flexDirection: 'column', flex: 1 }}>
                            <View style={{ flexDirection: isRTL ? 'row-reverse' : 'row' }}>
                                <View style={{ width: 30, alignItems: 'center' }}>
                                    <Ionicons name="location-outline" size={24} color={theme.leafGreen || '#4CAF50'} />
                                    <View style={[styles.hbox2, { flex: 1, minHeight: 5, backgroundColor: theme.border }]} />
                                </View>
                                <View style={{ flex: 1, marginBottom: 10 }}>
                                    <Typography variant="caption" color={theme.text} style={[isRTL ? { marginRight: 6, textAlign: 'right' } : { marginLeft: 6, textAlign: 'left' }]}>
                                        {item.pickup.add}
                                    </Typography>
                                </View>
                            </View>

                            {item && item.waypoints && item.waypoints.length > 0 ?
                                <View style={{ flexDirection: isRTL ? 'row-reverse' : 'row' }}>
                                    <View style={{ width: 30, alignItems: 'center' }}>
                                        <Ionicons name="location-outline" size={24} color={theme.textSecondary} />
                                        <View style={[styles.hbox2, { flex: 1, minHeight: 5, backgroundColor: theme.border }]} />
                                    </View>
                                    <View style={{ flex: 1, marginBottom: 10 }}>
                                        <Typography variant="caption" color={theme.textSecondary} style={[isRTL ? { marginRight: 6, textAlign: 'right' } : { marginLeft: 6, textAlign: 'left' }]}>
                                            {item.waypoints.length} {t('stops')}
                                        </Typography>
                                    </View>
                                </View>
                                : null}

                            <View style={{ flexDirection: isRTL ? 'row-reverse' : 'row' }}>
                                <View style={{ width: 30, alignItems: 'center' }}>
                                    <Ionicons name="location-outline" size={24} color="#FF3B30" />
                                </View>
                                <View style={{ flex: 1, marginBottom: 10 }}>
                                    <Typography variant="caption" color={theme.text} style={[isRTL ? { marginRight: 6, textAlign: 'right' } : { marginLeft: 6, textAlign: 'left' }]}>
                                        {item.drop.add}
                                    </Typography>
                                </View>
                            </View>
                        </View>
                    </View>

                </View>
            </View>
        )
    }

    return (
        <View style={[styles.textView3, { backgroundColor: theme.background }]}>
            <SegmentedControlTab
                values={[t('daily'), t('thismonth'), t('thisyear')]}
                selectedIndex={tabIndex}
                onTabPress={(index) => setTabIndex(index)}
                borderRadius={8}
                tabsContainerStyle={[styles.segmentcontrol, { flexDirection: isRTL ? 'row-reverse' : 'row', marginHorizontal: 16, marginTop: 10, backgroundColor: isDarkMode ? 'rgba(255,255,255,0.05)' : '#F0F0F0', borderRadius: 8, padding: 4 }]}
                tabStyle={{
                    borderWidth: 0,
                    backgroundColor: 'transparent',
                }}
                activeTabStyle={{ backgroundColor: theme.card, borderRadius: 6, elevation: 2, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.1, shadowRadius: 2 }}
                tabTextStyle={{ color: theme.textSecondary, fontFamily: fonts.Regular, fontSize: 13 }}
                activeTabTextStyle={{ color: theme.text, fontFamily: fonts.Bold }}
            />

            <View style={{ flex: 1, marginTop: 10 }}>
                <FlatList
                    showsVerticalScrollIndicator={false}
                    scrollEnabled={true}
                    keyExtractor={(item, index) => index.toString()}
                    data={tabIndex === 0 ? props.data.filter(item => ((new Date(item.endTime).getDate() == new Date().getDate()) && (item.status === 'PAID' || item.status === 'COMPLETE'))) : (tabIndex === 1 ? props.data.filter(item => ((new Date(item.endTime).getMonth() == new Date().getMonth()) && (item.status === 'PAID' || item.status === 'COMPLETE'))) : props.data.filter(item => ((new Date(item.endTime).getFullYear() == new Date().getFullYear()) && (item.status === 'PAID' || item.status === 'COMPLETE'))))}
                    renderItem={renderData}
                    ListEmptyComponent={
                        <View style={{ marginTop: height / 3.5, justifyContent: 'center', alignItems: 'center' }}>
                            <View style={{ padding: 20, borderRadius: 12, backgroundColor: theme.card, justifyContent: 'center', alignItems: 'center', borderColor: theme.border, borderWidth: 1 }}>
                                <Typography variant="body" color={theme.textSecondary}>{t('no_data_available')}</Typography>
                            </View>
                        </View>
                    }
                />
            </View>
        </View>
    );

};

const styles = StyleSheet.create({
    // textStyle: {
    //     fontSize: 18,
    // },
    BookingContainer: {
        margin: 10,
        borderRadius: 10,

        shadowColor: "black",
        shadowOffset: {
            width: 0,
            height: 2,
        },
        shadowOpacity: 0.23,
        shadowRadius: 1,
    },
    box: {
        backgroundColor: colors.WHITE,
        borderRadius: 10,

        // shadowOffset: {
        //     width: 0,
        //     height: 0,
        //   },
        //   shadowOpacity: 1,
        //   shadowRadius: 0.5,
        //   shadowColor: 'white',
    },
    elevation: {
        elevation: 5

    },

    vew: {
        shadowColor: colors.BLACK,
        shadowOffset: {
            width: 0,
            height: 2,
        },
        shadowOpacity: 0.23,
        shadowRadius: 2,
        elevation: 2,
        borderTopRightRadius: 15,
        borderTopLeftRadius: 15,
        backgroundColor: colors.new,
        height: 60,

    },
    iconClickStyle: {
        //flex: 1,
        alignSelf: 'center',
        shadowColor: colors.BLACK,
        shadowOffset: {
            width: 0,
            height: 4,
        },
        shadowOpacity: 0.23,
        shadowRadius: 2,
        elevation: 2,
        borderRadius: 15, backgroundColor: colors.WHITE,
        margin: 10,
    },
    picPlaceStyle: {
        color: colors.HEADER,
        marginHorizontal: 15
    },
    dateStyle: {
        fontFamily: fonts.Bold,
        color: colors.HEADER,
        fontSize: 18
    },
    textView3: {
        flex: 1
    },
    segmentcontrol: {
        color: colors.WHITE,
        fontSize: 18,
        fontFamily: fonts.Regular,
        marginTop: 0,
        alignSelf: "center",
        height: 50
    },
    location: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        marginVertical: 6,
        marginHorizontal: 5
    },

    fare: {
        width: (width - 35) / 4,
        backgroundColor: colors.WHITE,
        borderRadius: 5,
        paddingHorizontal: 3,
        height: 'auto',
        justifyContent: 'space-evenly',
        alignItems: 'center',
        paddingVertical: 5
    },
    shadow: {
        shadowColor: colors.BLACK,
        shadowOffset: {
            width: 0,
            height: 2,
        },
        shadowOpacity: 0.5,
        shadowRadius: 1,
        elevation: 5,
    },
    hbox2: {
        width: 1,
        backgroundColor: colors.MAP_TEXT
    },
    textStyle: {
        fontSize: 15,
        fontFamily: fonts.Regular
    },
    textStyleBold: {
        fontSize: 15,
        fontFamily: fonts.Bold
    },
    multiAddressChar: {
        height: 10,
        width: 10,
        borderWidth: 1,
        backgroundColor: colors.BLACK,
        borderRadius: 5,
        justifyContent: 'center',
        alignItems: 'center'
    },
    centeredView: {
        flex: 1,
        justifyContent: "center",
        backgroundColor: colors.BACKGROUND
    },
    modalView: {
        margin: 20,
        backgroundColor: "white",
        borderRadius: 20,
        padding: 35,
        alignItems: "flex-start",
        shadowColor: colors.BLACK,
        shadowOffset: {
            width: 0,
            height: 2
        },
        shadowOpacity: 0.25,
        shadowRadius: 4,
        elevation: 5,
    },
    textContainerStyle: {
        flexDirection: 'column',
        marginBottom: 12,
    }
});