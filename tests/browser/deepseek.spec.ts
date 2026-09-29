import { test, expect } from "@playwright/test";
import { defaultSettings } from "../../src/model";

test("DeepSeek preset configures model and Tavily search and persists settings", async ({ page, request }) => {
  await request.put('/api/settings', {data:{...defaultSettings,baseUrl:'https://another.example/v1',apiKey:'OLD_KEY'}});
  await page.goto('/');
  await page.getByRole('button',{name:'模型设置',exact:true}).click();
  await page.getByRole('button',{name:'DeepSeek Flash',exact:true}).click();
  await expect(page.getByLabel('API 地址',{exact:true})).toHaveValue('https://api.deepseek.com');
  await expect(page.getByLabel('模型名称',{exact:true})).toHaveValue('deepseek-flash');
  await expect(page.getByLabel('API 密钥',{exact:true})).toHaveValue('');
  await page.getByLabel('联网搜索',{exact:true}).check();
  await expect(page.getByRole('combobox',{name:'搜索服务',exact:true})).toHaveValue('tavily');
  await expect(page.getByRole('option',{name:'OpenAI 内置搜索（Responses API）'})).toHaveJSProperty('disabled', true);
  await page.getByLabel('Tavily API 密钥',{exact:true}).fill('SEARCH_TEST_KEY');
  await page.getByRole('button',{name:'DeepSeek V4 Pro',exact:true}).click();
  await page.getByRole('button',{name:'保存设置',exact:true}).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const saved = await (await request.get('/api/settings')).json();
  expect(saved.model).toBe('deepseek-v4-pro');
  expect(saved.webEnabled).toBe(true);
  expect(saved.webProvider).toBe('tavily');
});
