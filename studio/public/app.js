'use strict';

const $ = id => document.getElementById(id);
const state = {
  token: '', drafts: [], posts: [], git: null, draft: null,
  language: 'zh', previewLanguage: 'zh', edit: 0, saved: 0,
  saving: false, submitting: false, review: null, previewURL: '',
  previewRunning: false, previewPending: false, previewRevision: 0
};
let saveTimer, previewTimer, toastTimer, selection = 0;
let saveChain = Promise.resolve();

function icon(name) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.classList.add('icon');
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttribute('href', '#i-' + name);
  svg.append(use);
  return svg;
}
async function api(url, options = {}) {
  let response;
  try {
    response = await fetch(url, {
      method: options.method || 'GET',
      headers: options.body ? { 'Content-Type': 'application/json', 'X-Studio-Token': state.token } : {},
      body: options.body ? JSON.stringify(options.body) : undefined,
      cache: 'no-store'
    });
  } catch {
    throw new Error('无法连接本地写作台，请检查终端中的服务是否正在运行。');
  }
  const value = await response.json();
  if (!response.ok) throw new Error(value.error || '操作未完成，请重试。');
  return value;
}
function showError(error, reconnect = false) {
  $('errorText').textContent = error.message || String(error);
  $('retryBoot').hidden = !reconnect;
  $('errorBanner').hidden = false;
}
function toast(message) {
  clearTimeout(toastTimer);
  $('toast').textContent = message;
  $('toast').hidden = false;
  toastTimer = setTimeout(() => { $('toast').hidden = true; }, 4500);
}
function clock(value = new Date()) {
  return new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(value));
}
function dateLabel(value) {
  return value ? value.slice(0, 10).replaceAll('-', '.') : '';
}
function saveStatus(type) {
  const node = $('saveState');
  node.dataset.state = type;
  const text = type === 'saving' ? '正在保存…' : type === 'dirty' ? '有未保存改动' : type === 'error' ? '保存失败，可重试' : '已保存 ' + clock(state.draft?.updatedAt);
  node.replaceChildren(document.createElement('i'), document.createTextNode(text));
}
function selectedFields() {
  return state.language === 'zh' ? { title: 'title', summary: 'summary', body: 'body' } : { title: 'title_en', summary: 'summary_en', body: 'content_en' };
}
function updateHeading() {
  $('documentName').textContent = state.draft?.fields.title.trim() || '未命名草稿';
  $('documentName').title = $('documentName').textContent;
  const fields = state.draft?.fields;
  if (fields) $('settingsOverview').textContent = dateLabel(fields.date) + (fields.categories.length ? ' · ' + fields.categories.join(' / ') : ' · 未分类');
}
function updateCount() {
  const body = state.draft?.fields[selectedFields().body] || '';
  const chinese = (body.match(/[\p{Script=Han}]/gu) || []).length;
  const words = (body.replace(/[\p{Script=Han}]/gu, '').match(/[\p{L}\p{N}_]+/gu) || []).length;
  $('wordCount').textContent = (chinese + words).toLocaleString('zh-CN') + ' 字 / 词 · 约 ' + Math.max(1, Math.ceil((chinese + words) / 250)) + ' 分钟阅读';
}
function renderFields() {
  if (!state.draft) return;
  const keys = selectedFields();
  $('articleTitle').value = state.draft.fields[keys.title];
  $('articleSummary').value = state.draft.fields[keys.summary];
  $('articleBody').value = state.draft.fields[keys.body];
  $('articleTitle').placeholder = state.language === 'zh' ? '给这个想法起个标题…' : 'English title (optional)';
  $('articleSummary').placeholder = state.language === 'zh' ? '用一两句话介绍这篇文章，会显示在博客首页。' : 'A short introduction for the English version.';
  $('articleBody').placeholder = state.language === 'zh' ? '从一个想法开始。\n\n在这里写下正文，右侧会呈现博客中的真实效果。\n\n支持 Markdown 标题、列表、链接和代码块。' : 'Write the English version in Markdown.\n\nIf left blank, the original article will be shown.';
  $('titleLabel').textContent = state.language === 'zh' ? '文章标题' : '英文标题';
  $('summaryLabel').textContent = state.language === 'zh' ? '摘要' : '英文摘要';
  document.querySelectorAll('[data-language]').forEach(button => button.setAttribute('aria-selected', String(button.dataset.language === state.language)));
  updateHeading();
  updateCount();
  previewLanguage();
}
function renderSettings() {
  const draft = state.draft;
  if (!draft) return;
  $('articleDate').value = draft.fields.date;
  $('articleCategories').value = draft.fields.categories.join(', ');
  $('articleSlug').value = draft.fields.slug;
  $('articleSlug').readOnly = !!draft.sourceFile;
  $('slugHint').textContent = draft.sourceFile ? '文章文件名已固定：' + draft.sourceFile : '使用文字、数字或短横线。首次提交后文件名固定。';
  $('articleComments').checked = draft.fields.comments;
  $('articleHidden').checked = draft.fields.hide;
}
function renderList() {
  const list = $('articleList');
  const query = $('search').value.trim().toLocaleLowerCase();
  list.replaceChildren();
  const records = [...state.drafts];
  if (state.draft) {
    const index = records.findIndex(draft => draft.id === state.draft.id);
    if (index >= 0) records[index] = state.draft;
    else records.unshift(state.draft);
  }
  const filesBeingEdited = new Set(records.map(draft => draft.sourceFile).filter(Boolean));
  const published = state.posts.filter(post => !filesBeingEdited.has(post.filename));
  $('articleCount').textContent = records.length + published.length;
  let found = 0;
  const add = (record, isDraft) => {
    const fields = isDraft ? record.fields : record.fields || {};
    const title = fields.title || record.filename || '未命名草稿';
    if (query && !(title + ' ' + (fields.categories || []).join(' ')).toLocaleLowerCase().includes(query)) return;
    const button = document.createElement('button');
    button.className = 'article-item' + (isDraft && record.id === state.draft?.id ? ' active' : '');
    button.type = 'button';
    button.title = title;
    if (isDraft && record.id === state.draft?.id) button.setAttribute('aria-current', 'page');
    const main = document.createElement('span');
    main.className = 'article-item-main';
    const heading = document.createElement('strong');
    heading.textContent = title;
    const detail = document.createElement('small');
    detail.textContent = dateLabel(fields.date) + ((fields.categories || []).length ? ' · ' + fields.categories[0] : '');
    main.append(heading, detail);
    const status = document.createElement('span');
    status.className = 'article-status' + (isDraft && !record.pushed ? ' draft' : '');
    const dirty = isDraft && ((record.id === state.draft?.id && state.edit !== state.saved) || record.hasChanges);
    status.textContent = record.error ? '无法读取' : !isDraft ? '已提交' : dirty ? (record.sourceFile ? '编辑中' : '草稿') : record.pushed ? '已推送' : record.lastCommit ? '待推送' : '草稿';
    button.append(icon('file'), main, status);
    button.addEventListener('click', () => openArticle(isDraft ? { id: record.id } : { sourceFile: record.filename }).catch(showError));
    list.append(button);
    found++;
  };
  if (records.length) {
    const label = document.createElement('p'); label.className = 'section-label'; label.textContent = '正在写'; list.append(label);
    records.forEach(record => add(record, true));
  }
  if (published.length) {
    const label = document.createElement('p'); label.className = 'section-label'; label.textContent = '文章仓库'; list.append(label);
    published.forEach(record => add(record, false));
  }
  if (!found) {
    list.replaceChildren();
    const empty = document.createElement('p'); empty.className = 'list-empty'; empty.textContent = query ? '没有找到匹配的文章。' : '还没有文章。写下你的第一个想法吧。'; list.append(empty);
  }
}
async function refreshLibrary() {
  const data = await api('/api/bootstrap');
  state.token = data.token;
  state.drafts = data.drafts;
  state.posts = data.posts;
  state.git = data.git;
  $('branchName').textContent = data.git.branch;
  $('branchName').title = data.git.branch + '\n' + data.root;
  renderList();
  return data;
}
async function boot() {
  try {
    const data = await refreshLibrary();
    $('errorBanner').hidden = true;
    if (!state.draft) {
      if (data.drafts.length) await openArticle({ id: data.drafts[0].id });
      else if (data.posts.length) await openArticle({ sourceFile: data.posts[0].filename });
      else await openArticle({});
    }
  } catch (error) { showError(error, true); }
}
async function openArticle(source) {
  const sequence = ++selection;
  await saveNow();
  const draft = source.id ? await api('/api/drafts/' + source.id) : await api('/api/drafts', { method: 'POST', body: { sourceFile: source.sourceFile } });
  if (sequence !== selection) return;
  clearTimeout(saveTimer); clearTimeout(previewTimer);
  state.draft = draft; state.edit = 0; state.saved = 0;
  if (!source.id && !source.sourceFile) { state.language = 'zh'; state.previewLanguage = 'zh'; }
  state.previewURL = ''; state.previewRevision++;
  state.previewPending = false;
  $('previewFrame').hidden = true;
  $('openPreview').classList.add('disabled'); $('openPreview').removeAttribute('href');
  for (const input of ['articleTitle', 'articleSummary', 'articleBody', 'articleDate', 'articleCategories', 'articleSlug', 'articleComments', 'articleHidden', 'saveDraft', 'reviewSubmit']) $(input).disabled = false;
  $('app').classList.remove('sidebar-open');
  renderFields(); renderSettings(); renderList(); saveStatus('saved');
  await refreshLibrary();
  requestPreview();
}
function changed() {
  if (!state.draft || state.submitting) return;
  state.edit++;
  saveStatus('dirty');
  updateHeading(); updateCount(); renderList();
  clearTimeout(saveTimer); clearTimeout(previewTimer);
  saveTimer = setTimeout(() => saveNow().catch(showError), 850);
  previewTimer = setTimeout(requestPreview, 1400);
}
function saveNow() {
  clearTimeout(saveTimer);
  if (!state.draft) return Promise.resolve();
  const id = state.draft.id;
  const operation = async () => {
    if (state.draft?.id !== id || state.edit === state.saved) return state.draft;
    const revision = state.edit;
    const fields = structuredClone(state.draft.fields);
    state.saving = true; saveStatus('saving');
    try {
      const saved = await api('/api/drafts/' + id, { method: 'PUT', body: { version: state.draft.version, fields } });
      if (state.draft?.id === id) {
        state.draft.version = saved.version;
        state.draft.updatedAt = saved.updatedAt;
        state.draft.hasChanges = saved.hasChanges;
        state.saved = revision;
        state.drafts = state.drafts.map(draft => draft.id === id ? saved : draft);
        saveStatus(state.edit === state.saved ? 'saved' : 'dirty');
        renderList();
      }
      return saved;
    } catch (error) { saveStatus('error'); throw error; }
    finally { state.saving = false; }
  };
  const promise = saveChain.then(operation, operation);
  saveChain = promise.catch(() => {});
  return promise;
}

function previewLanguage() {
  document.querySelectorAll('[data-preview-language]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.previewLanguage === state.previewLanguage)));
  if (state.previewURL) $('previewFrame').contentWindow?.postMessage({ type: 'studio:language', language: state.previewLanguage }, '*');
  $('previewNote').textContent = state.previewLanguage === 'en' && state.draft && !state.draft.fields.content_en.trim()
    ? '英文正文尚未填写，当前预览保留原文。'
    : '与博客使用同一套主题和排版。';
}
async function requestPreview() {
  if (!state.draft) return;
  state.previewPending = true;
  if (state.previewRunning) return;
  state.previewRunning = true;
  $('refreshPreview').disabled = true;
  try {
    while (state.previewPending) {
      state.previewPending = false;
      const id = state.draft.id;
      if (!state.draft.fields.title.trim() && !state.draft.fields.body.trim()) {
        $('previewLoading').hidden = true; $('previewFrame').hidden = true; $('previewPlaceholder').hidden = false;
        $('previewStatus').textContent = '等待内容';
        continue;
      }
      $('previewPlaceholder').hidden = true;
      $('previewLoading').hidden = false;
      $('previewStatus').textContent = '正在生成…';
      try {
        await saveNow();
        if (state.draft.id !== id) continue;
        const revision = state.edit;
        const result = await api('/api/preview', { method: 'POST', body: { draftId: id } });
        if (state.draft.id !== id) continue;
        if (revision !== state.edit) { state.previewPending = true; continue; }
        state.previewURL = result.url;
        $('previewFrame').src = result.url;
        $('previewFrame').hidden = false;
        $('openPreview').href = result.url;
        $('openPreview').classList.remove('disabled');
        $('previewStatus').textContent = '已更新 ' + clock();
      } catch (error) {
        $('previewLoading').hidden = true;
        $('previewStatus').textContent = '预览生成失败';
        showError(error);
      }
    }
  } finally {
    state.previewRunning = false;
    $('refreshPreview').disabled = false;
    if (!state.previewURL) $('previewLoading').hidden = true;
  }
}
function previewReady() {
  if (!state.previewURL) return;
  previewLanguage();
  $('previewLoading').hidden = true;
}
$('previewFrame').addEventListener('load', previewReady);
window.addEventListener('message', event => {
  if (event.source === $('previewFrame').contentWindow && event.data?.type === 'studio:ready' && state.previewURL && event.data.url === new URL(state.previewURL, window.location.href).pathname) previewReady();
});

async function reviewSubmit() {
  if (!state.draft || state.submitting) return;
  $('reviewSubmit').disabled = true;
  try {
    await saveNow();
    state.review = await api('/api/review', { method: 'POST', body: { draftId: state.draft.id } });
    $('reviewBranch').textContent = state.review.branch;
    $('reviewFilename').textContent = state.review.filename;
    $('productionNotice').hidden = false;
    $('productionNotice').classList.toggle('work-branch', !state.review.isProduction);
    $('productionNotice').textContent = state.review.isProduction
      ? '当前分支是网站的主分支。推送后，GitHub Pages 可能自动更新公开网站。'
      : '文章会推送到当前工作分支。合并到网站的发布分支后，线上内容才会更新。';
    $('commitMessage').value = state.review.suggestedMessage;
    $('commitMessage').disabled = !state.review.changed;
    $('reviewTitle').textContent = state.review.changed ? '检查并提交' : '重试推送';
    $('reviewDescription').textContent = state.review.changed ? '确认这篇文章的改动，再将它提交到当前分支。' : '文章已在本地提交，此次只推送现有提交。';
    $('pushChanges').checked = true;
    $('pushChanges').disabled = !state.review.changed;
    const diff = $('reviewDiff'); diff.replaceChildren();
    if (state.review.diff) {
      let added = 0, removed = 0;
      state.review.diff.trimEnd().split('\n').forEach(line => {
        const row = document.createElement('span'); row.className = 'diff-line'; row.textContent = line;
        if (line.startsWith('+++') || line.startsWith('---') || line.startsWith('diff ') || line.startsWith('index ') || line.startsWith('@@')) row.classList.add('header');
        else if (line.startsWith('+')) { row.classList.add('added'); added++; }
        else if (line.startsWith('-')) { row.classList.add('removed'); removed++; }
        diff.append(row);
      });
      $('diffCount').textContent = '+' + added + ' / −' + removed;
    } else {
      diff.textContent = '文章内容已经提交到本地，无新增改动。\n确认后将推送到当前 Git 分支。';
      $('diffCount').textContent = '无新增改动';
    }
    $('reviewError').hidden = true;
    submitLabel();
    $('reviewDialog').showModal();
  } catch (error) { showError(error); }
  finally { $('reviewSubmit').disabled = false; }
}
function submitLabel() {
  $('confirmSubmit').replaceChildren(document.createTextNode($('pushChanges').checked ? '确认提交并推送' : '确认本地提交'), icon('arrow'));
}
async function submit() {
  if (!state.review || state.submitting) return;
  state.submitting = true;
  const close = $('reviewDialog').querySelector('.dialog-close-form button');
  close.disabled = true; $('cancelSubmit').disabled = true; $('confirmSubmit').disabled = true;
  $('confirmSubmit').textContent = $('pushChanges').checked ? '正在提交并推送…' : '正在创建提交…';
  $('reviewError').hidden = true;
  try {
    const result = await api('/api/submit', { method: 'POST', body: { reviewId: state.review.id, message: $('commitMessage').value, push: $('pushChanges').checked } });
    state.draft = result.draft; state.edit = 0; state.saved = 0; state.review = null;
    $('reviewDialog').close();
    await refreshLibrary();
    renderFields(); renderSettings(); saveStatus('saved');
    if (result.pushError) showError(new Error(result.message + '\n' + result.pushError));
    else toast(result.message + ' ' + result.commit.slice(0, 7));
  } catch (error) {
    $('reviewError').textContent = error.message;
    $('reviewError').hidden = false;
  } finally {
    state.submitting = false;
    close.disabled = false; $('cancelSubmit').disabled = false; $('confirmSubmit').disabled = false;
    submitLabel();
  }
}
function insertMarkdown(type) {
  if (!state.draft) return;
  const editor = $('articleBody'), start = editor.selectionStart, end = editor.selectionEnd;
  const selected = editor.value.slice(start, end);
  const formats = {
    heading: ['## ', selected || '标题', ''],
    bold: ['**', selected || '加粗文字', '**'],
    italic: ['*', selected || '斜体文字', '*'],
    link: ['[', selected || '链接文字', '](https://example.com)'],
    code: ['\n' + '\x60\x60\x60' + 'go\n', selected || '// 在这里写代码', '\n' + '\x60\x60\x60' + '\n'],
    quote: ['> ', selected || '引用内容', '']
  };
  const [before, text, after] = formats[type];
  editor.setRangeText(before + text + after, start, end, 'end');
  editor.focus();
  editor.setSelectionRange(start + before.length, start + before.length + text.length);
  state.draft.fields[selectedFields().body] = editor.value;
  changed();
}

for (const [id, field] of [['articleTitle', 'title'], ['articleSummary', 'summary'], ['articleBody', 'body']]) {
  $(id).addEventListener('input', event => {
    if (!state.draft) return;
    state.draft.fields[selectedFields()[field]] = event.target.value;
    changed();
  });
}
$('articleDate').addEventListener('change', event => { if (state.draft) { state.draft.fields.date = event.target.value; changed(); } });
$('articleSlug').addEventListener('input', event => { if (state.draft && !state.draft.sourceFile) { state.draft.fields.slug = event.target.value.trim(); changed(); } });
$('articleCategories').addEventListener('input', event => { if (state.draft) { state.draft.fields.categories = event.target.value.split(/[,，]/).map(value => value.trim()).filter(Boolean); changed(); } });
$('articleComments').addEventListener('change', event => { if (state.draft) { state.draft.fields.comments = event.target.checked; changed(); } });
$('articleHidden').addEventListener('change', event => { if (state.draft) { state.draft.fields.hide = event.target.checked; changed(); } });
document.querySelectorAll('[data-language]').forEach(button => button.addEventListener('click', () => {
  state.language = button.dataset.language; state.previewLanguage = state.language; renderFields();
}));
document.querySelectorAll('[data-preview-language]').forEach(button => button.addEventListener('click', () => {
  state.previewLanguage = button.dataset.previewLanguage; previewLanguage();
}));
document.querySelectorAll('[data-layout]').forEach(button => {
  if (button.tagName !== 'BUTTON') return;
  button.addEventListener('click', () => {
    $('app').dataset.layout = button.dataset.layout;
    document.querySelectorAll('button[data-layout]').forEach(item => { item.classList.toggle('active', item === button); item.setAttribute('aria-pressed', String(item === button)); });
  });
});
document.querySelectorAll('[data-format]').forEach(button => button.addEventListener('click', () => insertMarkdown(button.dataset.format)));
$('newDraft').addEventListener('click', () => openArticle({}).then(() => $('articleTitle').focus()).catch(showError));
$('search').addEventListener('input', renderList);
$('saveDraft').addEventListener('click', () => saveNow().then(() => toast('草稿已保存到本机。')).catch(showError));
$('reviewSubmit').addEventListener('click', reviewSubmit);
$('refreshPreview').addEventListener('click', requestPreview);
$('previewDevice').addEventListener('change', event => $('previewStage').classList.toggle('mobile', event.target.value === 'mobile'));
$('pushChanges').addEventListener('change', submitLabel);
$('confirmSubmit').addEventListener('click', submit);
$('cancelSubmit').addEventListener('click', () => $('reviewDialog').close());
$('reviewDialog').addEventListener('cancel', event => { if (state.submitting) event.preventDefault(); });
$('sidebarToggle').addEventListener('click', () => $('app').classList.toggle('sidebar-open'));
$('dismissError').addEventListener('click', () => { $('errorBanner').hidden = true; });
$('retryBoot').addEventListener('click', boot);
window.addEventListener('beforeunload', event => {
  if (state.edit !== state.saved || state.submitting) { event.preventDefault(); event.returnValue = ''; }
});
window.addEventListener('keydown', event => {
  if ($('reviewDialog').open) return;
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
    event.preventDefault(); saveNow().catch(showError);
  }
  if (!event.metaKey && !event.ctrlKey && !event.altKey && event.key.toLowerCase() === 'n' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)) {
    event.preventDefault(); $('newDraft').click();
  }
});
boot();
