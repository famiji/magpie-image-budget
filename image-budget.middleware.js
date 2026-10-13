// magpie gateway middleware: image budget.
//
// Keeps only the newest base64 images in a request; every older one becomes a
// single line of placeholder text in the shape the agent's API expects. Agents
// resend the whole conversation on every turn, so once the images push the body
// past the endpoint's byte limit, every following turn fails.
//
// It can only drop images, not re-encode them: moejs has no image codec and the
// middleware cannot pull in dependencies. To keep every image and lower its
// quality instead, use the agent's own switch — for Codex, /experimental has
// unified_image_budget and resize_all_images.
//
// Options: {"keep": 10, "placeholder": "..."}

const LONG = 2000; // a base64 payload this long is an image; ordinary long text stays untouched

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
  // magpie logs this line, capped at 60 lines/min, and only when something was dropped
  const dropped = found.length - keep;
  console.log(
    "image-budget: kept " + keep + " of " + found.length + " images, dropped " + dropped + (ctx && ctx.model ? " | model=" + ctx.model : ""),
  );
  return body; // edited in place, but the contract wants the body back (undefined means "unchanged")
}

// the placeholder has to match the agent's own protocol, or the next turn fails validation
function placeholder(ctx, ph) {
  const p = ctx && ctx.protocol;
  if (p === "anthropic" || p === "chat") return { type: "text", text: ph };
  if (p === "responses") return { type: "input_text", text: ph };
  return { text: ph }; // gemini / unknown
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
  const src = el.source; // anthropic: {type:"image", source:{type:"base64", data:"<raw b64>"}}
  if (el.type === "image" && src && typeof src.data === "string" && src.data.length > LONG) return true;
  const iu = el.image_url; // chat and responses: data URI
  const url = typeof iu === "string" ? iu : iu && iu.url;
  return typeof url === "string" && url.length > LONG;
}
