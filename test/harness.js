// Loads named top-level functions/vars from a single-file app into a Node vm sandbox.
// const H = require('./harness'); const ctx = H.load(['chessStart','sanApply',...], {file, extraCode});
const fs = require('fs'), vm = require('vm');
const DEFAULT_FILE = require('path').join(__dirname, '..', 'index.html');
function scriptOf(html) {
  const parts = html.split('<script>');
  return parts.slice(1).map(p => p.split('</script>')[0]).sort((a, b) => b.length - a.length)[0];
}
// scan from `i` (at an opening brace or statement start) to the end of the balanced block
function skipBalanced(src, i, stopAtSemicolon) {
  let depth = 0, n = src.length;
  for (; i < n; i++) {
    const c = src[i], d = src[i + 1];
    if (c === '/' && d === '/') { i = src.indexOf('\n', i); if (i < 0) return n; continue; }
    if (c === '/' && d === '*') { i = src.indexOf('*/', i + 2) + 1; continue; }
    if (c === '"' || c === "'" || c === '`') {
      const q = c; i++;
      while (i < n && src[i] !== q) { if (src[i] === '\\') i++; i++; }
      continue;
    }
    if (c === '/' ) {
      // regex literal heuristic: previous non-space char is one of ( , = : [ ! & | ? { } ; return
      let k = i - 1; while (k >= 0 && /\s/.test(src[k])) k--;
      const prev = src[k];
      if (prev && '(,=:[!&|?{};+-*%<>~^'.indexOf(prev) >= 0) {
        i++;
        let inClass = false;
        while (i < n) {
          if (src[i] === '\\') { i += 2; continue; }
          if (src[i] === '[') inClass = true; else if (src[i] === ']') inClass = false;
          else if (src[i] === '/' && !inClass) break;
          i++;
        }
        continue;
      }
    }
    if (c === '{' || c === '(' || c === '[') depth++;
    else if (c === '}' || c === ')' || c === ']') { depth--; if (depth === 0 && !stopAtSemicolon && c === '}') return i + 1; }
    else if (c === ';' && depth === 0 && stopAtSemicolon) return i + 1;
  }
  return n;
}
function extract(src, name) {
  let m = new RegExp('(^|\\n)function ' + name + '\\s*\\(').exec(src);
  if (m) {
    const start = m.index + (m[1] ? 1 : 0);
    const brace = src.indexOf('{', src.indexOf(')', start));
    // find the ')' that closes the parameter list properly
    const end = skipBalanced(src, brace, false);
    return src.slice(start, end);
  }
  m = new RegExp('(^|\\n)var ' + name + '\\s*=').exec(src);
  if (m) {
    const start = m.index + (m[1] ? 1 : 0);
    const end = skipBalanced(src, start, true);
    return src.slice(start, end);
  }
  throw new Error('not found: ' + name);
}
function load(names, opts) {
  opts = opts || {};
  const src = scriptOf(fs.readFileSync(opts.file || DEFAULT_FILE, 'utf8'));
  const code = names.map(n => extract(src, n)).join('\n\n') + '\n' + (opts.extraCode || '');
  const ctx = Object.assign({ console, Math, JSON, Date }, opts.globals || {});
  vm.createContext(ctx);
  vm.runInContext(code, ctx, { filename: 'extracted.js' });
  return ctx;
}
module.exports = { load, extract, scriptOf };
