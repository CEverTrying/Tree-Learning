import type { Settings } from "./model";

export function isDeepSeekApi(baseUrl: string): boolean {
  try { return new URL(baseUrl).hostname === "api.deepseek.com"; }
  catch { return false; }
}

export const deepSeekModels = [
  { id: "deepseek-flash", label: "DeepSeek Flash" },
  { id: "deepseek-v4-pro", label: "DeepSeek V4 Pro" },
] as const;

export function deepSeekPreset(settings: Settings, model: string): Settings {
  return {
    ...settings,
    baseUrl: "https://api.deepseek.com",
    apiType: "chat-completions",
    model,
    apiKey: isDeepSeekApi(settings.baseUrl) ? settings.apiKey : "",
    webProvider: "tavily",
  };
}
