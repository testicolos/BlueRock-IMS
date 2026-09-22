import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { allowedViews, resolveView, viewUrl, type View } from '../src/lib/view-navigation';

const origin = 'https://bluerock-ims.vercel.app';
const expectedViews: View[] = ['dashboard', 'materials', 'office-inventory', 'locations', 'scanner', 'issues', 'users', 'scans', 'checklist', 'samples-report'];
let checks = 0;

function check(name: string, run: () => void) {
  run();
  checks += 1;
  console.log(`PASS ${name}`);
}

check('all application pages are supported', () => {
  assert.deepEqual([...allowedViews].sort(), [...expectedViews].sort());
});

for (const view of expectedViews) {
  check(`administrator refresh restores ${view}`, () => {
    const next = viewUrl(`${origin}/?view=dashboard`, view, 'ADMIN');
    assert.ok(next.startsWith('/'), 'navigation must remain a relative URL');
    assert.ok(!next.startsWith('//'), 'navigation must not be protocol-relative');
    const reloaded = new URL(next, origin);
    assert.equal(reloaded.origin, origin);
    assert.equal(resolveView(reloaded.search, 'ADMIN'), view);
    assert.equal(resolveView(`?view=${view}`, 'ADMIN'), view);
  });

  check(`scanner role cannot restore administrative page ${view}`, () => {
    assert.equal(resolveView(`?view=${view}`, 'SCANNER'), 'scanner');
    const next = new URL(viewUrl(`${origin}/?view=${view}`, view, 'SCANNER'), origin);
    assert.equal(next.searchParams.get('view'), 'scanner');
    assert.equal(resolveView(next.search, 'SCANNER'), 'scanner');
  });
}

check('missing, empty, invalid, and prototype-like pages safely fall back', () => {
  for (const search of ['', '?', '?filter=active', '?view=', '?view=unknown', '?view=Scans', '?view=constructor', '?view=__proto__', '?view=toString', '?view=%3Cscript%3E']) {
    assert.equal(resolveView(search, 'ADMIN'), 'dashboard', `administrator fallback for ${search}`);
    assert.equal(resolveView(search, 'SCANNER'), 'scanner', `scanner fallback for ${search}`);
  }
});

check('URL-encoded valid pages are restored', () => {
  assert.equal(resolveView('?view=%73cans', 'ADMIN'), 'scans');
});

check('page changes preserve the pathname, other query parameters, and hash', () => {
  const next = viewUrl(`${origin}/inventory?filter=needs+repair&tag=a&tag=b&view=materials#unit-42`, 'checklist', 'ADMIN');
  const parsed = new URL(next, origin);
  assert.equal(parsed.pathname, '/inventory');
  assert.equal(parsed.searchParams.get('view'), 'checklist');
  assert.equal(parsed.searchParams.get('filter'), 'needs repair');
  assert.deepEqual(parsed.searchParams.getAll('tag'), ['a', 'b']);
  assert.equal(parsed.hash, '#unit-42');
  assert.equal(parsed.origin, origin);
});

check('page changes normalize repeated page parameters to one current page', () => {
  const next = new URL(viewUrl(`${origin}/?view=scans&filter=active&view=users`, 'locations', 'ADMIN'), origin);
  assert.deepEqual(next.searchParams.getAll('view'), ['locations']);
  assert.equal(next.searchParams.get('filter'), 'active');
});

check('scanner URL normalization preserves unrelated state', () => {
  const next = new URL(viewUrl(`${origin}/?view=users&location=warehouse#capture`, 'users', 'SCANNER'), origin);
  assert.equal(next.searchParams.get('view'), 'scanner');
  assert.equal(next.searchParams.get('location'), 'warehouse');
  assert.equal(next.hash, '#capture');
});

check('scanner login exposes Office Inventory scanning', () => {
  const pageSource = readFileSync(new URL('../src/app/page.tsx', import.meta.url), 'utf8');
  const officeScanSource = readFileSync(new URL('../src/app/office-scan/page.tsx', import.meta.url), 'utf8');
  assert.match(pageSource, /scannerOfficeNav[^>]*href="\/office-scan"/);
  assert.match(pageSource, /Scan Office Inventory/);
  assert.match(officeScanSource, /Office Inventory Validation/);
  assert.match(officeScanSource, /Open barcode camera/);
});

check('sequential navigation and saved history URLs restore the correct pages', () => {
  const pages: View[] = ['materials', 'scanner', 'checklist', 'samples-report', 'scans', 'dashboard'];
  const history: URL[] = [];
  let current = new URL(`${origin}/?filter=active#inventory`);
  for (const page of pages) {
    current = new URL(viewUrl(current.href, page, 'ADMIN'), origin);
    history.push(current);
    assert.equal(resolveView(current.search, 'ADMIN'), page);
    assert.equal(current.searchParams.get('filter'), 'active');
    assert.equal(current.hash, '#inventory');
  }
  for (let index = history.length - 1; index >= 0; index -= 1) {
    assert.equal(resolveView(history[index].search, 'ADMIN'), pages[index], 'back navigation must restore the URL page');
  }
  for (let index = 0; index < history.length; index += 1) {
    assert.equal(resolveView(history[index].search, 'ADMIN'), pages[index], 'forward navigation must restore the URL page');
  }
});

console.log(`\n${checks} navigation checks passed.`);
