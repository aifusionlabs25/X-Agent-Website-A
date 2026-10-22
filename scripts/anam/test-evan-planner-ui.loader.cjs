// Webpack's synchronous loader contract is CommonJS.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const ts = require('typescript');

module.exports = function transpileFixture(source) {
    this.cacheable();
    return ts.transpileModule(source, {
        fileName: this.resourcePath,
        compilerOptions: {
            target: ts.ScriptTarget.ES2020,
            module: ts.ModuleKind.ESNext,
            jsx: ts.JsxEmit.ReactJSX,
            esModuleInterop: true,
        },
    }).outputText;
};
