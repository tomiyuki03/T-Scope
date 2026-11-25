<script lang="ts">
  import { t } from "$lib/i18n";
  import { EntityURN } from "$lib/rcrs/urns";
  import {
    civilianStories,
    currentStep,
    seekToStep,
    selectedEntity,
    type CivilianStory,
  } from "$lib/stores/simulation";
  import ambCarryUrl from "$lib/assets/icons/amb-carry.png";
  import fireDigUrl from "$lib/assets/icons/fire-dig.png";
  import waitStretcherUrl from "$lib/assets/icons/wait-stretcher.png";
  import buriedUrl from "$lib/assets/icons/buried.png";
  import refugeUrl from "$lib/assets/icons/refuge.png";
  import freeUrl from "$lib/assets/icons/free.png";
  import deadUrl from "$lib/assets/icons/dead.png";

  // 流れの段階の名前と、並べる順番
  type FlowKey = "free" | "buried" | "rescueStart" | "waiting" | "carried" | "refuge" | "dead";
  const FLOW_ORDER: FlowKey[] = [ "free", "buried", "rescueStart", "waiting", "carried", "refuge", "dead"];

  // 段階の絵。buried と refuge は、画像がまだ無いので、未設定（文字で出す）
  const FLOW_ICON: Partial<Record<FlowKey, string>> = {
    rescueStart: fireDigUrl,
    waiting: waitStretcherUrl,
    carried: ambCarryUrl,
    buried: buriedUrl,
    refuge: refugeUrl,
    free: freeUrl,
    dead: deadUrl,
  };

  function flowLabel(k: FlowKey): string {
    switch (k) {
      case "buried": return $t("flow.buried");
      case "rescueStart": return $t("flow.rescue");
      case "waiting": return $t("flow.waiting");
      case "carried": return $t("flow.carried");
      case "refuge": return $t("flow.refuge");
      case "free": return $t("flow.free");
      case "dead": return $t("flow.dead");
    }
  }

  type FlowStage = { key: FlowKey; step: number; now: boolean; future: boolean };

  // 1人の流れから、画面に出す段階の並びを作る
  function flowStages(flow: CivilianStory | undefined, now: number): FlowStage[] {
    if (!flow) return [];
    // 記録がある段階だけ、順に並べる
    const list = FLOW_ORDER.flatMap((k) => {
      const step = flow[k];
      return step === undefined ? [] : [{ key: k, step }];
    });
    // 今の段階 ＝ 始まったステップが、今のステップ以前のものの、最後
    let cur = -1;
    list.forEach((s, i) => {
      if (s.step <= now) cur = i;
    });
    return list.map((s, i) => ({ ...s, now: i === cur, future: i > cur }));
  }

  // 選んでいるものが市民のときだけ、その流れを出す
  const stages = $derived.by(() => {
    const e = $selectedEntity;
    if (!e || e.urn !== EntityURN.CIVILIAN) return [];
    return flowStages($civilianStories.get(e.id), $currentStep);
  });
  const next = $derived(stages.find((s) => s.future));
</script>

{#if stages.length > 0}
  <div class="flow-bar">
    {#each stages as s, i (s.key)}
      {#if i > 0}<span class="arrow">›</span>{/if}
      <div class="stage" class:now={s.now} class:future={s.future}>
        <button class="icon" title={flowLabel(s.key)} onclick={() => seekToStep(s.step)}>
          {#if FLOW_ICON[s.key]}
            <img src={FLOW_ICON[s.key]} alt={flowLabel(s.key)} />
          {:else}
            <span class="text">{flowLabel(s.key)}</span>
          {/if}
        </button>
        <span class="label">{s.now ? flowLabel(s.key) : ""}</span>
      </div>
    {/each}
    {#if next}
      <button class="next" title={flowLabel(next.key)} onclick={() => seekToStep(next.step)}>
        ▶
        {#if FLOW_ICON[next.key]}
          <img src={FLOW_ICON[next.key]} alt="" />
        {:else}
          <span class="text">{flowLabel(next.key)}</span>
        {/if}
      </button>
    {/if}
  </div>
{/if}

<style>
  .flow-bar {
    position: absolute;
    left: 50%;
    bottom: 12px;
    transform: translateX(-50%);
    z-index: 10;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 16px;
    background: var(--panel-bg);
    border: 1px solid var(--panel-border);
    border-radius: 14px;
    color: var(--text);
    backdrop-filter: blur(6px);
    box-shadow: 0 2px 12px rgba(0, 0, 0, 0.25);
  }
  .arrow { opacity: 0.5; font-size: 20px; }
  .stage { display: flex; flex-direction: column; align-items: center; gap: 2px; }
  .icon {
    width: 56px; height: 56px; padding: 3px;
    border: 3px solid transparent; border-radius: 12px;
    background: transparent; color: inherit; cursor: pointer;
    display: flex; align-items: center; justify-content: center;
  }
  .icon img { width: 100%; height: 100%; object-fit: contain; }
  .stage.now .icon { width: 72px; height: 72px; border-color: #ffc840; background: rgba(255, 200, 60, 0.18); }
  .stage.future .icon { opacity: 0.4; }
  .label { font-size: 13px; font-weight: 500; min-height: 16px; }
  .text { font-size: 12px; line-height: 1.1; }
  .next {
    display: flex; align-items: center; gap: 6px; padding: 6px 12px;
    margin-left: 6px; font-size: 18px;
    border: 2px solid var(--panel-border); border-radius: 12px;
    background: transparent; color: inherit; cursor: pointer;
  }
  .next img { width: 40px; height: 40px; object-fit: contain; }
</style>