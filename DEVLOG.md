# 開発記録

T-Scope（RoboCup Rescue Simulation ビューワ、[shima004/SimScope](https://github.com/shima004/SimScope) のフォーク）の開発記録。

---

## 1. 全体画面＋詳細画面の2画面表示

**ブランチ**: `feature/multi-view` → `develop` にマージ済み（PR #1）

### やったこと
- エージェントを選択すると、画面が「全体画面」と「詳細画面」の2画面に分割されるようにした
  - 全体画面：街全体を表示（ハイライト・暗転なし）
  - 詳細画面：選択したエージェントに自動で追従・ズーム
- 建物や瓦礫などエージェント以外を選択した場合は、1画面表示のまま
- 詳細画面が今どこを映しているかを示す「視野枠」を全体画面上に表示

### 実装のポイント
- `SimMap.svelte` に `alwaysFollow`（詳細画面用：常に追従）、`suppressHighlight`（全体画面用：選択によるハイライト・暗転を無効化）という2つのpropを追加
- `detailViewport` というstoreを新設し、詳細画面が今映している範囲（中心座標＋半幅・半高さ）を書き込み、全体画面側がそれを読んで枠（`PathLayer`）を描画

### つまずいた点・学んだこと
- `position: absolute` な要素は、CSSで囲んだ`<div>`ではなく「一番近いpositionされた祖先」を基準にサイズが決まる → 2画面分割時に全体画面のcanvasが画面全体に重なって見える原因になった。囲みの`<div>`に`position: relative;`を追加して解決
- Svelteの`.subscribe(...)`は登録した瞬間に1回呼ばれるが、その時点で前提条件（`deck`が未作成等）が揃っていないと「取りこぼし」が起きる → `onMount`内で手動で一度呼び直す処理が必要だった

---

## 2. 追従・知覚ボタンの整理

**ブランチ**: `fix/perception-follow-buttons` → `develop` にマージ済み（PR #2）

### やったこと
- 「追従」ボタンを削除（詳細画面が自動で追従するようになったため不要かつ、ONのままだと全体画面まで追従してしまう不具合があった）
- 「知覚」ボタンを`ControlPanel.svelte`から`InfoPanel.svelte`（選択中エンティティの情報カード）へ移動
  - エージェント選択時のみ、かつ市民（知覚データを持たない）以外の時だけ表示
- 知覚モードが全体画面の表示に影響しないようガードを追加
- 知覚による暗転表示を、知覚モードON時のみに限定（以前は常時表示されていた）

---

## 3. 表示する情報の選択（作業中）

**ブランチ**: `feature/layer-visibility`

利用者が見たい情報だけに絞れるように、地図上の表示要素をカテゴリごとにON/OFFできるようにする機能。

### 対象カテゴリ
市民 / 救急隊 / 消防隊 / 土木隊 / 建物 / 瓦礫 / 避難所 / エージェントの移動経路 / 救助活動に関係する対象 / （エージェントや避難所の色の意味＝凡例）

### 進捗
- [x] **ステップ1**: store追加（`hiddenLayers`, `showLegend`）
- [x] **ステップ2〜3**: 開閉UIの作成
  - 当初は`ControlPanel`にボタンを追加する案だったが、「タイムラインと同じ見た目のタブにしたい」という方針変更があり、`+page.svelte`に`activeDrawer`（`"timeline" | "layers" | null`）という1つの状態でタイムライン/表示設定のドロワーを管理する形に変更
  - 2つのタブボタンを縦に並べて配置、文字ラベルは縦書き（`writing-mode: vertical-rl`）
  - タイムラインと表示設定は同時に開けず、同じ場所に展開される
- [x] **ステップ4**: `LayerFilterPanel.svelte` 作成（`ChannelFilterPanel.svelte`と同じパターンのトグルボタン一覧）
- [x] **ステップ5**: `SimMap.svelte` 側の配線（`hiddenLayers`を見て実際に描画を出し分け）完了
  - [x] 市民・救急隊・消防隊・土木隊・建物・瓦礫・避難所（`isLayerHidden()`関数でurnからカテゴリ判定し、仕分けループでスキップ）
  - [x] エージェントの移動経路（`moveLayers`・`agent-trails`レイヤーのdataを空にする形で対応）
  - [x] 救助活動に関係する対象（`clear-area`ポリゴン、`rescuing-fire-brigades-highlight`、`passengers-emoji`、`passengers-circle`の4箇所、dataを空にする形で対応）⚠️**要修正**：実装後に確認したところ「想定と違ったかもしれない」とのことで、対象範囲の見直しが必要（下記「未着手・今後の課題」参照）
- [x] **ステップ6**: 凡例パネルの中身作成 — `LayerFilterPanel.svelte`に`$showLegend`がONの時だけ表示される`.legend`セクションを追加。市民（HP高低で緑→黒）・消防隊（通常／救助中）・救急隊（通常／搬送中）・土木隊・避難所・瓦礫の色見本と説明を一覧表示。色の値は`SimMap.svelte`の`agentColor`/`buildingColor`/`blockades`レイヤーの実装から転記
  - 市民のHP低下時の色がほぼ黒で、パネルの暗い背景に埋もれて見えにくい問題への対応：
    - 案1（色見本に白い縁取り）、案2（`.legend`セクション全体の背景を明るくする）の2つを試し、人に見た目の意見をもらった結果、**案1（白い枠線）に決定**。`.legend`の背景変更はコメントアウトして無効化、`.swatch`に`border: 1px solid rgba(255, 255, 255);`を追加して対応済み

### 設計のポイント
- `hiddenLayers`（`Set<LayerCategory>`）に非表示カテゴリを入れる／消すことで管理（`hiddenChannels`と同じパターン）
- `SimMap.svelte`の`staticArgs`/`agentArgs`という`derived`store（複数storeの変化を合成して`buildStaticLayers`/`buildAgentLayers`を呼び直す仕組み）の依存リストに`hiddenLayers`を追加し、チェックボックス操作が即座に地図に反映されるようにした

### 未着手・今後の課題
- **「救助活動に関係する対象」(`rescueTargets`) カテゴリの対象範囲を要見直し**：現状は「今まさに救助・搬送・瓦礫除去をしている最中であることを示す付加的な演出表示」4つ（`clear-area`ポリゴン、`rescuing-fire-brigades-highlight`、搬送中市民の表示2種）だけを対象にしているが、2026-10-06にユーザーから「少し想定と違ったかもしれない」という指摘があった（具体的に何が違うかは時間切れで未確認）。次回、本来どの要素を指していたのか認識合わせをしてから実装を直す
- 知覚機能の見せ方について、今の「知覚ON時のみ暗転表示」は暫定対応。ユーザーから「別のやり方にしたい」という要望があり、最終形は未確定
- 「2つのログファイルを同時に開く」機能は別のブランチ・別名で今後着手予定（検討段階でiframe方式が候補に上がったが保留中）

---

## ブランチ構成の参考
```
main
 └ develop  ← ここに feature/機能 を順次マージしていく運用（研究室の方針に合わせた）
    └ feature/multi-view          (マージ済み)
    └ fix/perception-follow-buttons (マージ済み)
    └ feature/layer-visibility     (作業中)
```
