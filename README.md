# Science Tokyo LMS → LINE 課題リマインダー

東京科学大学のMoodle系LMSから課題締切を取得し、LINEへ通知する個人向けリマインダーです。LMSに載らない課題の手動登録、完了管理、通知時刻の追加、繰り返し通知にも対応しています。

このリポジトリは共同開発用の安全なコピーです。実際のLMS URL、LINEトークン、ユーザーID、管理画面パスワード、Cloudflare D1 IDは含まれていません。各開発者が自分の環境で設定してください。

## 動作の流れ

```text
LMSの秘密iCalendar URL
        ↓ 30分ごとに取得
Cloudflare Worker
        ↓ 課題を追加・更新
Cloudflare D1
        ↓ 毎分、通知時刻を判定
LINE Messaging API
        ↓
自分のLINE
```

- Cloudflare Cron Triggerが毎分通知を確認します。
- 毎時00分・30分にLMSカレンダーを同期します。
- 新規課題の標準通知は、締切1日前・12時間前・3時間前です。
- 提出済み状態はiCalendarに含まれないため、管理画面で手動完了にします。
- LINE送信は月180通で自動停止する安全上限があります。

## 技術構成

- バックエンド: JavaScript / Cloudflare Workers
- ローカル実行・テスト: Node.js 22.5以上
- フロントエンド: HTML / CSS / Vanilla JavaScript
- データベース: Cloudflare D1（SQLite系SQL）
- LMS連携: iCalendar（ICS）
- 通知: LINE Messaging API
- 定期実行: Cloudflare Cron Triggers
- デプロイ: Wrangler

## ローカル開発

### 1. リポジトリを取得

```bash
git clone <REPOSITORY_URL>
cd lms-line-notifier-collab
npm ci
```

Node.js 22.5以上を使用します。`nvm`を利用している場合は、リポジトリ内で`nvm use`を実行すると基準バージョンを選択できます。

### 2. 環境変数を作成

```bash
npm run setup
```

`.env`へ自分の値を設定します。最初は`DRY_RUN=true`のままにしてください。

```dotenv
MOODLE_ICAL_URL=https://LMSで発行した秘密カレンダーURL
LINE_CHANNEL_ACCESS_TOKEN=
LINE_USER_ID=
DRY_RUN=true
```

秘密カレンダーURLには認証情報が含まれます。Issue、Pull Request、チャット、スクリーンショットへ貼らないでください。

### 3. 設定と接続を確認

```bash
npm run doctor
npm run lms:test
npm test
```

### 4. ローカル起動

```bash
npm start
```

<http://127.0.0.1:8787>を開きます。ローカル版はプロセスを終了すると停止します。

## Cloudflareへデプロイ

常時運用する場合はCloudflare WorkersとD1を使用します。詳しい手順は[CLOUD_DEPLOY.md](./CLOUD_DEPLOY.md)を参照してください。

重要な流れは次のとおりです。

```bash
npx wrangler login
cp wrangler.example.jsonc wrangler.jsonc
npx wrangler d1 create science-tokyo-task-notifier --location apac
```

表示された`database_id`を、Git管理外の`wrangler.jsonc`にある`REPLACE_WITH_DATABASE_ID`へ設定し、続けて実行します。`wrangler.example.jsonc`は共有テンプレートなので編集しません。

```bash
npm run cloud:migrate
npm run cloud:secrets
npm run cloud:deploy
```

デプロイ前に、`.env`へ16文字以上の`APP_PASSWORD`と必要な秘密情報を設定してください。

## ディレクトリ構成

```text
cloud/       Cloudflare WorkerとD1処理
public/      管理画面
scripts/     初期設定・secret登録用スクリプト
src/         LMS取得、通知判定、ローカル版
test/        自動テスト
```

主要ファイル:

- `cloud/worker.mjs`: 本番Workerの入口、Cron、API、LINE送信
- `cloud/db.mjs`: D1への保存と取得
- `src/ical.mjs`: iCalendarの取得と解析
- `src/reminder-core.mjs`: 通知時刻の判定と文章生成
- `public/app.js`: 管理画面の操作
- `wrangler.example.jsonc`: Cloudflare構成の共有テンプレート
- `wrangler.jsonc`: 各開発者が作る環境固有設定（Git管理外）

## 共同開発

変更前にブランチを作成してください。

```bash
git switch -c feature/変更内容
npm test
```

コミット後にPull Requestを作成します。詳しい規約は[CONTRIBUTING.md](./CONTRIBUTING.md)を参照してください。

## セキュリティ

次のファイルや値はGitへ追加しないでください。

- `.env`
- `data/`
- `.wrangler/`
- `.dev.vars`、`.dev.vars.*`
- `wrangler.jsonc`
- LMSの秘密カレンダーURL
- LINEチャネルアクセストークン
- LINEユーザーID
- `APP_PASSWORD`

実際の秘密情報が誤ってコミットされた場合は、削除するだけでなく該当トークンやURLを再発行してください。

## 現在の制約

- iCalendarから提出済み状態は取得できません。
- LMSにカレンダー登録されない課題は手動登録が必要です。
- 現在は1デプロイ・1ユーザーを前提としています。
- 複数人で同じ本番環境を共有する設計ではありません。

## ライセンス

共同公開する場合は、リポジトリ所有者が利用方針に合うライセンスを選択してください。現時点ではライセンスを付与していません。
