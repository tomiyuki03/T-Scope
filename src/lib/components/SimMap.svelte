<script lang="ts">
  import { channelColorRGB } from "$lib/rcrs/channelColors";
  import type {
    BlockadeEntity,
    BuildingEntity,
    HumanEntity,
    RoadEntity,
    SimEntity,
  } from "$lib/rcrs/types";
  import { CommandURN, EntityURN, isAgent, isBuilding } from "$lib/rcrs/urns";
  import type { AgentAction, CommMessage } from "$lib/stores/simulation";
  import {
    agentActions,
    agentDisplayMode,
    agentReceivedComms,
    agentVisibleIds,
    animatedEntities,
    currentStep,
    detailViewport,
    entities,
    focusPoint,
    getCarryingDestinations,
    getActivityPhases,
    hiddenChannels,
    hiddenLayers,
    inspectedId,
    kernelConfig,
    mapViewport,
    remoteViewportCommand,
    perceivedEntities,
    perceptionViewMode,
    pinnedAgentId,
    selectedId,
    simEvents,
  } from "$lib/stores/simulation";
  import type { OrthographicViewState, PickingInfo } from "@deck.gl/core";
  import { Deck, OrthographicView } from "@deck.gl/core";
  import {
    IconLayer,
    LineLayer,
    PathLayer,
    PolygonLayer,
    ScatterplotLayer,
  } from "@deck.gl/layers";
  import { onDestroy, onMount } from "svelte";
  import { derived, get } from "svelte/store";
  import type {LayerCategory} from "$lib/stores/simulation";

  function selectEntity(id: number | null) {
    if (get(pinnedAgentId) !== null) inspectedId.set(id);
    else selectedId.set(id);
  }

  let canvas: HTMLCanvasElement;
  let deck: Deck<OrthographicView> | null = null;

  // Tomi Split-screen tracking
  const {alwaysFollow = false, suppressHighlight = false}: {alwaysFollow?: boolean; suppressHighlight?: boolean} = $props();

  // ── Color helpers ─────────────────────────────────────────────────────────

  // Base color per facility type (used when not on fire)
  const FACILITY_COLOR: Partial<Record<number, [number, number, number]>> = {
    [EntityURN.REFUGE]: [20, 140, 60], // 避難所: 濃い緑
    [EntityURN.FIRE_STATION]: [220, 60, 60], // 消防署: 赤
    [EntityURN.AMBULANCE_CENTRE]: [60, 160, 220], // 救急センター: 水色
    [EntityURN.POLICE_OFFICE]: [80, 80, 220], // 警察署: 青
    [EntityURN.GAS_STATION]: [220, 180, 40], // ガスステーション: 黄
    [EntityURN.HYDRANT]: [30, 100, 140], // 消火栓: 暗い水色
  };

  function buildingColor(e: BuildingEntity): [number, number, number, number] {
    const f = e.fieryness;
    // Burning / burned state overrides facility color
    if (f >= 1 && f <= 3) return [255, Math.max(0, 180 - f * 50), 0, 230];
    if (f === 8) return [60, 40, 40, 200];
    if (f >= 4 && f <= 7) return [160, 80, 40, 200];

    const base = FACILITY_COLOR[e.urn];
    if (base) return [...base, 240] as [number, number, number, number];

    // Regular building: brokenness が 1 以上で茶色
    //return e.brokenness > 0 ? [112, 92, 76, 185] : [80, 100, 140, 220];
    const v = Math.round(150 - e.brokenness * 0.5); // 無傷150 → 全壊100
    return [v, v, v, 255];

  }

  const AGENT_EMOJI: Record<number, string> = {
    [EntityURN.FIRE_BRIGADE]: "🚒",
    [EntityURN.AMBULANCE_TEAM]: "🚑",
    [EntityURN.POLICE_FORCE]: "🚜",
  };
  // 市民のみ HP に応じて絵文字を変える（HP高い順）
  const CIVILIAN_EMOJI_LEVELS = ["😄", "😰", "🥵", "🤢", "👻"] as const;

  function getAgentEmoji(urn: number, hp: number): string {
    if (urn === EntityURN.CIVILIAN) {
      const n = CIVILIAN_EMOJI_LEVELS.length;
      if (hp >= 10000) return CIVILIAN_EMOJI_LEVELS[0];
      if (hp <= 0) return CIVILIAN_EMOJI_LEVELS[n - 1];
      // 中間の絵文字を均等分割（インデックス 1 〜 n-2）
      const mid = n - 2;
      const t = hp / 10000;
      const idx = 1 + Math.min(mid - 1, Math.floor((1 - t) * mid));
      return CIVILIAN_EMOJI_LEVELS[idx];
    }
    return AGENT_EMOJI[urn] ?? "🧑";
  }
  const EMOJI_FONT =
    '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';

  type IconMapping = Record<
    string,
    { x: number; y: number; width: number; height: number; mask: boolean; anchorX?: number; anchorY?: number }
  >;
  interface EmojiAtlas {
    atlas: string;
    mapping: IconMapping;
  }
  let _emojiAtlas: EmojiAtlas | null = null;

  function getEmojiAtlas(): EmojiAtlas {
    if (_emojiAtlas) return _emojiAtlas;
    const SIZE = 64;
    const emojis: string[] = [
      ...new Set([
        ...Object.values(AGENT_EMOJI),
        ...(CIVILIAN_EMOJI_LEVELS as readonly string[]),
      ]),
    ];
    const canvas = document.createElement("canvas");
    canvas.width = SIZE * emojis.length;
    canvas.height = SIZE;
    const ctx = canvas.getContext("2d")!;
    ctx.font = `${SIZE * 0.82}px ${EMOJI_FONT}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const mapping: IconMapping = {};
    emojis.forEach((emoji: string, i: number) => {
      ctx.fillText(emoji, SIZE * i + SIZE / 2, SIZE / 2);
      mapping[emoji] = {
        x: SIZE * i,
        y: 0,
        width: SIZE,
        height: SIZE,
        mask: false,
      };
    });
    _emojiAtlas = { atlas: canvas.toDataURL(), mapping };
    return _emojiAtlas;
  }

  // 仮：活動中ピンの色と絵（色だけ。しずく型のSVGをデータURLにして使う）
  type ActiveKind = "rescue" | "carry" | "clear";

  const ACTIVE_COLOR: Record<ActiveKind, [number, number, number]> = {
    rescue: [255, 140, 0], // オレンジ（agentColorの救助中と同じ）
    carry: [255, 200, 60], // 黄色（agentColorの搬送中と同じ）
    clear: [255, 80, 200], // ピンク（clear-areaの枠と同じ）
  };

  //吹き出しの種類
  type BubbleKey = "amb-approach" | "amb-carry" | "fire-approach" | "fire-dig" | "police-clear";

  interface BubbleDef {
    glyphs: string[];                       // 吹き出しの中に並べる絵文字
    color: [number, number, number];        // 枠と尻尾の色
    dashed: boolean;                        // 破線か(破線は移動中)
  }

  //絵文字の種類
  const BUBBLE_DEF: Record<BubbleKey, BubbleDef> = {
    "amb-approach":  { glyphs: ["🚑", "💨"],     color: ACTIVE_COLOR.carry,  dashed: true  },
    "amb-carry":     { glyphs: ["🚑", "🤕"],     color: ACTIVE_COLOR.carry,  dashed: false },
    "fire-approach": { glyphs: ["🚒", "💨"],     color: ACTIVE_COLOR.rescue, dashed: true  },
    "fire-dig":      { glyphs: ["🚒", "\u26CF\uFE0F"], color: ACTIVE_COLOR.rescue, dashed: false },
    "police-clear":  { glyphs: ["🚜"],           color: ACTIVE_COLOR.clear,  dashed: false },
  }

  let _bubbleAtlas: EmojiAtlas | null = null;

  function getBubbleAtlas(): EmojiAtlas {
    if (_bubbleAtlas) return _bubbleAtlas;
    const G = 40;     // 絵文字1つの大きさ（px）
    const PAD = 8;    // 吹き出しの内側の余白
    const TAIL = 14;  // 尻尾の高さ
    const H = G + PAD * 2 + TAIL;     // 画像全体の高さ
    const bodyH = H - TAIL;           // 吹き出しの本体の高さ
    const keys = Object.keys(BUBBLE_DEF) as BubbleKey[];
    const widths = keys.map((k) => BUBBLE_DEF[k].glyphs.length * G + PAD * 2);

    const canvas = document.createElement("canvas");
    canvas.width = widths.reduce((a, b) => a + b, 0);
    canvas.height = H;
    const ctx = canvas.getContext("2d")!;
    ctx.font = `${G * 0.82}px ${EMOJI_FONT}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    const mapping: IconMapping = {};
    let x0 = 0;
    keys.forEach((key, i) => {
      const def = BUBBLE_DEF[key];
      const w = widths[i];
      const [r, g, b] = def.color;
      const css = `rgb(${r},${g},${b})`;

      // 本体（白い角丸の四角に、色つきの枠）
      ctx.beginPath();
      ctx.roundRect(x0 + 2, 2, w - 4, bodyH - 4, 10);
      ctx.fillStyle = "white";
      ctx.fill();
      ctx.lineWidth = 4;
      ctx.strokeStyle = css;
      ctx.setLineDash(def.dashed ? [8, 5] : []);
      ctx.stroke();

      // 尻尾（下向きの三角）
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(x0 + w / 2 - 8, bodyH - 3);
      ctx.lineTo(x0 + w / 2 + 8, bodyH - 3);
      ctx.lineTo(x0 + w / 2, H - 1);
      ctx.closePath();
      ctx.fillStyle = css;
      ctx.fill();

      // 絵文字
      def.glyphs.forEach((glyph, j) => {
        ctx.fillText(glyph, x0 + PAD + G * j + G / 2, PAD + G / 2);
      });

      mapping[key] = { x: x0, y: 0, width: w, height: H, anchorX: w / 2, anchorY: H, mask: false };
      x0 += w;
    });
    _bubbleAtlas = { atlas: canvas.toDataURL(), mapping };
    return _bubbleAtlas;
  }


  function agentColor(
    urn: number,
    action?: AgentAction,
    carrying = false,
    hp = 10000,
  ): [number, number, number, number] {
    if (
      urn === EntityURN.FIRE_BRIGADE &&
      action?.urn === CommandURN.AK_RESCUE
    ) {
      return [255, 140, 0, 255]; // rescue中: オレンジ
    }
    if (urn === EntityURN.AMBULANCE_TEAM && carrying) {
      return [255, 200, 60, 255]; // 市民搬送中: 黄色
    }
    if (urn === EntityURN.CIVILIAN) {
      const t = Math.max(0, Math.min(1, hp / 10000));
      return [Math.round(60 * t), Math.round(200 * t), Math.round(80 * t), 255];
    }
    switch (urn) {
      case EntityURN.FIRE_BRIGADE:
        return [220, 30, 30, 255]; // 赤
      case EntityURN.AMBULANCE_TEAM:
        return [240, 240, 240, 255]; // 白
      case EntityURN.POLICE_FORCE:
        return [30, 90, 220, 255];
      default:
        return [200, 200, 200, 255];
    }
  }

  // ── Layer builders ────────────────────────────────────────────────────────
  // 静的レイヤー（道路・建物・瓦礫・通信・軌跡）: ステップ切替時のみ再構築
  // 動的レイヤー（エージェントドット）: 毎フレーム再構築（補間位置）

  // Tomi── Layer filter panel ───────────────────────────────────────────────────
  function isLayerHidden(urn: number, hidden: Set<LayerCategory>): boolean {
    switch (urn) {
      case EntityURN.CIVILIAN:
        return hidden.has("civilian");
      case EntityURN.AMBULANCE_TEAM:
        return hidden.has("ambulance");
      case EntityURN.FIRE_BRIGADE:
        return hidden.has("fire");
      case EntityURN.POLICE_FORCE:
        return hidden.has("police");
      case EntityURN.REFUGE:
        return hidden.has("refuge");
      case EntityURN.BLOCKADE:
        return hidden.has("blockade");
      case EntityURN.BUILDING:
      case EntityURN.FIRE_STATION:
      case EntityURN.AMBULANCE_CENTRE:
      case EntityURN.POLICE_OFFICE:
      case EntityURN.GAS_STATION:
        return hidden.has("building");
      default:
        return false;
    }
  }

  function buildStaticLayers(
    emap: Map<number, SimEntity>,
    selId: number | null,
    actions: Map<number, AgentAction>,
    cfg: Record<string, string>,
    perceivedIds: Set<number> | null,
    comms: CommMessage[] | null,
    hiddenChs: Set<number>,
    hidden: Set<LayerCategory>,
  ) {
    const filteredComms =
      hiddenChs.size > 0 && comms
        ? comms.filter((c) => !hiddenChs.has(c.channel))
        : comms;

    const roads: RoadEntity[] = [];
    const buildings: BuildingEntity[] = [];
    const blockades: BlockadeEntity[] = [];
    const agents: HumanEntity[] = [];

    for (const e of emap.values()) {
      if (isLayerHidden(e.urn, hidden)) continue;
      if (e.urn === EntityURN.ROAD || e.urn === EntityURN.HYDRANT)
        roads.push(e as RoadEntity);
      else if (isBuilding(e.urn)) buildings.push(e as BuildingEntity);
      else if (e.urn === EntityURN.BLOCKADE)
        blockades.push(e as BlockadeEntity);
      else if (isAgent(e.urn)) agents.push(e as HumanEntity);
    }

    // 搬送中マップ（軌跡・色計算用）
    const carrierMap = new Map<number, HumanEntity>();
    const carriedIds = new Set<number>();
    for (const e of emap.values()) {
      if (e.urn === EntityURN.CIVILIAN) {
        const h = e as HumanEntity;
        const carrier = emap.get(h.position);
        if (carrier?.urn === EntityURN.AMBULANCE_TEAM) {
          carrierMap.set(carrier.id, h);
          carriedIds.add(h.id);
        }
      }
    }
    const visibleAgents = agents.filter((a) => !carriedIds.has(a.id));

    // AK_CLEAR / AK_CLEAR_AREA
    const clearingTargets = new Set<number>();
    const clearDist = parseInt(cfg["clear.repair.distance"] ?? "10000", 10);
    const clearRad = parseInt(cfg["clear.repair.rad"] ?? "2000", 10);
    const clearAreaPolygons: [number, number][][] = [];

    for (const [agentId, action] of actions) {
      if (perceivedIds ? !perceivedIds.has(agentId) : !emap.has(agentId))
        continue;
      if (action.urn === CommandURN.AK_CLEAR && action.target !== undefined) {
        clearingTargets.add(action.target);
      } else if (
        action.urn === CommandURN.AK_CLEAR_AREA &&
        action.destX !== undefined &&
        action.destY !== undefined
      ) {
        const agent = emap.get(agentId) as HumanEntity | undefined;
        if (!agent) continue;
        const dx = action.destX - agent.x;
        const dy = action.destY - agent.y;
        const len = Math.sqrt(dx * dx + dy * dy);
        if (len === 0) continue;
        const nx = dx / len,
          ny = dy / len;
        const px = -ny,
          py = nx;
        const ex = agent.x + nx * clearDist;
        const ey = agent.y + ny * clearDist;
        clearAreaPolygons.push([
          [agent.x + px * clearRad, agent.y + py * clearRad],
          [agent.x - px * clearRad, agent.y - py * clearRad],
          [ex - px * clearRad, ey - py * clearRad],
          [ex + px * clearRad, ey + py * clearRad],
        ]);
      }
    }

    // AK_MOVE パス
    const moveLayers = ((): (
      | PathLayer<unknown>
      | ScatterplotLayer<unknown>
    )[] => {
      if (hidden.has("path") || !selId) return [];
      const sel = emap.get(selId) as HumanEntity | undefined;
      if (!sel || !isAgent(sel.urn)) return [];
      const action = actions.get(selId);
      if (action?.urn !== CommandURN.AK_MOVE || !action.path?.length) return [];
      const pts: [number, number][] = [];
      for (const id of action.path) {
        const e = emap.get(id);
        if (e && "x" in e && "y" in e)
          pts.push([
            (e as { x: number; y: number }).x,
            (e as { x: number; y: number }).y,
          ]);
      }
      if (pts.length < 2) return [];
      const dest = pts[pts.length - 1];
      return [
        new PathLayer<[number, number][]>({
          id: "move-path",
          data: [pts],
          getPath: (d) => d,
          getColor: [80, 220, 255, 200],
          getWidth: 300,
          widthMinPixels: 2,
          widthMaxPixels: 5,
          pickable: false,
        }) as unknown as PathLayer<unknown>,
        new ScatterplotLayer<{ pos: [number, number] }>({
          id: "move-dest",
          data: [{ pos: dest }],
          getPosition: (d) => d.pos,
          getFillColor: [80, 220, 255, 240],
          getLineColor: [255, 255, 255, 200],
          getRadius: 800,
          radiusMinPixels: 5,
          radiusMaxPixels: 14,
          stroked: true,
          lineWidthMinPixels: 2,
          pickable: false,
        }) as unknown as ScatterplotLayer<unknown>,
      ];
    })();

    // 通信レイヤー
    const commLayers = ((): (
      | LineLayer<unknown>
      | ScatterplotLayer<unknown>
    )[] => {
      if (!filteredComms?.length || !selId) return [];
      const sel = emap.get(selId) as HumanEntity | undefined;
      if (!sel || !isAgent(sel.urn)) return [];
      const senderChMap = new Map<number, number>();
      for (const c of filteredComms) {
        const cur = senderChMap.get(c.senderId);
        if (cur === undefined || c.channel < cur)
          senderChMap.set(c.senderId, c.channel);
      }
      type LineEntry = {
        source: [number, number];
        target: [number, number];
        ch: number;
      };
      type SenderEntry = { x: number; y: number; ch: number };
      const lineData: LineEntry[] = [];
      const senderData: SenderEntry[] = [];
      for (const [sid, ch] of senderChMap) {
        const sender = emap.get(sid) as HumanEntity | undefined;
        if (!sender || !isAgent(sender.urn)) continue;
        if (sender.x === 0 && sender.y === 0) continue;
        lineData.push({
          source: [sel.x, sel.y],
          target: [sender.x, sender.y],
          ch,
        });
        senderData.push({ x: sender.x, y: sender.y, ch });
      }
      return [
        new LineLayer<LineEntry>({
        id: "comm-lines-casing",
        data: lineData,
        getSourcePosition: (d) => d.source,
        getTargetPosition: (d) => d.target,
        getColor: [255, 255, 255, 200],
        getWidth: 300,
        widthMinPixels: 3,
        widthMaxPixels: 6,
        }) as unknown as LineLayer<unknown>,
        new LineLayer<LineEntry>({
          id: "comm-lines",
          data: lineData,
          getSourcePosition: (d) => d.source,
          getTargetPosition: (d) => d.target,
          getColor: (d) =>
            [...channelColorRGB(d.ch), 230] as [number, number, number, number],
          getWidth: 300,
          widthMinPixels: 2,
          widthMaxPixels: 4,
          updateTriggers: { getColor: [filteredComms] },
        }) as unknown as LineLayer<unknown>,
        new ScatterplotLayer<SenderEntry>({
          id: "comm-senders",
          data: senderData,
          getPosition: (d) => [d.x, d.y],
          getFillColor: [0, 0, 0, 0],
          getLineColor: (d) =>
            [...channelColorRGB(d.ch), 255] as [number, number, number, number],
          getRadius: 900,
          radiusMinPixels: 5,
          radiusMaxPixels: 16,
          stroked: true,
          filled: false,
          lineWidthMinPixels: 2,
          lineWidthMaxPixels: 4,
          pickable: false,
          updateTriggers: { getLineColor: [filteredComms] },
        }) as unknown as ScatterplotLayer<unknown>,
      ];
    })();

    return [
      new PolygonLayer({
        id: "roads",
        data: roads,
        getPolygon: (d: RoadEntity) => d.apexes,
        getFillColor: (d: RoadEntity) =>
          d.urn === EntityURN.HYDRANT ? [30, 100, 140, 220] : [200, 200, 200, 255],
        getLineColor: [170, 170, 170, 255],
        lineWidthMinPixels: 0.5,
        pickable: true,
        onClick: (info: PickingInfo) =>
          selectEntity((info.object as RoadEntity)?.id ?? null),
      }),

      new PolygonLayer({
        id: "buildings",
        data: buildings,
        getPolygon: (d: BuildingEntity) => d.apexes,
        getFillColor: (d: BuildingEntity) => {
          const [r, g, b, a] = buildingColor(d);
          if (perceivedIds && !perceivedIds.has(d.id))
            return [r, g, b, Math.round(a * 0.2)];
          return [r, g, b, a];
        },
        getLineColor: (d: BuildingEntity) =>
          d.id === selId
            ? [0, 220, 255, 255]
            : perceivedIds?.has(d.id)
              ? [0, 200, 180, 200]
              : perceivedIds
                ? [90, 90, 90, 50]
                : [90, 90, 90, 200],
        lineWidthMinPixels: 1.5,
        pickable: true,
        onClick: (info: PickingInfo) =>
          selectEntity((info.object as BuildingEntity)?.id ?? null),
        updateTriggers: {
          getFillColor: [
            buildings.map((b) => b.fieryness * 100 + b.brokenness),
            perceivedIds,
          ],
          getLineColor: [selId, perceivedIds],
        },
      }),

      new PolygonLayer({
        id: "blockades",
        data: blockades,
        getPolygon: (d: BlockadeEntity) => d.apexes,
        getFillColor: (d: BlockadeEntity) =>
          perceivedIds && !perceivedIds.has(d.id)
            ? [10, 10, 10, 40] : [10, 10, 10, 255],
        getLineColor: (d: BlockadeEntity) =>
          d.id === selId
            ? [0, 220, 255, 255]
            : perceivedIds?.has(d.id)
              ? [0, 200, 180, 220]
              : clearingTargets.has(d.id)
                ? [255, 80, 200, 255]
                : perceivedIds
                  ? [240, 200, 60, 60]
                  : [100, 100, 100, 255],
        lineWidthMinPixels: 1,
        lineWidthMaxPixels: 4,
        pickable: true,
        onClick: (info: PickingInfo) =>
          selectEntity((info.object as BlockadeEntity)?.id ?? null),
        updateTriggers: {
          getFillColor: [perceivedIds],
          getLineColor: [selId, clearingTargets, perceivedIds],
        },
      }),

      new PathLayer({
        id: "agent-trails",
        data: hidden.has("path")? [] :visibleAgents.filter((a) => a.positionHistory.length >= 2),
        getPath: (d: HumanEntity) => {
          const pts: [number, number][] = [];
          for (let i = 0; i + 1 < d.positionHistory.length; i += 2)
            pts.push([d.positionHistory[i], d.positionHistory[i + 1]]);
          return pts;
        },
        getColor: (d: HumanEntity) => {
          const [r, g, b] = agentColor(
            d.urn,
            actions.get(d.id),
            carrierMap.has(d.id),
            d.hp,
          );
          return [r, g, b, d.id === selId ? 220 : 60] as [
            number,
            number,
            number,
            number,
          ];
        },
        getWidth: (d: HumanEntity) => (d.id === selId ? 400 : 200),
        widthMinPixels: 1,
        widthMaxPixels: 4,
        updateTriggers: { getColor: [selId], getWidth: [selId] },
      }),

      ...commLayers,

      new PolygonLayer({
        id: "clear-area",
        data: hidden.has("rescueTargets") ? [] : clearAreaPolygons,
        getPolygon: (d: [number, number][]) => d,
        getFillColor: [255, 80, 200, 30],
        getLineColor: [255, 80, 200, 220],
        lineWidthMinPixels: 1,
        lineWidthMaxPixels: 3,
        pickable: false,
      }),

      ...moveLayers,
    ];
  }

  // 動的レイヤー: animatedEntities の補間位置でエージェントドットのみ再構築
  function buildAgentLayers(
    emap: Map<number, SimEntity>,
    selId: number | null,
    actions: Map<number, AgentAction>,
    perceivedIds: Set<number> | null,
    hidden: Set<LayerCategory>,
    displayMode: "circle" | "emoji" = "emoji",
  ) {
    const agents: HumanEntity[] = [];
    const carrierMap = new Map<number, HumanEntity>();
    const carriedIds = new Set<number>();

    for (const e of emap.values()) {
      if ((!isAgent(e.urn)) || isLayerHidden(e.urn, hidden)) continue;
      const h = e as HumanEntity;
      if (h.urn === EntityURN.CIVILIAN) {
        const carrier = emap.get(h.position);
        if (carrier?.urn === EntityURN.AMBULANCE_TEAM) {
          carrierMap.set(carrier.id, h);
          carriedIds.add(h.id);
        }
      }
      agents.push(h);
    }
    const visibleAgents = agents.filter((a) => !carriedIds.has(a.id));
    const civilians = visibleAgents.filter((a) => a.urn === EntityURN.CIVILIAN);
    const rescueAgents = visibleAgents.filter(
      (a) => a.urn !== EntityURN.CIVILIAN,
    );

          // 仮：活動中のエージェントと、吹き出しの種類
     const phases = getActivityPhases(get(currentStep));
     const activeAgents = rescueAgents.flatMap((a) => {
      const act = actions.get(a.id)?.urn;
      const ph = phases.get(a.id);
      let key: BubbleKey | null = null;
      if (ph?.phase === "approach") {
        key = ph.kind === "rescue" ? "fire-approach" : "amb-approach";
      } else if (a.urn === EntityURN.FIRE_BRIGADE && act === CommandURN.AK_RESCUE) {
        key = "fire-dig";
      } else if (carrierMap.has(a.id)) {
        key = "amb-carry";
      } else if (a.urn === EntityURN.POLICE_FORCE && (act === CommandURN.AK_CLEAR || act === CommandURN.AK_CLEAR_AREA)) {
        key = "police-clear";
      }
      return key ? [{ agent: a, key }] : [];
     })


    if (displayMode === "emoji") {
      const { atlas, mapping } = getEmojiAtlas();
      const rescuingFireBrigades = rescueAgents.filter(
        (a) =>
          a.urn === EntityURN.FIRE_BRIGADE &&
          actions.get(a.id)?.urn === CommandURN.AK_RESCUE,
      );
      const emojiLayer = (id: string, data: HumanEntity[]) =>
        new IconLayer({
          id,
          data,
          getPosition: (d: HumanEntity) => [d.x, d.y],
          getIcon: (d: HumanEntity) => getAgentEmoji(d.urn, d.hp ?? 10000),
          getSize: (d: HumanEntity) => (d.id === selId ? 28 : 20),
          getColor: (d: HumanEntity) => {
            const dim =
              perceivedIds && !perceivedIds.has(d.id) && d.id !== selId;
            return dim ? [255, 255, 255, 50] : [255, 255, 255, 255];
          },
          sizeMinPixels: 10,
          sizeMaxPixels: 32,
          iconAtlas: atlas,
          iconMapping: mapping,
          pickable: true,
          onClick: (info: PickingInfo) =>
            selectEntity((info.object as HumanEntity)?.id ?? null),
          updateTriggers: { getSize: [selId], getColor: [perceivedIds] },
        });
      return [
        emojiLayer("civilians-emoji", civilians),
        new ScatterplotLayer({
          id: "rescuing-fire-brigades-highlight",
          data: hidden.has("rescueTargets") ? [] : rescuingFireBrigades,
          getPosition: (d: HumanEntity) => [d.x, d.y],
          getFillColor: (d: HumanEntity) => {
            const dim =
              perceivedIds && !perceivedIds.has(d.id) && d.id !== selId;
            return dim ? [255, 140, 0, 40] : [255, 140, 0, 210];
          },
          getLineColor: [255, 255, 255, 220],
          getRadius: (d: HumanEntity) => (d.id === selId ? 850 : 650),
          radiusMinPixels: 8,
          radiusMaxPixels: 24,
          stroked: true,
          lineWidthMinPixels: 1,
          pickable: false,
          updateTriggers: {
            getFillColor: [perceivedIds],
            getRadius: [selId],
          },
        }),
        emojiLayer("rescue-agents-emoji", rescueAgents),
        new IconLayer({
          id: "passengers-emoji",
          data: hidden.has("rescueTargets") ? [] :visibleAgents.filter((a) => carrierMap.has(a.id)),
          getPosition: (d: HumanEntity) => [d.x, d.y],
          getIcon: () => "🧑",
          getSize: (d: HumanEntity) => (d.id === selId ? 18 : 13),
          getColor: [255, 255, 255, 220],
          sizeMinPixels: 6,
          sizeMaxPixels: 20,
          iconAtlas: atlas,
          iconMapping: mapping,
          pickable: false,
          updateTriggers: { getSize: [selId] },
        }),
      ];
    }

    // circle モード（従来）
    const circleLayer = (id: string, data: HumanEntity[]) =>
      new ScatterplotLayer({
        stroked: true,
        getLineColor: [30, 30, 30, 255],
        lineWidthMinPixels: 1,
        id,
        data,
        getPosition: (d: HumanEntity) => [d.x, d.y],
        getFillColor: (d: HumanEntity) => {
          const [r, g, b, a] = agentColor(
            d.urn,
            actions.get(d.id),
            carrierMap.has(d.id),
            d.hp,
          );
          if (perceivedIds && !perceivedIds.has(d.id) && d.id !== selId)
            return [r, g, b, 40];
          return [r, g, b, a];
        },
        getRadius: (d: HumanEntity) => (d.id === selId ? 800 : 500),
        radiusMinPixels: 3,
        radiusMaxPixels: 12,
        pickable: true,
        onClick: (info: PickingInfo) =>
          selectEntity((info.object as HumanEntity)?.id ?? null),
        updateTriggers: {
          getRadius: [selId],
          getFillColor: [actions, perceivedIds],
        },
      });
    const bubbleAtlas = getBubbleAtlas();
    return [
      circleLayer("civilians-circle", civilians),
      circleLayer("rescue-agents-circle", rescueAgents),
      new ScatterplotLayer({
        id: "passengers-circle",
        data: hidden.has("rescueTargets") ? [] : visibleAgents.filter((a) => carrierMap.has(a.id)),
        getPosition: (d: HumanEntity) => [d.x, d.y],
        getFillColor: [60, 200, 80, 220],
        getLineColor: [255, 255, 255, 180],
        getRadius: (d: HumanEntity) => (d.id === selId ? 400 : 250),
        radiusMinPixels: 2,
        radiusMaxPixels: 7,
        stroked: true,
        lineWidthMinPixels: 1,
        pickable: false,
        updateTriggers: { getRadius: [selId] },
      }),

      // 仮：活動中のエージェントの上に出すアイコン
      new IconLayer({
        id: "active-pins",
        data: hidden.has("rescueTargets") || alwaysFollow ? [] : activeAgents,
        getPosition: (d: { agent: HumanEntity; key: BubbleKey }) => [d.agent.x, d.agent.y],
        getIcon: (d: { agent: HumanEntity; key: BubbleKey }) => d.key,
        getSize: (d: { agent: HumanEntity; key: BubbleKey }) => (d.key === "police-clear" ? 30 : 40),
        sizeUnits: "pixels",
        iconAtlas: bubbleAtlas.atlas,
        iconMapping: bubbleAtlas.mapping,
        pickable: true,
        onClick: (info: PickingInfo) => selectEntity(
            (info.object as { agent: HumanEntity } | undefined)?.agent.id ?? null,
        ),
      }),
    ];
  }

  // ── Viewport fit ──────────────────────────────────────────────────────────

  function fitViewport(emap: Map<number, SimEntity>) {
    if (emap.size === 0 || !deck) return;

    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    for (const e of emap.values()) {
      if ("apexes" in e) {
        for (const [x, y] of (e as { apexes: [number, number][] }).apexes) {
          if (x < minX) minX = x;
          if (y < minY) minY = y;
          if (x > maxX) maxX = x;
          if (y > maxY) maxY = y;
        }
      }
    }
    if (!isFinite(minX)) return;

    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const span = Math.max(maxX - minX, maxY - minY);
    const viewSize = Math.min(canvas.clientWidth, canvas.clientHeight);
    const zoom = Math.log2(viewSize / span) - 0.2;

    fitZoom = zoom;
    const target: [number, number, number] = [cx, cy, 0];
    const viewState: OrthographicViewState = {
      target,
      zoom,
      minZoom: zoom - 5,
      maxZoom: zoom + 10,
    };
    deck.setProps({ initialViewState: viewState });
  }

  // ── Follow mode ───────────────────────────────────────────────────────────

  let currentZoom = 0;
  let fitZoom = 0;

  function followAgent(emap: Map<number, SimEntity>, selId: number | null) {
    //Tomi 
    //if (!(alwaysFollow || $followMode) || selId === null || !deck) return;
    if(!alwaysFollow || selId === null || !deck) return;
    const e = emap.get(selId);
    if (!e || !isAgent(e.urn)) return;
    const h = e as HumanEntity;
    if (h.x == 0 && h.y == 0) return;
    deck.setProps({
      initialViewState: {
        target: [h.x, h.y, 0] as [number, number, number],
        zoom: fitZoom　+ 3,
        minZoom: currentZoom - 5,
        maxZoom: currentZoom + 10,
      },
    });
    if(alwaysFollow) {
      const worldWidth = canvas.clientWidth / 2 ** (fitZoom + 3);
      const worldHeight = canvas.clientHeight / 2 ** (fitZoom + 3);
      detailViewport.set({ cx: h.x, cy: h.y, halfW: worldWidth / 2, halfH: worldHeight / 2 });
    }
  }

  // ── Store subscriptions ───────────────────────────────────────────────────

  let prevSize = 0;

  // キャッシュ: 静的レイヤーは毎フレーム再構築しない
  let cachedStaticLayers: ReturnType<typeof buildStaticLayers> = [];
  let cachedAgentLayers: ReturnType<typeof buildAgentLayers> = [];
  let cachedViewportLayer: unknown[] = [];
  // 搬送先の線のレイヤー（buildCarryLine の結果。cachedViewportLayer と同じ使い方）
  let cachedCarryLine: unknown[] = [];

  // 搬送先の表のキャッシュ。描画は補間で1秒に何十回も走るので、
  // 全イベントを走査する getCarryingDestinations は、ステップが変わったときだけ呼ぶ
  // （C++ なら static 変数に、前回の入力と前回の結果を持っておくのと同じ）
  let carryDestStep = -1; // 前回、表を作ったステップ
  let carryDestEvents: unknown = null; // 前回見たイベント一覧（別ログを読み込んだ検知用。!== はポインタ比較）
  let carryDest = new Map<number, number>(); // 搬送先の表: 救急隊ID → 避難所のノードID

  // 選択中の救急隊が搬送中なら、その隊から搬送先（避難所）までの線を返す
  // emap: 隊の「今の位置」を引く表（補間された位置が入っている）
  // selId: 選択中のID。左の全体画面は suppressHighlight なので displaySelId ではなく元の selId を渡す
  function buildCarryLine(emap: Map<number, SimEntity>, selId: number | null) {
    // 詳細画面側（alwaysFollow）と、何も選んでいないときは、線なし
    if (alwaysFollow || selId === null) return [];

    // 前回と同じステップ・同じログなら、前回の表を使い回す
    const step = get(currentStep);
    const events = get(simEvents);
    if (step !== carryDestStep || events !== carryDestEvents) {
      carryDest = getCarryingDestinations(step);
      carryDestStep = step;
      carryDestEvents = events;
    }

    const destId = carryDest.get(selId); // 搬送中でなければ undefined（find が end() を返すのと同じ）
    const agent = emap.get(selId) as HumanEntity | undefined; // 隊は動くので emap（補間位置）から取る
    // 避難所は動かないので、ステップごとの状態（entities）から取る
    const dest = destId === undefined ? undefined : get(entities).get(destId);
    // どれか無い、または座標（x）を持たない型なら、線なし
    if (!agent || !dest || !("x" in dest)) return [];

    return [
      new LineLayer({
        id: "carry-destination-line",
        // 線は1本だけなので、要素が1つの配列を渡す
        data: [{ source: [agent.x, agent.y], target: [dest.x, dest.y] }],
        // 「データから始点・終点を取り出す関数」を渡す（C++ のラムダ）
        getSourcePosition: (d: { source: [number, number] }) => d.source,
        getTargetPosition: (d: { target: [number, number] }) => d.target,
        // [...a, 230] は、配列 a の後ろに 230（透明度）を足した配列。色は活動ピンの「搬送」と同じ
        getColor: [...ACTIVE_COLOR.carry, 230] as [number, number, number, number],
        getWidth: 300,
        widthMinPixels: 3, // 拡大・縮小しても、画面上の太さがこの範囲に収まる
        widthMaxPixels: 5,
      }),
    ];
  }

  function flushLayers() {
    if (!deck) return;
    deck.setProps({
      // 後ろに並べたものほど上に描かれる（隊の点の上、視野枠の下に線が重なる）
      layers: [
        ...cachedStaticLayers,
        ...cachedAgentLayers,
        ...cachedCarryLine,
        ...cachedViewportLayer,
      ],
    });
  }

  // 静的レイヤー: ステップ切替・選択変更・設定変更時のみ再構築
  const staticArgs = derived(
    [
      entities,
      perceivedEntities,
      perceptionViewMode,
      selectedId,
      agentActions,
      kernelConfig,
      agentVisibleIds,
      agentReceivedComms,
      hiddenChannels,
      hiddenLayers,
    ],
    ([$e, $pe, $pvm, $sel, $aa, $kc, $avi, $arc, $hc, $hl]) => ({
      //Tomi
      //emap: $pvm ? $pe : $e,
      emap: (!suppressHighlight && $pvm) ? $pe : $e,
      selId: $sel,
      actions: $aa,
      cfg: $kc,
      perceivedIds: $avi,
      comms: $arc,
      hiddenChs: $hc,
      hidden: $hl,
    }),
  );

  const unsubStatic = staticArgs.subscribe(
    ({ emap, selId, actions, cfg, perceivedIds, comms, hiddenChs, hidden}) => {
      const displaySelId = suppressHighlight ? null : selId;
      const displayPerceivedIds = (suppressHighlight || !get(perceptionViewMode)) ? null : perceivedIds;
      cachedStaticLayers = buildStaticLayers(
        emap,
        displaySelId,
        actions,
        cfg,
        displayPerceivedIds,
        comms,
        hiddenChs,
        hidden,
      );
      flushLayers();
      followAgent(emap, selId);
    },
  );

  // 動的レイヤー: animatedEntities が更新されるたびに再構築（補間フレーム含む）
  const agentArgs = derived(
    [
      animatedEntities,
      selectedId,
      agentActions,
      agentVisibleIds,
      perceptionViewMode,
      perceivedEntities,
      agentDisplayMode,
      hiddenLayers,
    ],
    ([$ae, $sel, $aa, $avi, $pvm, $pe, $adm, $hl]) => ({
      //Tomi
      //emap: $pvm ? $pe : $ae,
      emap: (!suppressHighlight && $pvm) ? $pe : $ae,
      selId: $sel,
      actions: $aa,
      perceivedIds: $avi,
      displayMode: $adm,
      hidden: $hl,
    }),
  );

  const unsubAgents = agentArgs.subscribe(
    ({ emap, selId, actions, perceivedIds, displayMode, hidden }) => {
      const displaySelId = suppressHighlight ? null : selId;
      const displayPerceivedIds = (suppressHighlight || !get(perceptionViewMode)) ? null : perceivedIds;
      cachedAgentLayers = buildAgentLayers(
        emap,
        displaySelId,
        actions,
        displayPerceivedIds,
        hidden, 
        displayMode,
      );
      // 搬送先の線も作り直す（隊が動くたびに呼ばれるので、線の隊側の端が隊について動く）
      cachedCarryLine = buildCarryLine(emap, selId);
      flushLayers();
    },
  );

  //Tomi
  const unsubViewportIndicator = detailViewport.subscribe((bounds) => {
    if(alwaysFollow) return ;

    if(!bounds) cachedViewportLayer = [];
    else {
      //詳細画面の範囲を囲む
      const rectPath:[number, number][] = [
        [bounds.cx - bounds.halfW, bounds.cy - bounds.halfH],// 左下
        [bounds.cx + bounds.halfW, bounds.cy - bounds.halfH],// 右下
        [bounds.cx + bounds.halfW, bounds.cy + bounds.halfH],// 右上
        [bounds.cx - bounds.halfW, bounds.cy + bounds.halfH],// 左上
        [bounds.cx - bounds.halfW, bounds.cy - bounds.halfH],// 左下
      ];
      cachedViewportLayer = [
        new PathLayer({
          id: "detail-Viewport-indicator",
          data: [rectPath],
          getPath: (d) => d,
          getColor: [255, 255, 255, 255],//要検討色
          getWidth: 2,
          widthMinPixels: 2,
          widthMaxPixels: 2,
        })
      ];
    }

    flushLayers();
  });

  // 実世界エンティティが初めてロードされたときにビューポートをフィット
  const unsubFit = entities.subscribe((emap) => {
    //Tomi
    //if (!deck || $perceptionViewMode) return;
    if (!deck || (!suppressHighlight && $perceptionViewMode)) return;
    if (prevSize === 0 && emap.size > 0) fitViewport(emap);
    prevSize = emap.size;
  });

  const unsubFocus = focusPoint.subscribe((pt) => {
    if (!pt || !deck) return;
    if (suppressHighlight) return;
    const closeZoom = Math.max(currentZoom, fitZoom + 5);
    deck.setProps({
      initialViewState: {
        target: [pt.x, pt.y, 0] as [number, number, number],
        zoom: closeZoom,
        minZoom: fitZoom - 5,
        maxZoom: fitZoom + 10,
      },
    });
    focusPoint.set(null);
  });

  const unsubRemoteViewport = remoteViewportCommand.subscribe((cmd) => {
    if (!cmd || alwaysFollow || !deck) return;
    deck.setProps({
      initialViewState: {
        target: [cmd.cx, cmd.cy, 0] as [number, number, number],
        zoom: cmd.zoom,
        minZoom: cmd.zoom -5,
        maxZoom: cmd.zoom + 10,
      },
    });
  });

  // ── Deck.gl lifecycle ─────────────────────────────────────────────────────

  //画面に出す時
  onMount(() => {
    const initialViewState: OrthographicViewState = {
      target: [0, 0, 0],
      zoom: 0,
    };
    deck = new Deck<OrthographicView>({
      canvas,
      views: new OrthographicView({ id: "ortho", flipY: false }),
      initialViewState,
      controller: true,
      layers: [],
      getCursor: ({ isDragging }) => (isDragging ? "grabbing" : "crosshair"),
      onClick: (info) => {
        if (!info.picked) {
          if (get(pinnedAgentId) === null) selectedId.set(null);
          inspectedId.set(null);
        }
      },
      onViewStateChange: ({ viewState }) => {
        const vs = viewState as OrthographicViewState;
        const z = vs.zoom;
        if (typeof z !== "number") return;
        currentZoom = z;
        if (!alwaysFollow && Array.isArray(vs.target)) {
          const [cx, cy] = vs.target as [number, number];
          mapViewport.set({cx, cy, zoom: z});
        }
      },
    });

    //Tomi初期化処理
    //const initEmap = get(perceptionViewMode) ? get(perceivedEntities) : get(entities);
    const initEmap = (!suppressHighlight && get(perceptionViewMode)) ?
    get(perceivedEntities) : get(entities);
    fitViewport(initEmap);
    followAgent(initEmap, get(selectedId));
    flushLayers();
  });

  //画面から消える時
  onDestroy(() => {
    unsubStatic();
    unsubAgents();
    unsubFit();
    unsubFocus();
    unsubRemoteViewport();
    deck?.finalize();
    unsubViewportIndicator();
    if(alwaysFollow){
      detailViewport.set(null);
    }
  });
</script>

<canvas bind:this={canvas} class="sim-canvas"></canvas>

<style>
  .sim-canvas {
    width: 100%;
    height: 100%;
    display: block;
    background: var(--map-bg);
  }
</style>
