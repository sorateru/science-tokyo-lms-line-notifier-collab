import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';

test('shared Cloudflare config stays deployment-neutral and safe by default', () => {
  const wrangler = JSON.parse(fs.readFileSync('wrangler.example.jsonc', 'utf8'));
  assert.equal(
    wrangler.d1_databases[0].database_id,
    'REPLACE_WITH_DATABASE_ID',
    '共有テンプレートへ実際のD1 database_idを入れないでください'
  );
  assert.equal(wrangler.vars.DRY_RUN, 'true', '共有テンプレートはdry-runを既定にしてください');
});

test('secret fields are empty and local deployment files are ignored', () => {
  const envExample = fs.readFileSync('.env.example', 'utf8');
  for (const name of [
    'APP_PASSWORD', 'MOODLE_ICAL_URL', 'LINE_CHANNEL_ACCESS_TOKEN', 'LINE_USER_ID'
  ]) {
    assert.match(envExample, new RegExp(`^${name}=$`, 'm'), `${name}は空欄にしてください`);
  }

  const gitignore = fs.readFileSync('.gitignore', 'utf8');
  for (const entry of ['.env', '.dev.vars', 'wrangler.jsonc', 'data/', 'node_modules/']) {
    assert.ok(gitignore.split(/\r?\n/).includes(entry), `${entry}をGit管理外にしてください`);
  }
});
