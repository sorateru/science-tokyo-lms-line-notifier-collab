# 無料枠で24時間動かす（Cloudflare Workers + D1）

この構成では、自分のMacやVS Codeを閉じてもCloudflare側が毎分処理を起動します。常駐サーバーではなく、必要な時だけWorkerが起動するため、個人利用なら無料枠で運用しやすい構成です。

## 無料枠の目安

- Worker Cron: 毎分で1日1,440回
- LMS同期: 30分ごとで1日48回
- D1: 課題数十件なら無料枠に対して十分小さい使用量
- LINE: 日本の無料プランは月200通

LINEが最も先に上限へ達しやすいため、既定では月180通で自動停止します。繰り返し通知を使う場合は注意してください。

例:

- 月20課題 × 3回通知 = 約60通
- 月20課題 × 締切前24時間を1時間ごと = 約480通（無料枠超過）

## 重要な前提

Science Tokyo LMSの「カレンダーをエクスポート」で生成した秘密iCalendar URLを使用します。このURLはログインなしでカレンダーを取得できる代わりに、URL自体が認証情報です。チャットやGitへ載せないでください。提出済み状態は含まれないため、提出後は管理画面で手動完了にします。

## 1. CloudflareアカウントとWrangler

Cloudflareの無料アカウントを作成してから、プロジェクトで次を実行します。

```bash
cd lms-line-notifier-collab
npm ci
npx wrangler login
```

共有テンプレートから自分専用のWrangler設定を作成します。このファイルはGit管理外です。

```bash
cp wrangler.example.jsonc wrangler.jsonc
```

## 2. D1データベースの作成

```bash
npx wrangler d1 create science-tokyo-task-notifier --location apac
```

表示された`database_id`を、`wrangler.jsonc`の`REPLACE_WITH_DATABASE_ID`と置き換えます。共有用の`wrangler.example.jsonc`には実IDを書き込みません。

データベースの表を作成します。

```bash
npm run cloud:migrate
```

## 3. 秘密情報を登録

次のコマンドは値をソースコードへ残さず、Cloudflareの暗号化secretとして登録します。各コマンドの実行後に値を入力します。

```bash
npx wrangler secret put APP_PASSWORD
npx wrangler secret put MOODLE_ICAL_URL
npx wrangler secret put LINE_CHANNEL_ACCESS_TOKEN
npx wrangler secret put LINE_USER_ID
```

`APP_PASSWORD`は管理画面専用の十分に長いパスワードです。ユーザー名は`admin`です。大学のパスワードは登録しません。

ローカルの`.env`へ4項目を設定済みなら、値をターミナルへ表示しない一括登録も利用できます。

```bash
npm run cloud:secrets
```

## 4. LINE実送信を有効化

Git管理外の`wrangler.jsonc`にある次の値を変更します。

```json
"DRY_RUN": "false"
```

月間安全上限は既定で180通です。

```json
"LINE_MONTHLY_LIMIT": "180"
```

## 5. デプロイ

```bash
npm run cloud:deploy
```

表示された`https://...workers.dev`を開き、以下でログインします。

- ユーザー名: `admin`
- パスワード: `APP_PASSWORD`に登録した値

デプロイ後はCloudflare Cron Triggerが毎分通知を確認し、毎時00分・30分にLMSを同期します。MacやVS Codeを起動しておく必要はありません。

## 6. 更新するとき

コード変更後は次だけ実行します。

```bash
npm test
npm run cloud:deploy
```

## セキュリティ

- `.env`、iCalendar URL、LINEトークンをGitへ追加しない
- `APP_PASSWORD`を大学アカウントのパスワードと同じにしない
- 管理画面はBasic認証で保護され、未設定時は公開されない
- Cloudflareのログへ課題名が出る可能性があるため、不要な`console.log`を追加しない
- 大学の規則上、秘密iCalendar URLを外部クラウドへ保存可能か確認する
