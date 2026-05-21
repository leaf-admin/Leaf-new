const fs = require("node:fs");
const path = require("node:path");

function splitSections(markdown) {
  const lines = markdown.split(/\r?\n/);
  const sections = [];
  let current = { title: "Playbook", content: [] };

  lines.forEach((line) => {
    const heading = line.match(/^(#{1,4})\s+(.+)$/);
    if (heading && current.content.length) {
      sections.push({
        title: current.title,
        content: current.content.join("\n").trim(),
      });
      current = { title: heading[2].trim(), content: [line] };
    } else if (heading) {
      current.title = heading[2].trim();
      current.content.push(line);
    } else {
      current.content.push(line);
    }
  });

  if (current.content.length) {
    sections.push({
      title: current.title,
      content: current.content.join("\n").trim(),
    });
  }
  return sections.filter((section) => section.content);
}

function tokenize(text) {
  return String(text || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .filter((token) => token.length >= 3);
}

class PlaybookStore {
  constructor({ filePath }) {
    this.filePath = filePath;
    this.loadedAt = null;
    this.version = "unknown";
    this.sections = [];
  }

  load() {
    const absolutePath = path.resolve(this.filePath);
    const markdown = fs.readFileSync(absolutePath, "utf8");
    const version = markdown.match(/Versao:\s*([^\n]+)/i)?.[1]?.trim() || "unknown";
    this.loadedAt = new Date().toISOString();
    this.version = version;
    this.sections = splitSections(markdown).map((section) => ({
      ...section,
      tokens: tokenize(`${section.title}\n${section.content}`),
    }));
    return this;
  }

  search(query, { limit = 5 } = {}) {
    const queryTokens = new Set(tokenize(query));
    if (!queryTokens.size) return [];

    return this.sections
      .map((section) => {
        const score = section.tokens.reduce((total, token) => total + (queryTokens.has(token) ? 1 : 0), 0);
        return { section, score };
      })
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map(({ section, score }) => ({
        title: section.title,
        score,
        excerpt: section.content.slice(0, 900),
      }));
  }

  metadata() {
    return {
      path: this.filePath,
      version: this.version,
      loadedAt: this.loadedAt,
      sections: this.sections.length,
    };
  }
}

module.exports = PlaybookStore;
