# magpie-image-budget（网关中间件）

一张请求里带 base64 的图**只保留最近 N 张**，更早的换成一行占位文字。
治：历史截图（工具输出里的图）把请求体顶到上游 ~45MB 上限后，每一轮都 413。

## 装

```
magpie plugin add github:famiji/magpie-image-budget
```

或 App：Plugins → Discover → Unofficial 里找 `magpie-image-budget`（仓库带 `magpie-plugin` topic）。
本地开发/调试时也可以直接给**这个文件夹**的路径：`magpie plugin add /path/to/magpie-image-budget`。

> Options 框会**预填下面这组默认值**（从 `package.json` 的 `magpie.options` 读），不是空 `{}`。

## 设置（App 里那一行的 Options，或命令）

```
magpie plugin options image-budget '{"keep":10}'
magpie plugin options image-budget 'off'        # 清空 → 回到默认
```

| key | 默认 | 说明 |
| --- | --- | --- |
| `keep` | `10` | 保留最近的几张图（0 = 全丢）。按“图”数，不按消息数 |
| `placeholder` | `[older image omitted by image-budget; ask again if you need to look at it]` | 被丢掉的位置换成这句话，同协议形状（anthropic/chat 用 `text`、responses 用 `input_text`、gemini 用 `text`） |

不设 = 用默认。少发的图越多，请求体越小。

## 它做什么 / 不做什么

- 做：`onRequest(body, ctx)` 拿整包原始 body，遍历四种协议（anthropic / chat / responses / gemini）里带 base64 的
  图节点，从尾往前数，留最近 `keep` 张，更早的换占位。**没超就算，一个字节都不动。**
- 不做：**重编码缩图**。moejs 里没有图片编解码器、不能引依赖、没有 timer / fetch / Node API
  （`console.log` 有，写进 magpie 的日志）。
- 代价：模型回看不到老截图。所以它插的占位文字是**给模型看的提示**，模型会知道“这儿有张图被我丢了”。
- 出错：钩子抛错或超 250ms（单事件 50ms）会被当成不存在、请求原样放行。

## 看它在干活

- magpie 日志里每次真丢图都有一行：`image-budget: kept 10 of 14 images, dropped 4 | model=…`（最多 60 行/分钟）。
- Settings → Plugins 那一行显示 `onRequest` 的调用次数、平均耗时、失败数。

## 测试

```
bun test
```

用例全在 `cases.json`（9 个：四种协议各丢一遍、未超预算逐字节原样、`keep:0`、没 options 用默认 10、
自定义 placeholder、短 base64 不算图）。跑它们的是社区仓库那份宿主 `scripts/middleware.mjs` —— 和
magpie 网关调钩子的方式一致，同一份 `cases.json` 在 moejs 里也能跑。

## 要进社区仓库（`magpie-community/plugins`）

这个仓库就是按那份规范写的，只差三件事：

1. 整个文件夹拷到 `packages/image-budget/`；
2. `package.json` 的 `name` 改成 `@magpie-community/middleware-image-budget`（其余不动）；
3. `image-budget.test.mjs` 里的 import 路径改成 `../../scripts/middleware.mjs`（删掉本仓库自带的 `scripts/`）。

MIT.
