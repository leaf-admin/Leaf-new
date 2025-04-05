import React, { useState, useEffect, useRef } from 'react';
import { downloadCsv } from '../common/sharedFunctions';
import MaterialTable from "material-table";
import { useSelector, useDispatch } from "react-redux";
import CircularLoading from "../components/CircularLoading";
import { api } from 'common';
import { useTranslation } from "react-i18next";
import { colors } from '../components/Theme/WebTheme';
import moment from 'moment/min/moment-with-locales';
import { SECONDORY_COLOR } from "../common/sharedFunctions";
import { ThemeProvider } from '@mui/material/styles';
import theme from "styles/tableStyle";
import TableStyle from '../components/Table/Style';
import localization from '../components/Table/Localization';

export default function Complain() {
    const { t, i18n } = useTranslation();
    const isRTL = i18n.dir();
    const settings = useSelector(state => state.settingsdata.settings);
    const {
        fetchUsersOnce,
        editComplain
    } = api;
    const [data, setData] = useState([]);
    const complaindata = useSelector(state => state.complaindata.list);
    const dispatch = useDispatch();
    const loaded = useRef(false);

    useEffect(() => {
        dispatch(fetchUsersOnce());
    }, [dispatch, fetchUsersOnce])

    useEffect(() => {
        if (complaindata) {
            setData(complaindata);
        } else {
            setData([]);
        }
        loaded.current = true;
    }, [complaindata]);
    const columns = [
        { title: t('createdAt'), field: 'createdAt', editable: 'never', defaultSort: 'desc', render: rowData => rowData.complainDate ? moment(rowData.complainDate).format('lll') : null },
        { title: t('first_name'), field: 'firstName', editable: 'never' },
        { title: t('last_name'), field: 'lastName', editable: 'never' },
        { title: t('usertype'), field: 'role', editable: 'never' },
        { title: t('email'), field: 'email', editable: 'never', render: (rowData) =>
        settings.AllowCriticalEditsAdmin ? rowData.email : t("hidden_demo"), },
        { title: t('mobile'), field: 'mobile', editable: 'never', render: (rowData) =>
        settings.AllowCriticalEditsAdmin ? rowData.mobile : t("hidden_demo"), },
        { title: t('message_text'), field: 'body', editable: 'never', initialEditValue: '',cellStyle:{wordWrap: "break-word", textAlign:"center", maxWidth:"420px"} },
        { title: t('subject'), field: 'subject', editable: 'never', initialEditValue: '' },
        { title: t('processDate'), field: 'processDate', editable: 'never', defaultSort: 'desc', render: rowData => rowData.processDate ? moment(rowData.processDate).format('lll') : null },
        { title: t('status'), field: 'check', type: 'boolean', initialEditValue: true, },
    ];

    const [selectedRow, setSelectedRow] = useState(null);

    return (
        !loaded.current ? <CircularLoading /> :
          <ThemeProvider theme={theme}>
            <MaterialTable
                title={t('complain_title')}
                columns={columns}
                style={{ 
                    direction: isRTL === "rtl" ? "rtl" : "ltr",
                    borderRadius: "8px",
                    boxShadow: `0px 2px 5px ${SECONDORY_COLOR}`,
                    padding:5 
                }}
                data={data}
                onRowClick={((evt, selectedRow) => setSelectedRow(selectedRow.tableData.id))}
                options={{
                    exportCsv: (columns, data) => {
                        let hArray = [];
                        const headerRow = columns.map(col => {
                            if (typeof col.title === 'object') {
                                return col.title.props.text;
                            }
                            hArray.push(col.field);
                            return col.title;
                        });
                        const dataRows = data.map(({ tableData, ...row }) => {
                            row.createdAt = row.complainDate ? new Date(row.complainDate).toLocaleDateString() + ' ' + new Date(row.complainDate).toLocaleTimeString() : '';
                            row.processDate = row.processDate ? new Date(row.processDate).toLocaleDateString() + ' ' + new Date(row.processDate).toLocaleTimeString() : '';
                            let dArr = [];
                            for (let i = 0; i < hArray.length; i++) {
                                dArr.push(row[hArray[i]]);
                            }
                            return Object.values(dArr);
                        })
                        const { exportDelimiter } = ",";
                        const delimiter = exportDelimiter ? exportDelimiter : ",";
                        const csvContent = [headerRow, ...dataRows].map(e => e.join(delimiter)).join("\n");
                        const csvFileName = 'Complain.csv';
                        downloadCsv(csvContent, csvFileName);
                    },
                    exportButton: {
                        csv: settings.AllowCriticalEditsAdmin,
                        pdf: false,
                    },
                    maxColumnSort: "all_columns",
                    rowStyle: rowData => ({
                        backgroundColor: (selectedRow === rowData.tableData.id) ? colors.THIRDCOLOR : colors.WHITE
                    }),
                    ...TableStyle()
                }}
                localization={localization(t)}
                editable={{
                    onRowUpdate: (newData, oldData) =>
                        new Promise((resolve, reject) => {
                            setTimeout(() => {
                                resolve();
                                if (newData !== oldData) {
                                    delete newData.tableData;
                                    dispatch(editComplain(newData, 'Update'));
                                }
                            }, 600);
                        }),
                }}
            /> 
          </ThemeProvider>
    
    );
}
