export type OfficialNewsItem = { title: string; url: string; publishedAt: string | null; summary: string; source: string; topic: string };

export const OFFICIAL_NEWS_FEEDS = [
  { url: 'https://www.bls.gov/feed/empsit.rss', host: 'www.bls.gov', source: 'U.S. Bureau of Labor Statistics', topic: 'Employment Situation' },
  { url: 'https://www.bls.gov/feed/cpi.rss', host: 'www.bls.gov', source: 'U.S. Bureau of Labor Statistics', topic: 'Consumer Price Index' },
  { url: 'https://www.federalreserve.gov/feeds/press_monetary.xml', host: 'www.federalreserve.gov', source: 'Federal Reserve Board', topic: 'Monetary Policy' },
] as const;

function decodeXml(value: string) {
  return value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<[^>]*>/g, ' ').replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (entity, code: string) => {
    if (code === 'amp') return '&'; if (code === 'lt') return '<'; if (code === 'gt') return '>'; if (code === 'quot') return '"'; if (code === 'apos') return "'";
    const number = code[1]?.toLowerCase() === 'x' ? Number.parseInt(code.slice(2), 16) : Number.parseInt(code.slice(1), 10);
    try { return Number.isFinite(number) ? String.fromCodePoint(number) : ''; } catch { return ''; }
  }).replace(/\s+/g, ' ').replace(/\s+([.,;:!?])/g, '$1').trim();
}

function tag(block: string, name: string) {
  const found = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, 'i'));
  return found?.[1] ? decodeXml(found[1]) : '';
}

function link(block: string, expectedHost: string): string | null {
  const href = block.match(/<link\b[^>]*\bhref=["']([^"']+)["'][^>]*\/?\s*>/i)?.[1];
  const text = href || tag(block, 'link') || tag(block, 'guid');
  try {
    const parsed = new URL(text);
    return parsed.protocol === 'https:' && (parsed.hostname === expectedHost || parsed.hostname.endsWith(`.${expectedHost}`)) ? parsed.toString() : null;
  } catch { return null; }
}

export function parseOfficialNewsFeed(xml: string, feed: typeof OFFICIAL_NEWS_FEEDS[number]): OfficialNewsItem[] {
  if (xml.length > 1_000_000 || !/<(?:rss|feed|rdf:RDF)\b/i.test(xml)) return [];
  const blocks = xml.match(/<(?:item|entry)\b[^>]*>[\s\S]*?<\/(?:item|entry)>/gi) || [];
  return blocks.flatMap((block) => {
    const title = tag(block, 'title');
    const url = link(block, feed.host);
    const dateRaw = tag(block, 'published') || tag(block, 'updated') || tag(block, 'pubDate') || tag(block, 'dc:date');
    const parsedDate = dateRaw ? new Date(dateRaw) : null;
    const publishedAt = parsedDate && Number.isFinite(parsedDate.getTime()) ? parsedDate.toISOString() : null;
    const summary = tag(block, 'summary') || tag(block, 'description') || tag(block, 'content');
    if (!title || !url) return [];
    return [{ title: title.slice(0, 240), url, publishedAt, summary: summary.slice(0, 500), source: feed.source, topic: feed.topic }];
  });
}

export async function loadOfficialNews(fetcher: typeof fetch = fetch): Promise<{ items: OfficialNewsItem[]; unavailableSources: string[] }> {
  const results = await Promise.all(OFFICIAL_NEWS_FEEDS.map(async (feed) => {
    try {
      const response = await fetcher(feed.url, { headers: { Accept: 'application/atom+xml, application/rss+xml, application/xml, text/xml' }, signal: AbortSignal.timeout(10_000), next: { revalidate: 300 } });
      if (!response.ok) return { feed, items: null };
      const xml = await response.text();
      return { feed, items: parseOfficialNewsFeed(xml, feed) };
    } catch { return { feed, items: null }; }
  }));
  const items = results.flatMap((result) => result.items || []).sort((a, b) => (b.publishedAt || '').localeCompare(a.publishedAt || '')).slice(0, 50);
  return { items, unavailableSources: results.filter((result) => result.items === null).map((result) => result.feed.source + ' · ' + result.feed.topic) };
}
