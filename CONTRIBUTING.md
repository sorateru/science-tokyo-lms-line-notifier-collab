# Contributing

このプロジェクトへの変更は、秘密情報を含めず、テストを通したPull Requestとして提出してください。

## 開発手順

1. 最新の`main`から作業ブランチを作成します。
2. 変更範囲を小さく保ちます。
3. 必要なテストを追加または更新します。
4. `npm test`を実行します。
5. 変更理由と確認方法をPull Requestへ記載します。

```bash
git switch main
git pull --ff-only
git switch -c feature/short-description
npm ci
npm test
```

## ブランチ名

- `feature/...`: 機能追加
- `fix/...`: 不具合修正
- `docs/...`: 文書のみ
- `refactor/...`: 挙動を変えない整理

## コミット

何を変更したか分かる短いメッセージを使用してください。

```text
Add configurable reminder presets
Fix iCalendar timezone parsing
Update deployment guide
```

## Pull Requestの確認項目

- [ ] `npm test`が成功する
- [ ] `.env`や実トークンを含んでいない
- [ ] D1スキーマ変更には新しいmigrationを追加した
- [ ] 挙動変更をREADMEへ反映した
- [ ] 本番デプロイが必要か明記した

## D1スキーマ変更

適用済みのmigrationを直接書き換えず、`cloud/migrations/`へ連番の新規ファイルを追加してください。

```text
0002_add_example_column.sql
```

ローカル確認後、管理者がリモートD1へ適用します。

## Secretの扱い

秘密情報をソースコード、テストデータ、Issue、Pull Requestへ記載しないでください。テストでは`example.invalid`や明らかなダミー値を使用します。

`wrangler.jsonc`は開発者ごとのD1 IDを含むためGit管理外です。共有設定を変更する場合は`wrangler.example.jsonc`を更新し、実際のIDを含めないでください。
