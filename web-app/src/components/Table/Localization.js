const localization = (t) => {
    return {
        body: {
            addTooltip: t('add'),
            deleteTooltip: t('delete'),
            editTooltip: t('edit'),
            emptyDataSourceMessage: t('blank_message'),
            editRow: {
                deleteText: t('delete_message'),
                cancelTooltip: t('cancel'),
                saveTooltip: t('save')
            },
        },
        toolbar: {
            searchPlaceholder: t('search'),
            exportTitle: t('export'),
            exportCSVName: t('export'),
        },
        header: {
            actions: t('actions')
        },
        pagination: {
            labelDisplayedRows: ('{from}-{to} ' + (t('of')) + ' {count}'),
            labelRowsPerPage: t('rows_per_page'),
            firstTooltip: t('first_page_tooltip'),
            previousTooltip: t('previous_page_tooltip'),
            nextTooltip: t('next_page_tooltip'),
            lastTooltip: t('last_page_tooltip'),
            firstAriaLabel: t('first_page_aria_label'),
            previousAriaLabel: t('previous_page_aria_label'),
            nextAriaLabel: t('next_page_aria_label'),
            lastAriaLabel: t('last_page_aria_label'),
            labelRowsSelect: t('rows_select')
        },
    };
};

export default localization;