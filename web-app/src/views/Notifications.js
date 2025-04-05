import React,{ useState, useEffect } from 'react';
import MaterialTable from 'material-table';
import { useSelector, useDispatch } from "react-redux";
import CircularLoading from "../components/CircularLoading";
import { api } from 'common';
import { useTranslation } from "react-i18next";
import {colors} from '../components/Theme/WebTheme';
import {  useNavigate,useLocation } from 'react-router-dom';
import { SECONDORY_COLOR } from "../common/sharedFunctions";
import moment from 'moment/min/moment-with-locales';
import { ThemeProvider } from '@mui/material/styles';
import theme from "styles/tableStyle";
import TableStyle from '../components/Table/Style';
import localization from '../components/Table/Localization';
import BlankTable from '../components/Table/BlankTable';

export default function Notifications() {
  const { t, i18n  } = useTranslation();
  const isRTL = i18n.dir();
  const {
    editNotifications
  } = api;

  const columns =  [
    {
      title:t("createdAt"),
      field:"createdAt",
      defaultSort:'desc',render: rowData => rowData.createdAt? moment(rowData.createdAt).format('lll'):null
    },
      {
        title: t('device_type'),
        field: 'devicetype',
        lookup: { All: (t('all')), ANDROID: (t('android')), IOS: (t('ios')) },
      },
      {
        title: t('user_type'),
        field: 'usertype',
        lookup: { customer: t('customer'), driver: t('driver') },
      },
      { title: t('title'),field: 'title', 
    },
      { title: t('body'), field: 'body', 
    },
  ];

  const [data, setData] = useState([]);
  const notificationdata = useSelector(state => state.notificationdata);
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const {state} = useLocation()
  const [currentPage,setCurrentPage] = useState(null)

  useEffect(()=>{
    setCurrentPage(state?.pageNo)
  },[state])

  const HandalePageChange = (page)=>{
    setCurrentPage(page)
  }

  useEffect(()=>{
        if(notificationdata.notifications){
            setData(notificationdata.notifications);
        }else{
            setData([]);
        }
  },[notificationdata.notifications]);

  const [selectedRow, setSelectedRow] = useState(null);
  
  return (
    notificationdata.loading? <CircularLoading/>:
    <ThemeProvider theme={theme}>
      {data.length>0? 
      <MaterialTable
      title={t('push_notification_title')}
      columns={columns}
      onChangePage={(page)=>HandalePageChange(page)}
      style={{
          direction: isRTL === "rtl" ? "rtl" : "ltr",
          borderRadius: "8px",
          boxShadow: `0px 2px 5px ${SECONDORY_COLOR}`,
          padding: "20px",
        }}
        data={data}
        onRowClick={((evt, selectedRow) => setSelectedRow(selectedRow.tableData.id))}
        options={{
          initialPage:state?.pageNo,
          rowStyle: (rowData) => ({
            backgroundColor:
              selectedRow === rowData.tableData.id ? colors.ROW_SELECTED :colors.WHITE
          }),
          ...TableStyle()
        }}
        localization={localization(t)}
        editable={{
          onRowDelete: oldData =>
            new Promise(resolve => {
              setTimeout(() => {
                resolve();
                dispatch(editNotifications(oldData,"Delete"));
              }, 600);
            }),
        }}
        actions={[
          {
            icon: 'add',
            tooltip: t("add_notification"),
            isFreeAction: true,
            onClick: (event) => navigate("/notifications/addnotifications",{state:{pageNo:currentPage}})
          },
        ]}
        />
        :<BlankTable title={t('push_notification_title')} 
        actions={[    
          {
            icon: 'add',
            tooltip: t("push_notification_title"),
            isFreeAction: true,
            onClick: (event) => navigate("/notifications/addnotifications")
          },
        ]} columns={columns}  data={[]} localization={localization(t)} options={TableStyle()}/>
        }
    </ThemeProvider>
  );
}
