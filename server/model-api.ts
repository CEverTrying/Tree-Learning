import type { Settings } from "../src/model";

type TextMessage = { role: "user" | "assistant"; content: string };
type ImageReference = { name: string; url: string };
type JsonObject = Record<string, unknown>;
const object = (value: unknown): JsonObject =>
  value !== null && typeof value === "object" ? (value as JsonObject) : {};

export class ModelProtocolError extends Error {}
export type ToolCall = { id: string; name: string; arguments: string };

export function readToolCalls(
  apiType: Settings["apiType"],
  value: unknown,
): ToolCall[] {
  const result = object(value);
  if (
    apiType === "responses" &&
    (result.error ||
      ["failed", "cancelled", "queued", "in_progress", "incomplete"].includes(
        String(result.status),
      ))
  ) {
    readModelResponse(apiType, value);
  }
  const choice = object(
    Array.isArray(result.choices) ? result.choices[0] : undefined,
  );
  const message = object(choice.message);
  const raw =
    apiType === "responses"
      ? Array.isArray(result.output)
        ? result.output.filter((item) => object(item).type === "function_call")
        : []
      : Array.isArray(message.tool_calls)
        ? message.tool_calls
        : [];
  if (raw.length && choice.finish_reason === "length")
    throw new ModelProtocolError("工具调用输出不完整，请重试");
  const ids = new Set<string>();
  return raw.map((item) => {
    const call = object(item);
    const fn = apiType === "responses" ? call : object(call.function);
    const id = apiType === "responses" ? call.call_id : call.id;
    if (
      typeof id !== "string" ||
      !id ||
      ids.has(id) ||
      typeof fn.name !== "string" ||
      typeof fn.arguments !== "string" ||
      (apiType !== "responses" && call.type !== "function")
    ) {
      throw new ModelProtocolError("模型返回了无效的工具调用");
    }
    ids.add(id);
    return { id, name: fn.name, arguments: fn.arguments };
  });
}

export function appendToolResults(
  apiType: Settings["apiType"],
  body: JsonObject,
  value: unknown,
  calls: ToolCall[],
  outputs: string[],
) {
  const result = object(value);
  if (apiType === "responses") {
    // Replay all output, including reasoning items, when using store:false.
    body.input = [
      ...(body.input as unknown[]),
      ...(result.output as unknown[]),
      ...calls.map((call, index) => ({
        type: "function_call_output",
        call_id: call.id,
        output: outputs[index],
      })),
    ];
  } else {
    const message = object(object((result.choices as unknown[])[0]).message);
    body.messages = [
      ...(body.messages as unknown[]),
      {
        role: "assistant",
        content: message.content ?? null,
        tool_calls: message.tool_calls,
        ...(typeof message.reasoning_content === "string"
          ? { reasoning_content: message.reasoning_content }
          : {}),
      },
      ...calls.map((call, index) => ({
        role: "tool",
        tool_call_id: call.id,
        content: outputs[index],
      })),
    ];
  }
}

export function createModelRequest(
  settings: Pick<Settings, "baseUrl" | "model"> & {
    apiType?: Settings["apiType"];
  },
  instructions: string,
  messages: TextMessage[],
  context: string,
  images: ImageReference[],
) {
  const apiType = settings.apiType ?? "chat-completions";
  if (!["chat-completions", "responses"].includes(apiType))
    throw new ModelProtocolError("不支持的接口类型");
  const url = new URL(settings.baseUrl.trim());
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new ModelProtocolError("请填写不含查询参数的 HTTP(S) API 基础地址");
  }
  // Accept a base URL or a pasted endpoint without duplicating its suffix.
  url.pathname =
    url.pathname
      .replace(/\/+$/, "")
      .replace(/\/(?:chat\/completions|responses)$/, "") +
    (apiType === "responses" ? "/responses" : "/chat/completions");
  const input: { role: string; content: unknown }[] = messages.map((m) => ({
    role: m.role,
    content: m.content,
  }));
  if (context) {
    let last = input.at(-1);
    if (!last || last.role !== "user") {
      last = { role: "user", content: "请根据引用资料回答。" };
      input.push(last);
    }
    last.content = `以下是本次提问已提供的资料正文与参考对话，请根据问题使用相关内容。\n<reference>\n${context}\n</reference>\n\n【本次问题】\n${last.content}`;
  }
  if (images.length) {
    let last = input.at(-1);
    if (!last || last.role !== "user") {
      last = { role: "user", content: "引用图片" };
      input.push(last);
    }
    last.content =
      apiType === "responses"
        ? [
            { type: "input_text", text: last.content },
            ...images.flatMap((image) => [
              { type: "input_text", text: `引用图片：${image.name}` },
              { type: "input_image", image_url: image.url, detail: "auto" },
            ]),
          ]
        : [
            { type: "text", text: last.content },
            ...images.flatMap((image) => [
              { type: "text", text: `引用图片：${image.name}` },
              { type: "image_url", image_url: { url: image.url } },
            ]),
          ];
  }
  const body: JsonObject =
    apiType === "responses"
      ? {
          model: settings.model.trim(),
          instructions,
          input,
          store: false,
          stream: false,
          truncation: "disabled",
        }
      : {
          model: settings.model.trim(),
          messages: [{ role: "system", content: instructions }, ...input],
          stream: false,
        };
  return { url, body, apiType };
}

export function readModelResponse(
  apiType: Settings["apiType"],
  value: unknown,
): string {
  const result = object(value);
  if (apiType === "chat-completions") {
    const first = Array.isArray(result.choices)
      ? object(result.choices[0])
      : {};
    const message = object(first.message);
    if (typeof message.refusal === "string" && message.refusal.trim())
      return message.refusal;
    if (typeof message.content === "string" && message.content.trim())
      return message.content;
  } else {
    if (
      result.error ||
      ["failed", "cancelled", "queued", "in_progress", "incomplete"].includes(
        String(result.status),
      )
    ) {
      const reason = object(result.incomplete_details).reason;
      throw new ModelProtocolError(
        reason === "max_output_tokens"
          ? "模型输出达到长度限制，回答未完成，请缩小问题范围后重试。"
          : "Responses API 未完成回答，请检查模型服务后重试。",
      );
    }
    const output = Array.isArray(result.output) ? result.output : [];
    const parts = output.flatMap((item) => {
      const message = object(item);
      if (
        message.type !== "message" ||
        message.role !== "assistant" ||
        !Array.isArray(message.content)
      )
        return [];
      return message.content.flatMap((part) => {
        const content = object(part);
        if (content.type === "output_text" && typeof content.text === "string")
          return [content.text];
        if (content.type === "refusal" && typeof content.refusal === "string")
          return [content.refusal];
        return [];
      });
    });
    if (parts.join("").trim()) return parts.join("\n\n");
    if (typeof result.output_text === "string" && result.output_text.trim())
      return result.output_text;
  }
  throw new ModelProtocolError(
    "模型没有返回文本，请检查接口类型与模型兼容性。",
  );
}
