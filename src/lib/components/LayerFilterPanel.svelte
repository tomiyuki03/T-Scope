<script lang="ts">
    import {hiddenLayers, showLegend, type LayerCategory} from "$lib/stores/simulation/state";

    const categories: {key: LayerCategory, label: string}[] = [
        {key: "civilian", label: "市民"},
        {key: "ambulance", label: "救急隊"},
        {key: "fire", label: "消防隊"},
        {key: "police", label: "土木隊"},
        {key: "building", label: "建物"},
        {key: "blockade", label: "瓦礫"},
        {key: "refuge", label: "避難所"},
        {key: "path", label: "移動経路"},
        {key: "rescueTargets", label: "救助対象"},
    ];

    function toggle(key: LayerCategory) {
        hiddenLayers.update((s) => {
            const next = new Set(s);
            next.has(key) ? next.delete(key) : next.add(key);
            return next;
        });
    }

</script>

<div class="panel">
    <div class="title">表示情報</div>
    <div class="item-list">
        {#each categories as cat}
           {@const hidden = $hiddenLayers.has(cat.key)}
           <button class="item-btn" class:hidden onclick={() => toggle(cat.key)}>
           {cat.label}
           </button>
        {/each}
        <button 
            class="item-btn" 
            class:hidden={!$showLegend} 
            onclick={() => showLegend.update((v) => !v)}>
            色の意味
        </button>
    </div>
    {#if $showLegend}
        <div class="legend">
            <div class="legend-row"><span class="swatch" style="background-color: rgb(60,200,80)"></span>市民（健康？）</div>
            <div class="legend-row"><span class="swatch" style="background-color: rgb(10,10,10)"></span>市民（HP低下）</div>
            <div class="legend-row"><span class="swatch" style="background-color: rgb(220,30,30)"></span>消防隊</div>
            <div class="legend-row"><span class="swatch" style="background-color: rgb(255,140,0)"></span>消防隊（救助中）</div>
            <div class="legend-row"><span class="swatch" style="background-color: rgb(240,240,240)"></span>救急隊</div>
            <div class="legend-row"><span class="swatch" style="background-color: rgb(255,200,60)"></span>救急隊（搬送中）</div>
            <div class="legend-row"><span class="swatch" style="background-color: rgb(60,140,255)"></span>土木隊</div>
            <div class="legend-row"><span class="swatch" style="background-color: rgb(20,140,60)"></span>避難所</div>
            <div class="legend-row"><span class="swatch" style="background-color: rgb(200,160,40)"></span>瓦礫</div>
        </div>
    {/if}
</div>

<style>
    .panel {
        background: rgba(13, 20, 30, 0.92);
        border: 1px solid rgba(0, 200, 255, 0.2);
        border-radius: 6px;
        padding: 5px 10px 6px;
        line-height: 1.2;
        backdrop-filter: blur(6px);
        box-shadow: 0 0 20px rgba(0, 180, 255, 0.08);
    }
    .title {
        font-size: 10px;
        line-height: 12px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        color: #00c8ff;
        margin-bottom: 4px;
    }
    .item-list {
        display: flex;
        flex-direction: column;
        gap: 3px;
    }
    .item-btn {
        display: flex;
        align-items: center;
        min-height: 26px;
        background: rgba(0, 180, 255, 0.12);
        border: 1px solid rgba(0, 200, 255, 0.3);
        border-radius: 4px;
        padding: 4px 9px;
        color: #c8d8e8;
        font-size: 12px;
        cursor: pointer;
        text-align: left;
        transition:
        opacity 0.15s,
        background 0.15s;
    }
    .item-btn:hover {
        background: rgba(0, 180, 255, 0.22);
    }
    .item-btn.hidden {
        opacity: 0.3;
        background: transparent;
    }

    .legend {
        margin-top: 6px;
        padding-top: 6px;
        /*background: rgba(109, 109, 109, 0.2);*/
        border-top: 1px solid rgba(0, 200, 255, 0.15);
        display: flex;
        flex-direction: column;
        gap: 4px;
    }
    .legend-row {
        display: flex;
        align-items: center;
        gap: 6px;
        font-size: 12px;
        color: #c8d8e8;
    }

    .swatch {
        display: inline-block;
        width: 14px;
        height: 12px;
        border-radius: 2px;
        flex-shrink: 0;
        border: 1px solid rgba(255, 255, 255);
    }
</style>