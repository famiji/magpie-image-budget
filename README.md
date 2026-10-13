# magpie-image-budget

A [magpie](https://usemagpie.ai) gateway middleware that keeps only the **newest N base64 images** in a request and turns older ones into a line of text.

Agents resend the whole conversation on every turn. A long session that picked up screenshots — from an image-reading tool, say — therefore grows until the request body passes the endpoint's byte limit, and from then on **every** turn fails with `413 Payload Too Large`. Dropping the images that are no longer in play keeps such a session usable.

Install it from magpie's **Plugins › Discover**, or with `magpie plugin add github:famiji/magpie-image-budget`. Then set its options under **Plugins › Installed › Options**, or with `magpie plugin options image-budget '<json>'`.

## Options

```json
{ "keep": 10, "placeholder": "[older image omitted by image-budget; ask again if you need to look at it]" }
```

| Field | |
| --- | --- |
| `keep` | How many of the newest images to keep (default `10`; `0` drops them all). Counted per image, not per message. |
| `placeholder` | What a dropped image becomes, in that API's own shape: `text` for Anthropic, Chat and Gemini, `input_text` for Responses. Defaults to the line above. |

A request that is under the budget is left byte for byte alone.

## What it sees

`onRequest` is handed the whole body, so it finds images in each of the four shapes magpie proxies: Anthropic `{"type":"image","source":{"type":"base64","data":…}}` (including inside a `tool_result`), Chat `{"type":"image_url","image_url":"data:…"}`, Responses `{"type":"input_image","image_url":"data:…"}` and Gemini `{"inlineData":{"data":…}}`. A base64 string shorter than 2000 characters is not taken for an image.

## Limits

- It **cannot re-encode or resize** an image. Gateway middleware runs in magpie's own process on [moejs](https://usemagpie.ai/docs/plugins#middleware): one file, imports nothing, no Node APIs, no timers. Downscaling belongs to the agent — Codex has `unified_image_budget` and `resize_all_images` under `/experimental`.
- A replaced image is gone for the model. The placeholder says so, so the model can ask to look again.
- If the middleware throws or runs past its time budget (250ms per request, 50ms per event), magpie sends the request as it came.

## Seeing it work

Every request that drops something logs one line into magpie's log — `image-budget: kept 10 of 14 images, dropped 4 | model=…` — and **Settings › Plugins** shows the row's `onRequest` call count, average time and failures.

## Tests

```
bun test
```

The 9 cases are in `cases.json` and run through `scripts/middleware.mjs`, the harness `magpie-community/plugins` uses: it calls the hooks the way the gateway does, so the same `cases.json` runs inside magpie on moejs.

MIT.

中文：magpie 网关中间件 —— 一张请求里带 base64 的图只保留最近 N 张，更早的换成一行占位文字。装：`magpie plugin add github:famiji/magpie-image-budget`。治「历史截图把请求体顶过上游字节上限、之后每轮都 413」的会话。它只能丢图，不能缩图（moejs 里没有图片编解码器）；配置 `keep` / `placeholder`，App 里 Plugins › Installed › Options 改。
