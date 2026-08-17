const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const SOURCE_ROOTS = ['app', 'components', 'hooks', 'lib'];
const ENGINE_REFERENCE = /\b(?:useChatEngine|ChatEngineThread)\b/;
const ENGINE_MODULE = /\b(?:from|require|import)\s*(?:\(\s*)?['"][^'"]*(?:useChatEngine|chat-engine)[^'"]*['"]/;

function sourceFiles(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry: any) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      return entry.name === '__tests__' ? [] : sourceFiles(entryPath);
    }
    return /\.(?:ts|tsx|js|jsx)$/.test(entry.name) ? [entryPath] : [];
  });
}

describe('chat engine dead-path contract', () => {
  it('has no UI consumer while the engine flag stays default-off', () => {
    const references = SOURCE_ROOTS
      .flatMap((root) => sourceFiles(path.join(ROOT, root)))
      .filter((filePath) => path.relative(ROOT, filePath) !== 'hooks/useChatEngine.ts')
      .filter((filePath) => {
        const source = fs.readFileSync(filePath, 'utf8');
        return ENGINE_REFERENCE.test(source) || ENGINE_MODULE.test(source);
      })
      .map((filePath) => path.relative(ROOT, filePath));

    expect(references).toEqual([]);
  });
});
