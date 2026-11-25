import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
import { existsSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIELDS = ['title', 'title_en', 'date', 'slug', 'categories', 'summary', 'summary_en', 'body', 'content_en', 'comments', 'hide'];
const POST = /^\d{4}-\d{2}-\d{2}-[^/\\\0]+\.md$/;
const ID = /^[a-f0-9-]{36}$/;

export class StudioError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}
export const hash = value => createHash('sha256').update(value).digest('hex');
export function today() {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const get = key => parts.find(part => part.type === key).value;
  return [get('year'), get('month'), get('day')].join('-');
}
export function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = execFile(command, args, { timeout: 90_000, maxBuffer: 5 * 1024 * 1024, ...options }, (error, stdout, stderr) => {
      if (error && !(options.allowedCodes || []).includes(error.code)) {
        const message = (stderr || stdout || error.message).trim().replace(/https:\/\/[^/@\s]+:[^/@\s]+@/g, 'https://***@');
        const failure = new StudioError(message || '操作未完成', 500);
        failure.code = error.code;
        reject(failure);
      } else resolve({ stdout, stderr });
    });
    if (options.input !== undefined) child.stdin.end(options.input);
  });
}

function normalize(input, validateAddress = false) {
  if (!input || typeof input !== 'object') throw new StudioError('文章格式不正确');
  const fields = {};
  for (const key of FIELDS) {
    if (key === 'categories') {
      if (!Array.isArray(input[key])) throw new StudioError('分类必须是列表');
      fields[key] = [...new Set(input[key].map(value => String(value).trim()).filter(Boolean))].slice(0, 20);
    } else if (key === 'comments' || key === 'hide') {
      fields[key] = input[key] === true;
    } else fields[key] = String(input[key] ?? '');
  }
  if (FIELDS.some(key => typeof fields[key] === 'string' && fields[key].length > 500_000)) throw new StudioError('文章内容过长');
  if (validateAddress && (!/^\d{4}-\d{2}-\d{2}$/.test(fields.date) || !Number.isFinite(Date.parse(fields.date + 'T00:00:00Z')) || new Date(fields.date + 'T00:00:00Z').toISOString().slice(0, 10) !== fields.date)) {
    throw new StudioError('请填写有效的文章日期');
  }
  if (validateAddress && !/^[\p{L}\p{N}][\p{L}\p{N}_-]*$/u.test(fields.slug)) throw new StudioError('文章地址请使用文字、数字、短横线或下划线');
  return fields;
}

export class Studio {
  constructor(root, options = {}) {
    this.root = realpathSync(root);
    this.state = path.join(this.root, '.blog-studio');
    this.posts = path.join(this.root, '_posts');
    this.previews = new Map();
    this.reviews = new Map();
    this.queue = Promise.resolve();
    this.previewCount = 0;
    this.gitCommand = options.gitCommand || 'git';
    this.ruby = options.ruby || ['/opt/homebrew/opt/ruby@3.3/bin/ruby', '/usr/local/opt/ruby@3.3/bin/ruby'].find(existsSync) || 'ruby';
    this.env = {
      ...process.env,
      PATH: [path.isAbsolute(this.ruby) ? path.dirname(this.ruby) : null, process.env.PATH].filter(Boolean).join(path.delimiter),
      BUNDLE_GEMFILE: path.join(this.root, 'Gemfile'),
      BUNDLE_PATH: process.env.BUNDLE_PATH || path.join(this.root, 'vendor/bundle'),
      BUNDLE_USER_HOME: path.join(this.state, 'bundler'),
      GIT_TERMINAL_PROMPT: '0',
      GIT_SSH_COMMAND: 'ssh -o BatchMode=yes -o ConnectTimeout=10'
    };
  }

  async init() {
    await mkdir(path.join(this.state, 'drafts'), { recursive: true });
    await mkdir(path.join(this.state, 'previews'), { recursive: true });
    await mkdir(this.posts, { recursive: true });
    if (await realpath(this.posts) !== this.posts) throw new StudioError('_posts 不能是符号链接');
    await this.git(['rev-parse', '--show-toplevel']);
  }
  async git(args, options = {}) { return run(this.gitCommand, args, { cwd: this.root, env: this.env, ...options }); }
  async codec(input) {
    const result = await run(this.ruby, [path.join(HERE, 'post-codec.rb')], { cwd: this.root, env: this.env, input: JSON.stringify(input) });
    return JSON.parse(result.stdout).result;
  }
  async exclusive(operation) {
    const previous = this.queue;
    let release;
    this.queue = new Promise(resolve => { release = resolve; });
    await previous;
    try { return await operation(); } finally { release(); }
  }
  async safePost(filename) {
    if (!POST.test(filename) || path.basename(filename) !== filename) throw new StudioError('文章路径不正确');
    const target = path.join(this.posts, filename);
    try {
      if (await realpath(target) !== target) throw new StudioError('文章不能是符号链接');
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    return target;
  }
  draftPath(id) {
    if (!ID.test(id)) throw new StudioError('草稿标识不正确');
    return path.join(this.state, 'drafts', id + '.json');
  }
  async readDraft(id) {
    try { return JSON.parse(await readFile(this.draftPath(id), 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') throw new StudioError('没有找到这篇草稿', 404); throw error; }
  }
  async storeDraft(draft) {
    const destination = this.draftPath(draft.id);
    const temporary = destination + '.' + randomUUID() + '.tmp';
    await writeFile(temporary, JSON.stringify(draft, null, 2) + '\n', { mode: 0o600 });
    await rename(temporary, destination);
    return draft;
  }
  async listDrafts() {
    const files = (await readdir(path.join(this.state, 'drafts'))).filter(name => ID.test(name.replace(/\.json$/, '')) && name.endsWith('.json'));
    const drafts = await Promise.all(files.map(async name => this.readDraft(name.slice(0, -5))));
    return drafts.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
  async listPosts() {
    const filenames = (await readdir(this.posts)).filter(name => POST.test(name)).sort().reverse();
    const files = [];
    for (const filename of filenames) files.push({ filename, source: await readFile(await this.safePost(filename), 'utf8') });
    return this.codec({ action: 'parse_many', files });
  }
  async gitState() {
    const [branch, head, remote, status] = await Promise.all([
      this.git(['symbolic-ref', '--short', 'HEAD']),
      this.git(['rev-parse', 'HEAD']),
      this.git(['remote', 'get-url', 'origin'], { allowedCodes: [2, 128] }),
      this.git(['status', '--porcelain'])
    ]);
    return { branch: branch.stdout.trim(), head: head.stdout.trim(), remote: remote.stdout.trim().replace(/https:\/\/[^/@\s]+:[^/@\s]+@/g, 'https://***@'), dirty: !!status.stdout.trim() };
  }
  async bootstrap() {
    const [drafts, posts, git] = await Promise.all([this.listDrafts(), this.listPosts(), this.gitState()]);
    return { drafts, posts, git, today: today(), root: this.root };
  }
  async createDraft(sourceFile) {
    return this.exclusive(async () => {
      if (sourceFile) {
        const existing = (await this.listDrafts()).find(draft => draft.sourceFile === sourceFile);
        if (existing) return existing;
      }
      let fields, originalSha = null;
      if (sourceFile) {
        const original = await readFile(await this.safePost(sourceFile), 'utf8');
        originalSha = hash(original);
        fields = await this.codec({ action: 'parse', source: original, filename: sourceFile });
      } else fields = { title: '', title_en: '', date: today(), slug: 'new-post-' + randomUUID().slice(0, 6), categories: [], summary: '', summary_en: '', body: '', content_en: '', comments: false, hide: false };
      const now = new Date().toISOString();
      return this.storeDraft({ id: randomUUID(), version: 1, sourceFile: sourceFile || null, originalSha, fields: normalize(fields), createdAt: now, updatedAt: now, lastCommit: null, pushed: false });
    });
  }
  async updateDraft(id, version, input) {
    return this.exclusive(async () => {
      const draft = await this.readDraft(id);
      if (draft.version !== version) throw new StudioError('草稿已在另一个窗口更新，请刷新后继续', 409);
      draft.fields = normalize(input);
      draft.hasChanges = !draft.lastSubmittedHash || hash(JSON.stringify(draft.fields)) !== draft.lastSubmittedHash;
      draft.version++;
      draft.updatedAt = new Date().toISOString();
      return this.storeDraft(draft);
    });
  }
  filename(draft) { normalize(draft.fields, true); return draft.sourceFile || draft.fields.date + '-' + draft.fields.slug + '.md'; }
  async source(draft, enforce = false) {
    const filename = this.filename(draft);
    const target = await this.safePost(filename);
    let original = '';
    try { original = await readFile(target, 'utf8'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (enforce && draft.sourceFile && (!original || hash(original) !== draft.originalSha)) throw new StudioError('文章文件已被其他程序修改，请重新载入文章后再提交', 409);
    if (enforce && !draft.sourceFile && original) throw new StudioError('相同文件名的文章已经存在，请修改文章地址', 409);
    return { filename, target, original };
  }

  async preview(id) {
    if (this.previewCount >= 2) throw new StudioError('正在生成其他预览，请稍后再试', 429);
    this.previewCount++;
    const previewId = randomUUID();
    const folder = await realpath(await mkdtemp(path.join(tmpdir(), 'gochief-studio-preview-')));
    try {
      const draft = await this.readDraft(id);
      const { filename, original } = await this.source(draft);
      const fields = { ...draft.fields, title: draft.fields.title.trim() || '未命名文章' };
      const content = await this.codec({ action: 'serialize', fields, original, preview: true });
      const source = path.join(folder, 'source');
      const output = path.join(folder, 'site');
      const excluded = new Set(['.git', '.blog-studio', '.bundle', 'vendor', 'node_modules', 'studio', 'tests', 'scripts']);
      await cp(this.root, source, {
        recursive: true,
        filter: entry => {
          const relative = path.relative(this.root, entry);
          if (!relative) return true;
          const first = relative.split(path.sep)[0];
          return !excluded.has(first) && !first.startsWith('_site') && !first.startsWith('.jekyll') && !first.endsWith('.command');
        }
      });
      await writeFile(path.join(source, '_posts', filename), content);
      const plugins = path.join(source, '_plugins');
      await mkdir(plugins, { recursive: true });
      await writeFile(path.join(plugins, 'studio-preview.rb'), [
        'require "json"',
        'Jekyll::Hooks.register :site, :post_write do |site|',
        '  post = site.posts.docs.find { |doc| File.basename(doc.path) == ENV.fetch("GOCHIEF_PREVIEW_FILENAME") }',
        '  raise "Preview article not found" unless post',
        '  File.write(ENV.fetch("GOCHIEF_PREVIEW_MANIFEST"), JSON.generate({url: post.url}))',
        'end', ''
      ].join('\n'));
      const overlay = path.join(folder, 'preview.yml');
      await writeFile(overlay, 'google_analytics: false\n');
      const prefix = '/preview/' + previewId;
      await run(this.ruby, ['-S', 'bundle', 'exec', 'jekyll', 'build', '--source', source, '--destination', output, '--config', path.join(source, '_config.yml') + ',' + overlay, '--baseurl', prefix, '--future', '--disable-disk-cache'], {
        cwd: this.root,
        env: { ...this.env, GOCHIEF_PREVIEW_FILENAME: filename, GOCHIEF_PREVIEW_MANIFEST: path.join(folder, 'manifest.json') },
        timeout: 90_000
      });
      const manifest = JSON.parse(await readFile(path.join(folder, 'manifest.json'), 'utf8'));
      if (!manifest.url.startsWith('/')) throw new StudioError('预览地址不正确', 500);
      this.previews.set(previewId, { folder, output });
      while (this.previews.size > 6) {
        const oldest = this.previews.keys().next().value;
        const old = this.previews.get(oldest);
        this.previews.delete(oldest);
        await rm(old.folder, { recursive: true, force: true });
      }
      return { url: prefix + manifest.url, filename, version: draft.version };
    } catch (error) {
      await rm(folder, { recursive: true, force: true });
      throw error;
    } finally { this.previewCount--; }
  }
  async previewFile(id, relative) {
    const preview = this.previews.get(id);
    if (!preview) throw new StudioError('预览已过期，请重新生成', 404);
    const resolved = path.resolve(preview.output, '.' + relative);
    if (resolved !== preview.output && !resolved.startsWith(preview.output + path.sep)) throw new StudioError('无效的预览路径');
    let target = resolved;
    try {
      if ((await stat(target)).isDirectory()) target = path.join(target, 'index.html');
      const real = await realpath(target);
      if (!real.startsWith(preview.output + path.sep)) throw new StudioError('无效的预览路径');
      return { path: real, body: await readFile(real) };
    } catch (error) { if (error.code === 'ENOENT') throw new StudioError('预览页面不存在', 404); throw error; }
  }

  async prepareReview(id) {
    return this.exclusive(async () => {
      const draft = await this.readDraft(id);
      if (!draft.fields.title.trim() || !draft.fields.body.trim()) throw new StudioError('请先填写文章标题和中文正文');
      const git = await this.gitState();
      const { filename, target, original } = await this.source(draft, true);
      const relative = '_posts/' + filename;
      const staged = await this.git(['diff', '--cached', '--name-only', '--', relative]);
      if (staged.stdout.trim()) throw new StudioError('这篇文章已有暂存改动，请先在 Git 中处理后再提交', 409);
      const content = await this.codec({ action: 'serialize', fields: draft.fields, original });
      const reviewId = randomUUID();
      const folder = path.join(this.state, 'review-' + reviewId);
      let diff;
      await mkdir(folder);
      try {
        const left = path.join(folder, 'before.md'), right = path.join(folder, 'after.md');
        await writeFile(left, original);
        await writeFile(right, content);
        diff = (await this.git(['diff', '--no-index', '--', left, right], { allowedCodes: [1] })).stdout
          .replaceAll('a' + left, 'a/' + relative).replaceAll('b' + right, 'b/' + relative)
          .replaceAll(left, relative).replaceAll(right, relative);
      } finally { await rm(folder, { recursive: true, force: true }); }
      const changed = original !== content;
      if (!changed && !draft.lastCommit) throw new StudioError('文章内容没有变化，无需提交');
      if (!changed && draft.pushed) throw new StudioError('这篇文章已经提交并推送，无需重复提交');
      const review = { id: reviewId, draftId: id, draftVersion: draft.version, branch: git.branch, head: git.head, original, content, filename, target, changed, created: Date.now() };
      this.reviews.set(reviewId, review);
      for (const [key, value] of this.reviews) if (Date.now() - value.created > 30 * 60_000) this.reviews.delete(key);
      return { id: reviewId, filename: relative, branch: git.branch, diff, changed, suggestedMessage: (draft.sourceFile ? 'Update post: ' : 'Add post: ') + draft.fields.title, isProduction: git.branch === 'master' || git.branch === 'main' };
    });
  }
  async submit(reviewId, message, push = true) {
    return this.exclusive(async () => {
      const review = this.reviews.get(reviewId);
      if (!review || Date.now() - review.created > 30 * 60_000) throw new StudioError('提交确认已过期，请重新检查文章改动', 409);
      const draft = await this.readDraft(review.draftId);
      if (draft.version !== review.draftVersion) throw new StudioError('确认后草稿又发生了变化，请重新检查改动', 409);
      const git = await this.gitState();
      if (git.branch !== review.branch || git.head !== review.head) throw new StudioError('Git 分支或提交已变化，请重新检查改动', 409);
      await this.source(draft, true);
      message = String(message || '').trim();
      if (!message || message.length > 300 || /[\r\n\0]/.test(message)) throw new StudioError('请填写 1–300 字的单行提交说明');
      const relative = '_posts/' + review.filename;
      let commit = draft.lastCommit;
      if (review.changed) {
        await writeFile(review.target, review.content);
        try {
          await this.git(['add', '--', relative]);
          await this.git(['commit', '--only', '-m', message, '--', relative]);
        } catch (error) {
          if (review.original) await writeFile(review.target, review.original);
          else await rm(review.target, { force: true });
          await this.git(['restore', '--staged', '--', relative]).catch(() => {});
          throw error;
        }
        commit = (await this.git(['rev-parse', 'HEAD'])).stdout.trim();
        draft.sourceFile = review.filename;
        draft.originalSha = hash(review.content);
        draft.lastCommit = commit;
        draft.lastSubmittedHash = hash(JSON.stringify(draft.fields));
        draft.hasChanges = false;
        draft.pushed = false;
        draft.version++;
        draft.updatedAt = new Date().toISOString();
        await this.storeDraft(draft);
      } else if (commit !== git.head) throw new StudioError('待推送的提交已不是当前提交，请在 Git 中检查', 409);

      let pushError = null;
      if (push) {
        try {
          await this.git(['push', '--set-upstream', 'origin', 'HEAD:refs/heads/' + review.branch], { timeout: 60_000 });
          draft.pushed = true;
          await this.storeDraft(draft);
        } catch (error) { pushError = error.message; }
      }
      this.reviews.delete(reviewId);
      return { commit, pushed: draft.pushed, pushError, branch: review.branch, filename: relative, draft, message: pushError ? '文章已在本地提交，但推送未完成。可重新打开提交窗口重试推送。' : (push ? '文章已提交并推送到 GitHub。' : '文章已在本地提交。') };
    });
  }
}
