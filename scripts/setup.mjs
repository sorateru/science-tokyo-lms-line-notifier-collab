import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const envFile = path.join(root, '.env');
const exampleFile = path.join(root, '.env.example');
const dataDirectory = path.join(root, 'data');

fs.mkdirSync(dataDirectory, { recursive: true });
if (!fs.existsSync(envFile)) {
  fs.copyFileSync(exampleFile, envFile, fs.constants.COPYFILE_EXCL);
  console.log('✓ .env を作成しました');
} else {
  console.log('– .env は既にあるため変更していません');
}
console.log('✓ data ディレクトリを確認しました');
console.log('\n次の手順:');
console.log('1. VS Codeで .env を開いてLMSとLINEを設定');
console.log('2. npm run doctor');
console.log('3. npm start');
