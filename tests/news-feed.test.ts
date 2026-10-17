import test from 'node:test';
import assert from 'node:assert/strict';
import { loadOfficialNews, OFFICIAL_NEWS_FEEDS, parseOfficialNewsFeed } from '../src/lib/news/official-feeds';

test('official BLS Atom release feed parses published facts and source links', () => {
  const feed = OFFICIAL_NEWS_FEEDS[0];
  const xml = `<feed><entry><title>CPI &amp; prices</title><link rel="alternate" href="https://www.bls.gov/news.release/cpi.htm"/><updated>2026-10-14T08:30:00-04:00</updated><summary><![CDATA[Consumer prices <b>changed</b>.]]></summary></entry></feed>`;
  const items = parseOfficialNewsFeed(xml, feed);
  assert.equal(items.length, 1);
  assert.equal(items[0].title, 'CPI & prices');
  assert.equal(items[0].publishedAt, '2026-10-14T12:30:00.000Z');
  assert.equal(items[0].summary, 'Consumer prices changed.');
  assert.equal(items[0].source, 'U.S. Bureau of Labor Statistics');
});

test('official news parser rejects unsafe links and malformed or oversized feeds', () => {
  const feed = OFFICIAL_NEWS_FEEDS[2];
  assert.deepEqual(parseOfficialNewsFeed('<html/>', feed), []);
  assert.deepEqual(parseOfficialNewsFeed('<rss>' + 'x'.repeat(1_000_001) + '</rss>', feed), []);
  assert.deepEqual(parseOfficialNewsFeed('<rss><item><title>bad</title><link>https://evil.example/story</link></item></rss>', feed), []);
});

test('official feed loader merges source items and reports partial upstream failures', async () => {
  const result = await loadOfficialNews(async (input) => {
    const url = String(input);
    if (url.includes('/feed/empsit.rss')) return Response.json({});
    if (url.includes('/feed/cpi.rss')) throw new Error('offline');
    return new Response('<rss><channel><item><title>Fed action</title><link>https://www.federalreserve.gov/newsevents/pressreleases/monetary.htm</link><pubDate>Fri, 16 Oct 2026 10:00:00 -0400</pubDate></item></channel></rss>');
  });
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].title, 'Fed action');
  assert.equal(result.unavailableSources.length, 1);
  assert.match(result.unavailableSources[0], /Consumer Price Index/);
});
