require "json"
require "yaml"
require "date"

def parse(source, filename)
  match = source.match(/\A---[ \t]*\r?\n(.*?)\r?\n---[ \t]*\r?\n?(.*)\z/m)
  meta = match ? YAML.safe_load(match[1], permitted_classes: [Date, Time], aliases: false) || {} : {}
  raise "文章头信息必须是一个对象" unless meta.is_a?(Hash)
  body = match ? match[2].sub(/\A\r?\n/, "") : source
  day = (meta["date"] || filename[0, 10]).to_s[0, 10]
  {
    "title" => meta["title"].to_s,
    "title_en" => meta["title_en"].to_s,
    "date" => day,
    "slug" => filename.sub(/\A\d{4}-\d{2}-\d{2}-/, "").sub(/\.md\z/, ""),
    "categories" => Array(meta["categories"] || meta["category"]).map(&:to_s),
    "summary" => meta["summary"].to_s,
    "summary_en" => meta["summary_en"].to_s,
    "body" => body,
    "content_en" => meta["content_en"].to_s,
    "comments" => meta["comments"] != false,
    "hide" => meta["hide"] == true
  }
end

def serialize(input)
  fields = input.fetch("fields")
  original = input["original"].to_s
  match = original.match(/\A---[ \t]*\r?\n(.*?)\r?\n---[ \t]*\r?\n?/m)
  meta = match ? YAML.safe_load(match[1], permitted_classes: [Date, Time], aliases: false) || {} : {}
  raise "文章头信息必须是一个对象" unless meta.is_a?(Hash)
  meta["layout"] ||= "post"
  meta["title"] = fields.fetch("title").strip
  meta["date"] = fields["date"] unless meta["date"].to_s[0, 10] == fields["date"]
  meta["categories"] = fields["categories"]
  meta.delete("category")
  meta["summary"] = fields["summary"]
  meta["comments"] = fields["comments"]
  meta["hide"] = fields["hide"]
  %w[title_en summary_en content_en].each do |key|
    value = fields[key].to_s
    value.strip.empty? ? meta.delete(key) : meta[key] = value
  end
  if input["preview"]
    meta["comments"] = false
    meta["published"] = true
    meta["sitemap"] = false
  end
  meta.to_yaml + "---\n\n" + fields.fetch("body").rstrip + "\n"
end

begin
  input = JSON.parse(STDIN.read)
  result = case input.fetch("action")
           when "parse"
             parse(input.fetch("source"), input.fetch("filename"))
           when "parse_many"
             input.fetch("files").map do |file|
               begin
                 { "filename" => file.fetch("filename"), "fields" => parse(file.fetch("source"), file.fetch("filename")) }
               rescue StandardError => error
                 { "filename" => file["filename"], "error" => error.message }
               end
             end
           when "serialize"
             serialize(input)
           else
             raise "未知文章操作"
           end
  puts JSON.generate({ "result" => result })
rescue StandardError => error
  warn error.message
  exit 1
end
