import React, { useState, useEffect, useRef, useContext, useMemo } from 'react';
import {
    StyleSheet,
    View,
    Image,
    Dimensions,
    Text,
    TouchableOpacity,
    ScrollView,
    ActivityIndicator,
    Alert,
    Platform,
    Share,
    TextInput,
    KeyboardAvoidingView,
    StatusBar
} from 'react-native';
import { Icon } from 'react-native-elements'
import ActionSheet from "react-native-actions-sheet";
import { colors } from '../common/theme';
import * as ImagePicker from 'expo-image-picker';
import i18n from '../i18n';
var { width, height } = Dimensions.get('window');
import { useSelector, useDispatch } from 'react-redux';
import { api, FirebaseContext } from 'common';
import StarRating from 'react-native-star-rating-widget';
import AsyncStorage from '@react-native-async-storage/async-storage';
import RNPickerSelect from '../components/RNPickerSelect';
import moment from 'moment/min/moment-with-locales';
import { MaterialIcons, Ionicons, Entypo, MaterialCommunityIcons, Feather, AntDesign } from '@expo/vector-icons';
import { MAIN_COLOR, SECONDORY_COLOR } from '../common/sharedFunctions';
import Dialog from "react-native-dialog";
import { FontAwesome5 } from '@expo/vector-icons';
import rnauth from '@react-native-firebase/auth';
import { fonts } from '../common/font';
import { getLangKey } from 'common/src/other/getLangKey';
import { useTheme } from '@react-navigation/native';
import { updateUserProfile } from 'common/src/actions/authactions';

export default function ProfileScreen(props) {
    const { authRef, mobileAuthCredential, updatePhoneNumber } = useContext(FirebaseContext);
    const { t } = i18n;
    const theme = useTheme();
    const dispatch = useDispatch();
    const [isRTL, setIsRTL] = useState();
    const {
        updateProfileImage,
        deleteUser,
        updateProfile,
        updateProfileWithEmail,
        checkUserExists,
        requestMobileOtp,
        updateAuthMobile,
        countries
    } = api;
    const auth = useSelector(state => state.auth);
    const settings = useSelector(state => state.settingsdata.settings);
    const [profileData, setProfileData] = useState(null);
    const [loader, setLoader] = useState(false);
    const actionSheetRef = useRef(null);
    const [langSelection, setLangSelection] = useState();
    const languagedata = useSelector(state => state.languagedata);
    const pickerRef1 = React.createRef();
    const pickerRef2 = React.createRef();
    const [countrycodeFocus, setCountryCodeFocus] = useState(false)
    const [countryCode, setCountryCode] = useState();
    const [userMobile, setUserMobile] = useState('');
    const [isDarkMode, setIsDarkMode] = useState(theme.dark);
    const fromPage = props.route.params && props.route.params.fromPage ? props.route.params.fromPage : null;

    const formatCountries = useMemo(() => {
        let arr = [];
        for (let i = 0; i < countries.length; i++) {
            let txt = "(+" + countries[i].phone + ") " + countries[i].label ;
            arr.push({ label: txt, value: txt, key: txt, inputLabel: " +" + countries[i].phone});
        }
        return arr;
    }, [countries]); 

    useEffect(() => {
        if (settings) {
            for (let i = 0; i < countries.length; i++) {
                if (countries[i].label == settings.country) {
                    setCountryCode("(+" + countries[i].phone + ") " + countries[i].label );
                    setUserMobile("")
                }
            }
        }
        
    }, [settings]);


    const upDateCountry = (text) => {
        setCountryCode(text);
        setProfileData({ ...profileData, mobile: "" })
    }


    useEffect(() => {
        setLangSelection(i18n.locale);
        setIsRTL(i18n.locale.indexOf('he') === 0 || i18n.locale.indexOf('ar') === 0);
    }, []);

    useEffect(() => {
        if (auth.profile && auth.profile.uid) {
            setProfileData(auth.profile);
        }
    }, [auth.profile]);

    const showActionSheet = () => {
        actionSheetRef.current?.setModalVisible(true);
    }

    const uploadImage = () => {
        return (
            <ActionSheet ref={actionSheetRef}>
                <TouchableOpacity
                    style={{ width: '90%', alignSelf: 'center', paddingLeft: 20, paddingRight: 20, borderColor: colors.BORDER_TEXT, borderBottomWidth: 1, height: 60, alignItems: 'center', justifyContent: 'center' }}
                    onPress={() => { _pickImage('CAMERA', ImagePicker.launchCameraAsync) }}
                >
                    <Text style={{ color: colors.CAMERA_TEXT, fontWeight: 'bold' }}>{t('camera')}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                    style={{ width: '90%', alignSelf: 'center', paddingLeft: 20, paddingRight: 20, borderBottomWidth: 1, borderColor: colors.BORDER_TEXT, height: 60, alignItems: 'center', justifyContent: 'center' }}
                    onPress={() => { _pickImage('MEDIA', ImagePicker.launchImageLibraryAsync) }}
                >
                    <Text style={{ color: colors.CAMERA_TEXT, fontWeight: 'bold' }}>{t('medialibrary')}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                    style={{ width: '90%', alignSelf: 'center', paddingLeft: 20, paddingRight: 20, height: 50, alignItems: 'center', justifyContent: 'center' }}
                    onPress={() => { actionSheetRef.current?.setModalVisible(false); }}>
                    <Text style={{ color: 'red', fontWeight: 'bold' }}>{t('cancel')}</Text>
                </TouchableOpacity>
            </ActionSheet>
        )
    }

    const _pickImage = async (permissionType, res) => {
        var pickFrom = res;
        let permisions;
        if (permissionType == 'CAMERA') {
            permisions = await ImagePicker.requestCameraPermissionsAsync();
        } else {
            permisions = await ImagePicker.requestMediaLibraryPermissionsAsync();
        }
        const { status } = permisions;

        if (status == 'granted') {
            setLoader(true);
            let result = await pickFrom({
                allowsEditing: true,
                aspect: [3, 3]
            });
            actionSheetRef.current?.setModalVisible(false);
            if (!result.canceled) {
                setProfileData({
                    ...profileData,
                    profile_image: result.assets[0].uri
                })
                const blob = await new Promise((resolve, reject) => {
                    const xhr = new XMLHttpRequest();
                    xhr.onload = function () {
                        resolve(xhr.response);
                    };
                    xhr.onerror = function () {
                        Alert.alert(t('alert'), t('image_upload_error'));
                        setLoader(false);
                    };
                    xhr.responseType = 'blob';
                    xhr.open('GET', result.assets[0].uri, true);
                    xhr.send(null);
                });
                if (blob) {
                    updateProfileImage(blob);
                }
                setLoader(false);
            }
            else {
                setLoader(false);
            }
        } else {
            Alert.alert(t('alert'), t('camera_permission_error'))
        }
    };

    const deleteAccount = () => {
        setDLoading(true)
        Alert.alert(
            t('delete_account_modal_title'),
            t('delete_account_modal_subtitle'),
            [
                {
                    text: t('cancel'),
                    onPress: () => { setDLoading(false) },
                    style: 'cancel',

                },
                {
                    text: t('yes'), onPress: () => {
                        dispatch(deleteUser(auth.profile.uid));

                    }
                },
            ],
            { cancelable: false },
        );
    }

    const [otp, setOtp] = useState("");
    const [editName, setEditName] = useState(false);
    const [editEmail, setEditEmail] = useState(false);
    const [editMobile, setEditMobile] = useState(false);
    const [confirmCode, setConfirmCode] = useState(null);

    const [updateCalled, setUpdateCalled] = useState(false);
    const [otpCalled, setOtpCalled] = useState(false);
    const [loading, setLoading] = useState(false);
    const [dloading, setDLoading] = useState(false);

    const [emailLoading,setEmailLoading] = useState(false)
    const [mobileLoading,setmobileLoading] = useState(false)
    useEffect(() => {
        if (auth.profile && auth.profile.uid) {
            setProfileData({ ...auth.profile });
            if (updateCalled) {
            
                Alert.alert(
                    t('alert'),
                    t('profile_updated'),
                    [
                        {
                            text: t('ok'), onPress: () => {
                                setUpdateCalled(false);
                                setEmailLoading(false);
                                setmobileLoading(false);
                            }
                        }
                    ],
                    { cancelable: true }
                );
                setUpdateCalled(false);
            }
        }
    }, [auth.profile, updateCalled]);

    const saveName = async () => {

        if (profileData.firstName.length > 0 && profileData.lastName.length > 0) {
            let userData = {
                firstName: profileData.firstName,
                lastName: profileData.lastName
            }
            setUpdateCalled(true);
            dispatch(updateProfile(userData));
            setEditName(false);
        } else {
            setEditName(true)
            Alert.alert(
                t('alert'),
                t('proper_input_name'),
                [
                    {
                        text: t('cancel'),
                        onPress: () => { setEditName(false) },
                        style: 'cancel',

                    },
                    { text: t('ok'), onPress: () => { } }
                ],
                { cancelable: true }
            );
        }
    }

    const validateEmail = (email) => {
        const re = /^(([^<>()\[\]\\.,;:\s@"]+(\.[^<>()\[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/
        const emailValid = re.test(email)
        return emailValid;
    }

    const completeSubmit = () => {
        setLoading(true);
        let userData = {
            mobile: profileData.mobile,
            email: profileData.email
        }
        setUpdateCalled(true);
        dispatch(updateProfile(userData));
        setLoading(false);
        setEditMobile(false);
    }

    

    const saveProfile = async (set) => {
        // setLoading(true)
        if (profileData.email === auth.profile.email && set === 1) {
            setEditEmail(false);
            setLoading(false)
            setEmailLoading(false)
        } else if (profileData.mobile === auth.profile.mobile && set === 2) {
            setEditMobile(false);
            setLoading(false)
            setmobileLoading(false)
            setUserMobile("")
        } else if (profileData.email !== auth.profile.email) {
            if (validateEmail(profileData.email)) {
                setEmailLoading(true)
                checkUserExists({ email: profileData.email }).then((res) => {
                    if (res.users && res.users.length > 0) {
                        Alert.alert(t('alert'), t('user_exists'));
                        setLoading(false)
                        setEmailLoading(false)
                    }
                    else if (res.error) {
                        Alert.alert(t('alert'), t('email_or_mobile_issue'));
                        setLoading(false)
                        setEmailLoading(false)
                    } else {
                        setEditEmail(false);
                        profileData['uid'] = auth.profile.uid;
                        dispatch(updateProfileWithEmail(profileData));
                        setUpdateCalled(true);
                        setEmailLoading(false)
                    }
                });
            } else {
                Alert.alert(t('alert'), t('proper_email'));
                setLoading(false);
            }
        } else {
            if (profileData.mobile !== auth.profile.mobile && profileData.mobile && profileData.mobile.length > 6) {
                checkUserExists({ mobile: profileData.mobile }).then(async (res) => {
                    setmobileLoading(true)
                    if (res.users && res.users.length > 0) {
                        Alert.alert(t('alert'), t('user_exists'));
                        setLoading(false);
                        setmobileLoading(false)
                        setEditMobile(false);
                    }
                    else if (res.error) {
                        Alert.alert(t('alert'), t('email_or_mobile_issue'));
                        setLoading(false);
                        setEditMobile(false);
                        setEmailLoading(false)
                    } else {
                        if (settings.customMobileOTP) {
                            setOtpCalled(true);
                            dispatch(requestMobileOtp(profileData.mobile));
                            setmobileLoading(false)
                        } else {
                            const snapshot = await rnauth()
                                .verifyPhoneNumber(profileData.mobile)
                                .on('state_changed', (phoneAuthSnapshot) => {
                                        if(phoneAuthSnapshot && phoneAuthSnapshot.state === "error"){
                                            setLoading(false);
                                            setEditMobile(false);
                                            setEmailLoading(false);
                                            setmobileLoading(false);
                                            Alert.alert(t('alert'), t('email_or_mobile_issue'));
                                        }
                                });
                            if (snapshot) {
                                setConfirmCode(snapshot);
                                setOtpCalled(true);
                            }
                        }
                        setUserMobile("")
                    }
                });
            } else {
                Alert.alert(t('alert'), t('mobile_no_blank_error'))
                setLoading(false)
                setEditMobile(false);
            }
        }
    }

    const handleVerify = async () => {
        setOtpCalled(false);
        if (otp && otp.length === 6 && !isNaN(otp)) {
            if (settings.customMobileOTP) {
                const res = await updateAuthMobile(profileData.mobile, otp);
                if (res.success) {
                    completeSubmit();
                } else {
                    setOtp('');
                    setOtpCalled(true);
                    Alert.alert(t('alert'), t('otp_validate_error'));
                }
            } else {
                const credential = await mobileAuthCredential(
                    confirmCode.verificationId,
                    otp
                );
                updatePhoneNumber(authRef().currentUser, credential).then((res) => {
                    completeSubmit();
                }).catch((error) => {
                    setOtp('');
                    setOtpCalled(true);
                    Alert.alert(t('alert'), t('otp_validate_error'));
                });
            }
        } else {
            setOtp('');
            setOtpCalled(true);
            Alert.alert(t('alert'), t('otp_validate_error'));
        }
    }

    const handleClose = () => {
        setOtpCalled(false);
        setLoading(false);
        setEmailLoading(false);
        setEditMobile(false);
        setmobileLoading(false);
    }
    const cancle = (set) => {
        if (set === 0) {
            setEditName(false);
        } else if (set === 1) {
            setEditEmail(false);
        } else if (set === 2) {
            setEditMobile(false);
        }
    }


    const onPressBack = () => {
        if (fromPage == 'DriverTrips' || fromPage == 'Map' || fromPage == 'Wallet') {
            props.navigation.navigate('TabRoot', { screen: fromPage });
        } else {
            props.navigation.goBack()
        }
    }

    const lCom = () => {
        return (
            <TouchableOpacity style={{ marginLeft: 10 }} onPress={onPressBack}>
                <FontAwesome5 name="arrow-left" size={24} color={colors.WHITE} />
            </TouchableOpacity>
        );
    }

    React.useEffect(() => {
        props.navigation.setOptions({
            headerLeft: lCom,
        });
    }, [props.navigation]);

    const handleEditProfile = () => {
        props.navigation.navigate('editUser', { fromPage: 'Profile' });
    }

    const handleVerifyId = () => {
        if (settings && settings.imageIdApproval) {
            props.navigation.navigate('editUser', { fromPage: 'Profile' });
        }
    }

    const handleConvertToDriver = () => {
        Alert.alert(
            t('convert_to_driver'),
            t('convert_to_driver_confirmation'),
            [
                {
                    text: t('cancel'),
                    style: 'cancel'
                },
                {
                    text: t('continue'),
                    onPress: () => {
                        props.navigation.navigate('DriverDocuments');
                    }
                }
            ]
        );
    };

    return (
        <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
            <StatusBar hidden={true} />
            
            {/* Header */}
            <View style={[styles.header, { backgroundColor: theme.colors.card }]}>
                <TouchableOpacity 
                    style={[styles.headerButton, { backgroundColor: theme.colors.card }]}
                    onPress={onPressBack}
                >
                    <Icon name="arrow-back" type="material" color={theme.colors.text} size={24} />
                </TouchableOpacity>
                
                <Text style={[styles.headerTitle, { color: theme.colors.text, fontFamily: fonts.Bold }]}>Perfil</Text>
                
                <View style={styles.headerRightContainer}>
                    <TouchableOpacity 
                        style={[styles.headerButton, { backgroundColor: theme.colors.card }]}
                        onPress={() => setIsDarkMode(!isDarkMode)}
                    >
                        <Icon 
                            name={isDarkMode ? "light-mode" : "dark-mode"} 
                            type="material" 
                            color={theme.colors.text} 
                            size={24} 
                        />
                    </TouchableOpacity>
                </View>
            </View>

            <ScrollView style={styles.scrollView}>
                {/* Profile Info Card */}
                <View style={[styles.profileCard, { backgroundColor: theme.colors.card }]}>
                    <View style={styles.profileHeader}>
                        <View style={styles.avatarContainer}>
                            <Icon 
                                name="person" 
                                type="material" 
                                color={theme.colors.text} 
                                size={40} 
                            />
                        </View>
                        <View style={styles.profileInfo}>
                            <Text style={[styles.profileName, { color: theme.colors.text, fontFamily: fonts.Bold }]}>
                                {auth.profile.firstName} {auth.profile.lastName}
                            </Text>
                            <Text style={[styles.profileEmail, { color: theme.colors.text, fontFamily: fonts.Regular }]}>
                                {auth.profile.email}
                            </Text>
                        </View>
                    </View>

                    <TouchableOpacity 
                        style={[styles.editButton, { backgroundColor: MAIN_COLOR }]}
                        onPress={handleEditProfile}
                    >
                        <Icon name="edit" type="material" color="#FFFFFF" size={20} />
                        <Text style={[styles.editButtonText, { fontFamily: fonts.Bold }]}>
                            {t('edit_profile')}
                        </Text>
                    </TouchableOpacity>
                </View>

                {/* Profile Details */}
                <View style={styles.detailsContainer}>
                    <View style={[styles.detailItem, { backgroundColor: theme.colors.card }]}>
                        <Icon name="phone" type="material" color={theme.colors.text} size={24} />
                        <View style={styles.detailContent}>
                            <Text style={[styles.detailLabel, { color: theme.colors.text, fontFamily: fonts.Regular }]}>
                                {t('phone')}
                            </Text>
                            <Text style={[styles.detailValue, { color: theme.colors.text, fontFamily: fonts.Bold }]}>
                                {auth.profile.mobile || t('not_set')}
                            </Text>
                        </View>
                    </View>

                    {settings && settings.imageIdApproval && (
                        <TouchableOpacity 
                            style={[styles.detailItem, { backgroundColor: theme.colors.card }]}
                            onPress={handleVerifyId}
                        >
                            <Icon 
                                name={auth.profile.verifyId ? "verified-user" : "person-outline"} 
                                type="material" 
                                color={auth.profile.verifyId ? MAIN_COLOR : theme.colors.text} 
                                size={24} 
                            />
                            <View style={styles.detailContent}>
                                <Text style={[styles.detailLabel, { color: theme.colors.text, fontFamily: fonts.Regular }]}>
                                    {t('verify_id')}
                                </Text>
                                <Text style={[styles.detailValue, { 
                                    color: auth.profile.verifyId ? MAIN_COLOR : theme.colors.text,
                                    fontFamily: fonts.Bold 
                                }]}>
                                    {auth.profile.verifyId ? t('verified') : t('not_verified')}
                                </Text>
                            </View>
                            <Icon name="chevron-right" type="material" color={theme.colors.text} size={24} />
                        </TouchableOpacity>
                    )}
                </View>

                {/* Convert to Driver Button - Only show for customers */}
                {auth.profile && auth.profile.usertype === 'customer' && (
                    <TouchableOpacity
                        style={styles.convertToDriverButton}
                        onPress={handleConvertToDriver}
                    >
                        <Text style={styles.convertToDriverText}>
                            {t('convert_to_driver')}
                        </Text>
                    </TouchableOpacity>
                )}
            </ScrollView>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 16,
        paddingTop: Platform.OS === 'ios' ? 50 : 40,
        paddingBottom: 16,
        borderBottomWidth: 1,
        borderBottomColor: 'rgba(0,0,0,0.1)',
    },
    headerButton: {
        width: 40,
        height: 40,
        borderRadius: 20,
        justifyContent: 'center',
        alignItems: 'center',
    },
    headerTitle: {
        fontSize: 20,
    },
    headerRightContainer: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    scrollView: {
        flex: 1,
    },
    profileCard: {
        margin: 16,
        padding: 20,
        borderRadius: 12,
        shadowColor: '#000',
        shadowOffset: {
            width: 0,
            height: 2,
        },
        shadowOpacity: 0.1,
        shadowRadius: 4,
        elevation: 3,
    },
    profileHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 20,
    },
    avatarContainer: {
        width: 60,
        height: 60,
        borderRadius: 30,
        backgroundColor: 'rgba(0,0,0,0.1)',
        justifyContent: 'center',
        alignItems: 'center',
        marginRight: 16,
    },
    profileInfo: {
        flex: 1,
    },
    profileName: {
        fontSize: 20,
        marginBottom: 4,
    },
    profileEmail: {
        fontSize: 14,
        opacity: 0.7,
    },
    editButton: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 12,
        borderRadius: 8,
    },
    editButtonText: {
        color: '#FFFFFF',
        fontSize: 16,
        marginLeft: 8,
    },
    detailsContainer: {
        padding: 16,
    },
    detailItem: {
        flexDirection: 'row',
        alignItems: 'center',
        padding: 16,
        borderRadius: 12,
        marginBottom: 12,
    },
    detailContent: {
        flex: 1,
        marginLeft: 16,
    },
    detailLabel: {
        fontSize: 14,
        opacity: 0.7,
        marginBottom: 4,
    },
    detailValue: {
        fontSize: 16,
    },
    convertToDriverButton: {
        backgroundColor: MAIN_COLOR,
        padding: 15,
        borderRadius: 8,
        marginHorizontal: 20,
        marginTop: 20,
        alignItems: 'center',
    },
    convertToDriverText: {
        color: colors.WHITE,
        fontSize: 16,
        fontFamily: fonts.Bold,
    },
});