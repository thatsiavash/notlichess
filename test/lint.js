// node test/lint.js [index.html] [--warn]  -> reports undefined identifiers and unused top-level functions in the main script
const fs = require('fs'), path = require('path');
const { Linter } = require('eslint');
const globals = require('globals');
const html = fs.readFileSync(process.argv[2] || require('path').join(__dirname, '..', 'index.html'), 'utf8');
const parts = html.split('<script>').slice(1).map(p => p.split('</script>')[0]);
const src = parts.sort((a, b) => b.length - a.length)[0];
const linter = new Linter({ configType: 'flat' });
const msgs = linter.verify(src, [{
  languageOptions: { ecmaVersion: 2020, sourceType: 'script', globals: Object.assign({}, globals.browser) },
  rules: { 'no-undef': 'error', 'no-unused-vars': ['warn', { vars: 'all', args: 'none', caughtErrors: 'none' }], 'no-dupe-keys': 'error', 'no-redeclare': 'error', 'no-unreachable': 'warn', 'no-dupe-else-if': 'error', 'no-self-assign': 'error' }
}]);
const lineOffset = html.slice(0, html.indexOf(src)).split('\n').length - 1;
const errs = msgs.filter(m => m.severity === 2), warns = msgs.filter(m => m.severity === 1);
errs.forEach(m => console.log('ERROR', m.line + lineOffset, m.ruleId, m.message));
if (process.argv[3] === '--warn') warns.forEach(m => console.log('warn ', m.line + lineOffset, m.ruleId, m.message));
console.log(`${errs.length} errors, ${warns.length} warnings`);
process.exit(errs.length ? 1 : 0);
