const {
  BOARDING_COUNTDOWN_SECONDS,
  BOARDING_WAIT_PHASE,
  NO_SHOW_FEE_WAIT_SECONDS,
  PASSENGER_NO_SHOW_CANCEL_REASON,
  isPassengerNoShowCancelReason,
  resolveBoardingWait,
  resolveDriverBoardingWaitCopy,
  resolvePassengerBoardingWaitCopy,
} = require('../src/screens/prototype/boardingWaitPolicy');

const ARRIVAL_MS = new Date('2026-10-12T15:00:00.000Z').getTime();
const DEADLINE = new Date(ARRIVAL_MS + BOARDING_COUNTDOWN_SECONDS * 1000).toISOString();
const at = (seconds) => ARRIVAL_MS + seconds * 1000;

describe('boarding wait policy', () => {
  it('names the countdown and the no-show wait in one place', () => {
    expect(BOARDING_COUNTDOWN_SECONDS).toBe(120);
    expect(NO_SHOW_FEE_WAIT_SECONDS).toBe(300);
  });

  it('stays in the countdown before the 2 minutes are over', () => {
    const wait = resolveBoardingWait({ boardingDeadlineAt: DEADLINE, remainingSec: 45, nowMs: at(75) });
    expect(wait).toEqual({
      phase: BOARDING_WAIT_PHASE.COUNTDOWN,
      remainingSec: 45,
      waitedSec: null,
      waitedLabel: null,
    });
    expect(resolvePassengerBoardingWaitCopy(wait)).toEqual({ value: null, valueLabel: null, message: null });
    expect(resolveDriverBoardingWaitCopy(wait)).toMatchObject({
      value: null,
      hint: null,
      passengerNoShow: false,
      cancelPromptTitle: null,
    });
  });

  it('counts the wait up from the arrival time between 2 and 5 minutes without implying a fee', () => {
    const justOver = resolveBoardingWait({ boardingDeadlineAt: DEADLINE, remainingSec: 0, nowMs: at(119.6) });
    expect(justOver.waitedLabel).toBe('2:00');

    const wait = resolveBoardingWait({ boardingDeadlineAt: DEADLINE, remainingSec: 0, nowMs: at(192) });
    expect(wait.phase).toBe(BOARDING_WAIT_PHASE.WAITING);
    expect(wait.waitedSec).toBe(192);
    expect(wait.waitedLabel).toBe('3:12');

    expect(resolvePassengerBoardingWaitCopy(wait)).toEqual({
      value: '3:12',
      valueLabel: 'de espera',
      message: 'Depois de 5 minutos de espera, o motorista pode cancelar e uma taxa é cobrada.',
    });

    const driverCopy = resolveDriverBoardingWaitCopy(wait);
    expect(driverCopy.value).toBe('3:12');
    expect(driverCopy.hint).toBeNull();
    expect(driverCopy.passengerNoShow).toBe(false);
    expect(driverCopy.cancelPromptTitle).toBe('Cancelar corrida?');
    expect(driverCopy.cancelPromptMessage).not.toMatch(/taxa|cobran/i);
    expect(driverCopy.cancelPromptMessage).toMatch(/não conta como não comparecimento/);

    const lastSecond = resolveBoardingWait({ boardingDeadlineAt: DEADLINE, remainingSec: 0, nowMs: at(299.9) });
    expect(lastSecond.phase).toBe(BOARDING_WAIT_PHASE.WAITING);
    expect(lastSecond.waitedLabel).toBe('4:59');
  });

  it('turns into a no-show only after 5 minutes of waiting', () => {
    const wait = resolveBoardingWait({ boardingDeadlineAt: DEADLINE, remainingSec: 0, nowMs: at(300) });
    expect(wait.phase).toBe(BOARDING_WAIT_PHASE.NO_SHOW);
    expect(wait.waitedLabel).toBe('5:00');

    const later = resolveBoardingWait({ boardingDeadlineAt: DEADLINE, remainingSec: 0, nowMs: at(431) });
    expect(later.waitedLabel).toBe('7:11');
    expect(resolvePassengerBoardingWaitCopy(later)).toEqual({
      value: '7:11',
      valueLabel: 'de espera',
      message: 'O motorista já esperou 5 minutos. Ele pode cancelar e uma taxa é cobrada.',
    });
    expect(resolveDriverBoardingWaitCopy(later)).toMatchObject({
      value: '7:11',
      hint: 'Cancelar agora conta como não comparecimento do passageiro.',
      passengerNoShow: true,
      cancelPromptTitle: 'Passageiro não apareceu?',
    });
  });

  it('does not invent a waited time or a no-show when the arrival time is unknown', () => {
    const wait = resolveBoardingWait({ boardingDeadlineAt: null, remainingSec: 0, nowMs: at(900) });
    expect(wait).toEqual({
      phase: BOARDING_WAIT_PHASE.WAITING,
      remainingSec: 0,
      waitedSec: null,
      waitedLabel: null,
    });
    expect(resolvePassengerBoardingWaitCopy(wait).value).toBeNull();
    expect(resolveDriverBoardingWaitCopy(wait).passengerNoShow).toBe(false);
  });

  it('recognises the no-show reason the driver app sends', () => {
    expect(isPassengerNoShowCancelReason(PASSENGER_NO_SHOW_CANCEL_REASON)).toBe(true);
    expect(isPassengerNoShowCancelReason('Cancelado pelo motorista.')).toBe(false);
    expect(isPassengerNoShowCancelReason(null)).toBe(false);
  });
});
