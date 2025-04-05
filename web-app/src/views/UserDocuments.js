import React, { useState, useEffect, useCallback } from "react";
import { Typography, Grid, Card, Avatar, Button } from "@mui/material";
import { useParams, useNavigate, useLocation } from "react-router-dom";
import { useSelector, useDispatch } from "react-redux";
import { useTranslation } from "react-i18next";
import { colors } from "../components/Theme/WebTheme";
import CircularLoading from "../components/CircularLoading";
import FileUploadIcon from "@mui/icons-material/FileUpload";
import AlertDialog from "../components/AlertDialog";
import { api } from "common";
import { MAIN_COLOR, SECONDORY_COLOR, FONT_FAMILY } from "../common/sharedFunctions";
import { makeStyles } from "@mui/styles";
import GoBackButton from "components/GoBackButton";

const useStyles = makeStyles((theme) => ({
  card: {
    borderRadius: "10px",
    backgroundColor: SECONDORY_COLOR,
    minHeight: 60,
    minWidth: 300,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    textAlign: "center",
    padding: 2,
    marginBottom: 10,
    boxShadow: `0px 2px 5px ${MAIN_COLOR}`,
  },
  avatar: {
    width: 300,
    height: 250,
    display: "flex",
    flexDirection: "column",
    boxShadow: 3,
    border: `2px dashed ${colors.TABLE_BORDER}`,
    fontSize: 16,
    background: "none",
    color: "inherit",
    fontWeight: "bold",
  },
  buttonStyle: {
    borderRadius: "19px",
    minHeight: 50,
    minWidth: 150,
    marginBottom: 20,
    marginTop: 20,
    textAlign: "center",
    cursor: "pointer",
    boxShadow: `0px 2px 5px ${SECONDORY_COLOR}`,
    fontFamily: FONT_FAMILY,
    "&:hover": {
      backgroundColor: MAIN_COLOR,
    },
  }
}));

function UserDocuments() {
  const { id, rId } = useParams();
  const { t, i18n } = useTranslation();
  const isRTL = i18n.dir();
  const navigate = useNavigate();
  const { state } = useLocation();
  const dispatch = useDispatch();
  const settings = useSelector((state) => state.settingsdata.settings);
  const staticusers = useSelector((state) => state.usersdata.staticusers);
  const { fetchUsersOnce, updateLicenseImage } = api;
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [editable, setEditable] = useState(false);
  const [images, setImages] = useState({
    idImage: null,
    licenseImageFront: null,
    licenseImageBack: null
  });
  const [commonAlert, setCommonAlert] = useState({ open: false, msg: "" });
  const classes = useStyles();

  useEffect(() => {
    dispatch(fetchUsersOnce());
  }, [dispatch, fetchUsersOnce]);

  useEffect(() => {
    if (staticusers) {
      const user = staticusers.find((user) => user.id === id.toString());
      if (!user) {
        navigate("/404");
      } else {
        setData(user);
      }
    }
  }, [staticusers, id, navigate]);

  const handleImageChange = useCallback((field) => (e) => {
    setImages(prev => ({ ...prev, [field]: e.target.files[0] }));
  }, []);

  const handleSaveUser = useCallback(() => {
    setLoading(true);
    let isAnyIdUploaded = false;
    if (settings.AllowCriticalEditsAdmin) {
      Object.entries(images).forEach(([field, image]) => {
        if (image) {
          isAnyIdUploaded = true;
          dispatch(updateLicenseImage(data.id, image, field));
        }
      });
      if (!isAnyIdUploaded) {
        setCommonAlert({ open: true, msg: t("no_doc_uploaded") });
      }
      setTimeout(() => {
        setImages({ idImage: null, licenseImageFront: null, licenseImageBack: null });
        setEditable(false);
        setLoading(false);
        dispatch(fetchUsersOnce());
      }, 3000);
    } else {
      setCommonAlert({ open: true, msg: t("demo_mode") });
      setLoading(false);
    }
  }, [settings.AllowCriticalEditsAdmin, images, data.id, dispatch, t, fetchUsersOnce, updateLicenseImage]);

  const handleCancel = useCallback(() => {
    setImages({ idImage: null, licenseImageFront: null, licenseImageBack: null });
    setEditable(false);
  }, []);

  const commonFields = [
    { title: t("verifyid_image"), imageUrl: data?.verifyIdImage, placeholder: t("verifyid_image"), field: "verifyIdImage" },
  ];

  const driverFields = [
    { title: t("license_image_front"), imageUrl: data?.licenseImage, placeholder: t("license_image_front"), field: "licenseImage" },
    { title: t("license_image_back"), imageUrl: data?.licenseImageBack, placeholder: t("license_image_back"), field: "licenseImageBack" },
  ];

  const imageFields = data.usertype === "driver" ? [...commonFields, ...driverFields] : commonFields;

  const ImageUpload = ({ image, onClick, altText, uploadText }) => (
    image ? (
      <div onClick={onClick} style={{ display: "flex", justifyContent: "center", marginTop: 10 }}>
        <img src={URL.createObjectURL(image)} alt={altText} style={{ width: 300, height: 250, borderRadius: "19px" }} />
      </div>
    ) : (
      <div onClick={onClick} style={{ display: "flex", justifyContent: "center", marginTop: 30, cursor: "pointer" }}>
        <Avatar className={classes.avatar} sx={{ boxShadow: 3 }} variant="square">
          <FileUploadIcon sx={{ fontSize: 100, marginBottom: 3, color: colors.Header_Text_back, fontFamily: FONT_FAMILY }} />
          <Typography sx={{ textAlign: "center" }} fontFamily={FONT_FAMILY}>{uploadText}</Typography>
        </Avatar>
      </div>
    )
  );

  const ImageCard = ({ title, imageUrl, placeholder, onClick }) => (
    <Grid item>
      <Card className={classes.card}>
        <Typography style={{ textAlign: "center", fontSize: 16, fontWeight: "bold", fontFamily: FONT_FAMILY }}>
          {title}
        </Typography>
      </Card>
      <Grid item>
        {imageUrl ? (
          <Avatar alt={title} src={imageUrl} sx={{ width: 300, height: 250, borderRadius: "19px", cursor: "pointer" }} variant="square" onClick={onClick} />
        ) : (
          <Avatar className={classes.avatar} variant="square" sx={{ boxShadow: 3, cursor: "pointer", fontFamily: FONT_FAMILY, textAlign: "center" }} onClick={onClick}>
            {placeholder}
          </Avatar>
        )}
      </Grid>
    </Grid>
  );

  const EditButtonGroup = ({ editable, onEdit, onSave, onCancel }) => (
    <div style={{ display: "flex", justifyContent: "center", gap: 10 }}>
      {!editable ? (
        <Button
          className={classes.buttonStyle}
          sx={{
            backgroundColor: MAIN_COLOR,
            width: "50%",
            cursor: "pointer",
            borderColor: colors.CARD_DETAIL,
          }}
          variant="contained"
          onClick={onEdit}
        >
          <Typography sx={{ textAlign: "center", fontSize: 16, fontWeight: "bold", fontFamily: FONT_FAMILY, color: colors.WHITE }}>
            {t("edit")}
          </Typography>
        </Button>
      ) : (
        <>
          <Button
            className={classes.buttonStyle}
            sx={{ backgroundColor: colors.GREEN, width: "40%", "&:hover": { backgroundColor: MAIN_COLOR } }}
            variant="contained"
            onClick={onSave}
          >
            <Typography sx={{ color: colors.WHITE, textAlign: "center", fontSize: 16 }}>{t("save")}</Typography>
          </Button>
          <Button className={classes.buttonStyle} sx={{ backgroundColor: colors.RED, width: "40%" }} variant="contained" onClick={onCancel}>
            <Typography sx={{ color: colors.WHITE, textAlign: "center", fontSize: 16 }}>{t("cancel")}</Typography>
          </Button>
        </>
      )}
    </div>
  );

  return loading ? (
    <CircularLoading />
  ) : (
    <Card sx={{ borderRadius: "19px", backgroundColor: colors.WHITE, minHeight: 200, marginTop: 1, marginBottom: 1, padding: 1 }}>
      <div style={{ display: "flex", flexDirection: "column", justifyContent: isRTL === "rtl" ? "flex-end" : "flex-start" }}>
        <Typography variant="h5" sx={{ margin: "10px 10px 0 5px", fontFamily: FONT_FAMILY }}>{t("documents_title")}</Typography>
        <GoBackButton isRTL={isRTL} onClick={() => navigate(`/users/${rId}`, { state: { pageNo: state?.pageNo } })} />
      </div>
      <Grid container spacing={1} direction="column" sx={{ display: "flex", justifyContent: "center", alignItems: "center", width: "100%", height: "100%" }}>
        <Grid item>
          <Grid container spacing={1} justifyContent="center" alignItems="center" marginY={10} gap={2}>
            {editable ? (
              imageFields?.map((field, index) => (
                <ImageUpload key={index} image={images[field.field]} onClick={() => document.getElementById(field.field).click()} altText={field.title} uploadText={t(field.placeholder)} />
              ))
            ) : (
              imageFields?.map((field, index) => (
                <ImageCard key={index} title={field.title} imageUrl={field.imageUrl} placeholder={field.placeholder} onClick={() => setEditable(true)} />
              ))
            )}
          </Grid>
        </Grid>
        <EditButtonGroup editable={editable} onEdit={() => setEditable(true)} onSave={handleSaveUser} onCancel={handleCancel} />
      </Grid>
      {imageFields?.map((field) => (
        <input key={field.field} id={field.field} type="file" hidden onChange={handleImageChange(field.field)} />
      ))}
      <AlertDialog open={commonAlert.open} onClose={() => setCommonAlert({ open: false, msg: "" })}>
        {commonAlert.msg}
      </AlertDialog>
    </Card>
  );
}

export default UserDocuments;
