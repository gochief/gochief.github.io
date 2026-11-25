#!/usr/bin/env python3
"""Check generated metadata, local links, assets, RSS, and sitemap without dependencies."""
import argparse
import json
from email.utils import parsedate_to_datetime
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import parse_qs, unquote, urljoin, urlsplit
import xml.etree.ElementTree as ET


class Page(HTMLParser):
    def __init__(self, path):
        super().__init__(convert_charrefs=True)
        self.path = path
        self.canonicals = []
        self.viewports = 0
        self.heads = 0
        self.titles = 0
        self.ids = set()
        self.references = []
        self.translation_data = ""
        self.reading_translation = False
        self.language_controls = 0
        self.feed(path.read_text(encoding="utf-8"))

    def handle_starttag(self, tag, attributes):
        attrs = dict(attributes)
        if tag == "script" and attrs.get("id") == "site-translations":
            self.reading_translation = True
        if attrs.get("id") == "J_language_toggle":
            self.language_controls += 1
        if tag == "head":
            self.heads += 1
        if tag == "title":
            self.titles += 1
        if tag == "meta" and attrs.get("name") == "viewport":
            self.viewports += 1
        if tag == "link" and attrs.get("rel") == "canonical":
            self.canonicals.append(attrs.get("href", ""))
        if attrs.get("id"):
            assert attrs["id"] not in self.ids, f"{self.path}: duplicate id {attrs['id']}"
            self.ids.add(attrs["id"])
        for name in ("href", "src"):
            if name in attrs:
                assert attrs[name].strip(), f"{self.path}: empty {name}"
                self.references.append(attrs[name])
        if attrs.get("target") == "_blank":
            assert "noopener" in attrs.get("rel", "").split(), f"{self.path}: missing noopener"

    def handle_data(self, data):
        if self.reading_translation:
            self.translation_data += data

    def handle_endtag(self, tag):
        if tag == "script":
            self.reading_translation = False


def check_site(directory, baseurl):
    root = directory.resolve()
    paths = [p for p in root.rglob("*.html") if "js" not in p.relative_to(root).parts]
    assert paths, f"No generated pages in {root}; run npm run build first"
    pages = {path.resolve(): Page(path) for path in paths}
    for page in pages.values():
        assert page.heads == page.titles == page.viewports == 1, f"{page.path}: invalid head metadata"
        assert len(page.canonicals) == 1, f"{page.path}: missing/duplicate canonical"
        assert page.language_controls == 1, f"{page.path}: missing/duplicate language switch"
        translations = json.loads(page.translation_data)
        for language in ("zh", "en"):
            assert translations["page"][language]["title"], f"{page.path}: missing translated title"
            assert translations["page"][language]["description"], f"{page.path}: missing translated description"
            assert translations["messages"][language]["switch_language"], f"{page.path}: missing switch label"
        canonical = page.canonicals[0]
        origin = urlsplit(canonical)
        assert origin.scheme == "https" and origin.netloc, f"{page.path}: non-absolute canonical"
        asset_versions = set()
        for reference in page.references:
            target = urlsplit(urljoin(canonical, reference))
            if target.scheme not in ("http", "https") or target.netloc != origin.netloc:
                continue
            if target.path.endswith((".css", ".js")):
                version = parse_qs(target.query).get("v", [])
                assert len(version) == 1 and version[0], f"{page.path}: unversioned asset: {reference}"
                asset_versions.add(version[0])
            path = unquote(target.path)
            if baseurl:
                assert path == baseurl or path.startswith(baseurl + "/"), f"{page.path}: link misses baseurl: {reference}"
                path = path[len(baseurl):]
            destination = (root / path.lstrip("/")).resolve()
            assert destination.is_relative_to(root), f"{page.path}: link escapes site: {reference}"
            if destination.is_dir():
                destination /= "index.html"
            assert destination.is_file(), f"{page.path}: missing local target: {reference}"
            if target.fragment and destination in pages:
                fragment = unquote(target.fragment)
                assert fragment in pages[destination].ids, f"{page.path}: missing anchor: {reference}"
        assert len(asset_versions) == 1, f"{page.path}: mixed or missing asset versions"

    feed = ET.parse(root / "feed.xml").getroot()
    assert feed.tag == "rss"
    channel = feed.find("channel")
    assert channel is not None and channel.findtext("title")
    parsedate_to_datetime(channel.findtext("lastBuildDate"))
    for item in channel.findall("item"):
        parsedate_to_datetime(item.findtext("pubDate"))
        assert urlsplit(item.findtext("link")).scheme == "https"
    sitemap = ET.parse(root / "sitemap.xml").getroot()
    for location in sitemap.findall("{*}url/{*}loc"):
        assert urlsplit(location.text).scheme == "https"
    for excluded in ("Gemfile", "README.md", "License", "package.json", "scripts", "tests", "vendor", "studio", ".blog-studio", "启动写作台.command"):
        assert not (root / excluded).exists(), f"Development file copied into site: {excluded}"
    print(f"Checked {len(pages)} HTML pages, RSS, sitemap, local links and assets.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("directory", nargs="?", type=Path, default=Path("_site"))
    parser.add_argument("--baseurl", default="")
    arguments = parser.parse_args()
    check_site(arguments.directory, arguments.baseurl.rstrip("/"))
