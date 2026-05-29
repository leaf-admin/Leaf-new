const {
  getDriverOfferPayoutLabel,
  hasAuthoritativeDriverOfferPricing,
  mergeDriverOfferEntry,
  mergeDriverOffers,
  selectDisplayableDriverOffer,
} = require('../src/screens/prototype/driverOfferPricingSnapshot');

describe('driverOfferPricingSnapshot', () => {
  it('upgrades a provisional offer to the first authoritative pricing snapshot', () => {
    const merged = mergeDriverOffers(
      [
        {
          bookingId: 'booking_1',
          eta: '6 min',
          fare: 18.4,
          grossFare: 18.4,
          payout: 'R$ 18,40',
        },
      ],
      {
        bookingId: 'booking_1',
        eta: '5 min',
        estimatedOperationalFee: 2.4,
        estimatedPaymentIntermediationFee: 0.61,
        estimatedTotalFees: 3.01,
        estimatedDriverNetAmount: 15.39,
        pricingSnapshotLocked: true,
        pricingSnapshotLockedAt: '2026-04-02T12:00:00.000Z',
      },
    );

    expect(merged[0]).toEqual(
      expect.objectContaining({
        bookingId: 'booking_1',
        eta: '5 min',
        fare: 18.4,
        grossFare: 18.4,
        payout: 'R$ 15,39',
        estimatedOperationalFee: 2.4,
        estimatedPaymentIntermediationFee: 0.61,
        estimatedTotalFees: 3.01,
        estimatedDriverNetAmount: 15.39,
        pricingSnapshotLocked: true,
        pricingSnapshotLockedAt: '2026-04-02T12:00:00.000Z',
      }),
    );
  });

  it('does not allow later payloads for the same booking to drift the locked net amount', () => {
    const lockedOffer = mergeDriverOffers(
      [],
      {
        bookingId: 'booking_1',
        eta: '5 min',
        fare: 18.4,
        estimatedOperationalFee: 2.4,
        estimatedPaymentIntermediationFee: 0.61,
        estimatedTotalFees: 3.01,
        estimatedDriverNetAmount: 15.39,
        pricingSnapshotLocked: true,
        pricingSnapshotLockedAt: '2026-04-02T12:00:00.000Z',
      },
    );

    const merged = mergeDriverOffers(lockedOffer, {
      bookingId: 'booking_1',
      eta: '4 min',
      estimatedOperationalFee: 2.39,
      estimatedPaymentIntermediationFee: 0.62,
      estimatedTotalFees: 3.01,
      estimatedDriverNetAmount: 15.38,
      pricingSnapshotLocked: true,
      pricingSnapshotLockedAt: '2026-04-02T12:00:05.000Z',
    });

    expect(merged[0]).toEqual(
      expect.objectContaining({
        bookingId: 'booking_1',
        eta: '4 min',
        payout: 'R$ 15,39',
        estimatedOperationalFee: 2.4,
        estimatedPaymentIntermediationFee: 0.61,
        estimatedTotalFees: 3.01,
        estimatedDriverNetAmount: 15.39,
        pricingSnapshotLocked: true,
        pricingSnapshotLockedAt: '2026-04-02T12:00:00.000Z',
      }),
    );
  });

  it('does not treat a gross-only offer as displayable driver pricing', () => {
    const provisionalOffer = {
      bookingId: 'booking_1',
      fare: 16.5,
      grossFare: 16.5,
      payout: 'R$ 16,50',
    };

    expect(hasAuthoritativeDriverOfferPricing(provisionalOffer)).toBe(false);
    expect(getDriverOfferPayoutLabel(provisionalOffer)).toBeNull();
    expect(selectDisplayableDriverOffer([provisionalOffer])).toBeNull();
  });

  it('does not promote a locked gross-only offer into a net payout label', () => {
    const grossOnlyLockedOffer = {
      bookingId: 'booking_1',
      fare: 16.5,
      grossFare: 16.5,
      pricingSnapshotLocked: true,
    };

    expect(hasAuthoritativeDriverOfferPricing(grossOnlyLockedOffer)).toBe(false);
    expect(getDriverOfferPayoutLabel(grossOnlyLockedOffer)).toBeNull();
    expect(selectDisplayableDriverOffer([grossOnlyLockedOffer])).toBeNull();
  });

  it('infers the displayable net payout only when fees are explicit', () => {
    const feeBackedOffer = {
      bookingId: 'booking_1',
      fare: 16.5,
      grossFare: 16.5,
      estimatedTotalFees: 1.49,
      pricingSnapshotLocked: true,
    };

    expect(hasAuthoritativeDriverOfferPricing(feeBackedOffer)).toBe(true);
    expect(getDriverOfferPayoutLabel(feeBackedOffer)).toBe('R$ 15,01');
  });

  it('selects the first displayable offer with locked net pricing', () => {
    const selected = selectDisplayableDriverOffer([
      {
        bookingId: 'booking_provisional',
        fare: 16.5,
        payout: 'R$ 16,50',
      },
      {
        bookingId: 'booking_locked',
        fare: 16.5,
        estimatedDriverNetAmount: 15.01,
        pricingSnapshotLocked: true,
      },
    ]);

    expect(selected).toEqual(
      expect.objectContaining({
        bookingId: 'booking_locked',
        payout: 'R$ 15,01',
        estimatedDriverNetAmount: 15.01,
        pricingSnapshotLocked: true,
      }),
    );
    expect(getDriverOfferPayoutLabel(selected)).toBe('R$ 15,01');
  });

  it('preserves the locked net snapshot when an active ride sync only brings the gross fare', () => {
    const acceptedRide = mergeDriverOfferEntry(
      {
        bookingId: 'booking_1',
        fare: 16.5,
        grossFare: 16.5,
        estimatedOperationalFee: 0.99,
        estimatedPaymentIntermediationFee: 0.5,
        estimatedTotalFees: 1.49,
        estimatedDriverNetAmount: 15.01,
        pricingSnapshotLocked: true,
        pricingSnapshotLockedAt: '2026-04-02T15:00:00.000Z',
        payout: 'R$ 15,01',
      },
      {
        bookingId: 'booking_1',
        fare: 16.5,
        grossFare: 16.5,
        status: 'accepted',
      },
    );

    expect(acceptedRide).toEqual(
      expect.objectContaining({
        bookingId: 'booking_1',
        fare: 16.5,
        grossFare: 16.5,
        payout: 'R$ 15,01',
        estimatedDriverNetAmount: 15.01,
        pricingSnapshotLocked: true,
        pricingSnapshotLockedAt: '2026-04-02T15:00:00.000Z',
        status: 'accepted',
      }),
    );
  });
});
