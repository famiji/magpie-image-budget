import assert from "node:assert";
import { onRequest } from "./image-budget.middleware.js";

const B64 = "A".repeat(10000); // 假装 base64
const img = (n) => ({ type: "image", source: { type: "base64", media_type: "image/png", data: B64 + n } });

// 1) anthropic：6 张图，keep 2
{
  const body = {
    model: "m",
    messages: [
      { role: "assistant", content: [{ type: "tool_result", content: Array.from({ length: 6 }, (_, i) => img(i)) }] },
    ],
  };
  const before = JSON.stringify(body).length;
  onRequest(body, { protocol: "anthropic", options: { keep: 2 } });
  const c = body.messages[0].content[0].content;
  assert.equal(c.filter((x) => x.type === "image").length, 2, "只留最近 2 张");
  assert.equal(c.filter((x) => x.type === "text" && x.text.startsWith("[older")).length, 4, "4 张换占位");
  assert.equal(c[0].source, undefined, "占位里没有 base64");
  console.log(`anthropic: ${before} -> ${JSON.stringify(body).length} bytes`);
}

// 2) responses：Codex 的 function_call_output 形状，keep 1
{
  const body = {
    input: [
      {
        type: "function_call_output",
        output: [{ type: "input_text", text: "Wall time: 1.2 seconds" }, ...Array.from({ length: 5 }, () => ({ type: "input_image", image_url: "data:image/png;base64," + B64, detail: "high" }))],
      },
    ],
  };
  onRequest(body, { protocol: "responses", options: { keep: 1 } });
  const out = body.input[0].output;
  assert.equal(out.filter((x) => x.type === "input_image").length, 1);
  assert.equal(out.filter((x) => x.type === "input_text").length, 5); // 1 原有 + 4 占位
  assert.equal(out[1].detail, undefined);
}

// 3) chat：content 里的 image_url
{
  const body = { messages: [{ role: "user", content: Array.from({ length: 3 }, () => ({ type: "image_url", image_url: { url: "data:image/jpeg;base64," + B64 } })) }] };
  onRequest(body, { protocol: "chat", options: { keep: 1 } });
  const c = body.messages[0].content;
  assert.equal(c.filter((x) => x.type === "image_url").length, 1);
  assert.equal(c.filter((x) => x.type === "text").length, 2);
}

// 4) gemini
{
  const body = { contents: [{ parts: Array.from({ length: 2 }, () => ({ inlineData: { mimeType: "image/png", data: B64 } })) }] };
  onRequest(body, { protocol: "gemini", options: { keep: 0 } });
  assert.deepEqual(body.contents[0].parts.filter((p) => p.inlineData).length, 0);
}

// 5) 不超过 keep 时一个字节都不动
{
  const body = { messages: [{ role: "user", content: [img(1), img(2)] }] };
  const snapshot = JSON.stringify(body);
  onRequest(body, { protocol: "anthropic", options: { keep: 4 } });
  assert.equal(JSON.stringify(body), snapshot, "未超预算必须原样放行");
}

// 6) 没 options：默认 keep 10；没 ctx 也不能炸
{
  const body = { messages: [{ role: "user", content: Array.from({ length: 12 }, (_, i) => img(i)) }] };
  onRequest(body, undefined);
  assert.equal(body.messages[0].content.filter((x) => x.type === "image").length, 10);
}

console.log("all checks passed");
