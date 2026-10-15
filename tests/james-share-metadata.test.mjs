import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
function metadata(path) {
    const source = read(path);
    const ast = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const statement = ast.statements.find((node) => ts.isVariableStatement(node)
        && node.declarationList.declarations.some((decl) => decl.name.getText(ast) === 'metadata'));
    assert.ok(statement, `metadata export exists in ${path}`);
    const js = ts.transpileModule(statement.getText(ast), {
        compilerOptions: { module: ts.ModuleKind.CommonJS },
    }).outputText;
    const context = { exports: {} };
    vm.runInNewContext(js, context);
    return context.exports.metadata;
}

test('James supplies its own consistent standard, OpenGraph, and Twitter preview', () => {
    const result = metadata('app/demo/james-notepad/page.tsx');
    assert.equal(result.title, 'James — AI Intake Demo');
    for (const preview of [result.openGraph, result.twitter]) {
        assert.equal(preview.title, result.title);
        assert.equal(preview.description, result.description);
    }
    assert.match(result.description, /fictional details only/);
    assert.match(result.description, /Not legal advice/);
    assert.equal(result.robots.index, false);
    assert.equal(result.robots.follow, false);
    assert.match(read('app/demo/james/page.tsx'), /export \{ metadata, default \} from '\.\.\/james-notepad\/page'/);
});

test('site preview and homepage copy do not promise hallucination-free answers', () => {
    for (const path of ['app/layout.tsx', 'components/home/FAQSection.tsx', 'components/home/HowItWorksSection.tsx']) {
        assert.doesNotMatch(read(path), /zero hallucinations|zero off-script|can only reference verified/i);
    }
    assert.doesNotMatch(metadata('app/layout.tsx').openGraph.description, /hallucination/i);
    assert.match(read('components/home/FAQSection.tsx'), /AI can still make mistakes/);
});
