import React from 'react';
import { Button, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { FONT_FAMILY } from 'common/sharedFunctions';
import { MAIN_COLOR } from 'common/sharedFunctions';

const GoBackButton = ({ isRTL, onClick, style }) => {
    const { t } = useTranslation();

    return (
        <div dir={isRTL === "rtl" ? "rtl" : "ltr"} style={{ ...style }}>
            <Button variant="text" onClick={onClick} >
                <Typography
                    style={{
                        marginBottom: "10px 10px 0 5px",
                        textAlign: isRTL === "rtl" ? "right" : "left",
                        fontWeight: "bold",
                        color: MAIN_COLOR,
                        fontFamily:FONT_FAMILY
                    }}
                >
                    {`<<- ${t("go_back")}`}
                </Typography>
            </Button>
        </div>
    );
};

export default GoBackButton;