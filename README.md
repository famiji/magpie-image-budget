# magpie-image-budget

A [magpie](https://usemagpie.ai) gateway middleware that keeps only the **newest N base64 images** in a request and turns older ones into a line of text — or keeps the newest images until a **byte budget** is spent.

Agents resend the whole conversation on every turn. A long session that picked up screenshots — from an image-reading tool, say — therefore grows until the request body passes the endpoint's byte limit, and from then on **every** turn fails with `413 Payload Too Large`. An endpoint that also caps the pixels per side rejects the request over one oversized image at any age. Dropping the images that are no longer in play, and the oversized ones, keeps such a session usable.

Install it from magpie's **Plugins › Discover**, or with `magpie plugin add github:famiji/magpie-image-budget`. Then set its options under **Plugins › Installed › Options**, or with `magpie plugin options image-budget '<json>'`.

## Options

```json
{ "keep": 10,
  "maxBytes": 0,
  "maxDimension": 8192,
  "placeholder": "[older image omitted by image-budget; ask again if you need to look at it]",
  "agents": [],
  "models": [] }
```

| Field | |
| --- | --- |
| `keep` | How many of the newest images to keep (default `10`; `0` drops them all). Counted per image, not per message. |
| `maxBytes` | The byte budget: keep the newest images while their combined payload stays under it. `0` (the default) counts images only. |
| `maxDimension` | The pixel budget: an image wider or taller than this is dropped whatever its age. Default `8192`. `0` turns the check off. |
| `placeholder` | What a dropped image becomes, in that API's own shape: `text` for Anthropic, Chat and Gemini, `input_text` for Responses. Defaults to the line above. |
| `agents` | When given, trim only requests from these agents, by magpie's agent ids (`codex`, `claude`, `opencode`, …). An empty list (the default) applies to every agent. |
| `models` | When given, trim only requests whose model name begins with one of these prefixes. An empty list (the default) applies to every model. |

The pixel size is read from the base64 at the front of a PNG or JPEG (a JPEG's frame header is searched for in the first 4 KB, then the first 64 KB, since a large EXIF block can push it back); an image in another format, or one the reader cannot make sense of, is left alone. A number of endpoints cap a side at 8000 or 8192 pixels and reject the whole request over one image past it, so the default is on. A request that is under every budget is left byte for byte alone.

### An example

Only Codex, and never more than the last few images or 1 MB of payload:

```json
{ "keep": 4, "maxBytes": 1000000, "agents": ["codex"] }
```

## What it sees

`onRequest` is handed the whole body, so it finds images in each of the four shapes magpie proxies: Anthropic `{"type":"image","source":{"type":"base64","data":…}}` (including inside a `tool_result`), Chat `{"type":"image_url","image_url":"data:…"}`, Responses `{"type":"input_image","image_url":"data:…"}` and Gemini `{"inlineData":{"data":…}}`. A base64 string shorter than 2000 characters is not taken for an image.

## Limits

- It **reads image headers, but cannot re-encode or resize** an image. Gateway middleware runs in magpie's own process on [moejs](https://usemagpie.ai/docs/plugins#middleware): one file, imports nothing, no Node APIs, no timers — so the pixel check decodes a few dozen base64 characters by hand rather than pulling in a codec. Downscaling belongs to the agent — Codex has `unified_image_budget` and `resize_all_images` under `/experimental`.
- A replaced image is gone for the model. The placeholder says so, so the model can ask to look again.
- If the middleware throws or runs past its time budget (250ms per request, 50ms per event), magpie sends the request as it came.

## Seeing it work

Every request that drops something logs one line into magpie's log — `image-budget: kept 10 of 14 images, dropped 4 | model=…` (with `, oversized 1` when `maxDimension` dropped one, and `, bytes 4000000` when `maxBytes` is set) — and **Settings › Plugins** shows the row's `onRequest` call count, average time and failures.

## Tests

```
bun test
```

The 20 cases are in `cases.json` and run through `scripts/middleware.mjs`, the harness `magpie-community/plugins` uses: it calls the hooks the way the gateway does, so the same `cases.json` runs inside magpie on moejs.

## License

MIT — see [LICENSE](LICENSE).

中文：magpie 网关中间件，按张数、字节或像素预算保留请求里的图片，更早的、以及单边超尺寸的替换成一行占位文字，避免长会话请求体超限或单张大图撑爆端点而全部失败。可按 agent 或模型限定生效范围。
