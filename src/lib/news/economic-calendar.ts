export type EconomicCalendarEvent = {
  id: string;
  title: string;
  category: 'inflation' | 'employment' | 'other-release' | 'monetary-policy';
  source: string;
  sourceUrl: string;
  eventDate: string;
  startsAt: string | null;
  endsAt: string | null;
  timeZone: string;
  dateOnly: boolean;
  impact: 'not-provided';
  actual: null;
  forecast: null;
  previous: null;
};

const BLS_ICS_URL = 'https://www.bls.gov/schedule/news_release/bls.ics';
const BLS_SCHEDULE_URL = 'https://www.bls.gov/schedule/';
const FED_CALENDAR_URL = 'https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm';
const MAX_FEED_CHARS = 2_000_000;
const HORIZON_DAYS = 120;

function unescapeIcs(value: string) {
  return value.replace(/\\n/gi, ' ').replace(/\\([,;\\])/g, '$1').trim();
}

function localEasternToIso(value: string, timeZone: string): string | null {
  const match = value.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?$/);
  if (!match) return null;
  const [, year, month, day, hour, minute, second = '00'] = match;
  const target = Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second));
  let instant = target;
  try {
    const formatter = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const parts = Object.fromEntries(formatter.formatToParts(new Date(instant)).map((part) => [part.type, part.value]));
      const rendered = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second));
      instant += target - rendered;
    }
    return new Date(instant).toISOString();
  } catch { return null; }
}

function categorize(title: string): EconomicCalendarEvent['category'] {
  if (/consumer price|inflation|producer price/i.test(title)) return 'inflation';
  if (/employment situation|job openings|unemployment|payroll/i.test(title)) return 'employment';
  return 'other-release';
}

function upcoming(date: string | null, now: Date, horizon: Date) {
  if (!date) return false;
  const value = new Date(date).getTime();
  return Number.isFinite(value) && value >= now.getTime() && value <= horizon.getTime();
}

function dateInZone(date: Date, timeZone: string) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function makeEvent(event: Omit<EconomicCalendarEvent, 'impact' | 'actual' | 'forecast' | 'previous'>): EconomicCalendarEvent {
  return { ...event, impact: 'not-provided', actual: null, forecast: null, previous: null };
}

export function parseBlsCalendar(ics: string, now = new Date(), horizonDays = HORIZON_DAYS): EconomicCalendarEvent[] {
  if (ics.length > MAX_FEED_CHARS || !/BEGIN:VCALENDAR/.test(ics)) return [];
  const horizon = new Date(now.getTime() + horizonDays * 86_400_000);
  const unfolded = ics.replace(/\r?\n[ \t]/g, ' ');
  const blocks = unfolded.match(/BEGIN:VEVENT[\s\S]*?END:VEVENT/g) || [];
  return blocks.flatMap((block) => {
    const uid = block.match(/^UID:(.+)$/mi)?.[1]?.trim();
    const summary = block.match(/^SUMMARY(?:;[^:]*)?:(.+)$/mi)?.[1];
    const startLine = block.match(/^DTSTART(?:;TZID=([^:;]+))?(;VALUE=DATE)?:([0-9TZ]+)$/mi);
    if (!uid || !summary || !startLine) return [];
    const title = unescapeIcs(summary);
    const dateOnly = startLine[2] === ';VALUE=DATE';
    const timezone = startLine[1] === 'US-Eastern' ? 'America/New_York' : startLine[1] || 'America/New_York';
    const startsAt = dateOnly ? null : localEasternToIso(startLine[3], timezone);
    const eventDate = `${startLine[3].slice(0, 4)}-${startLine[3].slice(4, 6)}-${startLine[3].slice(6, 8)}`;
    const isUpcoming = dateOnly ? eventDate >= dateInZone(now, timezone) && eventDate <= dateInZone(horizon, timezone) : upcoming(startsAt, now, horizon);
    if (!isUpcoming) return [];
    const sourceYear = eventDate.slice(0, 4);
    return [makeEvent({ id: `bls-${uid}`, title, category: categorize(title), source: 'U.S. Bureau of Labor Statistics', sourceUrl: `${BLS_SCHEDULE_URL}${sourceYear}/`, eventDate, startsAt, endsAt: null, timeZone: timezone, dateOnly })];
  });
}

const MONTHS: Record<string, number> = { January: 0, February: 1, March: 2, April: 3, May: 4, June: 5, July: 6, August: 7, September: 8, October: 9, November: 10, December: 11 };
function decodeHtml(value: string) { return value.replace(/&amp;/g, '&').replace(/&#39;|&apos;/g, "'").replace(/&nbsp;/g, ' ').replace(/&ndash;/g, '–').replace(/&mdash;/g, '—').trim(); }

export function parseFedCalendar(html: string, now = new Date(), horizonDays = HORIZON_DAYS): EconomicCalendarEvent[] {
  if (html.length > 2_000_000 || !/<html\b/i.test(html)) return [];
  const horizon = new Date(now.getTime() + horizonDays * 86_400_000);
  const yearMatches = [...html.matchAll(/(20\d{2}) FOMC Meetings/g)];
  const events: EconomicCalendarEvent[] = [];
  for (const yearMatch of yearMatches) {
    const year = Number(yearMatch[1]);
    const panelStart = html.lastIndexOf('<div class="panel panel-default">', yearMatch.index);
    const nextPanel = html.indexOf('<div class="panel panel-default">', (yearMatch.index || 0) + yearMatch[0].length);
    const section = html.slice(Math.max(0, panelStart), nextPanel < 0 ? html.length : nextPanel);
    const rows = [...section.matchAll(/<div class="([^"]*fomc-meeting[^"]*row[^"]*)"[^>]*>/g)];
    for (let index = 0; index < rows.length; index += 1) {
      const rowStart = rows[index].index || 0;
      const rowEnd = rows[index + 1]?.index ?? section.length;
      const row = section.slice(rowStart, rowEnd);
      const monthText = row.match(/fomc-meeting__month[^>]*>\s*<strong>([^<]+)<\/strong>/i)?.[1];
      const dateText = row.match(/fomc-meeting__date[^>]*>\s*([^<]+)/i)?.[1];
      const month = monthText ? MONTHS[decodeHtml(monthText)] : undefined;
      const dateRange = dateText?.match(/(\d{1,2})(?:\s*[-–]\s*(\d{1,2}))?/);
      if (month === undefined || !dateRange) continue;
      const startDay = Number(dateRange[1]);
      const endDay = Number(dateRange[2] || dateRange[1]);
      const startDate = new Date(Date.UTC(year, month, startDay));
      const endDate = new Date(Date.UTC(year, month, endDay));
      const isoDate = startDate.toISOString().slice(0, 10);
      const easternTodayParts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now).map((part) => [part.type, part.value]));
      const easternToday = `${easternTodayParts.year}-${easternTodayParts.month}-${easternTodayParts.day}`;
      const horizonDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(horizon);
      if (isoDate < easternToday || isoDate > horizonDate) continue;
      events.push(makeEvent({ id: `fed-fomc-${isoDate}`, title: `FOMC meeting${endDay !== startDay ? ` · ${startDay}–${endDay}` : ''}`, category: 'monetary-policy', source: 'Federal Reserve Board', sourceUrl: FED_CALENDAR_URL, eventDate: isoDate, startsAt: null, endsAt: endDate.toISOString().slice(0, 10), timeZone: 'America/New_York', dateOnly: true }));
    }
  }
  return events;
}

export async function loadOfficialEconomicCalendar(fetcher: typeof fetch = fetch, now = new Date()): Promise<{ events: EconomicCalendarEvent[]; unavailableSources: string[] }> {
  const sources = [
    { name: 'U.S. Bureau of Labor Statistics calendar', url: BLS_ICS_URL, parse: (body: string) => parseBlsCalendar(body, now) },
    { name: 'Federal Reserve FOMC calendar', url: FED_CALENDAR_URL, parse: (body: string) => parseFedCalendar(body, now) },
  ];
  const results = await Promise.all(sources.map(async (source) => {
    try {
      const response = await fetcher(source.url, { headers: { Accept: 'text/calendar, text/html;q=0.9, */*;q=0.8', 'User-Agent': 'Mozilla/5.0 (compatible; ProjectOrion/1.0)' }, signal: AbortSignal.timeout(12_000), next: { revalidate: 900 } });
      if (!response.ok) return { source, events: null };
      const body = await response.text();
      return { source, events: source.parse(body) };
    } catch { return { source, events: null }; }
  }));
  const events = results.flatMap((result) => result.events || []).sort((a, b) => (a.startsAt || a.endsAt || '').localeCompare(b.startsAt || b.endsAt || '')).slice(0, 100);
  return { events, unavailableSources: results.filter((result) => result.events === null).map((result) => result.source.name) };
}
