import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { database } from './db.ts';
import { publicProperties } from './domain.ts';
import type { IncomingMessage, ServerResponse } from 'node:http';
const escape = (s: unknown) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
export async function publicPageHTML(path: string, template?: string) {
  const origin = process.env.APP_ORIGIN ?? 'https://www.yournextcorner.com';
  let title = 'Property partnerships — Your Next Corner',
    description =
      'Join the free 90-day founding partnership. Share up to five reviewed properties with renters exploring neighborhoods.',
    content =
      '<h1>Connect Your Properties With Renters Finding Their Next Neighborhood</h1><p>Join our free 90-day founding partnership. Up to five properties, no upfront fees, no automatic billing.</p><a href="/partners/apply">Become a Founding Partner</a>',
    status = 200,
    structured = '';
  if (path.startsWith('/properties/')) {
    const p = process.env.DATABASE_URL
      ? (await publicProperties(database(), { slug: path.slice('/properties/'.length) }))[0]
      : null;
    if (!p) {
      status = 404;
      title = 'Property unavailable — Your Next Corner';
      description = 'This property is not currently published.';
      content =
        '<h1>Property unavailable</h1><p>This listing is not currently published.</p><a href="/start">Explore neighborhoods</a>';
    } else {
      const d = p.data;
      title = `${d.name} — Your Next Corner`;
      description = d.description.slice(0, 160);
      content = `<h1>${escape(d.name)}</h1><p>${escape(d.address)}, ${escape(d.state)} ${escape(d.zip)}</p><p>${escape(d.description)}</p><p>Advertised rent: $${d.rentMin}–$${d.rentMax} per month. Confirm pricing and availability directly with the property manager.</p><a href="/api/out/${p.id}" rel="nofollow">Visit Leasing Website</a>`;
      structured = `<script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@type': 'ApartmentComplex', name: d.name, description: d.description, url: `${origin}${path}`, address: { '@type': 'PostalAddress', streetAddress: d.address, addressRegion: d.state, postalCode: d.zip, addressCountry: 'US' } }).replace(/</g, '\\u003c')}</script>`;
    }
  }
  const html = template ?? (await readFile(resolve(process.env.DIST_DIR ?? 'dist', 'index.html'), 'utf8'));
  return {
    status,
    html: html
      .replace(/<title>[\s\S]*?<\/title>/, `<title>${escape(title)}</title>`)
      .replace(/<meta\s+name="description"[^>]*>/, '')
      .replace(
        '</head>',
        `<meta name="description" content="${escape(description)}"><meta property="og:title" content="${escape(title)}"><meta property="og:description" content="${escape(description)}"><meta property="og:type" content="website"><meta property="og:url" content="${escape(origin + path)}"><link rel="canonical" href="${escape(origin + path)}">${status === 404 ? '<meta name="robots" content="noindex">' : ''}${structured}</head>`,
      )
      .replace('<div id="root"></div>', `<div id="root"><main class="partner-page">${content}</main></div>`),
  };
}
export async function publicPagesAPI(req: IncomingMessage, res: ServerResponse) {
  try {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const slug = url.searchParams.get('slug');
    const path = slug ? `/properties/${slug}` : '/partners';
    const result = await publicPageHTML(path);
    res.writeHead(result.status, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(result.html);
  } catch {
    res.writeHead(503, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' });
    res.end('This page is temporarily unavailable. Please try again.');
  }
}
export async function propertySitemap(_req: IncomingMessage, res: ServerResponse) {
  try {
    const origin = process.env.APP_ORIGIN ?? 'https://www.yournextcorner.com';
    const rows = process.env.DATABASE_URL ? await publicProperties(database()) : [];
    res.writeHead(200, { 'Content-Type': 'application/xml', 'Cache-Control': 'no-store' });
    res.end(
      `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${['/partners', ...rows.map((p) => `/properties/${p.slug}`)].map((path) => `<url><loc>${escape(origin + path)}</loc></url>`).join('')}</urlset>`,
    );
  } catch {
    res.writeHead(503);
    res.end();
  }
}
