import React from 'react';
import MaterialTable from 'material-table';

const BlankTable = ({ title, columns, data, style, actions, options, localization }) => {
    return (
        <MaterialTable
            title={title}
            columns={columns}
            data={data}
            style={style}
            actions={actions}
            options={{ ...options,}}
            localization={localization}
        />

    )
}

export default BlankTable;