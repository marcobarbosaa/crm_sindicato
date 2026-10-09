import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import ts from 'typescript';

const nativeRequire = createRequire(import.meta.url);
const source = readFileSync('app/smart-sends-page.tsx', 'utf8');
const code = ts.transpileModule(source + '\nexport { CompanyPicker };', {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText;

// Execute the real picker and its click handlers; no browser or live API required.
function picker(id, origin) {
  const company = { id, name: 'Empresa de teste', primaryEmail: 'test@example.test', cnpj: null };
  const state = [origin === 'search' ? 'Empresa' : '', origin === 'search' ? [company] : [], ''];
  const updates = [], payloads = [];
  let index = 0;
  const loaded = { exports: {} };
  const require = name => {
    if (name === 'react') return {
      useState: () => { const slot = index++; return [state[slot], value => updates.push({ slot, value })]; },
      useEffect: () => {},
    };
    if (name === 'react/jsx-runtime') return nativeRequire(name);
    return {};
  };
  new Function('require', 'module', 'exports', code)(require, loaded, loaded.exports);
  const tree = loaded.exports.CompanyPicker({
    item: { fileName: 'documento.pdf', suggestions: origin === 'suggestion' ? [company] : [] },
    disabled: false,
    onChoose: companyId => payloads.push(JSON.stringify({ companyId })),
  });
  const buttons = [];
  function visit(node) {
    if (Array.isArray(node)) return node.forEach(visit);
    if (!node || typeof node !== 'object') return;
    if (node.type === 'button') buttons.push(node);
    visit(node.props?.children);
  }
  visit(tree);
  assert.equal(buttons.length, 1);
  buttons[0].props.onClick();
  return { payloads, updates };
}

for (const origin of ['search', 'suggestion']) {
  test(`${origin}: string API ID becomes a numeric PATCH payload`, () => {
    assert.deepEqual(picker('129', origin).payloads, ['{"companyId":129}']);
  });
  test(`${origin}: numeric API ID remains supported`, () => {
    assert.deepEqual(picker(129, origin).payloads, ['{"companyId":129}']);
  });
  test(`${origin}: invalid IDs do not request an association`, () => {
    for (const id of ['', ' ', '129x', '129.5', '1e2', '0x81', '0', '-1', 0, -1, 1.5, NaN, Infinity, '9007199254740993', null, undefined]) {
      const result = picker(id, origin);
      assert.deepEqual(result.payloads, [], String(id));
      assert.ok(result.updates.some(update => update.slot === 2 && update.value.includes('inválido')), String(id));
    }
  });
}
