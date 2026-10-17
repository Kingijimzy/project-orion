import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadOfficialEconomicCalendar, parseBlsCalendar, parseBlsScheduleList, parseFedCalendar } from '../src/lib/news/economic-calendar';

test('BLS calendar parses only upcoming events, preserves Eastern release time, and leaves unsourced figures empty', () => {
  const ics = [
    'BEGIN:VCALENDAR',
    'BEGIN:VEVENT', 'UID:cpi-1', 'DTSTART;TZID=US-Eastern:20261020T083000', 'SUMMARY:Consumer Price Index', 'END:VEVENT',
    'BEGIN:VEVENT', 'UID:jobs-1', 'DTSTART;TZID=US-Eastern:20261106T083000', 'SUMMARY:Employment Situation', 'END:VEVENT',
    'BEGIN:VEVENT', 'UID:old-1', 'DTSTART;TZID=US-Eastern:20261001T083000', 'SUMMARY:Past release', 'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');
  const events = parseBlsCalendar(ics, new Date('2026-10-16T12:00:00Z'), 45);
  assert.equal(events.length, 2);
  assert.equal(events[0].title, 'Consumer Price Index');
  assert.equal(events[0].eventDate, '2026-10-20');
  assert.equal(events[0].startsAt, '2026-10-20T12:30:00.000Z');
  assert.equal(events[0].category, 'inflation');
  assert.equal(events[0].impact, 'not-provided');
  assert.equal(events[0].actual, null);
  assert.equal(events[0].forecast, null);
  assert.equal(events[0].previous, null);
  assert.equal(events[1].startsAt, '2026-11-06T13:30:00.000Z'); // EST after daylight saving ends
});

test('BLS calendar rejects malformed or oversized feeds', () => {
  assert.deepEqual(parseBlsCalendar('<html>not an ICS calendar</html>'), []);
  assert.deepEqual(parseBlsCalendar(`BEGIN:VCALENDAR\n${'x'.repeat(2_000_001)}`), []);
});

test('BLS official month-list fallback parses actual Eastern release times and excludes holidays and past releases', () => {
  const html = `<html><table class="release-list"><tbody>
    <tr><td>Tuesday, October 20, 2026</td><td>10:00 AM</td><td><p><strong>State Employment and Unemployment (Monthly)</strong> for September 2026</p></td></tr>
    <tr><td>Friday, November 6, 2026</td><td>08:30 AM</td><td><p><strong>Employment Situation</strong> for October 2026</p></td></tr>
    <tr><td>Monday, November 9, 2026</td><td>&nbsp;</td><td><p><strong>Veterans Day</strong></p></td></tr>
    <tr><td>Friday, October 2, 2026</td><td>08:30 AM</td><td><p><strong>Employment Situation</strong> for September 2026</p></td></tr>
  </tbody></table></html>`;
  const events = parseBlsScheduleList(html, 'https://www.bls.gov/schedule/2026/11_sched_list.htm', new Date('2026-10-16T12:00:00Z'), 45);
  assert.equal(events.length, 2);
  assert.equal(events[0].title, 'State Employment and Unemployment (Monthly) for September 2026');
  assert.equal(events[0].startsAt, '2026-10-20T14:00:00.000Z');
  assert.equal(events[1].title, 'Employment Situation for October 2026');
  assert.equal(events[1].startsAt, '2026-11-06T13:30:00.000Z');
  assert.equal(events[1].sourceUrl, 'https://www.bls.gov/schedule/2026/11_sched_list.htm');
});

test('Federal Reserve parser includes dated meeting ranges and does not invent an announcement time', () => {
  const html = `<html><body><div class="panel panel-default"><h4><a>2026 FOMC Meetings</a></h4>
    <div class="row fomc-meeting"><div class="fomc-meeting__month"><strong>October</strong></div><div class="fomc-meeting__date">27-28</div></div>
    <div class="fomc-meeting--shaded row fomc-meeting"><div class="fomc-meeting__month"><strong>December</strong></div><div class="fomc-meeting__date">8-9*</div></div>
    </div></body></html>`;
  const events = parseFedCalendar(html, new Date('2026-10-28T16:00:00Z'), 90);
  assert.equal(events.length, 1);
  assert.equal(events[0].title, 'FOMC meeting · 8–9');
  assert.equal(events[0].startsAt, null);
  assert.equal(events[0].endsAt, '2026-12-09');
  assert.equal(events[0].eventDate, '2026-12-08');
  assert.equal(events[0].dateOnly, true);
  assert.equal(events[0].sourceUrl, 'https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm');
});

test('calendar source errors are visible as unavailable rather than converted into empty scheduled events', async () => {
  const result = await loadOfficialEconomicCalendar(async () => new Response('unavailable', { status: 503 }), new Date('2026-10-16T12:00:00Z'));
  assert.deepEqual(result.events, []);
  assert.equal(result.unavailableSources.length, 2);
});
