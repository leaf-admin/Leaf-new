import React, { useState, useEffect } from 'react';
import { Grid, Typography, Button, Box } from '@mui/material';
import backgroundImage from '../assets/img/background.jpg';
import useStyles from '../styles/styles';
import { useTranslation } from "react-i18next";
import { useNavigate } from 'react-router-dom';
import { calcEst, showEst, optionsRequired, FONT_FAMILY } from '../common/sharedFunctions';
import { colors as col } from "../components/Theme/WebTheme";
import AsyncStorage from '@react-native-async-storage/async-storage';

const Hero = (props) => {
    const classes = useStyles();
    const { t, i18n } = useTranslation();
    const isRTL = i18n.dir();
    const navigate = useNavigate();
    const role = props.role;
    const [loggedIn, setLoggedIn] = useState(false);
    const [authState, setAuthState] = useState({ profile: null });

    useEffect(() => {
        const checkAuth = async () => {
            try {
                const userData = await AsyncStorage.getItem('@user_data');
                if (userData) {
                    const profile = JSON.parse(userData);
                    setAuthState({ profile });
                    setLoggedIn(!!profile.uid);
                }
            } catch (error) {
                console.error('Erro ao verificar autenticação:', error);
            }
        };

        checkAuth();
    }, []);

    return (
        <Box 
            className={classes.heroBox} 
            sx={{ backgroundImage: `url(${backgroundImage})`, backgroundSize: 'cover' }} 
            style={{ direction: isRTL === 'rtl' ? 'rtl' : 'ltr' }}
        >
            <Grid container spacing={12} className={classes.gridContainer}>
                <Grid item xs={12} md={7}>
                    <Typography 
                        variant="h3" 
                        fontWeight={500} 
                        className={classes.titleMain} 
                        style={{ color: col.CAR_BOX_ODD, fontFamily: FONT_FAMILY }}
                    >
                        {t('book_your_title')}
                    </Typography>
                    <Typography 
                        variant="h6" 
                        className={classes.subtitleMain} 
                        style={{ color: 'white', fontFamily: FONT_FAMILY }}
                    >
                        {t('about_us_content2')}
                    </Typography>
                    <Button
                        variant="contained"
                        color="primary"
                        sx={{ width: '200px', fontSize: '16px', fontFamily: FONT_FAMILY }}
                        onClick={(e) => {
                            e.preventDefault();
                            if (loggedIn) {
                                navigate(
                                    ((role && role === 'driver') || 
                                    (calcEst && !showEst && !optionsRequired && 
                                    (role === 'admin' || role === 'fleetadmin'))) 
                                        ? '/bookings' 
                                        : '/addbookings'
                                );
                            } else {
                                navigate('/login');
                            }
                        }}
                    >
                        {role === 'driver' || 
                        (calcEst && !showEst && !optionsRequired && 
                        (role === 'admin' || role === 'fleetadmin')) 
                            ? t('info') 
                            : t('book_your_ride_menu')}
                    </Button>
                </Grid>
            </Grid>
        </Box>
    );
};

export default Hero;
