function getPeakHours(bookings) {
  const hourly = new Array(24).fill(0);

  bookings.forEach((booking) => {
    const hour = new Date(booking.tripdate).getHours();
    hourly[hour] += 1;
  });

  const maxTrips = Math.max(...hourly);
  return hourly
    .map((trips, hour) => ({ hour, trips }))
    .filter((entry) => entry.trips === maxTrips)
    .map((entry) => `${entry.hour}:00`);
}

module.exports = {
  getPeakHours,
};
