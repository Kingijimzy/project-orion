export type ForexSessionState = 'open' | 'daily-break' | 'closed';

type NewYorkClock = { weekday: number; minuteOfDay: number };

function getNewYorkClock(date: Date): NewYorkClock {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const weekdays: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const weekday = weekdays[values.weekday];
  const hour = Number(values.hour);
  const minute = Number(values.minute);
  if (weekday === undefined || !Number.isInteger(hour) || !Number.isInteger(minute)) {
    throw new Error('Could not determine the New York forex session time.');
  }
  return { weekday, minuteOfDay: hour * 60 + minute };
}

/**
 * Indicative US forex broker schedule, not a live quote/feed health check.
 * It follows OANDA US's published hours and daily break. Holidays and broker
 * specific exceptions are not modeled.
 */
export function getForexSessionState(date: Date): ForexSessionState {
  if (!Number.isFinite(date.getTime())) throw new Error('A valid date is required.');
  const { weekday, minuteOfDay } = getNewYorkClock(date);
  const sundayOpen = 17 * 60 + 5;
  const fridayClose = 16 * 60 + 59;
  const dailyBreakStart = fridayClose;
  const dailyBreakEnd = 17 * 60 + 5;

  if (weekday === 0) return minuteOfDay >= sundayOpen ? 'open' : 'closed';
  if (weekday === 6) return 'closed';
  if (weekday === 5) return minuteOfDay < fridayClose ? 'open' : 'closed';
  if (minuteOfDay >= dailyBreakStart && minuteOfDay < dailyBreakEnd) return 'daily-break';
  return 'open';
}
