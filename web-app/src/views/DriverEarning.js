import React,{ useState,useEffect } from 'react';
import MaterialTable from 'material-table';
import { useSelector } from "react-redux";
import CircularLoading from "../components/CircularLoading";
import { useTranslation } from "react-i18next";
import {colors} from '../components/Theme/WebTheme';
import {  SECONDORY_COLOR } from "../common/sharedFunctions";
import { ThemeProvider } from '@mui/material/styles';
import theme from "styles/tableStyle";
import TableStyle from '../components/Table/Style';
import localization from '../components/Table/Localization';

export default function DriverEarning() {
  const { t,i18n } = useTranslation();
  const isRTL = i18n.dir();
  
  const columns =  [
      { title: t('year'),field: 'year',
      },
      { title: t('months'), field: 'monthsName', },
      { title: t('driver_name'), field: 'driverName', 
    },
      { title: t('booking_count'), field: 'total_rides', 
    },
      { title: t('vehicle_reg_no'), field: 'driverVehicleNo', 
      },
      { title: t('earning_amount'), field: 'driverShare', 
    }
  ];

  const [data, setData] = useState([]);
  const driverearningdata = useSelector(state => state.driverearningdata);

  useEffect(()=>{
        if(driverearningdata.driverearnings){
            setData(driverearningdata.driverearnings);
        }
  },[driverearningdata.driverearnings]);

  const [selectedRow, setSelectedRow] = useState(null);
  
  return (
    driverearningdata.loading? <CircularLoading/>:
      <ThemeProvider theme={theme}>
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
            rowStyle: (rowData) => ({
              backgroundColor:
                selectedRow === rowData.tableData.id ? colors.ROW_SELECTED :colors.WHITE
            }),
            ...TableStyle()
          }}
          localization={localization(t)}
        />
      </ThemeProvider>
  );
}
