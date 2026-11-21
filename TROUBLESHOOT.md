# 小火箭模块完全不响应 —— 排查清单

## 一、最可能的原因：脚本拉不下来

小火箭拿到 sgmodule 后，还要去 `script-path` 下载 JS。如果这一步失败，
**模块会静默失效，不弹任何东西**。

验证地址（在你手机上用 Safari 打开，不是电脑）：

```
https://raw.githubusercontent.com/SuzukiRenz/sr-capture/main/sr-capture.js
```

- 能直接看到 JS 代码 → 地址通
- 空白/转圈/超时 → **被墙了，必须换 CDN**

国内直连 `raw.githubusercontent.com` 经常不通。如果打不开，把 sgmodule 里所有
`https://raw.githubusercontent.com/...` 换成 jsDelivr：

```
https://fastly.jsdelivr.net/gh/SuzukiRenz/sr-capture@main/sr-capture.js
https://fastly.jsdelivr.net/gh/SuzukiRenz/sr-capture@main/sr-capture.sgmodule
https://fastly.jsdelivr.net/gh/SuzukiRenz/sr-capture@main/sr-capture-rules.conf
```

注意 jsDelivr 的路径格式是 `gh/用户/仓库@分支/文件`，和 raw 不一样。

## 二、模块没启用

小火箭 → 配置 → 模块，找到「通用抓包提取」，确认：

- 开关是**绿色**（打开）
- 不是灰色/灰色带感叹号

灰色带感叹号 = 加载失败，长按看错误信息。

## 三、证书与 HTTPS 解密

小火箭的模块里写 `[MITM] hostname = %APPEND% 域名...`，作用是声明「这些域名的 HTTPS
需要解密」。但这个声明**只是必要条件**，真正生效还依赖两项 App 级设置：

| 操作 | 位置 |
|---|---|
| 生成并安装证书 | 设置 → 证书（Certificate）→ 生成新的证书 → 安装 |
| 信任证书 | 系统设置 → 通用 → 关于本机 → 证书信任设置 → 打开小火箭开关 |
| 开启全局解密 | 设置 → HTTPS 解密开关；部分版本在「配置 → 本地文件 → 编辑」里 |

**模块本身装不了证书**，这是 iOS 的安全限制，只能手动操作。

HTTPS 抓不到时按这个顺序查：
1. 证书装了吗（设置 → 证书，里面能看到已安装的证书）
2. 系统里信任了吗（证书信任设置里那个开关）
3. 全局解密开了吗
4. 模块里 `[MITM]` 的 hostname 包含目标域名吗

## 四、规则表为空

即使脚本跑起来了，规则表拉不到也不会弹窗（除非 debug=1）。
把模块参数 `debug` 改成 `1`，然后随便开个网页——如果弹出「🔍 未命中」，
说明脚本在跑，是规则匹配问题；如果还是没动静，是脚本压根没加载。

## 五、pattern 写法的隐患

当前 sgmodule 是：

```
pattern=^https?:\/\/,requires-body=1,max-size=0
```

这会让**每个 HTTP 请求**都触发脚本，`requires-body=1` 还会让小火箭为每个请求
缓冲响应体。请求一多，小火箭可能因为开销过大而丢弃部分脚本执行。

建议改成白名单 pattern，只匹配你真正要抓的域名。这也是最稳的做法。
