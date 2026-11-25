# gochief

使用 Jekyll 构建的个人博客，保留黑白主题、霞鹜文楷字体、分类归档、RSS 和 Reveal.js 演示文稿。

## 本地写作台

双击项目中的 `启动写作台.command`，或在项目目录运行：

```bash
npm run studio
```

打开终端显示的地址，默认是 http://127.0.0.1:4310。需要先按下节安装 Ruby 和项目依赖；写作台不需要额外的 npm 依赖。

1. 点击「写一篇新文章」，填写标题、摘要、分类和 Markdown 正文。草稿自动保存在本机，也可以按 `⌘S` / `Ctrl+S` 手动保存。
2. 右侧使用博客的真实 Jekyll 主题预览，支持中文、英文及手机尺寸；「打开完整预览」可在新标签页查看。
3. 点击「提交到 GitHub」，检查文章差异、目标分支和提交说明。默认提交并推送当前 Git 分支，也可取消勾选，仅创建本地提交。

草稿位于已被 Git 忽略的 `.blog-studio/drafts/`，不会出现在公开博客中。点击确认提交后才会写入 `_posts/`。提交仅包含当前文章，保留其他文件的修改和暂存状态。已有文章的其他头信息（如 `tags`、`feature`）会保留。

推送到工作分支后，仍需合并到网站的发布分支才能更新线上内容；向 `master` / `main` 提交时，界面会提示可能更新公开网站。推送失败时，本地提交会保留，再次打开提交窗口可重试推送，不会重复创建提交。

写作台只监听 `127.0.0.1`，使用本机 Git / SSH 配置。关闭启动它的终端或按 `Ctrl+C` 即可停止。`studio/` 和本地草稿目录已从博客构建中排除。

## 本地开发

需要 Ruby 3.3、Bundler、Node.js 22 或更新版本，以及 Python 3.9 或更新版本。Node.js 仅用于命令入口和测试，无需安装 npm 依赖。

macOS 使用 Homebrew 时，可独立安装 Ruby，不必修改系统 Ruby：

```bash
brew install ruby@3.3
export PATH="$(brew --prefix ruby@3.3)/bin:$PATH"
```

安装项目依赖并启动：

```bash
bundle config set --local path vendor/bundle
bundle install
npm run dev
```

浏览器访问 http://127.0.0.1:4000。修改 `_config.yml` 后需要重启服务。

```bash
npm test          # 动画生命周期、导航和可选脚本的行为测试
npm run build     # 生成静态站点至 _site/
npm run check     # 测试、构建并检查页面、资源、内部链接、RSS 和 sitemap
```

## 站点配置

- `_config.yml` 的 `url` 默认是 `https://gochief.github.io`。使用自定义域名时改成实际 HTTPS 域名，并同步修改 `package.json` 的 `homepage`。
- 根路径部署使用空 `baseurl`；子目录部署设置为 `/目录名`，末尾不加 `/`。站内链接和资源使用 Jekyll URL 过滤器。
- 时区为 `Asia/Shanghai`。未来日期的文章默认不发布。
- 导航由 `menu` 配置；空链接不会显示。
- 评论仅在 `giscus.repo`、`repo_id`、`category`、`category_id` 全部配置后加载。请在 https://giscus.app 为自己的仓库生成配置，不要复用其他仓库的 ID。
- 赞赏链接配置 `coffee_url`；留空时不显示按钮，也可设置 `showBuyCoffee: false`。
- 如需统计，在 `google_analytics` 中填写实际的衡量 ID。

## 中英文切换

导航栏右侧的 `EN` / `中文` 按钮可切换界面语言，并记住选择。首次访问按浏览器语言显示中文或英文；禁用浏览器存储时仍可在当前页面切换。没有 JavaScript 时默认显示中文。

导航、标语、分页、关于页、404 页面、文章界面及页面标题和描述同步切换。界面文案统一维护在 `_data/i18n.yml`。语言切换共用原页面地址。

文章和普通页面可在 YAML 头信息中提供对应英文内容：

```yaml
title_en: English title
summary_en: A short English summary.
content_en: |
  ## English heading

  English Markdown content.
```

没有英文版本的文章继续显示原文。英文正文内的 ID 和锚点会自动增加 `en-` 前缀，避免与中文正文重复。

## 写文章

在 `_posts/` 新建 `YYYY-MM-DD-title.md`，文章必须包含 YAML 头信息：

```yaml
---
layout: post
title: 文章标题
date: 2026-11-24
categories: [Go]
summary: 一段简短的文章摘要。
comments: false
---
```

然后在下方编写 Markdown 正文。`comments: false` 可省略；设置 `hide: true` 可从首页、分类和 RSS 列表隐藏文章，但文章链接仍可访问。`feature` 可指定分享图片地址。

演示文稿使用 `layout: ppt`，保留现有 Reveal.js 功能。

## 验证与发布

`.github/workflows/ci.yml` 在 `master` 的推送和 Pull Request 中运行测试、生产构建及子目录部署检查。该工作流只检查项目。

部署应发布 `_site/` 的构建结果。当前 Gemfile 使用 Jekyll 4.4；如果 GitHub Pages 仍配置为从源码分支自动构建，请改用能运行该 Gemfile 的 GitHub Actions 构建和发布流程。

手动验证子目录部署：

```bash
bundle exec jekyll build --baseurl /preview --destination _site-preview
python3 scripts/check_site.py _site-preview --baseurl /preview
```

不要提交 `_site/`、`vendor/` 或本地 Bundler 配置。依赖版本由 `Gemfile.lock` 固定。

本地 CSS 和 JavaScript 使用统一的构建版本参数，避免发布后新版 HTML 命中旧资源缓存。在 GitHub Pages 上优先使用构建提交号，其他环境使用构建时间。
