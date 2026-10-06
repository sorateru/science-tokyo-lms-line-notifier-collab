# Science Tokyo LMS → LINE Assignment Notifier

東京科学大学のMoodle系LMSから課題締切を取得し、LINEへ通知する非公式の個人向けリマインダーです。LMSカレンダーに掲載されない課題の手動登録、完了管理、通知時刻の調整、繰り返し通知にも対応します。

本リポジトリには、実際のLMS URL、LINE認証情報、管理画面パスワード、Cloudflare D1 IDを含めていません。利用者は自身の環境と認証情報を用意してください。

> [!IMPORTANT]
> 本プロジェクトは個人開発による非公式ツールです。東京科学大学、LINEヤフー株式会社、Cloudflare, Inc.が提供・承認・サポートする公式サービスではありません。所属組織の規則および各サービスの利用条件を確認し、自身の責任で利用してください。

## 主な機能

- LMSの秘密iCalendar URLから課題を30分ごとに同期
- 課題名、科目名、締切、URLの手動登録と編集
- 締切1日前・12時間前・3時間前の標準通知
- 課題ごとの追加通知と繰り返し通知
- 完了した課題の通知停止
- 通知履歴による二重送信の防止
- LMSで締切が変更された場合の再通知判定
- LINE月間送信数の安全上限（既定180通）
- MacやVS Codeを閉じても動作するCloudflare常時運用

## アーキテクチャ

本番環境の中心はCloudflare Workerです。Workerは、LMSからの課題取得、D1への保存、通知時刻の判定、LINEへの送信、管理画面のAPI処理を担当します。

Workerには、用途の異なる2つの入口があります。

- `scheduled()`: Cloudflare Cron Triggerから毎分呼ばれる定期処理
- `fetch()`: 管理画面やHTTP APIへのアクセス時に呼ばれるリクエスト処理

### 定期処理の流れ

1. Cloudflare Cron Triggerが毎分Workerを起動します。
2. 毎時00分・30分には、LMSの秘密iCalendar URLからイベントを取得します。
3. 取得したイベントを課題形式へ変換し、Cloudflare D1へ追加または更新します。
4. D1から締切前の未完了課題と通知履歴を取得します。
5. 現在時刻、締切、通知設定を比較し、送信対象を決定します。
6. 未送信の通知があれば、LINE用メッセージを生成してMessaging APIへ送信します。
7. 送信に成功した通知キーと月間送信数をD1へ記録します。

### 管理画面からの操作

1. ブラウザーがWorkerのHTTP APIへリクエストを送ります。
2. WorkerがBasic認証を検証します。
3. 認証に成功すると、課題の取得、手動登録、編集、完了、削除などをD1へ反映します。
4. 処理結果をJSONとして管理画面へ返します。

ブラウザーがLMS、D1、LINEへ直接接続することはありません。外部サービスとの通信と秘密情報の利用はWorker側に集約しています。

## コンポーネント

| コンポーネント | 役割 | 主な実装 |
|---|---|---|
| Cloudflare Worker | API、Cron、通知送信、認証 | `cloud/worker.mjs` |
| Cloudflare D1 | 課題、通知履歴、同期状態、送信数を保存 | `cloud/db.mjs` |
| iCalendarアダプター | ICSの取得、解析、課題形式への変換 | `src/ical.mjs` |
| 通知コア | 通知時刻の判定、LINE文章の生成 | `src/reminder-core.mjs` |
| 管理画面 | 手動登録、編集、完了、削除、同期 | `public/` |
| ローカルサーバー | 開発時のAPIとSQLite実行環境 | `src/server.mjs` |
| Wrangler | D1 migration、secret登録、Workerデプロイ | `wrangler.example.jsonc` |

### LMS同期

推奨方式は、Moodleのカレンダーエクスポートで発行される秘密iCalendar URLです。各イベントのUIDを外部IDとして使用するため、同じ課題を繰り返し取得しても重複しません。

同期時には課題名、科目名、締切、URLを更新します。利用者が管理画面で変更した通知設定と完了状態は維持されます。締切が変わった場合は、その課題の通知履歴を消去し、新しい締切で判定し直します。

### 通知判定

新規課題には、次の通知時刻を設定します。

| タイミング | 分単位の設定値 |
|---|---:|
| 締切1日前 | `1440` |
| 締切12時間前 | `720` |
| 締切3時間前 | `180` |

Workerは予定時刻を過ぎ、かつ締切前である通知を候補にします。実行が予定時刻から少し遅れても、次回Cronで送信できます。同じ通知キーはD1へ記録されるため、毎分実行しても二重送信されません。

### D1の保存内容

| 区分 | 内容 |
|---|---|
| `tasks` | 課題、締切、完了状態、通知設定 |
| `notification_log` | 送信済み通知キー、送信日時、結果 |
| `app_state` | 最終同期、同期エラー、月間LINE送信数 |

D1は保存を担当し、定期処理や通知判断はWorkerが担当します。

## 依存関係

アプリケーションの実行コードには、サードパーティーのnpmランタイム依存がありません。Node.jsおよびCloudflare Workersが提供する標準APIを使用しています。

| 種類 | 依存先 | 用途 |
|---|---|---|
| ローカルランタイム | Node.js 22.5以上 | ローカルサーバー、SQLite、テスト |
| クラウドランタイム | Cloudflare Workers | 本番API、Cron、LINE送信 |
| 開発依存 | Wrangler | Cloudflare開発・migration・デプロイ |
| 外部サービス | Cloudflare D1 | 本番データ保存 |
| 外部サービス | LINE Messaging API | LINE Push通知 |
| 外部データ | LMS iCalendar | 課題締切の取得 |

`package.json`の`dependencies`は空で、`devDependencies`はWranglerのみです。`package-lock.json`をコミットし、`npm ci`で同一の依存関係を再現します。DependabotがnpmとGitHub Actionsの更新を定期確認します。

## ローカル版とクラウド版

| 項目 | ローカル版 | クラウド版 |
|---|---|---|
| 実行場所 | Node.js | Cloudflare Workers |
| データベース | ローカルSQLiteファイル | Cloudflare D1 |
| 定期実行 | Node.jsプロセス内 | Cron Trigger |
| 停止条件 | Mac・プロセス終了時 | Cloudflare上で継続 |
| 主な用途 | 開発、動作確認 | 常時運用 |

ローカル版とクラウド版のデータベースは別です。ローカルで登録した課題が自動的にD1へ移ることはありません。

## ローカル開発

### 必要環境

- Git
- Node.js 22.5以上
- npm

`nvm`を利用する場合は、リポジトリ内で`nvm use`を実行すると`.nvmrc`の基準バージョンを選択できます。

### セットアップ

```bash
git clone <REPOSITORY_URL>
cd science-tokyo-lms-line-notifier-collab
nvm use
npm ci
npm run setup
```

`npm run setup`は`.env.example`からGit管理外の`.env`を作り、ローカルDB用の`data/`を用意します。

最初は`DRY_RUN=true`のまま使用してください。

```dotenv
MOODLE_ICAL_URL=https://LMSで発行した秘密カレンダーURL
LINE_CHANNEL_ACCESS_TOKEN=
LINE_USER_ID=
DRY_RUN=true
```

設定と接続を確認します。

```bash
npm run doctor
npm run lms:test
npm test
```

ローカルサーバーを起動します。

```bash
npm start
```

<http://127.0.0.1:8787>を開いてください。ローカル版はNode.jsプロセスを終了すると停止します。

## Cloudflareへデプロイ

常時運用にはCloudflare WorkersとD1を使用します。詳細は[CLOUD_DEPLOY.md](./CLOUD_DEPLOY.md)を参照してください。

概要は次のとおりです。

```bash
npx wrangler login
cp wrangler.example.jsonc wrangler.jsonc
npx wrangler d1 create science-tokyo-task-notifier --location apac
```

発行された`database_id`を、Git管理外の`wrangler.jsonc`へ設定します。共有用の`wrangler.example.jsonc`には実IDを書き込みません。

```bash
npm run cloud:migrate
npm run cloud:secrets
npm run cloud:deploy
```

`cloud:deploy`の前には自動テストが実行されます。共有テンプレートは`DRY_RUN=true`なので、動作確認後に各自の`wrangler.jsonc`で明示的に実送信を有効化してください。

## 開発コマンド

| コマンド | 内容 |
|---|---|
| `npm run setup` | `.env`と`data/`を初期化 |
| `npm run doctor` | 秘密値を表示せず設定状況を確認 |
| `npm run lms:test` | LMS接続と課題取得を確認 |
| `npm start` | ローカルサーバーを起動 |
| `npm run dev` | ファイル監視付きでローカル起動 |
| `npm test` | Node.js標準テストを実行 |
| `npm run cloud:migrate` | migrationをリモートD1へ適用 |
| `npm run cloud:secrets` | `.env`の秘密値をCloudflareへ登録 |
| `npm run cloud:deploy` | テスト後にWorkerをデプロイ |

## ディレクトリ構成

```text
.github/          CI、Dependabot、Pull Requestテンプレート
cloud/            Cloudflare WorkerとD1処理
public/           管理画面
scripts/          初期設定とsecret登録
src/              LMS連携、通知コア、ローカル版
test/             自動テストと共有設定の安全検査
```

## 共同開発

`main`へ直接pushせず、作業ブランチとPull Requestを使用してください。

```bash
git switch main
git pull --ff-only
git switch -c feature/short-description
npm ci
npm test
```

GitHub ActionsはNode.js 22と24でテストし、Node.js 24では高重要度以上の依存関係監査も行います。開発手順とmigration規約は[CONTRIBUTING.md](./CONTRIBUTING.md)を参照してください。

## セキュリティ

次のファイルと値はGitへ追加しないでください。

- `.env`、`.env.*`
- `.dev.vars`、`.dev.vars.*`
- `wrangler.jsonc`
- `data/`、ローカルDB
- LMSの秘密iCalendar URL
- LINEチャネルアクセストークン
- LINEユーザーID
- `APP_PASSWORD`

秘密情報を誤って公開した場合は、Git履歴から消すだけでなく、該当するURLやトークンを失効・再発行してください。詳細は[SECURITY.md](./SECURITY.md)を参照してください。

## 制約

- iCalendarから提出済み状態は取得できません。提出後は管理画面で完了にします。
- LMSカレンダーに掲載されない課題は手動登録が必要です。
- 1デプロイ・1ユーザーを前提としており、複数利用者のデータ分離機構はありません。
- LMSの秘密URLを外部クラウドへ保存できるか、所属組織の規則を確認する必要があります。

## ライセンス

[MIT License](./LICENSE)
