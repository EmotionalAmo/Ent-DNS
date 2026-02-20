/**
 * 预设颜色列表，用于客户端分组标记
 */
export const PRESET_COLORS = [
  '#6366f1', // Indigo
  '#ef4444', // Red
  '#22c55e', // Green
  '#eab308', // Yellow
  '#ec4899', // Pink
  '#8b5cf6', // Violet
  '#14b8a6', // Teal
  '#f97316', // Orange
  '#3b82f6', // Blue
  '#6b7280', // Gray
] as const;

/**
 * 颜色名称映射
 */
export const COLOR_NAMES: Record<string, string> = {
  '#6366f1': '靛蓝',
  '#ef4444': '红色',
  '#22c55e': '绿色',
  '#eab308': '黄色',
  '#ec4899': '粉色',
  '#8b5cf6': '紫色',
  '#14b8a6': '青色',
  '#f97316': '橙色',
  '#3b82f6': '蓝色',
  '#6b7280': '灰色',
};
