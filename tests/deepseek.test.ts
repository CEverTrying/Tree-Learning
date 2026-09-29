import test from "node:test";
import assert from "node:assert/strict";
import { defaultSettings } from "../src/model";
import { deepSeekPreset, isDeepSeekApi } from "../src/model-providers";
import { createModelRequest, compatibleTools, appendToolResults, readToolCalls } from "../server/model-api";
import { WebTools } from "../server/web-tools";

test("DeepSeek presets select current models, stable API and external search without reusing another provider key", () => {
  const settings = deepSeekPreset({ ...defaultSettings, apiKey: "OTHER_KEY", webEnabled: true }, "deepseek-flash");
  assert.equal(settings.apiKey, "");
  assert.equal(settings.baseUrl, "https://api.deepseek.com");
  assert.equal(settings.webProvider, "tavily");
  assert.equal(settings.apiType, "chat-completions");
  assert.equal(deepSeekPreset({ ...settings, apiKey: "DS_KEY" }, "deepseek-v4-pro").apiKey, "DS_KEY");
  assert.equal(isDeepSeekApi("https://api.deepseek.com.evil.example"), false);
});

test("DeepSeek sends executable search tools in standard mode and preserves tool results", () => {
  const settings = { ...deepSeekPreset(defaultSettings, "deepseek-flash"), webEnabled: true, webApiKey: "SEARCH_KEY" };
  for (const apiType of ["chat-completions", "responses"] as const) {
    const request = createModelRequest({ ...settings, apiType }, "help", [{ role: "user", content: "Search" }], "", []);
    assert.equal(request.url.hostname, "api.deepseek.com");
    if (apiType === "chat-completions") assert.deepEqual(request.body.thinking, { type: "disabled" });
    else assert.deepEqual(request.body.reasoning, { effort: "none" });
    const web = new WebTools(settings, new AbortController().signal);
    const original = web.definitions(apiType);
    const tools = compatibleTools(settings.baseUrl, original);
    assert.equal(tools.length, 2);
    assert.equal(tools[0].type, "function");
    assert.ok(!JSON.stringify(tools).includes('"strict"'));
    assert.ok(JSON.stringify(original).includes('"strict":true'));
    assert.ok(!JSON.stringify(tools).includes("SEARCH_KEY"));
    assert.deepEqual(compatibleTools("https://another.example/v1", original), original);
    assert.deepEqual(compatibleTools("https://api.deepseek.com/beta", original), original);
  }
  const request = createModelRequest(settings, "help", [{ role: "user", content: "Search" }], "", []);
  const response = { choices: [{ message: { content: null, reasoning_content: "", tool_calls: [{ id: "call1", type: "function", function: { name: "web_search", arguments: '{"query":"study","max_results":2}' } }] } }] };
  const calls = readToolCalls("chat-completions", response);
  appendToolResults("chat-completions", request.body, response, calls, ['{"results":[{"url":"https://example.com","content":"verified result"}]}']);
  const messages = request.body.messages as any[];
  assert.equal(messages.at(-1).tool_call_id, "call1");
  assert.ok(messages.at(-1).content.includes("verified result"));
  assert.equal(messages.at(-2).reasoning_content, "");
});
