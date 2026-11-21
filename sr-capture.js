/*
 * Shadowrocket 通用抓包提取模块
 * ============================================================
 * 规则表远程加载，改规则不用重装模块。
 * 抓到值后弹窗展示（可长按复制），带冷却去重，不会重复骚扰。
 *
 * 设计目标：
 *   1. 通用 —— 域名/来源/正则/显示名全在远程 conf 里配
 *   2. 可同步更新 —— 规则表放 GitHub，小火箭每次拉最新
 *   3. 好复制 —— 弹窗里值单独成行，长按即可复制
 *   4. 不重复 —— 同一规则在冷却期内只提示一次；值没变也不提示
 *
 * 模块参数（sgmodule [Argument] 里填）：
 *   ruleURLs  规则表地址，多个用逗号分隔
 *   cooldown  冷却秒数，默认 300
 *   debug     1 = 未命中也弹窗，默认 0
 * ============================================================
 */

const CFG = {
  ruleURLs: (typeof $argument !== 'undefined' && $argument && $argument.ruleURLs) || '',
  cooldown: parseInt((typeof $argument !== 'undefined' && $argument && $argument.cooldown) || '300', 10),
  debug: parseInt((typeof $argument !== 'undefined' && $argument && $argument.debug) || '0', 10),
};

// 规则表地址兜底：模块参数没填时用这个默认值。
// 小火箭某些版本会丢弃未修改的 Argument 项，写死一份能保证开箱可用。
const DEFAULT_RULE_URL =
  'https://raw.githubusercontent.com/SuzukiRenz/sr-capture/main/sr-capture-rules.conf';

// 规则表缓存键 / 冷却状态键
const STORE_RULES = 'sr_capture_rules_v1';
const STORE_RULES_AT = 'sr_capture_rules_at_v1';
const STORE_COOLDOWN = 'sr_capture_cooldown_v1';
const STORE_LASTVAL = 'sr_capture_lastval_v1';
const STORE_INITED = 'sr_capture_inited_v1';

// 规则表缓存有效期（秒），到期才重新拉，避免每条请求都请求一次
const RULES_TTL = 600;

function notify(title, sub, body) {
  if (typeof $notify !== 'function') {
    console.log(title + ' | ' + sub + '\n' + body);
    return;
  }
  $notify(title, sub || '', body || '');
}

/* ---------------- 远程规则表 ---------------- */

// 拉取单个规则表。小火箭里 $httpClient 同步返回 {status, body}
function fetchText(url) {
  return new Promise((resolve) => {
    const done = (err, resp, data) => {
      if (err || !resp || resp.status !== 200) {
        resolve('');
        return;
      }
      resolve(data || resp.body || '');
    };
    try {
      $httpClient.get({ url: url, timeout: 15 }, done);
    } catch (e) {
      resolve('');
    }
  });
}

/*
 * 极简 TOML 子集解析器，只认我们需要的东西：
 *   [[rule]]          块开始
 *   key = value       value 支持 "字符串" / '字符串' / true / false / 数字
 * 注释用 #。这样规则表既好写又好读。
 */
function parseRules(text) {
  const out = [];
  let cur = null;
  const lines = String(text || '').split(/\r?\n/);

  for (let raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;

    if (/^\[\[\s*rule\s*\]\]$/i.test(line)) {
      if (cur) out.push(cur);
      cur = {};
      continue;
    }
    if (!cur) continue;

    const m = line.match(/^([A-Za-z_][\w]*)\s*=\s*(.+)$/);
    if (!m) continue;

    const key = m[1];
    let val = m[2].trim();

    // 去掉行尾注释（引号内不算）
    if (!/^['"]/.test(val)) {
      const i = val.indexOf('#');
      if (i >= 0) val = val.slice(0, i).trim();
    }

    if ((val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    } else if (val === 'true') {
      val = true;
    } else if (val === 'false') {
      val = false;
    } else if (/^-?\d+$/.test(val)) {
      val = parseInt(val, 10);
    }
    cur[key] = val;
  }
  if (cur) out.push(cur);
  return out;
}

function loadRulesCached() {
  const now = Math.floor(Date.now() / 1000);
  const at = parseInt($persistentStore.read(STORE_RULES_AT) || '0', 10);
  const cached = $persistentStore.read(STORE_RULES);

  if (cached && now - at < RULES_TTL) {
    try {
      return JSON.parse(cached);
    } catch (e) { /* 缓存坏了就重拉 */ }
  }
  return null;
}

function saveRules(rules) {
  $persistentStore.write(JSON.stringify(rules), STORE_RULES);
  $persistentStore.write(String(Math.floor(Date.now() / 1000)), STORE_RULES_AT);
}

async function getRules() {
  const cached = loadRulesCached();
  if (cached) return cached;

  const raw = (CFG.ruleURLs || DEFAULT_RULE_URL);
  const urls = String(raw).split(',').map(s => s.trim()).filter(Boolean);
  if (!urls.length) return [];

  let all = [];
  let fetchedOk = 0;
  const fails = [];
  for (const u of urls) {
    const text = await fetchText(u);
    if (!text) { fails.push(u); continue; }
    fetchedOk++;
    all = all.concat(parseRules(text));
  }
  // 只留启用且填了必要字段的规则
  all = all.filter(r => r && r.enable !== false && r.host && r.source);

  // 拉取失败/解析为空时给出可见提示，否则模块会静默失效，
  // 用户只看到「模块没反应」，根本不知道是网络还是配置问题。
  if (!fetchedOk) {
    notify('❌ 抓包模块：规则表拉取失败',
      '可能是网络无法访问 raw.githubusercontent.com',
      '失败地址：\n' + fails.join('\n') +
      '\n\n解决：把规则表地址换成 jsDelivr 镜像\n' +
      'https://fastly.jsdelivr.net/gh/SuzukiRenz/sr-capture@main/sr-capture-rules.conf');
    return [];
  }
  if (!all.length) {
    notify('⚠️ 抓包模块：规则表为空',
      '拉到了内容但没有可用规则',
      '检查 enable/host/source 字段是否填对');
    return [];
  }

  saveRules(all);
  return all;
}

/* ---------------- 取值 ---------------- */

function headerValue(headers, name) {
  if (!headers || !name) return '';
  const lower = String(name).toLowerCase();
  for (const k in headers) {
    if (k.toLowerCase() === lower) return headers[k];
  }
  return '';
}

function pickSource(rule) {
  const req = (typeof $request !== 'undefined' && $request) || {};
  const res = (typeof $response !== 'undefined' && $response) || {};
  switch (rule.source) {
    case 'request.cookie':   return headerValue(req.headers, 'Cookie');
    case 'request.header':   return headerValue(req.headers, rule.headerKey);
    case 'request.body':     return req.body || '';
    case 'response.cookie':  return headerValue(res.headers, 'Set-Cookie');
    case 'response.header':  return headerValue(res.headers, rule.headerKey);
    case 'response.body':    return res.body || '';
    default:                 return '';
  }
}

/*
 * 按正则取值。
 * 默认取第 1 个捕获组（没有捕获组就取整个匹配），
 * 用 group 字段可以指定取第几组或取整段。
 */
function extract(text, rule) {
  if (!text) return '';
  let re;
  try {
    re = new RegExp(rule.valueRegex || '', rule.caseSensitive ? '' : 'i');
  } catch (e) {
    return '';
  }
  const m = re.exec(text);
  if (!m) return '';
  if (rule.group === 0 || rule.group === '0') return m[0];
  const idx = parseInt(rule.group, 10);
  if (!isNaN(idx) && idx > 0) return m[idx] || '';
  return m[1] !== undefined ? m[1] : m[0];
}

/* ---------------- 冷却 & 去重 ---------------- */

function cooldownOk(key) {
  const now = Math.floor(Date.now() / 1000);
  let map = {};
  try {
    map = JSON.parse($persistentStore.read(STORE_COOLDOWN) || '{}');
  } catch (e) { map = {}; }

  const last = map[key] || 0;
  if (now - last < CFG.cooldown) return false;

  map[key] = now;
  // 清理超过一天的键，防止无限膨胀
  for (const k in map) {
    if (now - map[k] > 86400) delete map[k];
  }
  $persistentStore.write(JSON.stringify(map), STORE_COOLDOWN);
  return true;
}

function valueChanged(key, value) {
  let map = {};
  try {
    map = JSON.parse($persistentStore.read(STORE_LASTVAL) || '{}');
  } catch (e) { map = {}; }

  const changed = map[key] !== value;
  if (changed) {
    map[key] = value;
    $persistentStore.write(JSON.stringify(map), STORE_LASTVAL);
  }
  return changed;
}

/*
 * 是否值得提示 —— 冷却优先。
 *
 *   cooldown > 0：冷却期内一律不提示，不管值变没变。
 *                 这是防止刷屏的关键：同一批请求里 Cookie 每跳都可能微调，
 *                 但用户只需要拿到一份可用的值。
 *   cooldown = 0：只按「值是否变化」判断，值变就提示。
 *
 * 冷却标记只在真正弹窗时写，被拦下的请求不会刷新计时器。
 */
function shouldNotify(ruleName, value) {
  if (CFG.cooldown > 0) {
    const now = Math.floor(Date.now() / 1000);
    let map = {};
    try { map = JSON.parse($persistentStore.read(STORE_COOLDOWN) || '{}'); } catch (e) { map = {}; }
    if (now - (map[ruleName] || 0) < CFG.cooldown) return false;
    // 冷却已过，允许提示；顺手更新值记录，便于排查
    valueChanged(ruleName, value);
    return true;
  }
  return valueChanged(ruleName, value);
}

function markNotified(key) {
  const now = Math.floor(Date.now() / 1000);
  let map = {};
  try {
    map = JSON.parse($persistentStore.read(STORE_COOLDOWN) || '{}');
  } catch (e) { map = {}; }
  map[key] = now;
  for (const k in map) {
    if (now - map[k] > 86400) delete map[k];
  }
  $persistentStore.write(JSON.stringify(map), STORE_COOLDOWN);
}

/* ---------------- 主流程 ---------------- */

// 统一主机名格式：取 host、转小写、去掉尾部点、去掉端口。
// 不统一的话 "WWW.Example.COM." 这种写法会漏匹配。
function normalizeHost(input) {
  let s = String(input || '').trim();
  // 传进来的可能是完整 URL
  const m = s.match(/^https?:\/\/([^\/?#]+)/i);
  if (m) s = m[1];
  s = s.toLowerCase();
  s = s.replace(/:\d+$/, '');     // 去端口
  s = s.replace(/^\.+/, '');      // 去前导点
  s = s.replace(/\.+$/, '');      // 去尾部点
  return s;
}

function matchRules(rules, url) {
  const host = normalizeHost(url);
  return rules.filter((r) => {
    // host 支持域名后缀匹配，也支持写成 /正则/
    if (typeof r.host === 'string' && r.host.startsWith('/') && r.host.endsWith('/')) {
      try {
        return new RegExp(r.host.slice(1, -1), 'i').test(url);
      } catch (e) { return false; }
    }
    const h = normalizeHost(r.host);
    return host === h || host.endsWith('.' + h);
  }).filter((r) => {
    if (!r.pathRegex) return true;
    try {
      return new RegExp(r.pathRegex).test(url);
    } catch (e) { return false; }
  });
}

async function main() {
  const url = (typeof $request !== 'undefined' && $request && $request.url)
    || (typeof $response !== 'undefined' && $response && $response.url) || '';

  const rules = await getRules();
  if (!rules.length) {
    return;   // getRules 内部已经弹过具体原因了
  }

  // 首次成功加载规则时提示一次，让用户确知模块活着。
  // 否则「装好了但没反应」无从判断到底是没加载、还是没命中。
  const seen = $persistentStore.read(STORE_INITED);
  if (!seen) {
    $persistentStore.write('1', STORE_INITED);
    notify('✅ 抓包模块已就绪',
      '已加载 ' + rules.length + ' 条规则',
      rules.map(r => (r.enable === false ? '○ ' : '● ') + r.label).join('\n'));
    return;
  }

  // .sgmodule 用通配 pattern 后会收到所有请求，这里先做最廉价的域名预筛，
  // 不命中就直接返回，不做正则、不碰 body，尽量把开销压到最低。
  const host = normalizeHost(url);
  if (!host) return;
  const candidates = rules.filter((r) => {
    if (r.enable === false) return false;
    const h = normalizeHost(r.host);
    if (!h) return false;
    if (String(r.host || '').startsWith('/')) return true;   // 正则形式，交给后续匹配
    // 精确相等或子域名后缀匹配。不能用 indexOf ——
    // "waimai-guide.ele.me.evil.com" 会因为包含 "waimai-guide.ele.me" 而误命中，
    // 那等于把 Cookie 往仿冒站点上送。
    return host === h || host.endsWith('.' + h);
  });
  if (!candidates.length) {
    if (CFG.debug === 1) notify('🔍 未命中', '', host);
    return;
  }

  const matched = matchRules(candidates, url);
  if (!matched.length) {
    if (CFG.debug === 1) notify('🔍 未命中', '', url);
    return;
  }

  const hits = [];
  for (const rule of matched) {
    const source = pickSource(rule);
    const value = extract(source, rule);
    if (!value) continue;

    // 值变了立刻提示；值没变则受冷却约束（避免同一条 Cookie 刷屏）
    if (!shouldNotify(rule.name, value)) continue;

    hits.push({ label: rule.label || rule.name, value: value, rule: rule.name });
  }

  if (!hits.length) return;

  // 真正弹窗了才记冷却，被拦下的请求不影响计时
  for (const h of hits) markNotified(h.rule);

  // 弹窗：值单独一行，方便长按复制
  const body = hits.map(h => h.label + '：\n' + h.value).join('\n\n');
  notify('🎯 抓包命中 ' + hits.length + ' 项', '长按可复制', body);
  console.log('[SR-Capture] ' + JSON.stringify(hits));
}

main()
  .catch((e) => {
    console.log('[SR-Capture] error: ' + (e && e.message ? e.message : e));
    if (CFG.debug === 1) notify('❌ 抓包异常', '', String(e));
  })
  .then(() => $done({}));
