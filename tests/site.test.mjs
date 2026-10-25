import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
const read = file => readFileSync(new URL('../' + file, import.meta.url), 'utf8');
test('main URL contains the application; old app URL preserves auth query and hash', () => {
  const html = read('index.html');
  assert.match(html, /id="casesInput"/);
  assert.match(html, /src="script.js\?v=1.14"/);
  assert.doesNotMatch(html, /landing\.(js|css)|id="root"/);
  assert.match(read('app.html'), /location.replace\('\.\/' \+ location.search \+ location.hash\)/);
  const manifest = JSON.parse(read('manifest.webmanifest'));
  assert.equal(manifest.start_url, './');
  assert.equal(manifest.id, './app.html', 'installed PWA identity must survive entry-point change');
  assert.doesNotMatch(read('sw.js'), /landing\./);
});
test('production build contains the single PWA, privacy and install resources', () => {
  execFileSync('npm', ['run', 'build'], { stdio: 'pipe' });
  for (const file of ['index.html','app.html','script.js','style.css','sw.js','manifest.webmanifest','privacy.html','icon-192.png','icon-512.png','.nojekyll','fonts/manrope-cyrillic-wght-normal.woff2']) {
    assert.ok(existsSync(new URL('../dist/' + file, import.meta.url)), file);
  }
  assert.equal(read('dist/index.html'), read('index.html'));
  assert.equal(existsSync(new URL('../dist/landing.js', import.meta.url)), false);
});
