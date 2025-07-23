// Web-compatible shared functions
// This replaces the common/sharedFunctions imports for web-app

// Colors and styling
export const MAIN_COLOR = '#1976d2';
export const SECONDORY_COLOR = '#dc004e';
export const FONT_FAMILY = 'Roboto, Helvetica, Arial, sans-serif';

// Utility functions
export const downloadCsv = (data, filename) => {
  const csvContent = "data:text/csv;charset=utf-8," + data;
  const encodedUri = encodeURI(csvContent);
  const link = document.createElement("a");
  link.setAttribute("href", encodedUri);
  link.setAttribute("download", filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
};

// Settings components
export const PanicSettings = () => null;
export const BookingImageSettings = () => null;
export const DeliveryFlow = () => null;
export const CustomerBidSettings = () => null;
export const DispatchSettings = () => null;

// Estimation functions
export const showEst = () => false;
export const calcEst = () => 0;

// Options
export const optionsRequired = false;

// Language functions
export const getLangKey = (key) => key;

// Modal components
export const BidModal = () => null;
export const BookingModalBody = () => null;

// Booking functions
export const acceptBid = () => null;
export const validateBookingObj = () => ({ bookingObject: {} });

// Table columns
export const bookingHistoryColumns = () => [];
export const carTypeColumns = () => [];

// Additional functions that might be needed
export const OtherPerson = () => null;
export const colors = {
  TAXIPRIMARY: '#1976d2',
  TAXISECONDORY: '#dc004e',
  RED: '#f44336',
  GREEN: '#4caf50',
  YELLOW: '#ff9800',
  BLACK: '#000000'
};
