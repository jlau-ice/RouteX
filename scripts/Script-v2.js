// Clash Verge Rev 全局扩展脚本 v2（兼容多订阅）
// 1) 用正则自动识别当前订阅里的新加坡/美国节点，不再硬编码节点名。
//    —— 同时兼容 iKuuu（"🇸🇬 新加坡Y01 | IEPL | x2"）和 qiwu（"-sg4 / -sv4 / Qiwu-SV-"）两套命名，
//       以后切订阅、合并订阅都不用改脚本。
// 2) 指定 IP/域名 → 强制分流到“数据库-新加坡”策略组
// 3) ChatGPT/OpenAI → 强制分流到“ChatGPT-美国”策略组

function main(config) {
  const databaseGroupName = "数据库-新加坡";
  const chatGPTGroupName = "ChatGPT-美国";

  // ========== 节点自动识别（正则） ==========
  // 需要换机场时，通常只需调整这两条正则：
  //   新加坡：匹配 中文“新加坡”、国旗 🇸🇬、以及 "-sg4 / -sg10" 这类机场代码后缀
  //   美国：  匹配 中文“美国”、国旗 🇺🇲/🇺🇸、以及 "-sv4 / -SV-"（硅谷）这类后缀
  const singaporePattern = /新加坡|🇸🇬|[-.]sg\d|singapore/i;
  const unitedStatesPattern = /美国|🇺🇸|🇺🇲|[-.]sv[-.\d]|[-.]us\d/i;

  const proxies = config.proxies || [];
  const singaporeNodes = proxies
    .filter((proxy) => singaporePattern.test(proxy.name))
    .map((proxy) => proxy.name);
  const unitedStatesNodes = proxies
    .filter((proxy) => unitedStatesPattern.test(proxy.name))
    .map((proxy) => proxy.name);

  if (singaporeNodes.length === 0) {
    throw new Error(
      `自定义分流：当前订阅未匹配到任何新加坡节点，请检查正则：${singaporePattern}`,
    );
  }
  if (unitedStatesNodes.length === 0) {
    throw new Error(
      `自定义分流：当前订阅未匹配到任何美国节点，请检查正则：${unitedStatesPattern}`,
    );
  }

  // ========== 策略组 ==========
  // 新增或更新策略组。select 类型默认选中列表第一个节点，可在代理页手动切换。
  config["proxy-groups"] = config["proxy-groups"] || [];
  const upsertSelectGroup = (name, nodeNames) => {
    const groupConfig = { name, type: "select", proxies: nodeNames };
    const existingGroup = config["proxy-groups"].find(
      (group) => group.name === name,
    );
    if (existingGroup) {
      Object.assign(existingGroup, groupConfig);
    } else {
      config["proxy-groups"].unshift(groupConfig);
    }
  };
  upsertSelectGroup(databaseGroupName, singaporeNodes);
  upsertSelectGroup(chatGPTGroupName, unitedStatesNodes);

  // ========== 以下为固定的分流规则，无需改动 ==========

  const databaseIPs = [
    "43.156.35.51",
    "43.128.81.174",
    "43.156.29.215",
    "43.163.85.90",
    "43.134.94.148",
    "43.163.90.89",
    "43.163.85.33",
    "43.134.91.196",
    "43.163.80.4",
    "43.156.229.44",
    "43.156.108.77",
    "43.159.60.31",
    "43.134.97.230",
    "43.128.105.86",
    "43.134.57.245",
    "129.226.156.39",
    "43.128.107.155",
    "43.134.122.151",
    "43.156.44.199",
    "43.159.33.201",
    "43.156.34.96",
    "43.153.193.218",
    "43.156.38.81",
    "43.156.172.51",
    "43.156.117.219",
    "43.163.92.93",
    "43.156.25.237",
    "43.134.231.90",
    "150.109.16.240",
    "43.134.75.230",
    "101.32.168.220",
    "129.226.220.246",
    "43.134.97.195",
    "43.163.91.25",
    "43.134.167.153",
    "43.134.80.167",
    "43.163.123.69",
    "43.156.76.59",
    "119.28.106.23",
    "43.159.35.235",
    "43.163.107.142",
    "43.156.111.48",
    "43.163.127.217",
    "43.156.200.74",
    "43.134.238.173",
    "129.226.4.113",
    "43.128.67.163",
    "119.28.108.19",
    "43.133.59.145",
    "43.128.102.151",
    "43.163.122.89",
    "101.32.166.177",
    "43.160.249.27",
    "43.160.221.156",
    "43.172.182.156",
    "43.133.58.22"
  ];

  const singaporeDomainSuffixes = [
    "dramarewards.com",
    "chewrobot.com",
  ];

  // OpenAI/ChatGPT 核心域名及专用依赖。
  // 不包含 Cloudflare、Stripe、Intercom 等可能被其他网站共用的泛域名。
  const chatGPTDomainSuffixes = [
    "chatgpt.com",
    "openai.com",
    "oaistatic.com",
    "oaiusercontent.com",
    "openaimerge.com",
    "oaistatsig.com",
    "featuregates.org",
    "featureassets.org",
    "prodregistryv2.org",
    "chatgpt.livekit.cloud",
  ];

  // IP-CIDR 规则必须位于订阅的 MATCH/GEOIP 等规则之前。
  const databaseRules = databaseIPs.map(
    (ip) => `IP-CIDR,${ip}/32,${databaseGroupName},no-resolve`,
  );
  const singaporeDomainRules = singaporeDomainSuffixes.map(
    (domain) => `DOMAIN-SUFFIX,${domain},${databaseGroupName}`,
  );
  const chatGPTRules = chatGPTDomainSuffixes.map(
    (domain) => `DOMAIN-SUFFIX,${domain},${chatGPTGroupName}`,
  );
  const customRules = [
    ...databaseRules,
    ...singaporeDomainRules,
    ...chatGPTRules,
  ];
  const customRuleSet = new Set(customRules);
  const originalRules = (config.rules || []).filter(
    (rule) => !customRuleSet.has(rule),
  );
  config.rules = [...customRules, ...originalRules];

  return config;
}
