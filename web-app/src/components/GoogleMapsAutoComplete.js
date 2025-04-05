import React, { useState, useEffect, useMemo } from 'react';
import TextField from '@mui/material/TextField';
import { Autocomplete } from '@mui/material';
import LocationOnIcon from '@mui/icons-material/LocationOn';
import Grid from '@mui/material/Grid';
import Typography from '@mui/material/Typography';
import { makeStyles } from '@mui/styles';
import parse from 'autosuggest-highlight/parse';
import throttle from 'lodash/throttle';
import { geocodeByPlaceId } from 'react-places-autocomplete';
import { useTranslation } from "react-i18next";
import { useSelector } from "react-redux";
import Box from '@mui/material/Box';
import { MAIN_COLOR, FONT_FAMILY } from "../common/sharedFunctions";
import { api } from 'common';
import uuid from 'react-native-uuid';


const useStyles = makeStyles((theme) => ({
  icon: {
    color: theme.palette.text.secondary,
    marginRight: theme.spacing(2),
  },
  inputRtl: {
    "& label": {
      right: 75,
      left: "auto",
      fontFamily: FONT_FAMILY,
    },
  },
  textField: {
    "& label.Mui-focused": {
      color: MAIN_COLOR,
    },
    "& .MuiOutlinedInput-root": {
      "&.Mui-focused fieldset": {
        borderColor: MAIN_COLOR,
      },
    },
    "& input": {
      fontFamily: FONT_FAMILY,
    },
  },
}));

export default function GoogleMapsAutoComplete(props) {
  const classes = useStyles();
  const [value, setValue] = useState(null);
  const [inputValue, setInputValue] = useState('');
  const [options, setOptions] = useState([]);
  const { t, i18n } = useTranslation();
  const isRTL = i18n.dir() === 'rtl';
  const settingsdata = useSelector(state => state.settingsdata);
  const [settings, setSettings] = useState({});
  const {
    fetchPlacesAutocomplete
  } = api;
  const [UUID, setUUID] = useState();

  useEffect(()=>{
    const uuidv4 = uuid.v4()
    setUUID(uuidv4);
    return () => {
      setUUID(null);
    };
  },[]);


  useEffect(() => {
    if (settingsdata.settings) {
      setSettings(settingsdata.settings);
    }
  }, [settingsdata.settings]);

  const fetch = useMemo(
    () => throttle(async (searchKeyword, callback) => {
      if (searchKeyword) {
        const results = await fetchPlacesAutocomplete(searchKeyword, UUID);
        callback(results || []);
      }
    }, 200),
    [fetchPlacesAutocomplete]
  );

  useEffect(() => {
    let active = true;

    if (inputValue === '') {
      setOptions(value ? [value] : []);
      return;
    }

    fetch(inputValue, (results) => {
      if (active) {
        let newOptions = value ? [value] : [];
        if (results) {
          newOptions = [...newOptions, ...results];
        }
        setOptions(newOptions);
      }
    });

    return () => {
      active = false;
    };
  }, [value, inputValue, fetch]);

  return (
    <Autocomplete
      style={props.style}
      getOptionLabel={(option) => (typeof option === 'string' ? option : option.description)}
      filterOptions={(x) => x}
      options={options}
      autoComplete
      includeInputInList
      filterSelectedOptions
      value={props.value}
      onChange={(event, newValue) => {
        setOptions(newValue ? [newValue, ...options] : options);
        setValue(newValue);
        if (newValue && newValue.place_id) {
          geocodeByPlaceId(newValue.place_id)
            .then(results => {
              if (results.length > 0) {
                newValue.coords = { lat: results[0].geometry.location.lat(), lng: results[0].geometry.location.lng() };
                newValue.placeDetails = results[0];
              }
              props.onChange(newValue);
            })
            .catch(() => alert(t('google_places_error')));
        } else {
          props.onChange(newValue);
        }
      }}
      onInputChange={(event, newInputValue) => {
        setInputValue(newInputValue);
      }}
      renderInput={(params) => (
        <TextField
          {...params}
          label={props.placeholder}
          variant={props.variant}
          className={[isRTL ? classes.inputRtl : '', classes.textField].join(" ")}
          fullWidth
        />
      )}
      renderOption={(props, option) => (
        <li {...props}>
          <Grid container alignItems="center">
            <Grid item sx={{ display: 'flex', width: 44 }}>
              <LocationOnIcon sx={{ color: 'text.secondary' }} />
            </Grid>
            <Grid item sx={{ width: 'calc(100% - 44px)', wordWrap: 'break-word' }}>
              <Typography variant="body1" sx={{ fontFamily: FONT_FAMILY }}>
                {option.description || "No description"}
              </Typography>
            </Grid>
          </Grid>
        </li>
      )}
    />
  );
}