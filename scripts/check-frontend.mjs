import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const failures = [];

function readText(file) {
  return fs.readFileSync(path.join(rootDir, file), "utf8");
}

function listFiles(dir, extension) {
  const dirPath = path.join(rootDir, dir);
  if (!fs.existsSync(dirPath)) return [];

  return fs
    .readdirSync(dirPath, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(extension))
    .map((entry) => path.join(dir, entry.name));
}

function getJavaScriptFiles() {
  return ["app.js", ...listFiles("js", ".js"), ...listFiles("functions/api", ".js"), ...listFiles("functions/lib", ".js")];
}

function checkDuplicateHtmlIds() {
  const html = readText("index.html");
  const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);
  const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
  const uniqueDuplicates = [...new Set(duplicates)];

  if (uniqueDuplicates.length) {
    failures.push(`index.html: duplicate IDs found: ${uniqueDuplicates.join(", ")}`);
  }
}

function checkUnsafeFrontendPatterns() {
  const patterns = [
    /\.innerHTML\b/,
    /\.outerHTML\b/,
    /\.insertAdjacentHTML\b/,
    /\beval\s*\(/,
    /\bnew Function\b/,
  ];

  for (const file of ["index.html", ...getJavaScriptFiles()]) {
    const source = readText(file);

    for (const pattern of patterns) {
      if (pattern.test(source)) {
        failures.push(`${file}: contains unsafe pattern ${pattern}`);
      }
    }
  }
}

function checkSimpleHtmlIdReferences() {
  const html = readText("index.html");
  const ids = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]));
  const references = new Map();
  const patterns = [
    /document\.getElementById\("([^"]+)"\)/g,
    /document\.querySelector\("#([A-Za-z][\w-]*)"\)/g,
  ];

  for (const file of getJavaScriptFiles()) {
    const source = readText(file);

    for (const pattern of patterns) {
      for (const match of source.matchAll(pattern)) {
        const id = match[1];
        if (!references.has(id)) references.set(id, []);
        references.get(id).push(file);
      }
    }
  }

  for (const [id, files] of references) {
    if (!ids.has(id)) {
      failures.push(`#${id}: referenced in ${[...new Set(files)].join(", ")} but missing from index.html`);
    }
  }
}

checkDuplicateHtmlIds();
checkUnsafeFrontendPatterns();
checkSimpleHtmlIdReferences();

if (failures.length) {
  console.error(failures.join("\n\n"));
  process.exit(1);
}

console.log("Frontend sanity checks passed.");
