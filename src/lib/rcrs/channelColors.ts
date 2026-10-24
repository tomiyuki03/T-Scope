/** チャンネル番号ごとの色定義 (InfoPanel / SimMap で共有) */

/** CSS 色文字列 (InfoPanel 用) */
export const CHANNEL_COLORS_CSS: readonly string[] = [
  "#00669e", // ch 0 – 青
  "#00704f", // ch 1 – 緑
  "#9c4f00", // ch 2 – 橙（茶）
  "#5b2a86", // ch 3 – 紫
  "#b91c1c", // ch 4 – 赤
  "#006d77", // ch 5 – ティール
  "#4b5563", // ch 6 – 灰
  "#b0155a", // ch 7 – ピンク
];

/** RGB タプル (deck.gl 用) */
export const CHANNEL_COLORS_RGB: readonly [number, number, number][] = [
  [0, 102, 158],
  [0, 112, 79],
  [156, 79, 0],
  [91, 42, 134],
  [185, 28, 28],
  [0, 109, 119],
  [75, 85, 99],
  [176, 21, 90],
];

export function channelColorCSS(ch: number): string {
  return CHANNEL_COLORS_CSS[ch % CHANNEL_COLORS_CSS.length];
}

export function channelColorRGB(ch: number): [number, number, number] {
  return CHANNEL_COLORS_RGB[ch % CHANNEL_COLORS_RGB.length];
}
