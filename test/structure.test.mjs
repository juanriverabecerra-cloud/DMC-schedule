// The app has no build step, so one bad import stops it dead on every phone. These check the
// whole codebase without running it: every import resolves, every imported name exists, and the
// offline list covers every module.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
  const p = path.join(dir, e.name);
  return e.isDirectory() ? walk(p) : /\.m?js$/.test(e.name) ? [p] : [];
});
const modules = ["public/js", "public/core", "lib", "netlify/functions", "scripts", "test"].flatMap((d) => walk(path.join(root, d)));
modules.push(path.join(root, "public/sw.js"));

function exportsOf(file) {
  const src = fs.readFileSync(file, "utf8");
  const names = new Set();
  for (const m of src.matchAll(/^export\s+(?:async\s+)?(?:function\*?|const|let|class)\s+([\w$]+)/gm)) names.add(m[1]);
  for (const m of src.matchAll(/^export\s*\{([^}]*)\}/gm)) for (const n of m[1].split(",")) if (n.trim()) names.add(n.trim().split(/\s+as\s+/).pop());
  if (/^export\s+default\b/m.test(src)) names.add("default");
  return names;
}

test("every local import points at a file that exports that name", () => {
  const problems = [];
  for (const file of modules) {
    const src = fs.readFileSync(file, "utf8");
    for (const m of src.matchAll(/^import\s+(?:\{([^}]*)\}\s+from\s+)?"(\.[^"]+)";/gm)) {
      const target = path.resolve(path.dirname(file), m[2]);
      const where = path.relative(root, file);
      if (!fs.existsSync(target)) { problems.push(`${where}: no file ${m[2]}`); continue; }
      const have = exportsOf(target);
      for (const n of (m[1] || "").split(",").map((x) => x.trim()).filter(Boolean)) {
        const name = n.split(/\s+as\s+/)[0];
        if (!have.has(name)) problems.push(`${where}: ${m[2]} has no export "${name}"`);
      }
    }
  }
  assert.deepEqual(problems, []);
});

test("the offline list has every module the app loads, and nothing that doesn't exist", () => {
  const sw = fs.readFileSync(path.join(root, "public/sw.js"), "utf8");
  const shell = [...sw.match(/const SHELL = \[([\s\S]*?)\];/)[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  const pub = path.join(root, "public");
  for (const p of shell) if (p !== "/") assert.ok(fs.existsSync(path.join(pub, p)), `${p} is listed but missing`);
  for (const file of [...walk(path.join(pub, "js")), ...walk(path.join(pub, "core"))]) {
    const url = `/${path.relative(pub, file).split(path.sep).join("/")}`;
    assert.ok(shell.includes(url), `${url} isn't in the offline list`);
  }
});

test("every shared record is saved through a safe update", () => {
  const shared = /setJSON\(\s*"(dataset|swaps|survey|push\/subs|reqlog)"|setJSON\(KEY/;
  for (const dir of ["lib", "netlify/functions"]) {
    for (const file of walk(path.join(root, dir))) assert.ok(!shared.test(fs.readFileSync(file, "utf8")), `${path.relative(root, file)} overwrites a shared record`);
  }
});
