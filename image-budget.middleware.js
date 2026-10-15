// magpie gateway middleware: image budget.
//
// Keeps only the newest base64 images in a request; every older one becomes a
// single line of placeholder text in the shape the agent's API expects. Agents
// resend the whole conversation on every turn, so once the images push the body
// past the endpoint's byte limit, every following turn fails.
//
// An image whose pixels are larger than the provider's limit is dropped too,
// whatever its age: one such image makes the provider reject the whole request
// even when the body is far under the context window.
//
// It can only drop images, not re-encode them: moejs has no image codec and the
// middleware cannot pull in dependencies. To keep every image and lower its
// quality instead, use the agent's own switch — for Codex, /experimental has
// unified_image_budget and resize_all_images.
//
// Options: {"keep": 10, "maxBytes": 0, "maxDimension": 8192, "placeholder": "...", "agents": [], "models": []}

const LONG = 2000; // a base64 payload this long is an image; ordinary long text stays untouched
const DEF_DIM = 8192; // pixels per side; opencode's zen and volcengine ark both reject more
const JPEG_SCAN = [4096, 65536]; // a JPEG's SOF marker is near the front, unless a big EXIF block pushes it back

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
  const maxDim = typeof o.maxDimension === "number" && o.maxDimension > 0 ? o.maxDimension : DEF_DIM;
  const ph =
    typeof o.placeholder === "string"
      ? o.placeholder
      : "[older image omitted by image-budget; ask again if you need to look at it]";

  const found = [];
  collect(body, found);
  if (!found.length) return;

  // oversized first: these go whatever their age, and they take no keep slot
  const oversize = new Set();
  for (let i = 0; i < found.length; i++) {
    const d = dims(found[i].el);
    if (d && (d[0] > maxDim || d[1] > maxDim)) oversize.add(i);
  }

  // keep the newest images while under both budgets (count and bytes); the
  // oldest that don't fit are the ones dropped
  let kept = 0;
  let bytes = 0;
  const keepAt = new Set();
  for (let i = found.length - 1; i >= 0; i--) {
    if (oversize.has(i)) continue;
    if (kept >= keep) break;
    const len = b64len(found[i].el);
    if (maxBytes > 0 && bytes + len > maxBytes) break;
    kept++;
    bytes += len;
    keepAt.add(i);
  }

  let dropTo = 0;
  for (let i = 0; i < found.length; i++) {
    if (keepAt.has(i)) continue;
    found[i].arr[found[i].idx] = placeholder(ctx, ph);
    dropTo++;
  }
  if (!dropTo) return; // nothing to drop: leave the body untouched

  // magpie logs this line, capped at 60 lines/min, and only when something was dropped
  console.log(
    "image-budget: kept " + kept + " of " + found.length + " images, dropped " + dropTo +
      (oversize.size ? ", oversized " + oversize.size : "") +
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
  return payload(el).length;
}

// the base64 payload of an image element, without any data URI prefix
function payload(el) {
  const inl = el.inlineData || el.inline_data;
  if (inl && typeof inl.data === "string") return inl.data;
  const src = el.source;
  if (src && typeof src.data === "string") return src.data;
  const iu = el.image_url;
  const url = typeof iu === "string" ? iu : iu && iu.url;
  if (typeof url !== "string") return "";
  const at = url.indexOf(";base64,");
  return at >= 0 ? url.slice(at + 8) : url;
}

// Pixel size of an image, read from the front of its base64 payload. null when it
// cannot be read (another format, or the marker sits deeper than we decode) and
// the image is then left alone.
function dims(el) {
  const s = payload(el);
  if (!s) return null;
  const head = b64bytes(s, 64);
  if (head.length >= 24 && head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47) {
    return [be32(head, 16), be32(head, 20)]; // PNG: IHDR width and height
  }
  if (head.length >= 2 && head[0] === 0xff && head[1] === 0xd8) {
    for (const n of JPEG_SCAN) {
      const d = jpegDims(b64bytes(s, n));
      if (d) return d;
    }
  }
  return null;
}

function jpegDims(b) {
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) {
      i++;
      continue;
    }
    const m = b[i + 1];
    if (m === 0x01 || (m >= 0xd0 && m <= 0xd8)) {
      i += 2; // standalone marker, no length
      continue;
    }
    if (m === 0xda || m === 0xd9) return null; // scan data starts: no frame header ahead
    const len = (b[i + 2] << 8) | b[i + 3];
    if (len < 2) return null;
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
      return [(b[i + 7] << 8) | b[i + 8], (b[i + 5] << 8) | b[i + 6]]; // SOF: width, height
    }
    i += 2 + len;
  }
  return null;
}

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

// decode the first n bytes of a base64 string (padding and line breaks skipped),
// by hand: moejs hands us no atob and no Buffer
function b64bytes(s, n) {
  const out = new Uint8Array(n);
  let o = 0;
  let bits = 0;
  let acc = 0;
  for (let i = 0; i < s.length && o < n; i++) {
    const v = B64.indexOf(s.charAt(i));
    if (v < 0) continue;
    acc = (acc << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[o++] = (acc >> bits) & 255;
    }
  }
  return out.subarray(0, o);
}

function be32(b, i) {
  return ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;
}
