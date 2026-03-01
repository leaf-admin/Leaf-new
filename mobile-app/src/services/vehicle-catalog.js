/**
 * Catálogo de Veículos Brasileiros
 * 
 * Estrutura canônica para normalização de dados de OCR
 * Baseado em padrão Uber/99 com aliases para variações de OCR
 */

// Catálogo básico (top marcas e modelos brasileiros)
export const VEHICLE_CATALOG = {
    brands: {
        'VW': {
            brand_name: 'Volkswagen',
            aliases: ['VW', 'VOLKSWAGEN', 'V W', 'VOLKS', 'V.W.'],
            models: {
                'SAVEIRO': {
                    model_name: 'Saveiro',
                    aliases: [
                        'SAVEIRO',
                        'VW/SAVEIRO',
                        'VOLKSWAGEN SAVEIRO',
                        'SAVEIRO 1.6',
                        'SAVEIRO ROBUST',
                        'SAVEIRO TRENDLINE',
                        'SAVEIRO CROSS',
                        'SAVEIRO TROPICAL',
                        'NOVA SAVEIRO',
                        'SAVEIRO RB',
                        'SAVEIRO MBVS'
                    ],
                    vehicle_type: 'pickup',
                    accepted_by: ['uber', '99'],
                    years: { min: 2009, max: 2025 }
                },
                'GOL': {
                    model_name: 'Gol',
                    aliases: [
                        'GOL',
                        'VW/GOL',
                        'VOLKSWAGEN GOL',
                        'GOL 1.0',
                        'GOL 1.6',
                        'GOL POWER',
                        'GOL TREND',
                        'GOL COMFORTLINE'
                    ],
                    vehicle_type: 'hatch',
                    accepted_by: ['uber', '99'],
                    years: { min: 2008, max: 2022 }
                },
                'POLO': {
                    model_name: 'Polo',
                    aliases: [
                        'POLO',
                        'VW/POLO',
                        'VOLKSWAGEN POLO',
                        'POLO 1.0',
                        'POLO 1.6',
                        'POLO TREND',
                        'POLO COMFORTLINE',
                        'POLO HIGHLINE'
                    ],
                    vehicle_type: 'hatch',
                    accepted_by: ['uber', '99'],
                    years: { min: 2010, max: 2025 }
                },
                'VOYAGE': {
                    model_name: 'Voyage',
                    aliases: [
                        'VOYAGE',
                        'VW/VOYAGE',
                        'VOLKSWAGEN VOYAGE',
                        'VOYAGE 1.0',
                        'VOYAGE 1.6',
                        'VOYAGE TREND',
                        'VOYAGE COMFORTLINE'
                    ],
                    vehicle_type: 'sedan',
                    accepted_by: ['uber', '99'],
                    years: { min: 2009, max: 2021 }
                },
                'VIRTUS': {
                    model_name: 'Virtus',
                    aliases: [
                        'VIRTUS',
                        'VW/VIRTUS',
                        'VOLKSWAGEN VIRTUS',
                        'VIRTUS 1.0',
                        'VIRTUS 1.6',
                        'VIRTUS TREND',
                        'VIRTUS COMFORTLINE',
                        'VIRTUS HIGHLINE'
                    ],
                    vehicle_type: 'sedan',
                    accepted_by: ['uber', '99'],
                    years: { min: 2018, max: 2025 }
                },
                'JETTA': {
                    model_name: 'Jetta',
                    aliases: [
                        'JETTA',
                        'VW/JETTA',
                        'VOLKSWAGEN JETTA',
                        'JETTA COMFORTLINE',
                        'JETTA HIGHLINE',
                        'JETTA GLI'
                    ],
                    vehicle_type: 'sedan',
                    accepted_by: ['uber', '99'],
                    years: { min: 2010, max: 2025 }
                },
                'TIGUAN': {
                    model_name: 'Tiguan',
                    aliases: [
                        'TIGUAN',
                        'VW/TIGUAN',
                        'VOLKSWAGEN TIGUAN',
                        'TIGUAN COMFORTLINE',
                        'TIGUAN HIGHLINE'
                    ],
                    vehicle_type: 'suv',
                    accepted_by: ['uber', '99'],
                    years: { min: 2015, max: 2025 }
                },
                'AMAROK': {
                    model_name: 'Amarok',
                    aliases: [
                        'AMAROK',
                        'VW/AMAROK',
                        'VOLKSWAGEN AMAROK',
                        'AMAROK TRENDLINE',
                        'AMAROK COMFORTLINE',
                        'AMAROK HIGHLINE'
                    ],
                    vehicle_type: 'pickup',
                    accepted_by: ['uber'],
                    years: { min: 2010, max: 2025 }
                }
            }
        },
        'CHEVROLET': {
            brand_name: 'Chevrolet',
            aliases: ['CHEVROLET', 'CHEV', 'CHEVY', 'GM', 'GENERAL MOTORS'],
            models: {
                'ONIX': {
                    model_name: 'Onix',
                    aliases: [
                        'ONIX',
                        'CHEVROLET ONIX',
                        'ONIX 1.0',
                        'ONIX 1.4',
                        'ONIX ACTIV',
                        'ONIX PREMIER',
                        'ONIX RS'
                    ],
                    vehicle_type: 'hatch',
                    accepted_by: ['uber', '99'],
                    years: { min: 2012, max: 2025 }
                },
                'PRISMA': {
                    model_name: 'Prisma',
                    aliases: [
                        'PRISMA',
                        'CHEVROLET PRISMA',
                        'PRISMA 1.0',
                        'PRISMA 1.4',
                        'PRISMA LT',
                        'PRISMA LTZ'
                    ],
                    vehicle_type: 'sedan',
                    accepted_by: ['uber', '99'],
                    years: { min: 2012, max: 2019 }
                },
                'CRUZE': {
                    model_name: 'Cruze',
                    aliases: [
                        'CRUZE',
                        'CHEVROLET CRUZE',
                        'CRUZE LT',
                        'CRUZE LTZ',
                        'CRUZE PREMIER'
                    ],
                    vehicle_type: 'sedan',
                    accepted_by: ['uber', '99'],
                    years: { min: 2011, max: 2019 }
                },
                'S10': {
                    model_name: 'S10',
                    aliases: [
                        'S10',
                        'CHEVROLET S10',
                        'S10 CABINE DUPLA',
                        'S10 CABINE SIMPLES',
                        'S10 LT',
                        'S10 LTZ'
                    ],
                    vehicle_type: 'pickup',
                    accepted_by: ['uber'],
                    years: { min: 2012, max: 2025 }
                },
                'TRACKER': {
                    model_name: 'Tracker',
                    aliases: [
                        'TRACKER',
                        'CHEVROLET TRACKER',
                        'TRACKER LT',
                        'TRACKER LTZ',
                        'TRACKER ACTIV'
                    ],
                    vehicle_type: 'suv',
                    accepted_by: ['uber', '99'],
                    years: { min: 2019, max: 2025 }
                },
                'SPIN': {
                    model_name: 'Spin',
                    aliases: [
                        'SPIN',
                        'CHEVROLET SPIN',
                        'SPIN LT',
                        'SPIN LTZ'
                    ],
                    vehicle_type: 'van',
                    accepted_by: ['uber'],
                    years: { min: 2012, max: 2021 }
                },
                'COBALT': {
                    model_name: 'Cobalt',
                    aliases: [
                        'COBALT',
                        'CHEVROLET COBALT',
                        'COBALT LT',
                        'COBALT LTZ'
                    ],
                    vehicle_type: 'sedan',
                    accepted_by: ['uber', '99'],
                    years: { min: 2012, max: 2019 }
                }
            }
        },
        'FIAT': {
            brand_name: 'Fiat',
            aliases: ['FIAT', 'FIAT AUTOMOVEIS'],
            models: {
                'UNO': {
                    model_name: 'Uno',
                    aliases: [
                        'UNO',
                        'FIAT UNO',
                        'UNO MILLE',
                        'UNO WAY',
                        'UNO VIVACE',
                        'UNO ATTRACTIVE'
                    ],
                    vehicle_type: 'hatch',
                    accepted_by: ['uber', '99'],
                    years: { min: 2010, max: 2021 }
                },
                'PALIO': {
                    model_name: 'Palio',
                    aliases: [
                        'PALIO',
                        'FIAT PALIO',
                        'PALIO FIRE',
                        'PALIO ATTRACTIVE',
                        'PALIO ADVENTURE'
                    ],
                    vehicle_type: 'hatch',
                    accepted_by: ['uber', '99'],
                    years: { min: 2012, max: 2017 }
                },
                'MOBI': {
                    model_name: 'Mobi',
                    aliases: [
                        'MOBI',
                        'FIAT MOBI',
                        'MOBI LIKE',
                        'MOBI EASY',
                        'MOBI TREKKING'
                    ],
                    vehicle_type: 'hatch',
                    accepted_by: ['uber', '99'],
                    years: { min: 2016, max: 2025 }
                },
                'ARGO': {
                    model_name: 'Argo',
                    aliases: [
                        'ARGO',
                        'FIAT ARGO',
                        'ARGO DRIVE',
                        'ARGO TREKKING',
                        'ARGO HGT'
                    ],
                    vehicle_type: 'hatch',
                    accepted_by: ['uber', '99'],
                    years: { min: 2017, max: 2025 }
                },
                'CRONOS': {
                    model_name: 'Cronos',
                    aliases: [
                        'CRONOS',
                        'FIAT CRONOS',
                        'CRONOS DRIVE',
                        'CRONOS PRECISION',
                        'CRONOS HGT'
                    ],
                    vehicle_type: 'sedan',
                    accepted_by: ['uber', '99'],
                    years: { min: 2018, max: 2025 }
                },
                'PULSE': {
                    model_name: 'Pulse',
                    aliases: [
                        'PULSE',
                        'FIAT PULSE',
                        'PULSE DRIVE',
                        'PULSE AUDACE',
                        'PULSE IMPETUS'
                    ],
                    vehicle_type: 'suv',
                    accepted_by: ['uber', '99'],
                    years: { min: 2021, max: 2025 }
                },
                'FASTBACK': {
                    model_name: 'Fastback',
                    aliases: [
                        'FASTBACK',
                        'FIAT FASTBACK',
                        'FASTBACK DRIVE',
                        'FASTBACK AUDACE',
                        'FASTBACK IMPETUS'
                    ],
                    vehicle_type: 'coupe',
                    accepted_by: ['uber', '99'],
                    years: { min: 2022, max: 2025 }
                },
                'TORO': {
                    model_name: 'Toro',
                    aliases: [
                        'TORO',
                        'FIAT TORO',
                        'TORO FREEDOM',
                        'TORO VOLCANO',
                        'TORO RANCH'
                    ],
                    vehicle_type: 'pickup',
                    accepted_by: ['uber'],
                    years: { min: 2016, max: 2025 }
                }
            }
        },
        'TOYOTA': {
            brand_name: 'Toyota',
            aliases: ['TOYOTA'],
            models: {
                'COROLLA': {
                    model_name: 'Corolla',
                    aliases: [
                        'COROLLA',
                        'TOYOTA COROLLA',
                        'COROLLA XEI',
                        'COROLLA XLI',
                        'COROLLA ALTIS'
                    ],
                    vehicle_type: 'sedan',
                    accepted_by: ['uber', '99'],
                    years: { min: 2009, max: 2025 }
                },
                'ETIOS': {
                    model_name: 'Etios',
                    aliases: [
                        'ETIOS',
                        'TOYOTA ETIOS',
                        'ETIOS SEDAN',
                        'ETIOS HATCH',
                        'ETIOS X',
                        'ETIOS XS'
                    ],
                    vehicle_type: 'hatch',
                    accepted_by: ['uber', '99'],
                    years: { min: 2012, max: 2021 }
                },
                'YARIS': {
                    model_name: 'Yaris',
                    aliases: [
                        'YARIS',
                        'TOYOTA YARIS',
                        'YARIS S',
                        'YARIS XS',
                        'YARIS XLS'
                    ],
                    vehicle_type: 'hatch',
                    accepted_by: ['uber', '99'],
                    years: { min: 2014, max: 2025 }
                },
                'HILUX': {
                    model_name: 'Hilux',
                    aliases: [
                        'HILUX',
                        'TOYOTA HILUX',
                        'HILUX CD',
                        'HILUX SRV',
                        'HILUX SRX'
                    ],
                    vehicle_type: 'pickup',
                    accepted_by: ['uber'],
                    years: { min: 2009, max: 2025 }
                },
                'SW4': {
                    model_name: 'SW4',
                    aliases: [
                        'SW4',
                        'TOYOTA SW4',
                        'SW4 SRX',
                        'SW4 SRV'
                    ],
                    vehicle_type: 'suv',
                    accepted_by: ['uber', '99'],
                    years: { min: 2010, max: 2025 }
                }
            }
        },
        'HONDA': {
            brand_name: 'Honda',
            aliases: ['HONDA'],
            models: {
                'CIVIC': {
                    model_name: 'Civic',
                    aliases: [
                        'CIVIC',
                        'HONDA CIVIC',
                        'CIVIC EX',
                        'CIVIC EXL',
                        'CIVIC TOURING'
                    ],
                    vehicle_type: 'sedan',
                    accepted_by: ['uber', '99'],
                    years: { min: 2009, max: 2025 }
                },
                'FIT': {
                    model_name: 'Fit',
                    aliases: [
                        'FIT',
                        'HONDA FIT',
                        'FIT EX',
                        'FIT EXL',
                        'FIT LX'
                    ],
                    vehicle_type: 'hatch',
                    accepted_by: ['uber', '99'],
                    years: { min: 2009, max: 2021 }
                },
                'HRV': {
                    model_name: 'HR-V',
                    aliases: [
                        'HRV',
                        'HR-V',
                        'HONDA HRV',
                        'HONDA HR-V',
                        'HRV EX',
                        'HRV EXL',
                        'HRV TOURING'
                    ],
                    vehicle_type: 'suv',
                    accepted_by: ['uber', '99'],
                    years: { min: 2015, max: 2025 }
                },
                'WRV': {
                    model_name: 'WR-V',
                    aliases: [
                        'WRV',
                        'WR-V',
                        'HONDA WRV',
                        'HONDA WR-V',
                        'WRV EX',
                        'WRV EXL'
                    ],
                    vehicle_type: 'suv',
                    accepted_by: ['uber', '99'],
                    years: { min: 2017, max: 2021 }
                }
            }
        },
        'FORD': {
            brand_name: 'Ford',
            aliases: ['FORD'],
            models: {
                'KA': {
                    model_name: 'Ka',
                    aliases: [
                        'KA',
                        'FORD KA',
                        'KA SE',
                        'KA SEL',
                        'KA FREESTYLE'
                    ],
                    vehicle_type: 'hatch',
                    accepted_by: ['uber', '99'],
                    years: { min: 2014, max: 2021 }
                },
                'FUSION': {
                    model_name: 'Fusion',
                    aliases: [
                        'FUSION',
                        'FORD FUSION',
                        'FUSION SE',
                        'FUSION SEL',
                        'FUSION TITANIUM'
                    ],
                    vehicle_type: 'sedan',
                    accepted_by: ['uber', '99'],
                    years: { min: 2013, max: 2020 }
                },
                'ECOSPORT': {
                    model_name: 'EcoSport',
                    aliases: [
                        'ECOSPORT',
                        'FORD ECOSPORT',
                        'ECOSPORT XLS',
                        'ECOSPORT XLT',
                        'ECOSPORT TITANIUM'
                    ],
                    vehicle_type: 'suv',
                    accepted_by: ['uber', '99'],
                    years: { min: 2012, max: 2021 }
                },
                'RANGER': {
                    model_name: 'Ranger',
                    aliases: [
                        'RANGER',
                        'FORD RANGER',
                        'RANGER XL',
                        'RANGER XLS',
                        'RANGER XLT'
                    ],
                    vehicle_type: 'pickup',
                    accepted_by: ['uber'],
                    years: { min: 2012, max: 2025 }
                }
            }
        },
        'HYUNDAI': {
            brand_name: 'Hyundai',
            aliases: ['HYUNDAI'],
            models: {
                'HB20': {
                    model_name: 'HB20',
                    aliases: [
                        'HB20',
                        'HYUNDAI HB20',
                        'HB20 COMFORT',
                        'HB20 COMFORT PLUS',
                        'HB20 STYLE',
                        'HB20 VISION'
                    ],
                    vehicle_type: 'hatch',
                    accepted_by: ['uber', '99'],
                    years: { min: 2012, max: 2025 }
                },
                'HB20S': {
                    model_name: 'HB20S',
                    aliases: [
                        'HB20S',
                        'HB20 S',
                        'HYUNDAI HB20S',
                        'HB20S COMFORT',
                        'HB20S COMFORT PLUS',
                        'HB20S STYLE',
                        'HB20S VISION'
                    ],
                    vehicle_type: 'sedan',
                    accepted_by: ['uber', '99'],
                    years: { min: 2012, max: 2025 }
                },
                'CRETA': {
                    model_name: 'Creta',
                    aliases: [
                        'CRETA',
                        'HYUNDAI CRETA',
                        'CRETA COMFORT',
                        'CRETA COMFORT PLUS',
                        'CRETA STYLE'
                    ],
                    vehicle_type: 'suv',
                    accepted_by: ['uber', '99'],
                    years: { min: 2017, max: 2025 }
                },
                'TUCSON': {
                    model_name: 'Tucson',
                    aliases: [
                        'TUCSON',
                        'HYUNDAI TUCSON',
                        'TUCSON GL',
                        'TUCSON GLS',
                        'TUCSON LIMITED'
                    ],
                    vehicle_type: 'suv',
                    accepted_by: ['uber', '99'],
                    years: { min: 2015, max: 2025 }
                },
                'IX35': {
                    model_name: 'ix35',
                    aliases: [
                        'IX35',
                        'IX 35',
                        'HYUNDAI IX35',
                        'HYUNDAI IX 35',
                        'IX35 GL',
                        'IX35 GLS'
                    ],
                    vehicle_type: 'suv',
                    accepted_by: ['uber', '99'],
                    years: { min: 2010, max: 2015 }
                }
            }
        },
        'NISSAN': {
            brand_name: 'Nissan',
            aliases: ['NISSAN'],
            models: {
                'MARCH': {
                    model_name: 'March',
                    aliases: [
                        'MARCH',
                        'NISSAN MARCH',
                        'MARCH S',
                        'MARCH SV',
                        'MARCH SL'
                    ],
                    vehicle_type: 'hatch',
                    accepted_by: ['uber', '99'],
                    years: { min: 2012, max: 2021 }
                },
                'VERSA': {
                    model_name: 'Versa',
                    aliases: [
                        'VERSA',
                        'NISSAN VERSA',
                        'VERSA S',
                        'VERSA SV',
                        'VERSA SL'
                    ],
                    vehicle_type: 'sedan',
                    accepted_by: ['uber', '99'],
                    years: { min: 2014, max: 2025 }
                },
                'SENTRA': {
                    model_name: 'Sentra',
                    aliases: [
                        'SENTRA',
                        'NISSAN SENTRA',
                        'SENTRA S',
                        'SENTRA SV',
                        'SENTRA SL'
                    ],
                    vehicle_type: 'sedan',
                    accepted_by: ['uber', '99'],
                    years: { min: 2014, max: 2025 }
                },
                'KICKS': {
                    model_name: 'Kicks',
                    aliases: [
                        'KICKS',
                        'NISSAN KICKS',
                        'KICKS S',
                        'KICKS SV',
                        'KICKS SL'
                    ],
                    vehicle_type: 'suv',
                    accepted_by: ['uber', '99'],
                    years: { min: 2017, max: 2025 }
                }
            }
        },
        'RENAULT': {
            brand_name: 'Renault',
            aliases: ['RENAULT'],
            models: {
                'KWID': {
                    model_name: 'Kwid',
                    aliases: [
                        'KWID',
                        'RENAULT KWID',
                        'KWID ZEN',
                        'KWID INTENSE',
                        'KWID OUTSIDER'
                    ],
                    vehicle_type: 'hatch',
                    accepted_by: ['uber', '99'],
                    years: { min: 2017, max: 2025 }
                },
                'LOGAN': {
                    model_name: 'Logan',
                    aliases: [
                        'LOGAN',
                        'RENAULT LOGAN',
                        'LOGAN AUTHENTIQUE',
                        'LOGAN EXPRESSION',
                        'LOGAN INTENS'
                    ],
                    vehicle_type: 'sedan',
                    accepted_by: ['uber', '99'],
                    years: { min: 2012, max: 2021 }
                },
                'SANDERO': {
                    model_name: 'Sandero',
                    aliases: [
                        'SANDERO',
                        'RENAULT SANDERO',
                        'SANDERO AUTHENTIQUE',
                        'SANDERO EXPRESSION',
                        'SANDERO INTENS'
                    ],
                    vehicle_type: 'hatch',
                    accepted_by: ['uber', '99'],
                    years: { min: 2012, max: 2025 }
                },
                'DUSTER': {
                    model_name: 'Duster',
                    aliases: [
                        'DUSTER',
                        'RENAULT DUSTER',
                        'DUSTER AUTHENTIQUE',
                        'DUSTER EXPRESSION',
                        'DUSTER INTENS'
                    ],
                    vehicle_type: 'suv',
                    accepted_by: ['uber', '99'],
                    years: { min: 2012, max: 2025 }
                },
                'CAPTUR': {
                    model_name: 'Captur',
                    aliases: [
                        'CAPTUR',
                        'RENAULT CAPTUR',
                        'CAPTUR ZEN',
                        'CAPTUR INTENSE',
                        'CAPTUR BOSE'
                    ],
                    vehicle_type: 'suv',
                    accepted_by: ['uber', '99'],
                    years: { min: 2017, max: 2025 }
                }
            }
        },
        'PEUGEOT': {
            brand_name: 'Peugeot',
            aliases: ['PEUGEOT'],
            models: {
                '208': {
                    model_name: '208',
                    aliases: [
                        '208',
                        'PEUGEOT 208',
                        '208 ACTIVE',
                        '208 ALLURE',
                        '208 GRIFFE'
                    ],
                    vehicle_type: 'hatch',
                    accepted_by: ['uber', '99'],
                    years: { min: 2013, max: 2025 }
                },
                '2008': {
                    model_name: '2008',
                    aliases: [
                        '2008',
                        'PEUGEOT 2008',
                        '2008 ACTIVE',
                        '2008 ALLURE',
                        '2008 GRIFFE'
                    ],
                    vehicle_type: 'suv',
                    accepted_by: ['uber', '99'],
                    years: { min: 2014, max: 2025 }
                },
                '3008': {
                    model_name: '3008',
                    aliases: [
                        '3008',
                        'PEUGEOT 3008',
                        '3008 ACTIVE',
                        '3008 ALLURE',
                        '3008 GRIFFE'
                    ],
                    vehicle_type: 'suv',
                    accepted_by: ['uber', '99'],
                    years: { min: 2017, max: 2025 }
                }
            }
        },
        'CITROEN': {
            brand_name: 'Citroën',
            aliases: ['CITROEN', 'CITROËN'],
            models: {
                'C3': {
                    model_name: 'C3',
                    aliases: [
                        'C3',
                        'CITROEN C3',
                        'CITROËN C3',
                        'C3 LIVE',
                        'C3 FEEL',
                        'C3 SHINE'
                    ],
                    vehicle_type: 'hatch',
                    accepted_by: ['uber', '99'],
                    years: { min: 2017, max: 2025 }
                },
                'C4': {
                    model_name: 'C4',
                    aliases: [
                        'C4',
                        'CITROEN C4',
                        'CITROËN C4',
                        'C4 LIVE',
                        'C4 FEEL',
                        'C4 SHINE'
                    ],
                    vehicle_type: 'sedan',
                    accepted_by: ['uber', '99'],
                    years: { min: 2013, max: 2021 }
                },
                'C4CACTUS': {
                    model_name: 'C4 Cactus',
                    aliases: [
                        'C4CACTUS',
                        'C4 CACTUS',
                        'CITROEN C4 CACTUS',
                        'C4 CACTUS LIVE',
                        'C4 CACTUS FEEL',
                        'C4 CACTUS SHINE'
                    ],
                    vehicle_type: 'suv',
                    accepted_by: ['uber', '99'],
                    years: { min: 2017, max: 2021 }
                }
            }
        },
        'JEEP': {
            brand_name: 'Jeep',
            aliases: ['JEEP'],
            models: {
                'RENEGADE': {
                    model_name: 'Renegade',
                    aliases: [
                        'RENEGADE',
                        'JEEP RENEGADE',
                        'RENEGADE SPORT',
                        'RENEGADE LONGITUDE',
                        'RENEGADE LIMITED'
                    ],
                    vehicle_type: 'suv',
                    accepted_by: ['uber', '99'],
                    years: { min: 2015, max: 2025 }
                },
                'COMPASS': {
                    model_name: 'Compass',
                    aliases: [
                        'COMPASS',
                        'JEEP COMPASS',
                        'COMPASS SPORT',
                        'COMPASS LONGITUDE',
                        'COMPASS LIMITED'
                    ],
                    vehicle_type: 'suv',
                    accepted_by: ['uber', '99'],
                    years: { min: 2017, max: 2025 }
                },
                'COMMANDER': {
                    model_name: 'Commander',
                    aliases: [
                        'COMMANDER',
                        'JEEP COMMANDER',
                        'COMMANDER SPORT',
                        'COMMANDER LONGITUDE',
                        'COMMANDER LIMITED'
                    ],
                    vehicle_type: 'suv',
                    accepted_by: ['uber', '99'],
                    years: { min: 2021, max: 2025 }
                }
            }
        },
        'KIA': {
            brand_name: 'Kia',
            aliases: ['KIA'],
            models: {
                'PICANTO': {
                    model_name: 'Picanto',
                    aliases: [
                        'PICANTO',
                        'KIA PICANTO',
                        'PICANTO EX',
                        'PICANTO LX'
                    ],
                    vehicle_type: 'hatch',
                    accepted_by: ['uber', '99'],
                    years: { min: 2012, max: 2021 }
                },
                'RIO': {
                    model_name: 'Rio',
                    aliases: [
                        'RIO',
                        'KIA RIO',
                        'RIO EX',
                        'RIO LX',
                        'RIO SX'
                    ],
                    vehicle_type: 'sedan',
                    accepted_by: ['uber', '99'],
                    years: { min: 2012, max: 2021 }
                },
                'SPORTAGE': {
                    model_name: 'Sportage',
                    aliases: [
                        'SPORTAGE',
                        'KIA SPORTAGE',
                        'SPORTAGE EX',
                        'SPORTAGE LX',
                        'SPORTAGE SX'
                    ],
                    vehicle_type: 'suv',
                    accepted_by: ['uber', '99'],
                    years: { min: 2016, max: 2025 }
                }
            }
        },
        'MITSUBISHI': {
            brand_name: 'Mitsubishi',
            aliases: ['MITSUBISHI'],
            models: {
                'L200': {
                    model_name: 'L200',
                    aliases: [
                        'L200',
                        'MITSUBISHI L200',
                        'L200 TRITON',
                        'L200 OUTSIDER'
                    ],
                    vehicle_type: 'pickup',
                    accepted_by: ['uber'],
                    years: { min: 2010, max: 2025 }
                },
                'PAJERO': {
                    model_name: 'Pajero',
                    aliases: [
                        'PAJERO',
                        'MITSUBISHI PAJERO',
                        'PAJERO SPORT',
                        'PAJERO FULL'
                    ],
                    vehicle_type: 'suv',
                    accepted_by: ['uber', '99'],
                    years: { min: 2010, max: 2021 }
                }
            }
        },
        'SUZUKI': {
            brand_name: 'Suzuki',
            aliases: ['SUZUKI'],
            models: {
                'SWIFT': {
                    model_name: 'Swift',
                    aliases: [
                        'SWIFT',
                        'SUZUKI SWIFT',
                        'SWIFT GL',
                        'SWIFT GLS'
                    ],
                    vehicle_type: 'hatch',
                    accepted_by: ['uber', '99'],
                    years: { min: 2014, max: 2021 }
                },
                'SX4': {
                    model_name: 'SX4',
                    aliases: [
                        'SX4',
                        'SUZUKI SX4',
                        'SX4 GL',
                        'SX4 GLS'
                    ],
                    vehicle_type: 'suv',
                    accepted_by: ['uber', '99'],
                    years: { min: 2014, max: 2018 }
                }
            }
        }
    }
};

/**
 * Normaliza marca usando catálogo
 * @param {string} rawBrand - Marca extraída do OCR
 * @returns {{brand_code: string, brand_name: string, confidence: number} | null}
 */
export function normalizeBrand(rawBrand) {
    if (!rawBrand) return null;
    
    const normalized = rawBrand.toUpperCase().trim();
    
    // Buscar no catálogo
    for (const [brandCode, brandData] of Object.entries(VEHICLE_CATALOG.brands)) {
        // Match exato
        if (brandCode === normalized || brandData.brand_name.toUpperCase() === normalized) {
            return {
                brand_code: brandCode,
                brand_name: brandData.brand_name,
                confidence: 1.0
            };
        }
        
        // Match por alias
        if (brandData.aliases.some(alias => alias === normalized)) {
            return {
                brand_code: brandCode,
                brand_name: brandData.brand_name,
                confidence: 0.95
            };
        }
        
        // Match parcial (contém)
        if (brandData.aliases.some(alias => normalized.includes(alias) || alias.includes(normalized))) {
            return {
                brand_code: brandCode,
                brand_name: brandData.brand_name,
                confidence: 0.85
            };
        }
    }
    
    return null;
}

/**
 * Normaliza modelo usando catálogo
 * @param {string} rawModel - Modelo extraído do OCR
 * @param {string} brandCode - Código da marca (opcional, para busca mais precisa)
 * @returns {{model_code: string, model_name: string, confidence: number} | null}
 */
export function normalizeModel(rawModel, brandCode = null) {
    if (!rawModel) return null;
    
    const normalized = rawModel.toUpperCase().trim();
    
    // Se tem brandCode, buscar apenas nessa marca
    const brandsToSearch = brandCode 
        ? [[brandCode, VEHICLE_CATALOG.brands[brandCode]]].filter(Boolean)
        : Object.entries(VEHICLE_CATALOG.brands);
    
    for (const [brandCode, brandData] of brandsToSearch) {
        if (!brandData?.models) continue;
        
        for (const [modelCode, modelData] of Object.entries(brandData.models)) {
            // Match exato
            if (modelCode === normalized || modelData.model_name.toUpperCase() === normalized) {
                return {
                    model_code: modelCode,
                    model_name: modelData.model_name,
                    confidence: 1.0,
                    vehicle_type: modelData.vehicle_type
                };
            }
            
            // Match por alias
            if (modelData.aliases.some(alias => alias === normalized)) {
                return {
                    model_code: modelCode,
                    model_name: modelData.model_name,
                    confidence: 0.95,
                    vehicle_type: modelData.vehicle_type
                };
            }
            
            // Match parcial (contém)
            if (modelData.aliases.some(alias => {
                const aliasNorm = alias.toUpperCase();
                const modelNorm = normalized;
                return modelNorm.includes(aliasNorm) || aliasNorm.includes(modelNorm);
            })) {
                return {
                    model_code: modelCode,
                    model_name: modelData.model_name,
                    confidence: 0.85,
                    vehicle_type: modelData.vehicle_type
                };
            }
        }
    }
    
    return null;
}

/**
 * Normaliza dados completos do veículo
 * @param {Object} rawData - Dados extraídos do OCR
 * @returns {Object} Dados normalizados
 */
export function normalizeVehicleData(rawData) {
    const result = {
        // Dados canônicos
        brand_code: null,
        brand_name: null,
        model_code: null,
        model_name: null,
        vehicle_type: null,
        
        // Dados originais (para auditoria)
        raw_brand: rawData.marca || rawData.brand,
        raw_model: rawData.modelo || rawData.model,
        
        // Outros campos (já normalizados)
        year: rawData.ano,
        plate: rawData.placa,
        renavam: rawData.renavam,
        chassi: rawData.chassi,
        uf: rawData.uf,
        cor: rawData.cor, // Cor do veículo
        
        // Metadados
        confidence: 0.0,
        needs_manual_review: false,
        source: 'ocr'
    };
    
    // Normalizar marca
    const brandNorm = normalizeBrand(result.raw_brand);
    if (brandNorm) {
        result.brand_code = brandNorm.brand_code;
        result.brand_name = brandNorm.brand_name;
        result.confidence = Math.max(result.confidence, brandNorm.confidence);
    }
    
    // Normalizar modelo (usando marca se disponível)
    const modelNorm = normalizeModel(result.raw_model, result.brand_code);
    if (modelNorm) {
        result.model_code = modelNorm.model_code;
        result.model_name = modelNorm.model_name;
        result.vehicle_type = modelNorm.vehicle_type || rawData.vehicleType;
        result.confidence = Math.max(result.confidence, modelNorm.confidence);
    }
    
    // Determinar se precisa revisão manual
    result.needs_manual_review = result.confidence < 0.85 || !result.brand_code || !result.model_code;
    
    return result;
}

