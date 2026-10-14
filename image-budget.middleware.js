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
// Options: {"keep": 10, "maxBytes": 0, "placeholder": "...", "agents": [], "models": []}

const LONG = 2000; // a base64 payload this long is an image; ordinary long text stays untouched

export function onRequest(body, ctx) {
  const o = (ctx && ctx.options) || {};

  // scoped to some agents or models only (magpie's agent ids, or model prefixes)
  if (Array.isArray(o.agents) && o.agents.length && !o.agents.includes(ctx.agent)) return;
  if (Array.isArray(o.models) && o.models.length) {
    const model = String((body && body.model) ?? ctx.model ?? "");
    if (!o.models.some((m) => typeof m === "string" && m && model.startsWith(m))) return;
  }

  const keep = typeof o.keep === "number" && o.keep >= 0 ? o.keep : 10;
  const maxBytes = typeof o.maxBytes === "number" && o.maxBytes > 0 ? o.maxBytes : 0;
  const ph =
    typeof o.placeholder === "string"
      ? o.placeholder
      : "[older image omitted by image-budget; ask again if you need to look at it]";

  const found = [];
  collect(body, found);
  if (!found.length) return;

  // keep the newest images while under both budgets (count and bytes); the
  // oldest that don't fit are the ones dropped
  let kept = 0;
  let bytes = 0;
  for (let i = found.length - 1; i >= 0; i--) {
    if (kept >= keep) break;
    const len = b64len(found[i].el);
    if (maxBytes > 0 && bytes + len > maxBytes) break;
    kept++;
    bytes += len;
  }
  if (kept === found.length) return;

  const dropTo = found.length - kept;
  for (let i = 0; i < dropTo; i++) {
    found[i].arr[found[i].idx] = placeholder(ctx, ph);
  }
  // magpie logs this line, capped at 60 lines/min, and only when something was dropped
  console.log(
    "image-budget: kept " + kept + " of " + found.length + " images, dropped " + dropTo +
      (maxBytes > 0 ? ", bytes " + bytes : "") +
      (ctx && ctx.model ? " | model=" + ctx.model : ""),
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
      if (isImage(node[i])) out.push({ arr: node, idx: i, el: node[i] });
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

// the size that counts against maxBytes: the payload itself (not the URI prefix)
function b64len(el) {
  const inl = el.inlineData || el.inline_data;
  if (inl && typeof inl.data === "string") return inl.data.length;
  const src = el.source;
  if (src && typeof src.data === "string") return src.data.length;
  const iu = el.image_url;
  const url = typeof iu === "string" ? iu : iu && iu.url;
  return typeof url === "string" ? url.length : 0;
}
