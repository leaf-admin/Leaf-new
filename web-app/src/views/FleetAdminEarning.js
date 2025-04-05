import React,{ useState,useEffect } from 'react';
import MaterialTable from 'material-table';
import { useSelector } from "react-redux";
import CircularLoading from "../components/CircularLoading";
import { useTranslation } from "react-i18next";
import {  SECONDORY_COLOR } from "../common/sharedFunctions";
import TableStyle from '../components/Table/Style';
import localization from '../components/Table/Localization';

export default function FleetAdminEarning() {
  
  const { t,i18n } = useTranslation();
  const isRTL = i18n.dir();

  const columns =  [
    { title: t('fleetadmin_id'), field: 'fleetUId'},
    { title: t('fleetadmin_name'), field: 'fleetadminName'},
    { title: t('year'),field: 'year'},
    { title: t('months'), field: 'monthsName'},
    { title: t('booking_count'), field: 'total_rides'},
    { title: t('earning_amount'), field: 'fleetCommission'}
  ];

  const [data, setData] = useState([]);
  const fleetadminearningdata = useSelector(state => state.fleetadminearningdata);

  useEffect(()=>{
    if(fleetadminearningdata.fleetadminearning){
      setData(fleetadminearningdata.fleetadminearning);
    }
  },[fleetadminearningdata.fleetadminearning]);

  const [selectedRow, setSelectedRow] = useState(null);
  
  return (
    fleetadminearningdata.loading? <CircularLoading/>:
    <MaterialTable
      title={t('driver_earning_title')}
      columns={columns}
      style={{
        direction: isRTL === "rtl" ? "rtl" : "ltr",
        borderRadius: "8px",
        boxShadow: `0px 2px 5px ${SECONDORY_COLOR}`,
        padding: "20px",
      }}
      data={data}
      
      onRowClick={((evt, selectedRow) => setSelectedRow(selectedRow.tableData.id))}
      options={{
        exportButton: true,
        rowStyle: rowData => ({
          backgroundColor: (selectedRow === rowData.tableData.id) ? '#EEE' : '#FFF',
        border: "1px solid rgba(224, 224, 224, 1)",
        }),
        ...TableStyle()
      }}
      localization={localization(t)}  
    />
  );
}
