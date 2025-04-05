import React, { useState, useEffect } from 'react';
import MaterialTable from 'material-table';
import { useSelector, useDispatch } from "react-redux";
import CircularLoading from "../components/CircularLoading";
import { api } from 'common';
import { useTranslation } from "react-i18next";
import {colors} from '../components/Theme/WebTheme';
import { SECONDORY_COLOR } from "../common/sharedFunctions";
import { ThemeProvider } from '@mui/material/styles';
import theme from "styles/tableStyle";
import TableStyle from '../components/Table/Style';
import localization from '../components/Table/Localization';
import { getLangKey } from 'common/src/other/getLangKey';

export default function CancellationReasons() {
  const { t,i18n } = useTranslation();
  const isRTL = i18n.dir();
  const {
    editCancellationReason,
    convertLanguage
  } = api;

  const columns = [
    { title: t('reason'), field: 'label',render: rowData => <span>{t(getLangKey(rowData.label))}</span>,
  }
  ];
  const settings = useSelector(state => state.settingsdata.settings);
  const [data, setData] = useState([]);
  const cancelreasondata = useSelector(state => state.cancelreasondata);
  const dispatch = useDispatch();
  const auth = useSelector((state) => state.auth);

  useEffect(() => {
    if (cancelreasondata.complex) {
      setData(cancelreasondata.complex);
    }else{
      setData([]);
    }
  }, [cancelreasondata.complex]);

  const [selectedRow, setSelectedRow] = useState(null);
  return (
    cancelreasondata.loading ? <CircularLoading /> :
      <ThemeProvider theme={theme}>
        <MaterialTable
          title={t('cancellation_reasons_title')}
          columns={columns}
          style={{
            direction: isRTL === "rtl" ? "rtl" : "ltr",
            borderRadius: "8px",
            padding: "20px",
            boxShadow: `0px 2px 5px ${SECONDORY_COLOR}`,
          }}
          data={data}
          onRowClick={((evt, selectedRow) => setSelectedRow(selectedRow.tableData.id))}
          options={{
            exportButton: true,
            rowStyle: (rowData) => ({
              backgroundColor:
                selectedRow === rowData.tableData.id ? colors.ROW_SELECTED :colors.WHITE
            }),
            ...TableStyle()
          }}
          localization={localization(t)}
          editable={settings.AllowCriticalEditsAdmin ? {
              onRowAdd: newData =>
              new Promise((resolve, reject)=> {
                setTimeout(async() => {
                  const tblData = data;
                  newData.value = tblData.length;
                  if(!(newData && newData.label)){
                    alert(t('no_details_error'));
                    reject();
                  }else{
                    tblData.push(newData);
                    await convertLanguage(newData.label, auth?.profile?.lang?.langLocale ? auth.profile.lang.langLocale : null);
                    dispatch(editCancellationReason(tblData, "Add"));
                    resolve();
                  }
                }, 600);
              }),
            onRowUpdate: (newData, oldData) =>
              new Promise((resolve, reject)=> {
                setTimeout(async() => {
                  if(!(newData && newData.label )){
                    alert(t('no_details_error'));
                    reject();
                  }else {
                    resolve();
                    if(newData !== oldData){
                      const tblData = data;
                      tblData[tblData.indexOf(oldData)] = newData;
                      await convertLanguage(newData.label, auth?.profile?.lang?.langLocale ? auth.profile.lang.langLocale : null);
                      dispatch(editCancellationReason(tblData, "Update"));
                    }
                  }
                }, 600);
              }),
            onRowDelete: oldData =>
              new Promise(resolve => {
                setTimeout(() => {
                  resolve();
                  const tblData = data;
                  const newTtblData = tblData.filter((item) => item.value !== oldData.value);
                  dispatch(editCancellationReason(newTtblData, "Delete"));
                }, 600);
              }),
              
          } : null}
        />
      </ThemeProvider>
  );
}
