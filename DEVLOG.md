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

### 使った主な技術・仕組み
- **Svelteコンポーネントのインスタンス化**：同じ`SimMap.svelte`というファイル（設計図）から、`<SimMap />`を複数回書くことで独立した実体（インスタンス）を複数作る
- **props**（`alwaysFollow`・`suppressHighlight`）：同じ部品でも、渡す値によって挙動を変える仕組み
- **store経由でのインスタンス間通信**（`detailViewport`）：直接繋がっていない2つのコンポーネント同士が、共有の置き場（store）を介してデータをやり取りする
- **deck.gl の `PathLayer`**：複数の座標点を結んだ線（閉じれば図形にもなる）を描画するレイヤー
- CSSの`position: relative`／`position: absolute`の基準関係

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

### 使った主な技術・仕組み
- 既存のstore（`perceptionViewMode`）はそのまま使い、「どのコンポーネントから見た挙動を変えるか」をpropsのガード条件で制御（新しい技術というより、既存の仕組みの応用）
- 使われなくなったコード・storeの削除（import整理含む）

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

### 使った主な技術・仕組み
- **`Set`（集合）データ構造**：「入っている／いない」でON/OFFを管理（`hiddenChannels`と同じ既存パターンを転用）
- **`derived`store**：複数のstoreの変化を合成して1つの計算済みstoreを作る仕組み。依存リストに追加するだけで「変化を検知して再計算する対象」を増やせる
- **`.subscribe(...)`**：storeの変化を監視して自動で処理を実行する（雑誌の定期購読と同じ発想）
- CSSの`writing-mode: vertical-rl`（縦書き表示）
- 三項演算子（`条件 ? 真の場合 : 偽の場合`）でレイヤーの`data`を空配列に差し替え、描画対象から除外する

### 未着手・今後の課題
- **「救助活動に関係する対象」(`rescueTargets`) カテゴリの対象範囲を要見直し**：現状は「今まさに救助・搬送・瓦礫除去をしている最中であることを示す付加的な演出表示」4つ（`clear-area`ポリゴン、`rescuing-fire-brigades-highlight`、搬送中市民の表示2種）だけを対象にしているが、2026-10-06にユーザーから「少し想定と違ったかもしれない」という指摘があった（具体的に何が違うかは時間切れで未確認）。次回、本来どの要素を指していたのか認識合わせをしてから実装を直す
- 知覚機能の見せ方について、今の「知覚ON時のみ暗転表示」は暫定対応。ユーザーから「別のやり方にしたい」という要望があり、最終形は未確定

---

## 4. 複数ログの同時表示（作業中）

**ブランチ**: `feature/multi-log`

### 方針
- URL・ページ自体は今まで通り（メインページから遷移しない）
- `entities`/`currentStep`等の状態はアプリ全体でシングルトン（1つしか持てない）なので、
  ログを2つ同時に扱うにはデータを分離する必要がある。本格的なstoreの
  インスタンス化（大掛かりなリファクタ）ではなく、**iframeで同じアプリをもう1つ
  埋め込む**方式を採用（ユーザーのSvelte習熟度を踏まえた判断、過去の検討経緯と同じ）

### やったこと
- `multiLogMode` store を追加（`state.ts`）
- `ControlPanel.svelte`：以前作って未使用になっていた（`/multi`へのリンク切れ）ボタンを
  「複数ログ」ボタンとして作り直し、`multiLogMode`を切り替えるようにした
- `+page.svelte`：`multiLogMode`がONの時、通常の1画面表示の代わりに
  `<iframe src="/?embed=1">`を2つ横に並べて表示するようにした
- **無限入れ子の防止**：URLに`embed`パラメータが付いている時（＝iframeの中）は
  「複数ログ」ボタン自体を表示しないようにし、iframeの中でさらに複数ログを
  開けてしまう問題をロック

### 使った主な技術・仕組み
- **`<iframe>`**：ページの中に別のWebページ（今回は自分自身のアプリ）をまるごと埋め込むHTMLの機能。中身は完全に独立した別のJavaScript実行環境になる
- **URLクエリパラメータ**（`?embed=1`）：iframeの中で動いているか、通常のページとして開かれているかを見分ける目印として利用

### 使った主な技術・仕組み（続き：ステップ同期）
- **`postMessage`**：別ウィンドウ（iframe）同士でメッセージをやり取りするブラウザ標準の仕組み。送信側は `相手のwindow.postMessage(データ, "*")`、受信側は `window.addEventListener("message", ...)` で受け取る
- 子（iframe内）は`window.parent`へ、親は`iframe要素.contentWindow`へ送ることで、親子間・子同士（親を中継役にして）のやり取りを実現
- **エコー防止フラグ**（`receivingSync`）：親からの同期指示で自分の状態を変えた時に、それをまた「変化した」として送り返してしまう無限ループを防ぐための目印

### やったこと（続き：同期ON/OFFの切り替え）
- `multiLogSync` store を追加（初期値`true`＝今までの常時同期と同じ挙動を維持）
- トグルボタンは**左側iframe（iframe1）のControlPanel内、言語切り替えの隣**に設置
  - iframe1のsrcに`&primary=1`を付与し、`_q.has("primary")`で「自分が左側か」を判定
  - 親のControlPanelではなく、各iframe自身のControlPanel（`embed`時のみ表示）の中に置くことで、既存のボタン配置・スタイルと一貫性を保った
- ボタンを押す → iframeは`tscope:toggleSync`を親へ送るだけ（自分では値を書き換えない）
- 親が実際に`multiLogSync`を反転させ、新しい値を**両方の**iframeへ`tscope:setSync`で送り返す（表示を揃えるため）
- ステップ中継処理の先頭に`if (!get(multiLogSync)) return;`を追加し、OFFの時は転送しないように変更

### やったこと（続き：カメラ位置の同期）
- `mapViewport`（送信用）・`remoteViewportCommand`（受信指令用）の2つのstoreを追加。送受信で別のstoreを使うことで、自分の変化を自分で検知して送り返すループを避けている
- `SimMap.svelte`の`onViewStateChange`（deck.glがカメラ変化時に呼ぶコールバック）を拡張し、ユーザーがドラッグ・ズームした時のカメラ位置（中心座標・ズーム）を`mapViewport`に書き込むようにした
  - **`alwaysFollow`（詳細画面）は対象外**：自動追従中のカメラ変化まで送信してしまうと、追従処理と競合するため
- 受信側は`remoteViewportCommand`を購読し、`deck.setProps`で実際にカメラを動かす（こちらも`alwaysFollow`は対象外）
- 中継・エコー防止の仕組みはステップ同期と同じパターンを踏襲（`receivingViewportSync`という別フラグを新設）

### 使った主な技術・仕組み（続き：同期ON/OFF・カメラ同期）
- **URLクエリパラメータでの役割判定**（`?embed=1&primary=1`）：同じiframe内コンポーネントでも、パラメータの有無で「自分が左か右か」を判定し、表示するUIを変える
- **送信用／受信用でstoreを分離する設計**：双方向の同期で同じstoreを使い回すと、自分の変化を自分で検知して無限ループになりやすい。書く専用・指令を受ける専用に分けることで回避
- **TypeScriptの型の絞り込み（narrowing）**：`number | undefined`のような値は、チェックした`if`ブロックの中でしか型が確定しない、という挙動にハマった

### 未着手・今後の課題
- 各iframeでどのログを読み込むかの指定方法（今は両方とも素の`/`を開くだけで、
  手動でそれぞれログファイルを選ぶ必要がある）
- **選択（クリック）の同期は保留**：複数ログ状態で詳細画面（2画面分割）を開くと縦4分割という見づらいレイアウトになってしまうため、UI設計を先に検討する必要がある
- 最終的に3画面・4画面に拡張するかどうかは未定（優先度Cの項目）
- **既知の不具合（未修正）**：
  - 1つのログを読み込んだ状態から複数ログモードに切り替えると、各iframeでログを読み込み直す必要がある（iframeは独立した実行コンテキストのため、読み込み済みの状態を引き継げない）
  - 再生／停止の状態（`playing`）が`ControlPanel.svelte`内のローカルな`$state`になっており、iframe間で共有されていない。そのため片方で再生してもステップは同期されるがもう片方のボタン表示は連動せず、両方で再生ボタンを押すと両方止めないと止まらない
- **既知の制限（未対応）**：
  - `postMessage`の送信先originを`"*"`で指定しており、受信側も送信元originを検証していない（同一オリジンのiframe間でのみ使う前提）
  - `svelte-check`の警告が2件増えた：`+page.svelte`の`iframe1`/`iframe2`（`bind:this`）が`$state`で宣言されていない（動作には影響しないが未修正）。なお`develop`時点から存在する型エラー2件（`SimMap.svelte`の`flushLayers`、`+page.svelte`の`$selectedEntity`のnull可能性）は今回の対象外

---

## 5. タスクを基準とした場面探索（計画中・優先度B）

シミュレーションログから特定のタスクが行われた場面を抽出し、利用者がタスクを選ぶとその場面（該当ステップ）へ直接移動できるようにする機能。

### 抽出対象とするタスク
- 重要ポイントの啓開（優先道路、避難所付近など）
- 消防隊による市民の救出
- 救急隊による市民の搬送
- 通信（ringoの機能）

### 概要
- 各タスクについて、発生したステップ・実行したエージェント・対象などをログから取得する
- 利用者がタスクを選択すると、該当する場面の一覧を提示し、選んだ場面のステップへ移動できるようにする

---

## 6. タイムライン選択時に全体画面が動かないようにする修正

**ブランチ**: `fix/timeline-focus-detail-only`

### 問題
2画面表示中にタイムラインパネルでタスク（イベント）を選ぶと、詳細画面だけでなく全体画面のカメラも選んだ場面へ移動してしまい、全体を見渡せなくなっていた。

### 原因
`focusPoint`は全`SimMap`インスタンスが購読している共有ストア。`TimelinePanel`が`focusPoint.set(...)`すると、2画面の両方が同じ処理（`deck.setProps`でカメラ移動）を実行していた。

### やったこと
- `SimMap.svelte`の`unsubFocus`に`if (suppressHighlight) return;`を追加し、2画面モードの全体画面は`focusPoint`を無視するようにした
- 詳細画面は元々`followAgent`が選択エージェントへ追従し続けるため、追加の対応は不要

### 設計のポイント
- `!alwaysFollow`ではなく`suppressHighlight`で判定した理由：1画面モードの`<SimMap />`も`alwaysFollow`は`false`のため、`!alwaysFollow`で弾くと1画面でのジャンプまで効かなくなる。2画面の全体画面だけを指せるのは`suppressHighlight`

### 影響範囲
- `focusPoint`は待機エージェント一覧・市民一覧・InfoPanelの「ここへ移動」も使っているため、それらでも2画面モードの全体画面は動かなくなる（詳細画面は追従する）

### 使った主な技術・仕組み
- 共有ストアを複数のインスタンスが購読する場合、「反応するかどうか」を各インスタンスが自分のprops（`alwaysFollow`／`suppressHighlight`）で判断する

---

## ブランチ構成の参考
```
main
 └ develop  ← ここに feature/機能 を順次マージしていく運用（研究室の方針に合わせた）
    └ feature/multi-view          (マージ済み)
    └ fix/perception-follow-buttons (マージ済み)
    └ feature/layer-visibility     (マージ済み)
    └ feature/multi-log            (マージ済み)
    └ fix/timeline-focus-detail-only (作業中)
```
