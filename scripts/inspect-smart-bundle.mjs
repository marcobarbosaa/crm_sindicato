import { readdirSync, readFileSync, statSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname, relative } from 'node:path';
import ts from 'typescript';

const root = resolve('dist/server'), label = process.argv[2] || 'current';
if (!/^[a-z0-9-]+$/.test(label)) throw Error('Invalid label');
const walk = dir => readdirSync(dir, {withFileTypes:true}).flatMap(e => e.isDirectory() ? walk(resolve(dir,e.name)) : e.name.endsWith('.js') ? [resolve(dir,e.name)] : []);
const files = walk(root), route = files.find(f => { if (!/[/\\]route-[^/\\]+\.js$/.test(f)) return false; const text=readFileSync(f,'utf8'); return text.includes('deletion-preview') && text.includes('import-status'); });
if (!route) throw Error('Build the Worker first');
const seen = new Set(), dynamic = new Set();
function visit(file) {
  if (seen.has(file)) return;
  seen.add(file);
  const ast = ts.createSourceFile(file,readFileSync(file,'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
  for (const node of ast.statements) {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier) && node.moduleSpecifier.text.startsWith('.')) visit(resolve(dirname(file),node.moduleSpecifier.text));
  }
  function scan(node) {
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword && node.arguments[0] && (ts.isStringLiteral(node.arguments[0]) || ts.isNoSubstitutionTemplateLiteral(node.arguments[0]))) dynamic.add(node.arguments[0].text);
    ts.forEachChild(node,scan);
  }
  scan(ast);
}
visit(route);
const result={route:relative(root,route),staticBytes:[...seen].reduce((total,f)=>total+statSync(f).size,0),
  staticFiles:[...seen].map(f=>({file:relative(root,f),bytes:statSync(f).size})),dynamicImports:[...dynamic],
  pdfChunks:files.filter(f=>/[/\\]pdf(js|-text)-/.test(f)).map(f=>({file:relative(root,f),bytes:statSync(f).size,staticFromRoute:seen.has(f)}))};
mkdirSync(resolve('outputs/smart-cpu',label),{recursive:true});
writeFileSync(resolve('outputs/smart-cpu',label,'bundle.json'),JSON.stringify(result,null,2));
console.log(JSON.stringify(result,null,2));
