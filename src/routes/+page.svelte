<script lang="ts">
  import ChannelFilterPanel from "$lib/components/ChannelFilterPanel.svelte";
  import CivilianStatusPanel from "$lib/components/CivilianStatusPanel.svelte";
  import ControlPanel from "$lib/components/ControlPanel.svelte";
  import IdleAgentsPanel from "$lib/components/IdleAgentsPanel.svelte";
  import InfoPanel from "$lib/components/InfoPanel.svelte";
  import LayerFilterPanel from "$lib/components/LayerFilterPanel.svelte";
  import ScorePanel from "$lib/components/ScorePanel.svelte";
  import SimMap from "$lib/components/SimMap.svelte";
  import TeamNamePanel from "$lib/components/TeamNamePanel.svelte";
  import TimelinePanel from "$lib/components/TimelinePanel.svelte";
  import { selectedEntity } from "$lib/stores/simulation";
  import { EntityURN, isAgent } from "$lib/rcrs/urns";
  import { t } from "$lib/i18n";
  import {
    currentStep,
    downloadProgress,
    downloadSize,
    entities,
    extractProgress,
    loading,
    loadUrl,
    mapViewport,
    maxStep,
    multiLogMode,
    multiLogSync,
    parseProgress,
    perceptionViewMode,
    remoteViewportCommand,
    seekToStep,
    selectedId,
  } from "$lib/stores/simulation";
  import { onMount } from "svelte";
  import { get } from "svelte/store";

  function fmtBytes(b: number): string {
    if (b >= 1024 * 1024 * 1024) return `${(b / (1024 * 1024 * 1024)).toFixed(1)} GB`;
    if (b >= 1024 * 1024) return `${(b / (1024 * 1024)).toFixed(1)} MB`;
    if (b >= 1024) return `${(b / 1024).toFixed(1)} KB`;
    return `${b} B`;
  }

  //let timelineOpen = $state(false);
  let activeDrawer: "timeline" | "layers" | null = $state(null);
  let screenshotMode = $state(false);
  let dataLoaded = $state(false);
  let receivingSync = false;
  let receivingViewportSync = false;
  let receivingSelectSync = false;
  let iframe1: HTMLIFrameElement ;
  let iframe2: HTMLIFrameElement ;

  onMount(async () => {
    const params = new URLSearchParams(window.location.search);
    screenshotMode = params.has("screenshot");
    const autoUrl = params.get("autoload");
    const autoStep = params.get("step");
    const isEmbedded = new URLSearchParams(window.location.search).has("embed");

    if (autoUrl) {
      const result = await loadUrl(autoUrl);
      if (result === "ok" && autoStep !== null) {
        seekToStep(parseInt(autoStep, 10));
      }
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          dataLoaded = true;
        }),
      );
    }

    // CLI スナップショット用
    (window as unknown as Record<string, unknown>).__simscope_seekTo = (step: number) => seekToStep(step);
    (window as unknown as Record<string, unknown>).__simscope_maxStep = () => get(maxStep);

    // 親フレーム側
    window.addEventListener("message", (event) => {
      if (event.data?.type === "tscope:toggleSync"){
        multiLogSync.update((v) => !v);
        const newValue = get(multiLogSync);
        iframe1?.contentWindow?.postMessage({ type: "tscope:setSync", sync: newValue }, "*");
        iframe2?.contentWindow?.postMessage({ type: "tscope:setSync", sync: newValue }, "*");
      }

      if (event.data?.type === "tscope:viewport" && get(multiLogSync)) {
        if (event.source === iframe1?.contentWindow) {
          iframe2?.contentWindow?.postMessage({ type: "tscope:setViewport", cx: event.data.cx, cy: event.data.cy, zoom: event.data.zoom }, "*");
        } else if (event.source === iframe2?.contentWindow) {
          iframe1?.contentWindow?.postMessage({ type: "tscope:setViewport", cx: event.data.cx, cy: event.data.cy, zoom: event.data.zoom }, "*");
        }
      }

      if (event.data?.type === "tscope:select" && get(multiLogSync)) {
        if (event.source === iframe1?.contentWindow) {
          iframe2?.contentWindow?.postMessage({ type: "tscope:setSelect", id: event.data.id }, "*");
        } else if (event.source === iframe2?.contentWindow) {
          iframe1?.contentWindow?.postMessage({ type: "tscope:setSelect", id: event.data.id }, "*");
        }
      }
      
      if (event.data?.type !== "tscope:step") return;
      if (!get(multiLogSync)) return;
      if (event.source === iframe1?.contentWindow){
        iframe2?.contentWindow?.postMessage({ type: "tscope:setStep", step: event.data.step }, "*");
      } else if (event.source === iframe2?.contentWindow){
        iframe1?.contentWindow?.postMessage({ type: "tscope:setStep", step: event.data.step }, "*");
      }
    });

    if (!isEmbedded) return;

    //子フレーム側
    currentStep.subscribe((step) => {
      if (receivingSync) return;
      window.parent.postMessage({ type: "tscope:step", step }, "*");
    });

    mapViewport.subscribe((vp)=> {
      if (!vp || receivingViewportSync) return;
      window.parent.postMessage({ type: "tscope:viewport", cx: vp.cx, cy: vp.cy, zoom: vp.zoom }, "*");
    });

    selectedId.subscribe((id) => {
      if (receivingSelectSync) return;
      window.parent.postMessage({ type: "tscope:select", id }, "*");
    });

    window.addEventListener("message", (event) => {
      if (event.data?.type === "tscope:setStep") {
        receivingSync = true;
        seekToStep(event.data.step);
        receivingSync = false;
      }
      else if (event.data?.type === "tscope:setSync") {
        multiLogSync.set(event.data.sync);
      }
      else if (event.data?.type === "tscope:setViewport") {
        receivingViewportSync = true;
        remoteViewportCommand.set({ cx: event.data.cx, cy: event.data.cy, zoom: event.data.zoom });
        receivingViewportSync = false;
      }
      else if (event.data?.type === "tscope:setSelect") {
        const id = event.data.id as number | null;
        if (id !== null && !get(entities).has(id)) return; 
        receivingSelectSync = true;
        selectedId.set(id);
        receivingSelectSync = false;
      }
    });
  });

  const TIMELINE_WIDTH = 300;
  const PANEL_GAP = 12;
  const leftOffset = $derived(activeDrawer !== null ? TIMELINE_WIDTH + PANEL_GAP : 0);
</script>

<div class="app" data-loaded={dataLoaded ? "true" : undefined}>
  {#if !$multiLogMode}
  <!-- Tomi エージェント選択時以外は一画面に -->
    {#if $selectedId !== null && isAgent($selectedEntity.urn)}
      <div style="display: flex; width: 100%; height: 100%;">
        <div style="flex: 1; height: 100%; position: relative;">
          <SimMap suppressHighlight={true} />
        </div>
        <div style="flex: 1; height: 100%; position: relative;">
          <SimMap alwaysFollow={true} />
        </div>
      </div>
    {:else}
      <SimMap />
    {/if}

    <!-- Tomi タイムラインと表示設定 -->
    {#if !screenshotMode}
      <!-- Sliding timeline panel -->
      <div
        class="timeline-drawer"
        class:open={activeDrawer !== null}
      >
      {#if activeDrawer === "timeline"}
        <TimelinePanel />
      {:else if activeDrawer === "layers"}
        <LayerFilterPanel />
      {/if}
      </div>

      <!-- Toggle tab -->
      <button
        class="timeline-toggle"
        class:open={activeDrawer === "timeline"}
        style="left:{activeDrawer !==null ? TIMELINE_WIDTH : 0}px; top: 50%;"
        onclick={() => (activeDrawer = activeDrawer === "timeline" ? null :"timeline")}
      >
        タイムライン
      </button>

      <button
        class="timeline-toggle"
        class:open={activeDrawer === "layers"}
        style="left:{activeDrawer !==null ? TIMELINE_WIDTH : 0}px; top: calc(50% + 80px);"
        onclick={() => (activeDrawer = activeDrawer === "layers" ? null :"layers")}
      >
        表示設定
      </button>

      <div class="left-col" style="left:{leftOffset + PANEL_GAP}px">
        <ControlPanel />
        <TeamNamePanel />
        <ScorePanel />
        <ChannelFilterPanel />
      </div>
      <IdleAgentsPanel leftOffset={leftOffset + PANEL_GAP} />
      <InfoPanel />
      <CivilianStatusPanel />
    {/if}

    {#if $loading}
      <div class="loading-overlay">
        <div class="loading-box">
          <div class="spinner"></div>
          {#if $downloadProgress !== null}
            <div class="progress-wrap">
              {#if $downloadProgress < 0}
                <div class="progress-bar indeterminate"></div>
              {:else}
                <div
                  class="progress-bar"
                  style="width:{$downloadProgress * 100}%"
                ></div>
              {/if}
            </div>
            <span>
              {#if $downloadProgress < 0}
                {$t("loading.downloading")}{$downloadSize !== null ? ` (${fmtBytes($downloadSize)})` : ""}
              {:else}
                {$t("loading.downloading")} {Math.round($downloadProgress * 100)}%{$downloadSize !== null ? ` / ${fmtBytes($downloadSize)}` : ""}
              {/if}
            </span>
          {:else if $extractProgress !== null}
            <div class="progress-wrap">
              <div class="progress-bar" style="width:{$extractProgress}%"></div>
            </div>
            <span>{$t("loading.extracting")} {$extractProgress}%</span>
          {:else if $parseProgress !== null}
            <div class="progress-wrap">
              <div
                class="progress-bar"
                style="width:{$parseProgress * 100}%"
              ></div>
            </div>
            <span>{$t("loading.parsing")} {Math.round($parseProgress * 100)}%</span>
          {:else}
            <span>{$t("loading.loading")}</span>
          {/if}
        </div>
      </div>
    {/if}
  {:else}
  <!-- 複数ログモード -->
    <div style="display: flex; width: 100%; height: 100%;">
      <iframe bind:this={iframe1} src="/?embed=1&primary=1" style="flex: 1; height: 100%; border: none;" title="log1"></iframe>
      <iframe bind:this={iframe2} src="/?embed=1" style="flex: 1; height: 100%; border: none;" title="log2"></iframe>
    </div>
  {/if}
</div>

<style>
  .app {
    position: fixed;
    inset: 0;
    background: #0d1117;
  }

  .timeline-drawer {
    position: absolute;
    top: 0;
    left: 0;
    width: 300px;
    height: 100%;
    background: rgba(10, 16, 24, 0.96);
    border-right: 1px solid rgba(0, 200, 255, 0.18);
    backdrop-filter: blur(8px);
    box-shadow: 4px 0 24px rgba(0, 0, 0, 0.4);
    z-index: 20;
    transform: translateX(-100%);
    transition: transform 0.25s ease;
    overflow: hidden;
  }

  .timeline-drawer.open {
    transform: translateX(0);
  }

  .timeline-toggle {
    position: absolute;
    transform: translateY(-50%);
    z-index: 21;
    min-width: 20px;
    height: auto;
    min-height: 32px;
    background: rgba(0, 180, 255, 0.18);
    border: 1px solid rgba(0, 200, 255, 0.55);
    border-left: none;
    border-radius: 0 6px 6px 0;
    color: #00e0ff;
    font-size: 12px;
    line-height: 1.2;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 6px 10px;
    transition:
      left 0.25s ease,
      background 0.12s,
      box-shadow 0.12s;
    box-shadow: 2px 0 10px rgba(0, 180, 255, 0.3);
    writing-mode: vertical-rl;
  }

  .timeline-toggle:hover {
    background: rgba(0, 200, 255, 0.32);
    box-shadow: 2px 0 14px rgba(0, 200, 255, 0.5);
  }

  .left-col {
    position: absolute;
    top: 12px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    z-index: 10;
    transition: left 0.25s ease;
  }

  .loading-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.6);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
    backdrop-filter: blur(4px);
  }

  .loading-box {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
    color: #00c8ff;
    font-size: 14px;
    line-height: 17px;
    font-family: monospace;
    min-width: 200px;
  }

  .progress-wrap {
    width: 100%;
    height: 4px;
    background: rgba(0, 200, 255, 0.15);
    border-radius: 2px;
    overflow: hidden;
  }

  .progress-bar {
    height: 100%;
    background: #00c8ff;
    border-radius: 2px;
  }

  .progress-bar.indeterminate {
    width: 40%;
    animation: slide 1.2s ease-in-out infinite;
  }

  @keyframes slide {
    0% {
      transform: translateX(-150%);
    }
    100% {
      transform: translateX(350%);
    }
  }

  .spinner {
    width: 40px;
    height: 40px;
    border: 3px solid rgba(0, 200, 255, 0.2);
    border-top-color: #00c8ff;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
</style>
