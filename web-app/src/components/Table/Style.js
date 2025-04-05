import { colors } from "components/Theme/WebTheme";
import {SECONDORY_COLOR,FONT_FAMILY} from "../../common/sharedFunctions"
const TableStyle = () => {
    return {
        editable: {
            backgroundColor: colors.Header_Text,
            fontSize: "0.8em",
            fontWeight: "bold ",
            fontFamily: FONT_FAMILY 
          },
          pageSize: 10,
          pageSizeOptions: [10, 15, 20],
          headerStyle: {
            color: colors.Black,
            position: "sticky",
            top: "0px",
            backgroundColor:SECONDORY_COLOR,
            textAlign: "center",
            fontSize: "0.8em",
            fontWeight: "bold ",
            border: `1px solid ${colors.TABLE_BORDER}`,
            fontFamily: FONT_FAMILY 
          },
          cellStyle: {
            border: `1px solid ${colors.TABLE_BORDER}`,
            textAlign: "center",
          },
          actionsColumnIndex: -1,
        }
};

export default TableStyle;