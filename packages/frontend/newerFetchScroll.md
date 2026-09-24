# Load Newer Notes時のスクロール位置復元の問題と解決

## 📋 ドキュメント概要

### このドキュメントの目的
Playwright MCPを使って「Load newer notes」ボタンのスクロール位置復元機能をテストし、問題を特定・解決するための完全なガイド。

### 対象読者
- Claude Code（自動テスト実行）
- 開発者（問題の理解と手動確認）

### 使い方
1. **すぐにテストを実行したい場合**
   - 「実験1を実行して」とClaude Codeに指示
   - または「メインテストシナリオを実行して」で動作確認

2. **問題の詳細を理解したい場合**
   - 「問題の詳細」「デバッグログ」セクションを参照

3. **修正後の検証**
   - 「Playwright MCPテストシナリオ」を3回繰り返し実行

### ドキュメント構成
- **Playwright MCPテストシナリオ** - メインの動作確認テスト
- **関連ソースコード** - 実装の詳細
- **問題の詳細** - 何が起きているか
- **試した修正** - これまでの試行
- **検証課題** - 何を確認すべきか
- **次のステップ（実験1〜5）** - 具体的な検証手順
- **Playwright MCPでの実行方法** - 実行ガイド

---

## Playwright MCPテストシナリオ

### 目的
"Load newer notes"ボタンをクリックして新しいノートを上に追加したとき、ユーザーが見ていたノートの位置を復元する機能のテスト。

### 前提条件
- 開発サーバーが起動している（`pnpm dev`）
- Playwright MCPが利用可能
- ログイン済みのセッションがある

### テスト手順（Playwright MCP）

#### ステップ1: ページを開く
```
ツール: browser_navigate
URL: http://localhost:3000/timemachine?goto=20250131204200
```

#### ステップ2: 初期状態のスナップショット取得
```
ツール: browser_snapshot
目的: ページの初期状態とノートの構造を確認
```

#### ステップ3: 最初のノート要素の情報を記録
```
ツール: browser_evaluate
JavaScript:
  const scrollContainer = document.querySelector('[ref="scrollContainer"]') ||
                          document.querySelector('[style*="overflow-y: auto"]');
  const firstNote = document.querySelector('[data-scroll-anchor]');
  const firstNoteText = firstNote?.textContent?.substring(0, 50);
  const scrollContainerRect = scrollContainer?.getBoundingClientRect();
  const firstNoteRect = firstNote?.getBoundingClientRect();

  return {
    scrollTop: scrollContainer?.scrollTop,
    scrollHeight: scrollContainer?.scrollHeight,
    firstNoteText: firstNoteText,
    firstNoteOffsetFromTop: firstNoteRect && scrollContainerRect ?
      firstNoteRect.y - scrollContainerRect.y : null,
    firstNoteY: firstNoteRect?.y,
    scrollContainerY: scrollContainerRect?.y
  };
```

#### ステップ4: "Load newer notes"ボタンをクリック
```
ツール: browser_click
要素: "Load newer notes"ボタン
または: browser_snapshot で要素のrefを特定してからクリック
```

#### ステップ5: DOM更新を待機
```
ツール: browser_wait_for
time: 1（1秒待機）
目的: fetchNewerとDOM更新の完了を待つ
```

#### ステップ6: クリック後の状態を検証
```
ツール: browser_evaluate
JavaScript:
  const scrollContainer = document.querySelector('[ref="scrollContainer"]') ||
                          document.querySelector('[style*="overflow-y: auto"]');
  const firstNote = document.querySelector('[data-scroll-anchor]');
  const firstNoteText = firstNote?.textContent?.substring(0, 50);
  const scrollContainerRect = scrollContainer?.getBoundingClientRect();
  const firstNoteRect = firstNote?.getBoundingClientRect();

  return {
    scrollTop: scrollContainer?.scrollTop,
    scrollHeight: scrollContainer?.scrollHeight,
    firstNoteText: firstNoteText,
    firstNoteOffsetFromTop: firstNoteRect && scrollContainerRect ?
      firstNoteRect.y - scrollContainerRect.y : null,
    firstNoteY: firstNoteRect?.y,
    scrollContainerY: scrollContainerRect?.y,
    isVisible: firstNoteRect && scrollContainerRect ?
      firstNoteRect.y >= scrollContainerRect.y &&
      firstNoteRect.y <= scrollContainerRect.y + scrollContainerRect.height : false
  };
```

#### ステップ7: コンソールログを確認
```
ツール: browser_console_messages
level: info
目的: loadNewer関数のデバッグログを取得
```

### 期待される結果
- ステップ3とステップ6で取得した`firstNoteText`が同じ（同じノートを追跡している）
- ステップ6の`isVisible`が`true`（元のノートが可視範囲に残っている）
- ステップ6の`firstNoteOffsetFromTop`がステップ3とほぼ同じ値（±10px以内）

### 反復テスト（3回）
ステップ4〜7を3回繰り返し、毎回スクロール位置が正しく復元されることを確認する。

### 実測値の記録テンプレート

| 実行 | ステップ | scrollTop | scrollHeight | firstNoteOffsetFromTop | isVisible | 結果 |
|------|---------|-----------|--------------|----------------------|-----------|------|
| 1回目 | BEFORE | | | | - | |
| 1回目 | AFTER | | | | | |
| 2回目 | BEFORE | | | | - | |
| 2回目 | AFTER | | | | | |
| 3回目 | BEFORE | | | | - | |
| 3回目 | AFTER | | | | | |

## 関連ソースコード

### 主要ファイル

#### 1. `/packages/frontend/src/pages/timemachine.vue`
タイムマシンページのメインコンポーネント。`loadNewer`関数でスクロール位置復元を実装。

```vue
<template>
  <div>
    <!-- タイムライン -->
    <div v-if="paginator !== null" ref="scrollContainer" style="margin-top: var(--MI-margin); overflow-y: auto; height: 100vh;">
      <div v-if="targetDate !== null && canLoadNewer && !isTimeshiftMode" :class="$style.loadMore">
        <div :class="$style.loadMoreRow">
          <MkButton @click="loadNewer" :disabled="isLoadingNewer" style="flex: 1;">
            <i class="ti ti-arrow-up"></i> Load newer notes
          </MkButton>
          ...
        </div>
      </div>

      <MkTimemachineNoteTimeline
        :paginator="paginator"
        :noGap="false"
        :key="timelineKey"
      />
    </div>
  </div>
</template>

<script>
const scrollContainer = useTemplateRef<HTMLDivElement>('scrollContainer');

async function loadNewer() {
  if (!targetDate.value || !paginator.value || isLoadingNewer.value || !scrollContainer.value) return;

  isLoadingNewer.value = true;

  try {
    // 最初のノート要素を取得（追跡用）
    const firstNoteElement = scrollContainer.value.querySelector('[data-scroll-anchor]') as HTMLElement;
    const scrollContainerRect = scrollContainer.value.getBoundingClientRect();
    const firstNoteRect = firstNoteElement?.getBoundingClientRect();
    // scrollContainerからの相対位置を使用
    const firstNoteOffsetFromTop = firstNoteRect && scrollContainerRect ? firstNoteRect.y - scrollContainerRect.y : null;

    // Fetch newer notes
    await paginator.value.fetchNewer();

    // Wait for DOM to update
    await nextTick();
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));

    // 最初のノート要素の位置を元に戻す
    if (firstNoteElement && firstNoteOffsetFromTop !== null && scrollContainerRect) {
      const currentScrollContainerRect = scrollContainer.value.getBoundingClientRect();
      const currentNoteRect = firstNoteElement.getBoundingClientRect();
      const currentOffsetFromTop = currentNoteRect.y - currentScrollContainerRect.y;
      // 修正: 最初のノートを元の位置に戻すために必要なスクロール量を計算
      const scrollAdjustment = firstNoteOffsetFromTop - currentOffsetFromTop;

      // scrollTopに加算
      scrollContainer.value.scrollTop += scrollAdjustment;
    }
  } finally {
    isLoadingNewer.value = false;
  }
}
</script>
```

#### 2. `/packages/frontend/src/components/MkTimemachineNoteTimeline.vue`
タイムラインコンポーネント。各ノートに`data-scroll-anchor`属性を付与。

```vue
<template>
  <MkPagination
    :paginator="paginator"
    :customItems="customItems"
  >
    <template #default="{ items: notes }">
      <div :class="[$style.root, { [$style.noGap]: noGap, '_gaps': !noGap }]">
        <template v-for="(note, i) in notes as unknown as FusionNote[]" :key="generateUniqueKey(note)">
          <MkNote
            :class="[$style.note, { [$style.realtimeNote]: isRealtimeItem(note) }]"
            :note="note"
            :withHardMute="true"
            :data-scroll-anchor="note.id"
          />
        </template>
      </div>
    </template>
  </MkPagination>
</template>
```

#### 3. `/packages/frontend/src/utility/timeshiftPaginator.ts`
タイムシフト機能用のPaginator。`fetchNewer`メソッドで新しいノートを取得。

```typescript
async fetchNewer(options: { toQueue?: boolean } = {}): Promise<void> {
  await super.fetchNewer(options);

  // タイムシフトモード時は、新しいアイテムを allFetchedItems とキューに追加
  if (this.isTimeshiftMode.value && !options.toQueue) {
    const existingIds = new Set(this.allFetchedItems.value.map((item) => item.id));
    const newItems = (this.items.value || []).filter((item) => !existingIds.has(item.id));

    // allFetchedItems に追加
    this.allFetchedItems.value.push(...newItems);

    // 新しいアイテムをキューに追加（時刻順にソート）
    const futureItems = newItems.filter((item) => {
      const itemTime = new Date(item.createdAt).getTime();
      return itemTime > (this.playbackTime.value || 0);
    });

    this.queuedItems.value.push(...futureItems);
    this.queuedItems.value.sort((a, b) => {
      return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    });
  }
}
```

#### 4. `/packages/frontend/src/utility/paginator.ts`
基底Paginatorクラス。`fetchNewer`の基本実装。

```typescript
public async fetchNewer(options: { toQueue?: boolean } = {}): Promise<void> {
  this.fetchingNewer.value = true;

  const data: E['req'] = {
    ...(typeof this.params === 'function' ? this.params() : this.params),
    ...(this.computedParams ? this.computedParams.value : {}),
    limit: SECOND_FETCH_LIMIT,
    ...(this.offsetMode ? {
      offset: this.items.value.length,
    } : {
      sinceId: this.getNewestId(),
    }),
  };

  const apiRes = (await misskeyApi<T[]>(this.endpoint, data).catch(_ => {
    return null;
  })) as T[] | null;

  this.fetchingNewer.value = false;

  if (apiRes == null || apiRes.length === 0) {
    this.canFetchNewer.value = false;
    return;
  }

  if (options.toQueue) {
    this.aheadQueue.unshift(...apiRes.toReversed());
    if (this.aheadQueue.length > MAX_QUEUE_ITEMS) {
      this.aheadQueue = this.aheadQueue.slice(0, MAX_QUEUE_ITEMS);
    }
    this.queuedAheadItemsCount.value = this.aheadQueue.length;
  } else {
    if (this.order.value === 'oldest') {
      this.pushItems(apiRes);
    } else {
      this.unshiftItems(apiRes.toReversed(), false);
    }
  }
}
```

## 問題の詳細

### 現象
"Load newer notes"をクリックすると、新しいノートが配列の先頭に追加され（`unshiftItems`）、既存のノートが下に押し出される。しかし、スクロール位置が調整されないため、ユーザーが見ていたノートが画面外に消えてしまう。

### デバッグログ

```
=== loadNewer DEBUG START ===
1. BEFORE fetchNewer:
  scrollTop: 0
  scrollHeight: 2816
  firstNoteRect.y: 187.6875
  scrollContainerRect.y: 103
  firstNoteOffsetFromTop (relative): 84.6875
  firstNoteText: サミーがリノート2025/1/31 20:41:46...

2. AFTER fetchNewer, BEFORE nextTick:
  scrollTop: 0
  scrollHeight: 7587

3. AFTER nextTick, BEFORE requestAnimationFrame:
  scrollTop: 0
  scrollHeight: 7587

4. AFTER requestAnimationFrame, BEFORE scroll adjustment:
  scrollTop: 0
  scrollHeight: 7857
  currentNoteRect.y: 0
  currentScrollContainerRect.y: 103
  currentOffsetFromTop (relative): -103
  scrollAdjustment (NEW): 187.6875
  OLD scrollTop before adjustment: 0

5. AFTER scroll adjustment:
  scrollTop: 188
  scrollHeight: 7857
  firstNoteOffsetFromTop (after, relative): -103  ← 変わっていない！
  position diff: -187.6875
```

### 問題点

1. **scrollTop調整が不十分**
   - 計算式: `scrollAdjustment = firstNoteOffsetFromTop - currentOffsetFromTop = 84.6875 - (-103) = 187.6875`
   - `scrollTop += 187.6875` → `scrollTop = 188`
   - しかし、調整後も`firstNoteOffsetFromTop = -103`のまま（変わっていない）

2. **scrollTopの変更が反映されない（最も重要）**
   - `scrollContainer.value.scrollTop += scrollAdjustment`を実行しても、ノートの相対位置が変わらない
   - これは通常あり得ない動作（scrollTopを変更すれば、getBoundingClientRect()の結果も変わるはず）
   - **→ Playwright MCPの実験2で検証する**

3. **可能な原因（優先順位順）**

   **🔴 P0（最優先）:** `scrollContainer.value`が間違った要素を参照している
   - DOM構造に入れ子のスクロール可能要素がある可能性
   - `ref="scrollContainer"`が実際にスクロールしている要素ではない可能性
   - **→ Playwright MCPの実験1で検証する**

   **🟡 P1（次点）:** スクロールコンテナの構造問題
   - MkPaginationやMkTimemachineNoteTimeline内部に独自のスクロールコンテナがある
   - CSS transformやpositionが相対位置計算に影響している
   - **→ Playwright MCPの実験3で検証する**

   **🟢 P2（検討）:** イベントリスナーによるリセット
   - 別のイベントリスナーが即座にscrollTopをリセットしている
   - **→ Playwright MCPの実験5で検証する**

   **🟢 P3（タイミング問題）:**
   - Vueのリアクティブシステムやブラウザのレイアウト再計算のタイミング問題
   - requestAnimationFrameの2回待機では不十分

## 試した修正

### 修正1: 計算式の符号修正
**変更内容:**
```typescript
// 修正前
const positionDiff = currentOffsetFromTop - firstNoteOffsetFromTop;
scrollContainer.value.scrollTop += positionDiff;

// 修正後
const scrollAdjustment = firstNoteOffsetFromTop - currentOffsetFromTop;
scrollContainer.value.scrollTop += scrollAdjustment;
```

**結果:**
- ✅ scrollTopが0→188に変化（前回は0のまま）
- ❌ しかし元のノートはまだ画面外（`currentOffsetFromTop = -103`のまま）

### 修正2: MkPagination.vueにスクロール位置復元を追加
**変更内容:**
MkPagination.vueの`upButtonClick`/`downButtonClick`にスクロール位置復元ロジックを追加。

**結果:**
- ❌ timemachine.vueが独自のボタンを使っているため、この修正は使われていない

## 検証課題とPlaywright MCP実験マッピング

### 1. scrollTopの変更が反映されない根本原因の特定
**状況:**
- `scrollContainer.value.scrollTop`への代入が実際にスクロールを引き起こしているか不明
- scrollTop値は変わっているが、ノートの相対位置は変わらない

**Playwright MCP検証:**
- ✅ **実験2: scrollTop変更の即時反映確認** で検証
- ✅ **実験1: スクロールコンテナの特定** で根本原因を特定

---

### 2. 正しいスクロールコンテナの特定（最優先）
**状況:**
- `ref="scrollContainer"`が正しい要素を指しているか不明
- 入れ子になったスクロール可能要素がある場合、どれを使うべきか不明

**Playwright MCP検証:**
- ✅ **実験1: スクロールコンテナの特定** で全スクロール可能要素を列挙
- ✅ **実験3: DOM構造の完全調査** で親要素チェーンを確認

**想定される問題パターン:**
```
❌ 間違ったパターン（refが別の要素を指している）:
body (scrollable)
  └─ div[ref="scrollContainer"] (not scrollable)
      └─ inner div (actually scrollable) ← 実際にスクロールしているのはこちら
          └─ notes

✅ 正しいパターン:
body
  └─ div[ref="scrollContainer"] (scrollable) ← これが実際にスクロールしている
      └─ notes
```

---

### 3. ブラウザのレイアウト再計算タイミング
**状況:**
- `requestAnimationFrame`を2回待っているが、それでも不十分な可能性
- 追加の待機時間やイベントリスナーが必要かもしれない

**Playwright MCP検証:**
- ✅ **実験2** でタイミング問題か要素特定問題かを切り分け
- もし実験1・2で問題なければ、タイミング問題の可能性が高い

---

### 4. 代替アプローチの検討
**状況:**
- 現在の`scrollTop`調整アプローチが機能しない場合の代替案

**Playwright MCP検証:**
- ✅ **実験4: scrollIntoView** で代替実装を検証

**代替アプローチ候補:**
1. `scrollIntoView()` - 要素を直接ビューに表示
2. `scrollBy()` - 相対的なスクロール
3. IntersectionObserver - スクロール位置の監視と調整
4. ResizeObserver - DOM変更後のサイズ変化を監視

## 次のステップ（Playwright MCP実験）

### 🔴 最優先実験: スクロールコンテナの特定

**目的:** `scrollContainer.value`が実際にスクロールしている要素か確認

**Playwright MCP手順:**
```
1. browser_navigate で http://localhost:3000/timemachine?goto=20250131204200 を開く

2. browser_evaluate で以下を実行:
   const scrollContainer = document.querySelector('[ref="scrollContainer"]');
   const allScrollableElements = Array.from(document.querySelectorAll('*'))
     .filter(el => {
       const style = window.getComputedStyle(el);
       return style.overflowY === 'auto' || style.overflowY === 'scroll';
     });

   return {
     refElement: {
       tag: scrollContainer?.tagName,
       className: scrollContainer?.className,
       scrollHeight: scrollContainer?.scrollHeight,
       clientHeight: scrollContainer?.clientHeight,
       isScrollable: scrollContainer?.scrollHeight > scrollContainer?.clientHeight,
       overflow: window.getComputedStyle(scrollContainer).overflowY
     },
     allScrollableElements: allScrollableElements.map(el => ({
       tag: el.tagName,
       className: el.className,
       scrollHeight: el.scrollHeight,
       clientHeight: el.clientHeight,
       scrollTop: el.scrollTop
     }))
   };

3. 手動で少しスクロールする（browser_evaluateでscrollBy実行）

4. 再度browser_evaluateで各要素のscrollTopを確認

5. 実際にscrollTopが変化した要素を特定
```

**期待結果:** `ref="scrollContainer"`の要素が実際にスクロールしている要素と一致する

---

### 実験2: scrollTop変更の即時反映確認

**目的:** scrollTop設定が即座に反映されるか確認

**Playwright MCP手順:**
```
1. browser_navigate でページを開く

2. browser_evaluate で初期状態を記録:
   const container = document.querySelector('[ref="scrollContainer"]');
   const firstNote = document.querySelector('[data-scroll-anchor]');
   const before = {
     scrollTop: container.scrollTop,
     notePosition: firstNote.getBoundingClientRect().y
   };

3. browser_evaluate でscrollTopを変更:
   const container = document.querySelector('[ref="scrollContainer"]');
   const firstNote = document.querySelector('[data-scroll-anchor]');
   const beforeScrollTop = container.scrollTop;
   const beforePosition = firstNote.getBoundingClientRect().y;

   container.scrollTop += 200;

   const afterScrollTop = container.scrollTop;
   const afterPosition = firstNote.getBoundingClientRect().y;

   return {
     beforeScrollTop,
     afterScrollTop,
     scrollTopChanged: afterScrollTop !== beforeScrollTop,
     beforePosition,
     afterPosition,
     positionChanged: afterPosition !== beforePosition,
     expectedChange: afterScrollTop - beforeScrollTop,
     actualChange: beforePosition - afterPosition
   };

4. browser_console_messages でエラーがないか確認
```

**期待結果:**
- `scrollTopChanged`が`true`
- `positionChanged`が`true`
- `expectedChange`と`actualChange`がほぼ一致

---

### 実験3: DOM構造の完全調査

**目的:** ページの完全なDOM構造とスクロール階層を把握

**Playwright MCP手順:**
```
1. browser_navigate でページを開く

2. browser_snapshot でページ全体の構造を取得

3. browser_evaluate で詳細な階層情報を取得:
   const scrollContainer = document.querySelector('[ref="scrollContainer"]');
   const firstNote = document.querySelector('[data-scroll-anchor]');

   // scrollContainerからfirstNoteまでの親要素チェーン
   const getParentChain = (element, target) => {
     const chain = [];
     let current = element;
     while (current && current !== target && current !== document.body) {
       chain.push({
         tag: current.tagName,
         className: current.className,
         scrollHeight: current.scrollHeight,
         clientHeight: current.clientHeight,
         scrollTop: current.scrollTop,
         overflow: window.getComputedStyle(current).overflow,
         overflowY: window.getComputedStyle(current).overflowY,
         position: window.getComputedStyle(current).position,
         transform: window.getComputedStyle(current).transform
       });
       current = current.parentElement;
     }
     return chain;
   };

   return {
     scrollContainerInfo: {
       tag: scrollContainer?.tagName,
       className: scrollContainer?.className,
       hasRefAttribute: scrollContainer?.hasAttribute('ref'),
       refValue: scrollContainer?.getAttribute('ref')
     },
     parentChainFromNote: getParentChain(firstNote, scrollContainer)
   };
```

**期待結果:** 親要素チェーンの中にscrollContainerが含まれており、間に別のスクロール可能要素がない

---

### 実験4: 代替実装の検証（scrollIntoView）

**目的:** scrollIntoViewで問題を回避できるか確認

**準備:** timemachine.vueのloadNewer関数を以下に変更:
```typescript
// scrollTop調整の代わりに
firstNoteElement.scrollIntoView({ block: 'start', behavior: 'instant' });
```

**Playwright MCP手順:**
```
1. browser_navigate でページを開く
2. browser_evaluate で最初のノートのテキストを記録
3. browser_click で "Load newer notes"をクリック
4. browser_wait_for で1秒待機
5. browser_evaluate で最初のノートが可視範囲にあるか確認
```

**期待結果:** `isVisible`が`true`

---

### 実験5: イベントリスナーの確認

**目的:** scrollイベントをリセットするリスナーがないか確認

**Playwright MCP手順:**
```
browser_evaluate で以下を実行:
  const container = document.querySelector('[ref="scrollContainer"]');

  // すべてのイベントリスナーを取得（Chrome DevTools Protocol使用）
  const listeners = getEventListeners ? getEventListeners(container) : {};

  return {
    hasScrollListener: !!listeners.scroll,
    scrollListenerCount: listeners.scroll?.length || 0,
    allEventTypes: Object.keys(listeners)
  };
```

**期待結果:** 不審なscrollイベントリスナーがない

## Playwright MCPでの実行方法

### Claude Codeでの実行手順

このドキュメントに記載されているすべての実験は、Claude Codeのセッション内で直接実行できます。

**基本的な流れ:**
1. 開発サーバーが起動していることを確認（`pnpm dev`）
2. Claude Codeに「実験1を実行して」などと指示
3. Claude CodeがPlaywright MCPツールを使って自動的にテストを実行
4. 結果を分析して次の実験を決定

**実行例:**
```
ユーザー: "newerFetchScroll.mdの実験1を実行して、スクロールコンテナを特定してください"

Claude Code:
1. browser_navigate でページを開く
2. browser_evaluate でスクロール可能な要素を列挙
3. 結果を分析して報告
4. 問題があれば次の実験を提案
```

### 推奨実行順序

**フェーズ1: 問題の特定（P0）**
1. ✅ **実験1: スクロールコンテナの特定** ← まずこれを実行
   - 結果: refが正しい要素を指しているか判明
   - もし間違っていれば → コード修正して再テスト
   - もし正しければ → 実験2へ

**フェーズ2: 原因の切り分け（P1）**
2. ✅ **実験2: scrollTop変更の即時反映確認**
   - 結果: scrollTop設定が機能しているか判明
   - もし機能していなければ → 実験3へ（DOM構造問題）
   - もし機能していれば → タイミング問題の可能性

**フェーズ3: 詳細調査（必要に応じて）**
3. ✅ **実験3: DOM構造の完全調査**
   - 入れ子構造や親要素チェーンを確認
4. ✅ **実験5: イベントリスナーの確認**
   - scrollイベントの干渉を確認

**フェーズ4: 代替案の検証（P2）**
5. ✅ **実験4: scrollIntoView実装**
   - 根本的な修正が難しい場合の回避策

### メインテストシナリオの実行

問題修正後は、冒頭の「Playwright MCPテストシナリオ」を実行して、スクロール位置復元が正しく動作することを確認します。

**実行コマンド例:**
```
"newerFetchScroll.mdのメインテストシナリオを3回繰り返し実行して、結果を表にまとめてください"
```

## 参考情報

### Vue 3のベストプラクティス
- `watch`で`immediate: true`を使う場合は`flush: 'post'`を指定（DOM更新後に実行）
- リアクティブ配列のアイテムを置き換える場合は`splice()`を使う（参照を保持）

### スクロール位置復元の一般的なアプローチ
1. スクロールコンテナ内のアンカー要素を特定（例: `data-scroll-anchor`属性）
2. 新しいコンテンツを追加する前のアンカー要素の位置を記録
3. 新しいコンテンツ追加後、アンカー要素の位置を再測定
4. 位置の差分だけスクロール位置を調整

このアプローチは理論的には正しいが、実装の詳細（タイミング、要素の特定方法、スクロールコンテナの構造）によって動作しない場合がある。

### デバッグのポイント
- **Playwright MCPは実際のブラウザで実行される** - 開発者ツールと同等の情報が取得できる
- **browser_evaluate**は強力 - 任意のJavaScriptを実行してDOM情報を取得できる
- **browser_snapshot**は視覚的確認に便利 - ページの構造をテキストで確認できる
- **browser_console_messages**でアプリケーションのログを確認できる
