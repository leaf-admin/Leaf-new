import {
  RIDE_CARD_PRIORITIES,
  RIDE_CARD_ROLES,
  RIDE_CARD_STATES,
  getRideCardContract,
  getRideCardRequiredFields,
  listRideCardContracts,
  validateRideCardRenderedFields,
} from "../src/screens/prototype/rideCardContract";

describe("ride card contract", () => {
  it("defines a non-empty contract for every lifecycle surface", () => {
    const contracts = listRideCardContracts();

    expect(contracts.length).toBeGreaterThan(0);

    for (const contract of contracts) {
      expect(contract.role).toBeTruthy();
      expect(contract.state).toBeTruthy();
      expect(contract.title).toBeTruthy();
      expect(contract.goal).toBeTruthy();
      expect(contract.fields.length).toBeGreaterThan(0);
      expect(
        contract.fields.some(
          (field) => field.priority === RIDE_CARD_PRIORITIES.CRITICAL,
        ),
      ).toBe(true);
    }
  });

  it("keeps field ids unique inside each state", () => {
    for (const contract of listRideCardContracts()) {
      const fieldIds = contract.fields.map((field) => field.id);
      expect(new Set(fieldIds).size).toBe(fieldIds.length);
    }
  });

  it("keeps every field inspectable by product and QA", () => {
    const allowedPriorities = new Set(Object.values(RIDE_CARD_PRIORITIES));

    for (const contract of listRideCardContracts()) {
      for (const field of contract.fields) {
        expect(field.id).toMatch(/^[a-z0-9_]+$/);
        expect(field.label).toBeTruthy();
        expect(allowedPriorities.has(field.priority)).toBe(true);
        expect(field.source).toBeTruthy();
        expect(typeof field.required).toBe("boolean");
      }
    }
  });

  it("captures the passenger driver-accepted information that cannot disappear in redesigns", () => {
    const contract = getRideCardContract(
      RIDE_CARD_ROLES.PASSENGER,
      RIDE_CARD_STATES.PASSENGER_DRIVER_ACCEPTED,
    );
    const requiredFieldIds = getRideCardRequiredFields(
      RIDE_CARD_ROLES.PASSENGER,
      RIDE_CARD_STATES.PASSENGER_DRIVER_ACCEPTED,
    ).map((field) => field.id);

    expect(contract.visualGuards).toEqual(
      expect.arrayContaining([
        expect.stringContaining("Driver identity"),
        expect.stringContaining("Fare must never use red"),
      ]),
    );
    expect(requiredFieldIds).toEqual(
      expect.arrayContaining([
        "driver_name",
        "driver_photo",
        "driver_rating",
        "vehicle_model",
        "vehicle_color",
        "vehicle_plate",
        "pickup_eta",
        "pickup_distance",
        "pickup_address",
        "destination_address",
        "fare",
        "vehicle_type",
        "contact_actions",
        "share_trip_action",
        "safety_action",
        "cancel_action",
      ]),
    );
  });

  it("captures the driver new-offer economics and route context", () => {
    const requiredFieldIds = getRideCardRequiredFields(
      RIDE_CARD_ROLES.DRIVER,
      RIDE_CARD_STATES.DRIVER_NEW_OFFER,
    ).map((field) => field.id);

    expect(requiredFieldIds).toEqual(
      expect.arrayContaining([
        "net_payout",
        "pickup_address",
        "destination_address",
        "pickup_eta",
        "pickup_distance",
        "trip_distance",
        "trip_duration",
        "passenger_name",
        "ride_preferences",
        "payment_confirmed",
        "response_timer",
        "accept_action",
        "reject_action",
      ]),
    );
  });

  it("validates rendered field coverage for a given state", () => {
    const result = validateRideCardRenderedFields(
      RIDE_CARD_ROLES.PASSENGER,
      RIDE_CARD_STATES.PASSENGER_DRIVER_ACCEPTED,
      [
        "driver_name",
        "driver_photo",
        "driver_rating",
        "vehicle_model",
        "vehicle_color",
        "vehicle_plate",
        "pickup_eta",
        "pickup_distance",
        "pickup_address",
        "destination_address",
        "fare",
        "vehicle_type",
        "contact_actions",
        "share_trip_action",
        "safety_action",
      ],
    );

    expect(result.ok).toBe(false);
    expect(result.missing.map((field) => field.id)).toContain("cancel_action");

    const criticalOnlyResult = validateRideCardRenderedFields(
      RIDE_CARD_ROLES.PASSENGER,
      RIDE_CARD_STATES.PASSENGER_DRIVER_ACCEPTED,
      [
        "driver_name",
        "driver_photo",
        "driver_rating",
        "vehicle_model",
        "vehicle_color",
        "vehicle_plate",
        "pickup_eta",
        "pickup_address",
        "destination_address",
        "contact_actions",
        "share_trip_action",
        "safety_action",
      ],
      { includeImportant: false },
    );

    expect(criticalOnlyResult.ok).toBe(true);
  });
});
