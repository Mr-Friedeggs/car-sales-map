const numberFmt = new Intl.NumberFormat("zh-CN");

export const DEFAULT_MINIMAX_MODEL = "MiniMax-M2.7";

const MAX_TOP_ROWS = 12;
const MAX_AGENT_STEPS = 8;

const sortDesc = (a, b) => (b.value ?? 0) - (a.value ?? 0) || String(a.name ?? "").localeCompare(String(b.name ?? ""), "zh-CN");

const clampLimit = (value, fallback = 8) => {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.min(parsed, MAX_TOP_ROWS));
};

export const monthToIndex = (month) => {
  const [year, value] = String(month).split("-").map(Number);
  return year * 12 + value - 1;
};

export const indexToMonth = (index) => `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;

export const derivePreviousPeriod = (months) => {
  if (!months.length) return [];
  const indexes = [...months].map(monthToIndex).sort((a, b) => a - b);
  const length = indexes.length;
  return indexes.map((index) => indexToMonth(index - length));
};

export const deriveLastYearPeriod = (months) => months.map((month) => indexToMonth(monthToIndex(month) - 12));

const percent = (current, base) => {
  if (!base) return null;
  return (current - base) / base;
};

const percentLabel = (value) => {
  if (value === null || value === undefined || Number.isNaN(value)) return "无基准";
  return `${value >= 0 ? "+" : ""}${(value * 100).toFixed(1)}%`;
};

const sourceForMonths = (months) => {
  const sorted = [...months].sort();
  if (sorted.length === 1) return `data/months/${sorted[0]}.json`;
  return `data/months/${sorted[0]}..${sorted.at(-1)}.json`;
};

const addValue = (map, key, value, seed = {}) => {
  const item = map.get(key) ?? { ...seed, value: 0 };
  item.value += value;
  map.set(key, item);
};

const asArray = (value) => {
  if (!value) return [];
  return Array.isArray(value) ? value.filter(Boolean) : [value].filter(Boolean);
};

const unique = (values) => [...new Set(values.filter(Boolean))];

const normalizeBaseUrl = (baseUrl) => String(baseUrl || "").replace(/\/$/, "");

export function createMarketDataClient({ baseUrl, fetchImpl = fetch, loadJson, maxMonthCache = 8 } = {}) {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
  let indexPromise = null;
  const monthCache = new Map();

  const readJson = async (path) => {
    if (loadJson) return loadJson(path);
    if (!normalizedBaseUrl) {
      throw new Error("MARKET_DATA_BASE_URL is not configured");
    }
    const response = await fetchImpl(`${normalizedBaseUrl}/${path.replace(/^\//, "")}`);
    if (!response.ok) {
      throw new Error(`数据文件加载失败: ${path}`);
    }
    return response.json();
  };

  const touchMonth = (month, promise) => {
    if (monthCache.has(month)) monthCache.delete(month);
    monthCache.set(month, promise);
    while (monthCache.size > maxMonthCache) {
      monthCache.delete(monthCache.keys().next().value);
    }
  };

  return {
    getIndex() {
      indexPromise ??= readJson("data/sales-index.json");
      return indexPromise;
    },
    getMonth(month) {
      if (!monthCache.has(month)) {
        touchMonth(month, readJson(`data/months/${month}.json`));
      }
      return monthCache.get(month);
    },
    async getMonths(months) {
      const entries = await Promise.all(months.map(async (month) => [month, await this.getMonth(month)]));
      return Object.fromEntries(entries);
    },
  };
}

const aliasGroups = {
  manufacturers: [
    ["比亚迪", ["比亚迪"]],
    ["特斯拉", ["特斯拉"]],
    ["吉利", ["吉利"]],
    ["上汽大众", ["上汽大众"]],
    ["一汽大众", ["一汽-大众", "一汽大众"]],
    ["长安", ["长安"]],
    ["广汽丰田", ["广汽丰田"]],
    ["一汽丰田", ["一汽丰田"]],
    ["理想", ["理想"]],
    ["问界", ["问界", "AITO"]],
    ["小米", ["小米"]],
    ["蔚来", ["蔚来"]],
    ["乐道", ["蔚来"]],
    ["萤火虫", ["蔚来"]],
    ["小鹏", ["小鹏"]],
    ["零跑", ["零跑"]],
  ],
  energies: [
    ["纯电", ["纯电动"]],
    ["新能源", ["纯电动", "插电混动", "增程式"]],
    ["插混", ["插电混动"]],
    ["增程", ["增程式"]],
    ["燃油", ["汽油"]],
    ["汽油", ["汽油"]],
  ],
  levels: [
    ["SUV", ["SUV"]],
    ["MPV", ["MPV"]],
    ["紧凑型", ["紧凑型"]],
    ["中型", ["中型"]],
    ["中大型", ["中大型"]],
    ["小型", ["小型"]],
    ["微型", ["微型"]],
  ],
};

const findValuesByAlias = (question, options, groups) => {
  const matches = [];
  for (const [needle, aliases] of groups) {
    if (!question.includes(needle)) continue;
    for (const option of options) {
      if (aliases.some((alias) => option.name.includes(alias))) matches.push(option.name);
    }
  }
  return unique(matches);
};

const normalizeMonths = (inputMonths, index) => {
  const validMonths = new Set(index.months ?? []);
  const explicit = asArray(inputMonths).filter((month) => validMonths.has(month)).sort();
  return explicit.length ? explicit : [index.months.at(-1)].filter(Boolean);
};

const normalizeContext = (context = {}, index) => ({
  months: normalizeMonths(context.months, index),
  modelId: context.modelId || null,
  compareModelId: context.compareModelId || null,
  manufacturers: asArray(context.manufacturers),
  energies: asArray(context.energies),
  levels: asArray(context.levels),
  selectedProvince: context.selectedProvince || null,
});

const mergeFilters = (context = {}, filters = {}) => ({
  manufacturers: unique([...asArray(context.manufacturers), ...asArray(filters.manufacturers)]),
  energies: unique([...asArray(context.energies), ...asArray(filters.energies)]),
  levels: unique([...asArray(context.levels), ...asArray(filters.levels)]),
});

const matchesModelQuery = (model, query) => {
  const clean = String(query || "").trim().toLowerCase();
  if (!clean) return false;
  return [model.id, model.name, model.manufacturer, model.energy, model.level]
    .filter(Boolean)
    .some((value) => String(value).toLowerCase().includes(clean));
};

const selectModels = (index, { context = {}, filters = {}, modelIds = [], modelQuery = "" } = {}) => {
  const filter = mergeFilters(context, filters);
  const idSet = new Set(unique([...asArray(modelIds), context.modelId].filter(Boolean)));
  return (index.models ?? []).filter((model) => {
    if (idSet.size && !idSet.has(model.id)) return false;
    if (modelQuery && !matchesModelQuery(model, modelQuery)) return false;
    if (filter.manufacturers.length && !filter.manufacturers.includes(model.manufacturer)) return false;
    if (filter.energies.length && !filter.energies.includes(model.energy)) return false;
    if (filter.levels.length && !filter.levels.includes(model.level)) return false;
    return true;
  });
};

const aggregateModelDetails = (monthDataList, models) => {
  const province = new Map();
  const city = new Map();
  const modelRanking = new Map();
  const rankingByProvinceModel = new Map();
  let total = 0;

  for (const monthData of monthDataList) {
    for (const model of models) {
      const detail = monthData?.models?.[model.id];
      if (!detail) continue;
      const modelTotal = detail.total ?? 0;
      total += modelTotal;
      addValue(modelRanking, model.id, modelTotal, {
        id: model.id,
        name: model.name,
        manufacturer: model.manufacturer,
      });
      for (const row of detail.province ?? []) {
        addValue(province, row.name, row.value, { name: row.name });
        addValue(rankingByProvinceModel, `${row.name}\u001f${model.id}`, row.value, {
          province: row.name,
          id: model.id,
          name: model.name,
          manufacturer: model.manufacturer,
        });
      }
      for (const row of detail.city ?? []) {
        addValue(city, `${row.province}\u001f${row.name}`, row.value, { province: row.province, name: row.name });
      }
    }
  }

  const provinceModelRanking = {};
  for (const row of rankingByProvinceModel.values()) {
    provinceModelRanking[row.province] ??= [];
    provinceModelRanking[row.province].push(row);
  }
  for (const rows of Object.values(provinceModelRanking)) rows.sort(sortDesc);

  return {
    total,
    province: [...province.values()].sort(sortDesc),
    city: [...city.values()].sort(sortDesc),
    modelRanking: [...modelRanking.values()].sort(sortDesc),
    provinceModelRanking,
  };
};

const aggregateMonthSummaries = (monthDataList) => {
  const province = new Map();
  const city = new Map();
  const modelRanking = new Map();
  const rankingByProvinceModel = new Map();
  let total = 0;

  for (const monthData of monthDataList) {
    total += monthData?.total ?? 0;
    for (const row of monthData?.province ?? []) {
      addValue(province, row.name, row.value, { name: row.name });
    }
    for (const row of monthData?.city ?? []) {
      addValue(city, `${row.province}\u001f${row.name}`, row.value, { province: row.province, name: row.name });
    }
    for (const row of monthData?.modelRanking ?? []) {
      addValue(modelRanking, row.id, row.value, {
        id: row.id,
        name: row.name,
        manufacturer: row.manufacturer,
      });
    }
    for (const [provinceName, rows] of Object.entries(monthData?.provinceModelRanking ?? {})) {
      for (const row of rows ?? []) {
        addValue(rankingByProvinceModel, `${provinceName}\u001f${row.id}`, row.value, {
          province: provinceName,
          id: row.id,
          name: row.name,
          manufacturer: row.manufacturer,
        });
      }
    }
  }

  const provinceModelRanking = {};
  for (const row of rankingByProvinceModel.values()) {
    provinceModelRanking[row.province] ??= [];
    provinceModelRanking[row.province].push(row);
  }
  for (const rows of Object.values(provinceModelRanking)) rows.sort(sortDesc);

  return {
    total,
    province: [...province.values()].sort(sortDesc),
    city: [...city.values()].sort(sortDesc),
    modelRanking: [...modelRanking.values()].sort(sortDesc),
    provinceModelRanking,
  };
};

const canUseMonthSummaries = ({ context = {}, filters = {}, modelIds = [], modelQuery = "" } = {}) => {
  const filter = mergeFilters(context, filters);
  const ids = unique([...asArray(modelIds), context.modelId].filter(Boolean));
  return (
    !ids.length &&
    !String(modelQuery || "").trim() &&
    !filter.manufacturers.length &&
    !filter.energies.length &&
    !filter.levels.length
  );
};

const aggregateScope = async (dataClient, index, { months, context, filters, modelIds, modelQuery } = {}) => {
  const scopedMonths = normalizeMonths(months ?? context?.months, index);
  const models = selectModels(index, { context, filters, modelIds, modelQuery });
  const monthMap = await dataClient.getMonths(scopedMonths);
  const monthDataList = scopedMonths.map((month) => monthMap[month]).filter(Boolean);
  return {
    months: scopedMonths,
    models,
    aggregate: canUseMonthSummaries({ context, filters, modelIds, modelQuery })
      ? aggregateMonthSummaries(monthDataList)
      : aggregateModelDetails(monthDataList, models),
  };
};

const compareRows = (currentRows = [], baseRows = [], keyFor = (row) => row.name) => {
  const baseMap = new Map(baseRows.map((row) => [keyFor(row), row]));
  return currentRows
    .map((row) => {
      const base = baseMap.get(keyFor(row));
      const baseValue = base?.value ?? 0;
      return {
        ...row,
        base: baseValue,
        delta: row.value - baseValue,
        rate: percent(row.value, baseValue),
      };
    })
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
};

const summarizeRows = (rows, limit) =>
  rows.slice(0, limit).map((row) => ({
    id: row.id,
    name: row.name,
    province: row.province,
    manufacturer: row.manufacturer,
    value: row.value,
    base: row.base,
    share: row.share,
    delta: row.delta,
    rate: row.rate,
  }));

class EvidenceBuilder {
  constructor() {
    this.rows = [];
  }

  add({ source, metric, value, dimensions = {}, note }) {
    const evidence = {
      id: `E${this.rows.length + 1}`,
      source,
      metric,
      value,
      dimensions,
      note,
    };
    this.rows.push(evidence);
    return evidence;
  }

  has(id) {
    return this.rows.some((row) => row.id === id);
  }

  selected(ids) {
    const idSet = new Set(ids);
    return this.rows.filter((row) => idSet.has(row.id));
  }
}

const buildOverviewEvidence = (evidence, { months, aggregate, models, label }) => {
  const topProvince = aggregate.province[0];
  const topCity = aggregate.city[0];
  const topModel = aggregate.modelRanking[0];
  const source = sourceForMonths(months);
  const evidenceIds = [
    evidence.add({
      source,
      metric: "销量合计",
      value: aggregate.total,
      dimensions: { months, scope: label, modelCount: models.length },
    }).id,
  ];
  if (topProvince) {
    evidenceIds.push(
      evidence.add({
        source,
        metric: "第一省份销量",
        value: topProvince.value,
        dimensions: { province: topProvince.name, share: aggregate.total ? topProvince.value / aggregate.total : 0 },
      }).id,
    );
  }
  if (topCity) {
    evidenceIds.push(
      evidence.add({
        source,
        metric: "第一城市销量",
        value: topCity.value,
        dimensions: { province: topCity.province, city: topCity.name },
      }).id,
    );
  }
  if (topModel) {
    evidenceIds.push(
      evidence.add({
        source,
        metric: "第一车型销量",
        value: topModel.value,
        dimensions: { modelId: topModel.id, modelName: topModel.name, manufacturer: topModel.manufacturer },
      }).id,
    );
  }
  return evidenceIds;
};

const inferScopeLabel = ({ models, filters, modelIds }) => {
  if (modelIds?.length === 1 && models[0]) return `${models[0].name} / ${models[0].manufacturer}`;
  if (modelIds?.length > 1) return `${modelIds.length} 个指定车型`;
  const parts = [];
  if (filters?.manufacturers?.length) parts.push(`厂商 ${filters.manufacturers.join("、")}`);
  if (filters?.energies?.length) parts.push(`能源 ${filters.energies.join("、")}`);
  if (filters?.levels?.length) parts.push(`级别 ${filters.levels.join("、")}`);
  return parts.join("；") || "当前市场范围";
};

export const marketAgentTools = [
  {
    type: "function",
    function: {
      name: "resolve_entities",
      description: "从用户问题中解析月份、车型、厂商、能源、级别等候选实体。先调用它可以避免模型凭空猜实体。",
      parameters: {
        type: "object",
        properties: {
          text: { type: "string", description: "用户原始问题" },
          modelQuery: { type: "string", description: "可选车型或关键词" },
          limit: { type: "integer", description: "返回候选数量" },
        },
        required: ["text"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "market_overview",
      description: "汇总指定月份和筛选范围的销量、Top 省份、Top 城市、Top 车型，并返回证据。",
      parameters: {
        type: "object",
        properties: {
          months: { type: "array", items: { type: "string" } },
          modelIds: { type: "array", items: { type: "string" } },
          modelQuery: { type: "string" },
          filters: {
            type: "object",
            properties: {
              manufacturers: { type: "array", items: { type: "string" } },
              energies: { type: "array", items: { type: "string" } },
              levels: { type: "array", items: { type: "string" } },
            },
          },
          limit: { type: "integer" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "trend_series",
      description: "返回指定市场范围的逐月销量趋势和环比变化。",
      parameters: {
        type: "object",
        properties: {
          months: { type: "array", items: { type: "string" } },
          modelIds: { type: "array", items: { type: "string" } },
          modelQuery: { type: "string" },
          filters: { type: "object" },
          limit: { type: "integer" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "growth_drivers",
      description: "对比当前周期与上期或去年同期，找出省份、城市或车型的增长/下滑驱动。",
      parameters: {
        type: "object",
        properties: {
          months: { type: "array", items: { type: "string" } },
          baseline: { type: "string", enum: ["previous", "last_year"] },
          dimension: { type: "string", enum: ["province", "city", "model"] },
          modelIds: { type: "array", items: { type: "string" } },
          modelQuery: { type: "string" },
          filters: { type: "object" },
          limit: { type: "integer" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "compare_segments",
      description: "对比两个或多个车型/厂商/能源/级别细分市场的销量、份额和核心区域。",
      parameters: {
        type: "object",
        properties: {
          months: { type: "array", items: { type: "string" } },
          segments: {
            type: "array",
            items: {
              type: "object",
              properties: {
                label: { type: "string" },
                modelIds: { type: "array", items: { type: "string" } },
                modelQuery: { type: "string" },
                filters: { type: "object" },
              },
            },
          },
          limit: { type: "integer" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "regional_opportunities",
      description: "识别强势区域、弱势/空白区域、集中度和可优先关注的省份城市。",
      parameters: {
        type: "object",
        properties: {
          months: { type: "array", items: { type: "string" } },
          modelIds: { type: "array", items: { type: "string" } },
          modelQuery: { type: "string" },
          filters: { type: "object" },
          limit: { type: "integer" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "finalize_report",
      description: "在调用数据工具后，用证据 id 生成最终报告。必须引用已返回的 evidence id。",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string" },
          summary: { type: "string" },
          findings: {
            type: "array",
            items: {
              type: "object",
              properties: {
                claim: { type: "string" },
                evidenceIds: { type: "array", items: { type: "string" } },
              },
              required: ["claim", "evidenceIds"],
            },
          },
          analysisPath: {
            type: "array",
            items: {
              type: "object",
              properties: {
                step: { type: "string" },
                tool: { type: "string" },
                outputSummary: { type: "string" },
              },
              required: ["step", "tool", "outputSummary"],
            },
          },
          suggestedViewState: {
            type: "object",
            properties: {
              months: { type: "array", items: { type: "string" } },
              modelId: { type: ["string", "null"] },
              compareModelId: { type: ["string", "null"] },
              manufacturers: { type: "array", items: { type: "string" } },
              energies: { type: "array", items: { type: "string" } },
              levels: { type: "array", items: { type: "string" } },
              selectedProvince: { type: ["string", "null"] },
            },
          },
        },
        required: ["title", "summary", "findings", "analysisPath", "suggestedViewState"],
      },
    },
  },
];

export async function executeMarketTool(name, rawArgs, { dataClient, context, evidence }) {
  const index = await dataClient.getIndex();
  const normalizedContext = normalizeContext(context, index);
  const args = rawArgs ?? {};
  const limit = clampLimit(args.limit);

  if (name === "resolve_entities") {
    const text = String(args.text || "");
    const validMonthSet = new Set(index.months);
    const explicitMonths = unique(text.match(/\b20\d{2}-(0[1-9]|1[0-2])\b/g) ?? []).filter((month) => validMonthSet.has(month));
    const modelQuery = String(args.modelQuery || text).trim();
    const modelCandidates = modelQuery
      ? index.models.filter((model) => matchesModelQuery(model, modelQuery)).slice(0, limit)
      : [];
    const manufacturers = unique([
      ...findValuesByAlias(text, index.filters?.manufacturers ?? [], aliasGroups.manufacturers),
      ...asArray(normalizedContext.manufacturers),
    ]);
    const energies = unique([
      ...findValuesByAlias(text, index.filters?.energies ?? [], aliasGroups.energies),
      ...asArray(normalizedContext.energies),
    ]);
    const levels = unique([
      ...findValuesByAlias(text, index.filters?.levels ?? [], aliasGroups.levels),
      ...asArray(normalizedContext.levels),
    ]);

    return {
      months: explicitMonths.length ? explicitMonths : normalizedContext.months,
      modelCandidates: modelCandidates.map((model) => ({
        id: model.id,
        name: model.name,
        manufacturer: model.manufacturer,
        energy: model.energy,
        level: model.level,
        total: model.total,
      })),
      filters: { manufacturers, energies, levels },
      outputSummary: `解析到 ${modelCandidates.length} 个车型候选、${manufacturers.length} 个厂商、${energies.length} 个能源类型。`,
    };
  }

  if (name === "market_overview") {
    const { months, models, aggregate } = await aggregateScope(dataClient, index, {
      months: args.months,
      context: normalizedContext,
      filters: args.filters,
      modelIds: args.modelIds,
      modelQuery: args.modelQuery,
    });
    const label = inferScopeLabel({ models, filters: mergeFilters(normalizedContext, args.filters), modelIds: asArray(args.modelIds) });
    const evidenceIds = buildOverviewEvidence(evidence, { months, aggregate, models, label });
    const topProvinces = summarizeRows(
      aggregate.province.map((row) => ({ ...row, share: aggregate.total ? row.value / aggregate.total : 0 })),
      limit,
    );
    const topCities = summarizeRows(
      aggregate.city.map((row) => ({ ...row, share: aggregate.total ? row.value / aggregate.total : 0 })),
      limit,
    );
    return {
      months,
      scope: label,
      total: aggregate.total,
      modelCount: models.length,
      topProvinces,
      topCities,
      topModels: summarizeRows(aggregate.modelRanking, limit),
      evidenceIds,
      outputSummary: `${label} 在 ${months.join(", ")} 销量 ${numberFmt.format(aggregate.total)}，第一省份 ${topProvinces[0]?.name ?? "无"}。`,
    };
  }

  if (name === "trend_series") {
    const months = normalizeMonths(args.months ?? normalizedContext.months, index);
    const series = [];
    for (const month of months) {
      const { aggregate, models } = await aggregateScope(dataClient, index, {
        months: [month],
        context: normalizedContext,
        filters: args.filters,
        modelIds: args.modelIds,
        modelQuery: args.modelQuery,
      });
      series.push({ month, value: aggregate.total, modelCount: models.length });
    }
    const withChange = series.map((row, index) => ({
      ...row,
      delta: index ? row.value - series[index - 1].value : null,
      rate: index ? percent(row.value, series[index - 1].value) : null,
    }));
    const latest = withChange.at(-1);
    const peak = [...withChange].sort((a, b) => b.value - a.value)[0];
    const evidenceIds = [];
    if (latest) {
      evidenceIds.push(
        evidence.add({
          source: `data/months/${latest.month}.json`,
          metric: "最新月份销量",
          value: latest.value,
          dimensions: { month: latest.month, rate: latest.rate },
        }).id,
      );
    }
    if (peak && peak.month !== latest?.month) {
      evidenceIds.push(
        evidence.add({
          source: `data/months/${peak.month}.json`,
          metric: "趋势峰值销量",
          value: peak.value,
          dimensions: { month: peak.month },
        }).id,
      );
    }
    return {
      months,
      series: withChange,
      evidenceIds,
      outputSummary: `趋势覆盖 ${months.length} 个月，最新月 ${latest?.month ?? "-"} 销量 ${numberFmt.format(latest?.value ?? 0)}，环比 ${percentLabel(latest?.rate)}。`,
    };
  }

  if (name === "growth_drivers") {
    const months = normalizeMonths(args.months ?? normalizedContext.months, index);
    const baseline = args.baseline === "last_year" ? "last_year" : "previous";
    const baseMonths = baseline === "last_year" ? deriveLastYearPeriod(months) : derivePreviousPeriod(months);
    const validBaseMonths = baseMonths.filter((month) => index.months.includes(month));
    const dimension = ["city", "model"].includes(args.dimension) ? args.dimension : "province";
    const current = await aggregateScope(dataClient, index, {
      months,
      context: normalizedContext,
      filters: args.filters,
      modelIds: args.modelIds,
      modelQuery: args.modelQuery,
    });
    const base = await aggregateScope(dataClient, index, {
      months: validBaseMonths,
      context: normalizedContext,
      filters: args.filters,
      modelIds: args.modelIds,
      modelQuery: args.modelQuery,
    });
    const keyFor = dimension === "city" ? (row) => `${row.province}\u001f${row.name}` : (row) => row.id ?? row.name;
    const currentRows = dimension === "city" ? current.aggregate.city : dimension === "model" ? current.aggregate.modelRanking : current.aggregate.province;
    const baseRows = dimension === "city" ? base.aggregate.city : dimension === "model" ? base.aggregate.modelRanking : base.aggregate.province;
    const rows = compareRows(currentRows, baseRows, keyFor);
    const gainers = rows.filter((row) => row.delta > 0).sort((a, b) => b.delta - a.delta).slice(0, limit);
    const decliners = rows.filter((row) => row.delta < 0).sort((a, b) => a.delta - b.delta).slice(0, limit);
    const totalRate = percent(current.aggregate.total, base.aggregate.total);
    const evidenceIds = [
      evidence.add({
        source: sourceForMonths(months),
        metric: "当前周期销量",
        value: current.aggregate.total,
        dimensions: { months, dimension },
      }).id,
    ];
    if (validBaseMonths.length) {
      evidenceIds.push(
        evidence.add({
          source: sourceForMonths(validBaseMonths),
          metric: baseline === "last_year" ? "去年同期销量" : "上期销量",
          value: base.aggregate.total,
          dimensions: { months: validBaseMonths, rate: totalRate },
        }).id,
      );
    }
    if (gainers[0]) {
      for (const row of gainers.slice(0, Math.min(5, limit))) {
        evidenceIds.push(
          evidence.add({
            source: sourceForMonths(months),
            metric: "增长项销量增量",
            value: row.delta,
            dimensions: {
              id: row.id,
              name: row.name,
              manufacturer: row.manufacturer,
              province: row.province,
              currentValue: row.value,
              baseValue: row.base,
              rate: row.rate,
            },
          }).id,
        );
      }
    }
    return {
      months,
      baseline,
      baselineMonths: validBaseMonths,
      dimension,
      total: current.aggregate.total,
      baseTotal: base.aggregate.total,
      totalDelta: current.aggregate.total - base.aggregate.total,
      totalRate,
      gainers: summarizeRows(gainers, limit),
      decliners: summarizeRows(decliners, limit),
      evidenceIds,
      outputSummary: `当前周期销量 ${numberFmt.format(current.aggregate.total)}，${baseline === "last_year" ? "同比" : "环比"} ${percentLabel(totalRate)}。`,
    };
  }

  if (name === "compare_segments") {
    const months = normalizeMonths(args.months ?? normalizedContext.months, index);
    const requestedSegments = asArray(args.segments);
    const defaultSegments =
      normalizedContext.modelId && normalizedContext.compareModelId
        ? [
            { label: "车型 A", modelIds: [normalizedContext.modelId] },
            { label: "车型 B", modelIds: [normalizedContext.compareModelId] },
          ]
        : [];
    const segments = requestedSegments.length ? requestedSegments : defaultSegments;
    if (segments.length < 2) {
      return {
        months,
        segments: [],
        evidenceIds: [],
        outputSummary: "需要至少两个细分市场才能对比。可先调用 resolve_entities 获取候选。",
      };
    }

    const results = [];
    let grandTotal = 0;
    for (const segment of segments.slice(0, 4)) {
      const scoped = await aggregateScope(dataClient, index, {
        months,
        context: {},
        filters: segment.filters,
        modelIds: segment.modelIds,
        modelQuery: segment.modelQuery,
      });
      grandTotal += scoped.aggregate.total;
      results.push({
        label: segment.label || inferScopeLabel({ models: scoped.models, filters: segment.filters, modelIds: segment.modelIds }),
        modelCount: scoped.models.length,
        total: scoped.aggregate.total,
        topProvinces: summarizeRows(scoped.aggregate.province, limit),
        topCities: summarizeRows(scoped.aggregate.city, limit),
      });
    }
    const evidenceIds = results.map((result) =>
      evidence.add({
        source: sourceForMonths(months),
        metric: "细分市场销量",
        value: result.total,
        dimensions: { segment: result.label, share: grandTotal ? result.total / grandTotal : 0 },
      }).id,
    );
    return {
      months,
      segments: results.map((result) => ({ ...result, share: grandTotal ? result.total / grandTotal : 0 })),
      evidenceIds,
      outputSummary: `完成 ${results.length} 个细分对比，最高为 ${results.sort((a, b) => b.total - a.total)[0]?.label ?? "无"}。`,
    };
  }

  if (name === "regional_opportunities") {
    const { months, models, aggregate } = await aggregateScope(dataClient, index, {
      months: args.months,
      context: normalizedContext,
      filters: args.filters,
      modelIds: args.modelIds,
      modelQuery: args.modelQuery,
    });
    const avgProvince = aggregate.province.length ? aggregate.total / aggregate.province.length : 0;
    const strong = aggregate.province.filter((row) => row.value >= avgProvince * 1.4).slice(0, limit);
    const weak = aggregate.province
      .filter((row) => row.value <= avgProvince * 0.45)
      .sort((a, b) => a.value - b.value)
      .slice(0, limit);
    const top5Share = aggregate.province.slice(0, 5).reduce((sum, row) => sum + row.value, 0) / Math.max(aggregate.total, 1);
    const evidenceIds = [
      evidence.add({
        source: sourceForMonths(months),
        metric: "区域集中度 Top5 省份占比",
        value: Number(top5Share.toFixed(4)),
        dimensions: { months, modelCount: models.length },
      }).id,
    ];
    if (strong[0]) {
      evidenceIds.push(
        evidence.add({
          source: sourceForMonths(months),
          metric: "第一强势省份销量",
          value: strong[0].value,
          dimensions: { province: strong[0].name, provinceAverage: avgProvince },
        }).id,
      );
    }
    if (weak[0]) {
      evidenceIds.push(
        evidence.add({
          source: sourceForMonths(months),
          metric: "第一弱势省份销量",
          value: weak[0].value,
          dimensions: { province: weak[0].name, provinceAverage: avgProvince },
        }).id,
      );
    }
    return {
      months,
      total: aggregate.total,
      provinceAverage: avgProvince,
      top5Share,
      strongProvinces: summarizeRows(strong, limit),
      weakProvinces: summarizeRows(weak, limit),
      topCities: summarizeRows(aggregate.city, limit),
      evidenceIds,
      outputSummary: `Top5 省份占比 ${(top5Share * 100).toFixed(1)}%，强势省份 ${strong.map((row) => row.name).join("、") || "无"}。`,
    };
  }

  throw new Error(`Unknown market tool: ${name}`);
}

const parseToolArgs = (toolCall) => {
  const raw = toolCall?.function?.arguments ?? "{}";
  if (typeof raw === "object") return raw;
  try {
    return JSON.parse(raw || "{}");
  } catch {
    throw new Error(`工具 ${toolCall?.function?.name ?? "unknown"} 参数不是合法 JSON`);
  }
};

const toolMessage = (toolCall, content) => ({
  role: "tool",
  tool_call_id: toolCall.id,
  name: toolCall.function?.name,
  content: JSON.stringify(content),
});

const unsupportedCausalPatterns = [
  { pattern: /得益于|由于|促成|推动了|拉动了/, label: "外部因果判断" },
  { pattern: /低价|价格门槛|价格策略|降价|补贴|营销|渠道|产品力|竞争力|换电|交付能力|产能|订单/, label: "销量数据未覆盖的经营因素" },
  { pattern: /无强力竞争|没有强力竞争|绝对份额优势|占据绝对优势/, label: "未验证的竞争格局判断" },
  { pattern: /用户覆盖|用户群|品牌高端定位|市场匹配度/, label: "未验证的用户或品牌判断" },
];

const assertReportIsGrounded = ({ title, summary, findings }) => {
  const reportText = [title, summary, ...findings.map((item) => item.claim)].join("\n");
  const match = unsupportedCausalPatterns.find(({ pattern }) => pattern.test(reportText));
  if (match) {
    throw new Error(
      `最终报告包含${match.label}。当前工具只有销量数据，请改写为“数据上表现为/环比增量来自/不能证明真实原因”的表述，并移除价格、营销、产品力、竞争格局等未被工具证明的说法。`,
    );
  }
};

const buildSystemPrompt = () => `
你是汽车市场分析 Agent。你的任务不是聊天，而是自动拆解业务问题、调用销量数据工具、生成有证据链的结论。

规则：
1. 先调用 resolve_entities 或一个数据工具理解问题，不允许直接给最终答案。
2. 只能依据工具返回的数据下结论，不得编造外部市场事实。
3. 每个 finding 必须引用至少一个已返回的 evidence id。
4. 最终必须调用 finalize_report，不要输出普通自然语言答案。
5. 如果用户问题含糊，基于当前 context 和最近月份做分析，并在 summary 中说明默认口径。
6. 用户问“为什么/原因”时，只能回答“销量数据上可观察到的驱动项”：例如哪个车型、省份或城市贡献了环比/同比增量。不要把销量变化解释成真实商业因果。
7. 禁止使用“得益于、低价、价格门槛、营销、产品力、换电、产能、订单、用户覆盖、无强力竞争对手、绝对份额优势”等工具未证明的说法。
8. 如果提到某个车型/地区/细分市场，必须来自工具返回的 rows 或 evidence；如果 L60 不是最大增量项，不要把它写成主要原因。
`;

const buildUserPrompt = ({ question, context }) =>
  JSON.stringify(
    {
      question,
      context,
      instruction: "请自动拆解分析路径，调用必要数据工具，最终用 finalize_report 返回结构化报告。",
    },
    null,
    2,
  );

const sanitizeReport = (args, evidence, fallbackContext) => {
  const findings = asArray(args.findings).map((item) => ({
    claim: String(item.claim || "").trim(),
    evidenceIds: asArray(item.evidenceIds).filter((id) => evidence.has(id)),
  }));
  const invalidFinding = findings.find((item) => !item.claim || !item.evidenceIds.length);
  if (invalidFinding || !findings.length) {
    throw new Error("最终报告缺少有效 finding 或 evidenceIds");
  }

  const referencedEvidenceIds = unique(findings.flatMap((item) => item.evidenceIds));
  const suggested = args.suggestedViewState ?? {};
  const title = String(args.title || "汽车市场分析结论").trim();
  const summary = String(args.summary || "").trim();
  assertReportIsGrounded({ title, summary, findings });

  return {
    title,
    summary,
    findings,
    analysisPath: asArray(args.analysisPath).map((item) => ({
      step: String(item.step || "").trim(),
      tool: String(item.tool || "").trim(),
      outputSummary: String(item.outputSummary || "").trim(),
    })),
    evidence: evidence.selected(referencedEvidenceIds),
    suggestedViewState: {
      months: asArray(suggested.months).length ? asArray(suggested.months) : fallbackContext.months,
      modelId: suggested.modelId ?? fallbackContext.modelId ?? null,
      compareModelId: suggested.compareModelId ?? fallbackContext.compareModelId ?? null,
      manufacturers: asArray(suggested.manufacturers),
      energies: asArray(suggested.energies),
      levels: asArray(suggested.levels),
      selectedProvince: suggested.selectedProvince ?? fallbackContext.selectedProvince ?? null,
    },
  };
};

export async function runMarketAgent({ question, context = {}, dataClient, callModel, maxSteps = MAX_AGENT_STEPS }) {
  if (!question || !String(question).trim()) {
    const error = new Error("请输入业务问题");
    error.status = 400;
    throw error;
  }
  if (!dataClient) throw new Error("dataClient is required");
  if (!callModel) throw new Error("callModel is required");

  const index = await dataClient.getIndex();
  const normalizedContext = normalizeContext(context, index);
  const evidence = new EvidenceBuilder();
  const messages = [
    { role: "system", content: buildSystemPrompt() },
    { role: "user", content: buildUserPrompt({ question: String(question).trim(), context: normalizedContext }) },
  ];
  const analysisPath = [];
  const usage = { promptTokens: 0, completionTokens: 0 };
  let usedDataTools = false;
  let repairAttempts = 0;

  for (let step = 0; step < maxSteps; step += 1) {
    const response = await callModel({ messages, tools: marketAgentTools, tool_choice: "auto" });
    const message = response.message ?? response.choices?.[0]?.message;
    if (!message) throw new Error("模型没有返回有效消息");
    if (response.usage) {
      usage.promptTokens += response.usage.prompt_tokens ?? response.usage.promptTokens ?? 0;
      usage.completionTokens += response.usage.completion_tokens ?? response.usage.completionTokens ?? 0;
    }
    messages.push(message);

    const toolCalls = message.tool_calls ?? [];
    if (!toolCalls.length) {
      if (repairAttempts < 1) {
        repairAttempts += 1;
        messages.push({
          role: "user",
          content: "请继续：必须调用销量数据工具，并最终调用 finalize_report；不要输出普通文字答案。",
        });
        continue;
      }
      throw new Error("模型未调用工具，无法生成有证据链的结论");
    }

    let finalized = null;
    const toolResults = [];
    for (const toolCall of toolCalls) {
      const toolName = toolCall.function?.name;
      const args = parseToolArgs(toolCall);
      if (toolName === "finalize_report") {
        if (!usedDataTools) {
          toolResults.push(
            toolMessage(toolCall, {
              error: "finalize_report 前必须至少调用一个数据工具。",
            }),
          );
          continue;
        }
        try {
          finalized = sanitizeReport(args, evidence, normalizedContext);
          toolResults.push(toolMessage(toolCall, { ok: true }));
        } catch (error) {
          if (repairAttempts < 1) {
            repairAttempts += 1;
            toolResults.push(toolMessage(toolCall, { error: error.message }));
            continue;
          }
          throw error;
        }
      } else {
        const result = await executeMarketTool(toolName, args, { dataClient, context: normalizedContext, evidence });
        usedDataTools = true;
        analysisPath.push({
          step: `调用 ${toolName}`,
          tool: toolName,
          outputSummary: result.outputSummary || "已返回数据摘要",
        });
        toolResults.push(toolMessage(toolCall, result));
      }
    }
    messages.push(...toolResults);

    if (finalized) {
      const finalPath = finalized.analysisPath.length ? finalized.analysisPath : analysisPath;
      return {
        ...finalized,
        analysisPath: finalPath,
        usage,
      };
    }
  }

  throw new Error("Agent 分析步数超限，未能生成最终报告");
}
