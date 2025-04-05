import React, { useState, useEffect } from 'react';
import MaterialTable from 'material-table';
import { useSelector, useDispatch } from "react-redux";
import CircularLoading from "../components/CircularLoading";
import { api } from 'common';
import { useTranslation } from "react-i18next";
import moment from 'moment/min/moment-with-locales';
import {colors} from '../components/Theme/WebTheme';
import {Switch} from '@mui/material';
import { SECONDORY_COLOR } from "../common/sharedFunctions";
import EditIcon from '@mui/icons-material/Edit';
import { useNavigate,useLocation } from 'react-router-dom';
import { ThemeProvider } from '@mui/material/styles';
import theme from "styles/tableStyle";
import BlankTable from '../components/Table/BlankTable';
import TableStyle from '../components/Table/Style';
import localization from '../components/Table/Localization';
import { getLangKey } from 'common/src/other/getLangKey';

export default function Promos() {
  const { t,i18n } = useTranslation();
  const isRTL = i18n.dir();
  const {
    editPromo
  } = api;
  const settings = useSelector(state => state.settingsdata.settings);

  const columns = [
    { title: t('promo_name'), field: 'promo_name',
      render: rowData => rowData.promo_name?t(getLangKey(rowData.promo_name)):null,
  },
  {
    title: t('promo_code_web'), field: 'promo_code'
  },
    { title: t('description'), field: 'promo_description',
      render: rowData => rowData.promo_description?t(getLangKey(rowData.promo_description)):null,
  },
    {
      title: t('type'),
      field: 'promo_discount_type',
      lookup: { flat: t('flat'), percentage: t('percentage')},
    },
    { title: t('promo_discount_value'), field: 'promo_discount_value', type: 'numeric',
  },
    { title: t('max_limit'), field: 'max_promo_discount_value', type: 'numeric',
  },
    { title: t('min_limit'), field: 'min_order', type: 'numeric',
  },
    { title: t('end_date'), field: 'promo_validity',  
    render: rowData => rowData.promo_validity?moment(rowData.promo_validity).format('lll'):null,
  },
    { title: t('promo_usage'), field: 'promo_usage_limit', type: 'numeric',
  },
  { title: t('show_in_list'),  field: 'promo_show', type:'boolean', render: (rowData) => (
    <Switch
      checked={rowData.promo_show}
      onChange={() => handelShowPromo(rowData)}
      disabled={!settings.AllowCriticalEditsAdmin}
    />
  ),},
    { title: t('promo_used_by'), field: 'user_avail', editable: 'never',
  }
  ];

  const [data, setData] = useState([]);
  const promodata = useSelector(state => state.promodata);
  const dispatch = useDispatch();
  const [sortedData, SetSortedData] = useState([]);
  const navigate = useNavigate();
  const [role, setRole] = useState(null);
  const auth = useSelector(state => state.auth);
  const [selectedRow, setSelectedRow] = useState(null);
  const {state} = useLocation()
  const [currentPage,setCurrentPage] = useState(null)

  useEffect(() => {
    if(auth.profile && auth.profile.usertype){
      setRole(auth.profile.usertype);
    }
  }, [auth.profile]);

  useEffect(()=>{
    setCurrentPage(state?.pageNo)
  },[state])

  const HandalePageChange = (page)=>{
    setCurrentPage(page)
  }

  useEffect(() => {
    if (promodata.promos) {
      setData(promodata.promos);
    } else {
      setData([]);
    }
  }, [promodata.promos]);

  useEffect(()=>{
    if(data){
      SetSortedData(data.sort((a,b)=>(moment(b.createdAt) - moment(a.createdAt))))
    }
  },[data])

  const handelShowPromo = (rowData) => {
    if (role === "admin") {
        dispatch(editPromo({...rowData, promo_show : !rowData.promo_show},"Update"))
    }
  };

  return (
    promodata.loading ? <CircularLoading /> :
      <ThemeProvider theme={theme}>
        {sortedData?.length >0 ? 
        <MaterialTable
          title={t('promo_offer_title')}
          columns={columns}
          onChangePage={(page)=>HandalePageChange(page)}
          style={{
            direction: isRTL === "rtl" ? "rtl" : "ltr",
            borderRadius: "8px",
            boxShadow: `0px 2px 5px ${SECONDORY_COLOR}`,
            padding: "20px",
          }}
          data={sortedData}
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
              settings.AllowCriticalEditsAdmin?
              new Promise(resolve => {
                setTimeout(() => {
                  resolve();
                  dispatch(editPromo(oldData,"Delete"));
                }, 600);
              })
              :
              new Promise(resolve => {
                setTimeout(() => {
                  resolve();
                  alert(t('demo_mode'));
                }, 600);
              })
          }}
          actions={[
            {
            icon: 'add',
            tooltip: t("add_promo_title"),
            isFreeAction: true,
            onClick: (event) => navigate(`/promos/editpromo`,{state:{pageNo:currentPage}})
          },
          (rowData) => ({
            tooltip: t("edit"),
              icon: () => (
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    flexWrap: "wrap",
                    marginRight:0
                  }}
                >
                  <EditIcon />  
                </div>
              ),
              onClick: (event, rowData) =>{
                navigate(`/promos/editpromo/${rowData.id}`,{state:{pageNo:currentPage}})
              }
            }),
          ]}
        /> : <BlankTable title={t('promo_offer_title')} 
        actions={[    
          {
            icon: 'add',
            tooltip: t("add_promo_title"),
            isFreeAction: true,
            onClick: (event) => navigate(`/promos/editpromo`)
          },
        ]} columns={columns}  data={[]} localization={localization(t)} options={TableStyle()}/>
      }
      </ThemeProvider>
  );
}
