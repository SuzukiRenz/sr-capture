# 小火箭通用抓包模块

按远程规则表抓取指定域名的 Cookie / 请求头 / 请求体 / 响应体里的值，弹窗展示、长按复制。
规则表放在远程仓库，改规则不用重装模块。

## 三个文件

| 文件 | 作用 | 能否公开 |
|---|---|---|
| `sr-capture.js` | 抓取逻辑：拉规则、匹配、正则提取、冷却去重 | ✅ 无任何密钥 |
| `sr-capture-rules.conf` | 规则表：抓哪个域名、抓什么、用什么正则 | ✅ 无任何密钥 |
| `sr-capture.sgmodule` | 模块本体，`[Argument]` 里填参数 | ✅ 本版无敏感项 |

## 安装

**方式一：直接订阅 raw 地址**

```
https://raw.githubusercontent.com/SuzukiRenz/sr-capture/main/sr-capture.sgmodule
```

小火箭 → 配置 → 模块 → 右上角 `+` → 粘贴上面地址。

**方式二：手动粘贴**

把 `sr-capture.sgmodule` 内容整段贴进去。

**必须做的额外一步**：证书要手动装，模块装不了（iOS 安全限制）。
设置 → **证书** 生成并安装 → 系统「证书信任设置」里打开小火箭开关 →
开启 **HTTPS 解密**（部分版本在「配置 → 本地文件 → 编辑」里）。
模块里的 `[MITM] hostname` 只是声明要解密的域名，不能替代上面三步。

## 参数

模块编辑页 `[Argument]`：

| 参数 | 默认 | 说明 |
|---|---|---|
| `ruleURLs` | 内置默认地址 | 规则表地址，多个用逗号分隔 |
| `cooldown` | `300` | 同一条规则多少秒内只提示一次 |
| `debug` | `0` | `1` = 未命中也弹窗，调规则时用 |

> `ruleURLs` 留空会自动用脚本里写死的默认地址，不会静默失效。

## 冷却策略

这是本模块和普通抓包脚本最大的区别，避免你被弹窗淹没。

| `cooldown` | 行为 |
|---|---|
| `> 0`（默认 300） | **冷却期内一律不提示**，不管值变没变。同一批请求里 Cookie 每跳都可能微调，但你只需要一份能用的值 |
| `0` | 关闭冷却，改为纯去重：值没变不提示，值变了才提示 |

冷却标记只在**真正弹窗时**写入。被拦下的请求不会刷新计时器，所以你静置 5 分钟后
再操作一次，一定能重新抓到。

## 规则表格式

`sr-capture-rules.conf` 是 TOML 子集，每条规则一个块：

```toml
[[rule]]
name       = "elm-cookie"                     # 唯一名，冷却按它记，别重复
enable     = true                             # false 可临时停用
host       = "waimai-guide.ele.me"            # URL 包含即命中；也可写 /正则/
pathRegex  = "uam(onekey|randcode)login"      # 可选，路径再筛一道
source     = "request.cookie"                 # 抓哪儿，见下表
headerKey  = "Authorization"                  # source 是 *.header 时必填
valueRegex = 'Bearer\s+(\S+)'                 # 默认取第 1 个捕获组
group      = 1                                # 可选，指定第几组；0 = 整段
label      = "饿了么Cookie"                    # 弹窗里显示的名字
```

### `source` 取值

| 值 | 抓什么 | 需要 |
|---|---|---|
| `request.cookie` | 请求头 Cookie | `valueRegex` |
| `request.header` | 请求头某一项 | `headerKey` + `valueRegex` |
| `request.body` | 请求体 | `valueRegex` |
| `response.cookie` | 响应 `Set-Cookie` | `valueRegex` |
| `response.header` | 响应头某一项 | `headerKey` + `valueRegex` |
| `response.body` | 响应体 | `valueRegex` |

### 改规则不用重装模块

改完 `sr-capture-rules.conf` 推到仓库即可。脚本有 10 分钟缓存（`RULES_TTL`），
到期自动拉新版。想立刻生效：小火箭里重开关一次模块，或重启小火箭。

## 弹窗效果

```
🎯 抓包命中 1 项
长按可复制

饿了么Cookie：
cookie2=2295f4b3; sid=abc; SID=MjI5; USERID=248306984; ...
```

值单独成行，长按弹窗文本即可整段复制。

## 内置规则

| 规则 | 域名 | 状态 |
|---|---|---|
| `elm-cookie` | `waimai-guide.ele.me` | 启用 |
| `cmcc-autologin` | `client.app.coc.10086.cn` | 停用 |
| `cmcc-cookie` | `wx.10086.cn` | 停用 |
| `jd-ptkey` | `jd.com` | 停用 |
| `meituan-token` | `meituan.com` | 停用 |
| `generic-bearer` / `generic-json-token` | `example.com` | 示例 |

停用的规则把 `enable` 改成 `true` 即可。

## 注意

- **HTTPS 必须装 CA 证书**，否则只有 HTTP 能抓
- 一次请求可能命中多条规则，会合并成一个弹窗（`🎯 抓包命中 N 项`）
- 状态存在 `$persistentStore`，键前缀 `sr_capture_`。想彻底重置：
  删模块重装，或把 `cooldown` 临时设 0
- `valueRegex` 写错不会报错，只是匹配不到。调规则时开 `debug=1` 看 URL 有没有命中

## 和传统写法的区别

常见做法是「每条规则配一个专用 JS」，抓完 `$notify` 固定字段。
本模块是「一个 JS + 远程规则表」，加规则只要改 conf，不用碰代码，也不用重装模块。
