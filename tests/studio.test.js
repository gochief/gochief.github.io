const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const serviceModule = import('../studio/service.mjs');
const serverModule = import('../studio/server.mjs');
const project = path.resolve(__dirname, '..');

const ORIGINAL = [
  '---', 'layout: post', 'title: Original', 'date: 2024-11-28',
  'categories: [Notes]', 'tags: [preserved]', 'feature: /assets/cover.png',
  'summary: Original summary', '---', '', '# Original', '', 'Original body.', ''
].join('\n');

async function fixture(t) {
  const { Studio, run } = await serviceModule;
  const base = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'gochief-studio-test-')));
  const root = path.join(base, 'repo');
  await fs.mkdir(path.join(root, '_posts'), { recursive: true });
  await fs.writeFile(path.join(root, '_posts', '2024-11-28-original.md'), ORIGINAL);
  await fs.writeFile(path.join(root, '.gitignore'), '.blog-studio/\n');
  await fs.writeFile(path.join(root, 'other.txt'), 'Original unrelated file\n');
  const git = async args => run('git', args, { cwd: root });
  await git(['init', '-b', 'codex/studio-test']);
  await git(['config', 'user.name', 'Studio Test']);
  await git(['config', 'user.email', 'studio@example.invalid']);
  await git(['config', 'commit.gpgsign', 'false']);
  await git(['add', '.']);
  await git(['commit', '-m', 'Initial fixture']);
  const studio = new Studio(root);
  await studio.init();
  t.after(async () => {
    for (const preview of studio.previews.values()) await fs.rm(preview.folder, { recursive: true, force: true });
    await fs.rm(base, { recursive: true, force: true });
  });
  return { root, base, studio, git, run };
}
async function article(studio, sourceFile) {
  const draft = await studio.createDraft(sourceFile);
  return studio.updateDraft(draft.id, draft.version, {
    ...draft.fields, title: 'A new article', summary: 'A useful summary.',
    body: '# A new article\n\nUseful content.\n', title_en: 'English article',
    content_en: '# English article\n\nEnglish content.\n'
  });
}

test('studio saves recoverable drafts without changing article files and rejects stale writes', async t => {
  const { studio, root } = await fixture(t);
  const draft = await article(studio);
  assert.equal((await fs.readdir(path.join(root, '_posts'))).length, 1);
  assert.equal((await studio.readDraft(draft.id)).fields.title, 'A new article');
  const first = studio.updateDraft(draft.id, draft.version, { ...draft.fields, title: 'First save' });
  const stale = studio.updateDraft(draft.id, draft.version, { ...draft.fields, title: 'Stale save' });
  const results = await Promise.allSettled([first, stale]);
  assert.equal(results[0].status, 'fulfilled');
  assert.equal(results[1].reason.status, 409);
  assert.equal((await studio.readDraft(draft.id)).fields.title, 'First save');
});

test('studio rejects path traversal, symlinks and invalid dates', async t => {
  const { studio, root } = await fixture(t);
  await assert.rejects(studio.createDraft('../../.git/config'), /路径/);
  await assert.rejects(studio.readDraft('../../config'), /标识/);
  await fs.symlink(path.join(root, 'other.txt'), path.join(root, '_posts', '2024-11-28-link.md'));
  await assert.rejects(studio.createDraft('2024-11-28-link.md'), /符号链接/);
  const draft = await article(studio);
  const invalidDate = await studio.updateDraft(draft.id, draft.version, { ...draft.fields, date: '2026-02-30' });
  assert.equal((await studio.readDraft(draft.id)).fields.body, draft.fields.body);
  await assert.rejects(studio.prepareReview(invalidDate.id), /日期/);
  const invalidSlug = await studio.updateDraft(draft.id, invalidDate.version, { ...draft.fields, slug: '../../escape' });
  await assert.rejects(studio.prepareReview(invalidSlug.id), /地址/);
});

test('article commits preserve metadata and leave unrelated staged changes untouched', async t => {
  const { studio, root, git } = await fixture(t);
  const draft = await article(studio, '2024-11-28-original.md');
  await fs.writeFile(path.join(root, 'other.txt'), 'Unrelated staged change\n');
  await git(['add', 'other.txt']);
  const review = await studio.prepareReview(draft.id);
  assert.match(review.diff, /\+title: A new article/);
  const message = 'Update article $(touch SHOULD_NOT_EXIST)';
  const result = await studio.submit(review.id, message, false);
  assert.equal(result.pushed, false);
  assert.equal((await git(['show', '--format=', '--name-only', 'HEAD'])).stdout.trim(), '_posts/2024-11-28-original.md');
  assert.equal((await git(['diff', '--cached', '--name-only'])).stdout.trim(), 'other.txt');
  const saved = await fs.readFile(path.join(root, '_posts', '2024-11-28-original.md'), 'utf8');
  assert.match(saved, /feature: ["']?\/assets\/cover\.png/);
  assert.match(saved, /preserved/);
  assert.match(saved, /English content/);
  assert.equal((await git(['log', '-1', '--format=%s'])).stdout.trim(), message);
  await assert.rejects(fs.access(path.join(root, 'SHOULD_NOT_EXIST')), { code: 'ENOENT' });
  const edited = await studio.updateDraft(result.draft.id, result.draft.version, { ...result.draft.fields, body: 'Edited after submission' });
  assert.equal(edited.hasChanges, true);
  const reverted = await studio.updateDraft(edited.id, edited.version, result.draft.fields);
  assert.equal(reverted.hasChanges, false);
});

test('confirmation detects external edits, newer draft revisions and changed Git HEAD', async t => {
  const { studio, root, git } = await fixture(t);
  const existing = await article(studio, '2024-11-28-original.md');
  await fs.writeFile(path.join(root, '_posts', '2024-11-28-original.md'), ORIGINAL + '\nExternal edit\n');
  await assert.rejects(studio.prepareReview(existing.id), /其他程序修改/);
  const draft = await article(studio);
  const review = await studio.prepareReview(draft.id);
  const updated = await studio.updateDraft(draft.id, draft.version, { ...draft.fields, body: 'Changed after review' });
  await assert.rejects(studio.submit(review.id, 'Stale confirmation', false), /草稿又发生/);
  const second = await studio.prepareReview(updated.id);
  await fs.writeFile(path.join(root, 'other.txt'), 'A different commit\n');
  await git(['add', 'other.txt']);
  await git(['commit', '-m', 'Another local change']);
  await assert.rejects(studio.submit(second.id, 'Stale HEAD', false), /Git 分支或提交已变化/);
});

test('selected staged article is not silently overwritten', async t => {
  const { studio, root, git } = await fixture(t);
  await fs.writeFile(path.join(root, '_posts', '2024-11-28-original.md'), ORIGINAL + 'Already staged\n');
  await git(['add', '_posts/2024-11-28-original.md']);
  const draft = await article(studio, '2024-11-28-original.md');
  await assert.rejects(studio.prepareReview(draft.id), /暂存改动/);
});

test('failed push retains the commit and retry pushes the same commit to a local test remote', async t => {
  const { studio, base, root, git, run } = await fixture(t);
  const draft = await article(studio);
  await git(['remote', 'add', 'origin', path.join(base, 'missing-remote.git')]);
  const first = await studio.prepareReview(draft.id);
  const result = await studio.submit(first.id, 'Add test article', true);
  assert.ok(result.commit);
  assert.ok(result.pushError);
  assert.equal(result.pushed, false);
  assert.equal((await git(['rev-list', '--count', 'HEAD'])).stdout.trim(), '2');
  const remote = path.join(base, 'test-remote.git');
  await run('git', ['init', '--bare', remote], { cwd: root });
  await git(['remote', 'set-url', 'origin', remote]);
  const retry = await studio.prepareReview(draft.id);
  assert.equal(retry.changed, false);
  const success = await studio.submit(retry.id, 'Retry push', true);
  assert.equal(success.commit, result.commit);
  assert.equal(success.pushed, true);
  assert.equal((await git(['rev-list', '--count', 'HEAD'])).stdout.trim(), '2');
  assert.equal((await run('git', ['--git-dir', remote, 'rev-parse', 'refs/heads/codex/studio-test'])).stdout.trim(), result.commit);
});

test('failed commit restores the original article and unstages only its own file', async t => {
  const { studio, root, git } = await fixture(t);
  const hook = path.join(root, '.git', 'hooks', 'pre-commit');
  await fs.writeFile(hook, '#!/bin/sh\necho "Commit stopped by fixture" >&2\nexit 1\n', { mode: 0o755 });
  const existing = await article(studio, '2024-11-28-original.md');
  const review = await studio.prepareReview(existing.id);
  await assert.rejects(studio.submit(review.id, 'Should roll back', false), /Commit stopped/);
  assert.equal(await fs.readFile(path.join(root, '_posts', '2024-11-28-original.md'), 'utf8'), ORIGINAL);
  assert.equal((await git(['status', '--porcelain'])).stdout.trim(), '');
  const fresh = await article(studio);
  const newReview = await studio.prepareReview(fresh.id);
  await assert.rejects(studio.submit(newReview.id, 'New post should roll back', false), /Commit stopped/);
  assert.equal((await fs.readdir(path.join(root, '_posts'))).length, 1);
  assert.equal((await git(['status', '--porcelain'])).stdout.trim(), '');
});

test('studio API validates origin, CSRF token and host before accepting writes', { timeout: 15000 }, async t => {
  const { studio } = await fixture(t);
  const { createStudioServer } = await serverModule;
  const server = createStudioServer(studio);
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const port = server.address().port;
  const origin = 'http://127.0.0.1:' + port;
  const boot = await (await fetch(origin + '/api/bootstrap')).json();
  assert.match(boot.token, /^[a-f0-9]{64}$/);
  const request = headers => fetch(origin + '/api/drafts', { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: '{}' });
  assert.equal((await request({})).status, 403);
  assert.equal((await request({ Origin: 'http://evil.example', 'X-Studio-Token': boot.token })).status, 403);
  assert.equal((await request({ Origin: origin, 'X-Studio-Token': 'wrong' })).status, 403);
  assert.equal((await request({ Origin: origin, 'X-Studio-Token': boot.token })).status, 201);
  assert.equal((await fetch(origin + '/server.mjs')).status, 404);
  const badHost = await new Promise((resolve, reject) => {
    const request = http.get({ hostname: '127.0.0.1', port, path: '/api/bootstrap', headers: { Host: 'evil.example' } }, response => {
      response.resume(); resolve(response.statusCode);
    });
    request.on('error', reject);
  });
  assert.equal(badHost, 403);
});

test('real Jekyll preview preserves the source and renders bilingual headings with isolated IDs', async t => {
  const { studio, root } = await fixture(t);
  const skip = new Set(['.git', '.blog-studio', '.bundle', 'vendor', 'node_modules', 'studio', 'tests', 'scripts']);
  await fs.cp(project, root, {
    recursive: true,
    filter: entry => {
      const relative = path.relative(project, entry);
      const first = relative.split(path.sep)[0];
      return !relative || (!skip.has(first) && !first.startsWith('_site') && !first.startsWith('.jekyll') && !first.endsWith('.command'));
    }
  });
  studio.env.BUNDLE_PATH = path.resolve(project, process.env.BUNDLE_PATH || 'vendor/bundle');
  const draft = await article(studio, '2024-11-28-original.md');
  const preview = await studio.preview(draft.id);
  assert.match(preview.url, /^\/preview\/[a-f0-9-]{36}\/2024-11-28\/original\.html$/);
  const match = preview.url.match(/^\/preview\/([^/]+)(\/.*)$/);
  const file = await studio.previewFile(match[1], match[2]);
  const html = file.body.toString();
  assert.match(html, /A new article/);
  assert.match(html, /English content/);
  assert.match(html, /id="en-english-article"/);
  assert.match(html, /data-language="zh"/);
  assert.equal(await fs.readFile(path.join(root, '_posts', '2024-11-28-original.md'), 'utf8'), ORIGINAL);
  await assert.rejects(studio.previewFile(match[1], '/../../.git/config'), /预览路径/);
});
