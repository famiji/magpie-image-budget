// magpie 网关中间件：图片预算。
// 一张请求里带 base64 的图只保留最近 keep 张，更早的换成一行占位文字。
// 治的病：历史截图把请求体顶到上游 ~45MB 上限后，每一轮都 413（Codex 那次）。
//
// 装：magpie plugin add github:famiji/magpie-image-budget
//     （源码在 /Users/fmj/Scripts/misc-scripts/magpie-image-budget，本地调试可以给那个文件夹路径）
// 调：magpie plugin options image-budget '{"keep":10}' 或 App 里那一行的 Options
//     keep 不设就是 10；placeholder 不设就是下面这一句
// 卸：magpie plugin remove magpie-image-budget
// 测：bun test（用例在 cases.json，跑的是社区仓库那份 scripts/middleware.mjs 宿主）
//
// 只能丢图，不能重编码缩图 —— moejs 里没有图片编解码器、也不能引依赖。
// 要真缩图（图都留着、只降质）得走客户端开关：Codex /experimental 的
// unified_image_budget / resize_all_images。

const LONG = 2000; // 超过这么长的 base64 才算图，避免误伤普通长文本

export function onRequest(body, ctx) {
  const o = (ctx && ctx.options) || {};
  const keep = typeof o.keep === "number" && o.keep >= 0 ? o.keep : 10;
  const ph =
    typeof o.placeholder === "string"
      ? o.placeholder
      : "[older image omitted by image-budget; ask again if you need to look at it]";
  const found = [];
  collect(body, found);
  if (found.length <= keep) return;
  for (let i = 0; i < found.length - keep; i++) {
    found[i].arr[found[i].idx] = placeholder(ctx, ph);
  }
  // 进 magpie 日志（最多 60 行/分钟），只在真丢了东西时说话
  const dropped = found.length - keep;
  console.log(
    "image-budget: kept " + keep + " of " + found.length + " images, dropped " + dropped + (ctx && ctx.model ? " | model=" + ctx.model : ""),
  );
  return body; // 改动是原地做的，但契约上要回传 body（undefined 等于“原样”，用例里会被当成没改）
}

// 占位节点要跟 agent 自己的协议同形，否则下一轮校验不过
function placeholder(ctx, ph) {
  const p = ctx && ctx.protocol;
  if (p === "anthropic" || p === "chat") return { type: "text", text: ph };
  if (p === "responses") return { type: "input_text", text: ph };
  return { text: ph }; // gemini / 未知
}

function collect(node, out) {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (let i = 0; i < node.length; i++) {
      if (isImage(node[i])) out.push({ arr: node, idx: i });
      else collect(node[i], out);
    }
    return;
  }
  for (const k in node) collect(node[k], out);
}

function isImage(el) {
  if (!el || typeof el !== "object" || Array.isArray(el)) return false;
  const inl = el.inlineData || el.inline_data; // gemini
  if (inl && typeof inl.data === "string" && inl.data.length > LONG) return true;
  const src = el.source; // anthropic: {type:"image",source:{type:"base64",data:"<raw b64>"}}
  if (el.type === "image" && src && typeof src.data === "string" && src.data.length > LONG) return true;
  const iu = el.image_url; // chat 与 responses: data URI
  const url = typeof iu === "string" ? iu : iu && iu.url;
  return typeof url === "string" && url.length > LONG;
}
