import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import * as echarts from "echarts";
import { ArrowLeft, BarChart3, Bot, Car, Check, ChevronDown, Copy, Database, Factory, GitCompare, KeyRound, ListOrdered, LogOut, MapPinned, Route, Search, Send, ShieldCheck, Sparkles, UserPlus, X } from "lucide-react";
import { askMarketAgent, claimInvite, clearInviteSession, createInviteCode, getSavedInviteSession, isAccessGateConfigured, isMarketAgentConfigured, saveInviteSession, trackVisitEvent } from "./access";
import "./styles.css";

const numberFmt = new Intl.NumberFormat("zh-CN");
const assetUrl = (path) => `${import.meta.env.BASE_URL}${path.replace(/^\//, "")}`;
const provinceNameMap = {
  北京: "北京市",
  天津: "天津市",
  上海: "上海市",
  重庆: "重庆市",
  河北: "河北省",
  山西: "山西省",
  辽宁: "辽宁省",
  吉林: "吉林省",
  黑龙江: "黑龙江省",
  江苏: "江苏省",
  浙江: "浙江省",
  安徽: "安徽省",
  福建: "福建省",
  江西: "江西省",
  山东: "山东省",
  河南: "河南省",
  湖北: "湖北省",
  湖南: "湖南省",
  广东: "广东省",
  海南: "海南省",
  四川: "四川省",
  贵州: "贵州省",
  云南: "云南省",
  陕西: "陕西省",
  甘肃: "甘肃省",
  青海: "青海省",
  台湾: "台湾省",
  内蒙古: "内蒙古自治区",
  广西: "广西壮族自治区",
  西藏: "西藏自治区",
  宁夏: "宁夏回族自治区",
  新疆: "新疆维吾尔自治区",
  香港: "香港特别行政区",
  澳门: "澳门特别行政区",
};
const provinceShortName = Object.fromEntries(Object.entries(provinceNameMap).map(([short, full]) => [full, short]));
const toMapProvinceName = (name) => provinceNameMap[name] ?? name;
const toDataProvinceName = (name) => provinceShortName[name] ?? name;

function useSalesData() {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    Promise.all([
      fetch(assetUrl("data/china.json")).then((res) => {
        if (!res.ok) throw new Error("中国地图边界数据加载失败");
        return res.json();
      }),
      fetch(assetUrl("data/sales-index.json")).then((res) => {
        if (!res.ok) throw new Error("销量索引加载失败，请先运行 npm run data");
        return res.json();
      }),
    ])
      .then(([china, sales]) => {
        echarts.registerMap("china", china);
        setData(sales);
      })
      .catch((err) => setError(err.message));
  }, []);

  return { data, error };
}

function useMonthsData(months) {
  const [cache, setCache] = useState({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const missing = months.filter((month) => month && !cache[month]);
    if (!missing.length) return undefined;
    let alive = true;
    setLoading(true);
    Promise.all(
      missing.map((month) =>
        fetch(assetUrl(`data/months/${month}.json`)).then((res) => {
          if (!res.ok) throw new Error(`${month} 月份数据加载失败`);
          return res.json().then((json) => [month, json]);
        }),
      ),
    )
      .then((entries) => {
        if (alive) {
          setCache((current) => ({ ...current, ...Object.fromEntries(entries) }));
        }
      })
      .catch((err) => alive && setError(err.message))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [months, cache]);

  return { data: cache, loading, error };
}

const addValue = (map, key, value, seed = {}) => {
  const item = map.get(key) ?? { ...seed, value: 0 };
  item.value += value;
  map.set(key, item);
};

const sortDesc = (a, b) => b.value - a.value || a.name.localeCompare(b.name, "zh-CN");

function aggregateModelDetails(monthDataList, models) {
  const province = new Map();
  const city = new Map();
  const modelRanking = [];
  const rankingByModel = new Map();
  const rankingByProvinceModel = new Map();
  let total = 0;

  for (const monthData of monthDataList) {
    for (const model of models) {
      const detail = monthData?.models?.[model.id];
      if (!detail) continue;
      total += detail.total ?? 0;
      addValue(rankingByModel, model.id, detail.total ?? 0, { id: model.id, name: model.name });
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
  modelRanking.push(...rankingByModel.values());
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
    modelRanking: modelRanking.sort(sortDesc),
    provinceModelRanking,
  };
}

const monthToIndex = (month) => {
  const [year, value] = month.split("-").map(Number);
  return year * 12 + value - 1;
};

const indexToMonth = (index) => `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;

const derivePreviousPeriod = (months) => {
  if (!months.length) return [];
  const indexes = months.map(monthToIndex).sort((a, b) => a - b);
  const length = indexes.length;
  return indexes.map((index) => indexToMonth(index - length));
};

const deriveLastYearPeriod = (months) => months.map((month) => indexToMonth(monthToIndex(month) - 12));

const formatMonthLabel = (months) => {
  if (!months.length) return "未选择月份";
  const sorted = [...months].sort();
  if (sorted.length === 1) return sorted[0];
  return `${sorted[0]} - ${sorted.at(-1)}（${sorted.length}个月）`;
};

const percentText = (current, base) => {
  if (!base) return "无基准";
  const rate = ((current - base) / base) * 100;
  return `${rate >= 0 ? "+" : ""}${rate.toFixed(1)}%`;
};

const firstTierCities = new Set(["北京", "上海", "广州", "深圳"]);
const newFirstTierCities = new Set([
  "成都",
  "杭州",
  "重庆",
  "武汉",
  "苏州",
  "西安",
  "南京",
  "长沙",
  "天津",
  "郑州",
  "东莞",
  "青岛",
  "昆明",
  "宁波",
  "合肥",
]);
const standardProvinces = Object.keys(provinceNameMap).filter((name) => !["香港", "澳门", "台湾"].includes(name));

const asPercent = (value) => `${(value * 100).toFixed(1)}%`;

const provinceChangeRows = (currentRows = [], baseRows = []) => {
  const baseMap = new Map(baseRows.map((row) => [row.name, row.value]));
  return currentRows
    .map((row) => {
      const base = baseMap.get(row.name) ?? 0;
      return {
        ...row,
        base,
        delta: row.value - base,
        rate: base ? (row.value - base) / base : null,
      };
    })
    .filter((row) => row.base > 0 || row.value > 0);
};

function buildModelInsights({ current, previousCurrent, lastYearCurrent, selectedModel, selectedMonths }) {
  if (!selectedModel || !current?.total) return null;

  const total = current.total;
  const topProvinces = current.province.slice(0, 5);
  const topCities = current.city.slice(0, 5);
  const top5Share = topProvinces.reduce((sum, row) => sum + row.value, 0) / total;
  const avgProvince = total / Math.max(current.province.length, 1);
  const strongProvinces = current.province.filter((row) => row.value >= avgProvince * 1.5).slice(0, 6);
  const provinceMap = new Map(current.province.map((row) => [row.name, row.value]));
  const lowProvinces = standardProvinces
    .map((name) => ({ name, value: provinceMap.get(name) ?? 0 }))
    .filter((row) => row.value <= avgProvince * 0.25)
    .sort((a, b) => a.value - b.value || a.name.localeCompare(b.name, "zh-CN"))
    .slice(0, 6);

  const tierTotals = current.city.reduce(
    (acc, row) => {
      if (firstTierCities.has(row.name)) acc.first += row.value;
      else if (newFirstTierCities.has(row.name)) acc.newFirst += row.value;
      else acc.sinking += row.value;
      return acc;
    },
    { first: 0, newFirst: 0, sinking: 0 },
  );
  const tierEntries = [
    ["一线城市", tierTotals.first],
    ["新一线城市", tierTotals.newFirst],
    ["下沉市场", tierTotals.sinking],
  ].sort((a, b) => b[1] - a[1]);

  const momChanges = provinceChangeRows(current.province, previousCurrent?.province ?? []);
  const yoyChanges = provinceChangeRows(current.province, lastYearCurrent?.province ?? []);
  const bestMom = momChanges.filter((row) => row.rate !== null).sort((a, b) => b.rate - a.rate)[0];
  const worstMom = momChanges.filter((row) => row.rate !== null).sort((a, b) => a.rate - b.rate)[0];
  const bestYoy = yoyChanges.filter((row) => row.rate !== null).sort((a, b) => b.rate - a.rate)[0];
  const worstYoy = yoyChanges.filter((row) => row.rate !== null).sort((a, b) => a.rate - b.rate)[0];

  const topCity = current.city[0];
  const topCityShare = topCity ? topCity.value / total : 0;
  const highLineShare = (tierTotals.first + tierTotals.newFirst) / total;
  const tierType = highLineShare >= 0.55 ? "高线城市驱动" : tierTotals.sinking / total >= 0.5 ? "下沉市场驱动" : "高线与下沉均衡";
  const concentrationType = top5Share >= 0.6 ? "高度集中" : top5Share >= 0.4 ? "中度集中" : "相对均衡";
  const cityDependencyType = topCityShare >= 0.25 ? "单城依赖明显" : topCityShare >= 0.15 ? "存在核心城市依赖" : "单城依赖不强";
  const mainRegions = topProvinces.map((row) => row.name).join("、");
  const mainCities = topCities.slice(0, 3).map((row) => row.name).join("、");
  const summary = `${selectedModel.name} 在 ${formatMonthLabel(selectedMonths)} 呈现${tierType}、${concentrationType}的地域分布，主销省份集中在 ${mainRegions}，核心城市以 ${mainCities} 为代表。`;

  const conclusions = [
    {
      title: "市场结构",
      body: `Top 5 省份贡献 ${asPercent(top5Share)}，判断为${concentrationType}。${topProvinces[0]?.name ?? "-"}是第一大市场，销量 ${numberFmt.format(topProvinces[0]?.value ?? 0)}，说明该车型已有清晰的主销区域。`,
    },
    {
      title: "城市层级",
      body: `${tierEntries[0][0]}贡献最高，占比 ${asPercent(tierEntries[0][1] / total)}；一线+新一线合计 ${asPercent(highLineShare)}，整体判断为${tierType}。`,
    },
    {
      title: "区域强弱",
      body: strongProvinces.length
        ? `${strongProvinces.map((row) => row.name).join("、")}高于省份平均 1.5 倍以上，是当前优势区域。`
        : "没有省份显著高于平均 1.5 倍，区域分布相对平滑。",
    },
    {
      title: "增长变化",
      body: `环比增长最快为${bestMom?.name ?? "暂无"}${bestMom?.rate !== null && bestMom ? `（${percentText(bestMom.value, bestMom.base)}）` : ""}，下滑最大为${worstMom?.name ?? "暂无"}${worstMom?.rate !== null && worstMom ? `（${percentText(worstMom.value, worstMom.base)}）` : ""}；同比增长最快为${bestYoy?.name ?? "暂无"}${bestYoy?.rate !== null && bestYoy ? `（${percentText(bestYoy.value, bestYoy.base)}）` : ""}。`,
    },
  ];

  const opportunities = [
    lowProvinces.length
      ? `空白/弱势市场：${lowProvinces.map((row) => `${row.name}${row.value ? ` ${numberFmt.format(row.value)}` : " 0"}`).join("、")}，建议检查渠道覆盖或区域投放。`
      : "暂未发现明显空白省份，可优先关注既有优势区域的深挖。",
    topCity ? `${topCity.name}贡献 ${asPercent(topCityShare)}，${cityDependencyType}。` : "暂无城市层级数据，无法判断单城依赖。",
    strongProvinces.length ? `扩量优先级可放在${strongProvinces.slice(0, 3).map((row) => row.name).join("、")}等优势省份周边。` : "可通过城市层级和能源偏好继续寻找扩量区域。",
  ];

  return {
    title: `${selectedModel.name} · ${selectedModel.manufacturer}`,
    period: formatMonthLabel(selectedMonths),
    total,
    summary,
    conclusions,
    opportunities,
    chips: [
      `Top5省份 ${asPercent(top5Share)}`,
      `${tierType}`,
      `${cityDependencyType}`,
      `主销城市 ${mainCities}`,
    ],
  };
}

function compareRows(aRows = [], bRows = [], keyFor) {
  const map = new Map();
  for (const row of aRows) {
    const key = keyFor(row);
    map.set(key, { ...row, aValue: row.value, bValue: 0, value: row.value });
  }
  for (const row of bRows) {
    const key = keyFor(row);
    const current = map.get(key) ?? { ...row, aValue: 0, bValue: 0, value: 0 };
    current.bValue = row.value;
    current.value = current.aValue - current.bValue;
    map.set(key, current);
  }
  return [...map.values()].sort((a, b) => (b.aValue + b.bValue) - (a.aValue + a.bValue));
}

function SelectField({ icon, label, value, onChange, children }) {
  return (
    <label className="field">
      <span className="field-label">
        {icon}
        {label}
      </span>
      <span className="select-wrap">
        <select value={value} onChange={(event) => onChange(event.target.value)}>
          {children}
        </select>
        <ChevronDown size={16} aria-hidden />
      </span>
    </label>
  );
}

function MultiSelectField({ icon, label, options, values, onChange }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const selected = new Set(values);
  const buttonLabel = values.length === 0 ? `全部${label}` : values.length === 1 ? values[0] : `已选 ${values.length} 项`;
  const visibleOptions = useMemo(() => {
    const clean = query.trim().toLowerCase();
    if (!clean) return options;
    return options.filter((item) => item.name.toLowerCase().includes(clean));
  }, [options, query]);

  const toggle = (name) => {
    const next = new Set(values);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    onChange([...next]);
  };

  return (
    <div className="field multi-field">
      <span className="field-label">
        {icon}
        {label}
      </span>
      <button className="multi-button" type="button" onClick={() => setOpen((current) => !current)}>
        <span>{buttonLabel}</span>
        <ChevronDown size={16} />
      </button>
      {open ? (
        <div className="multi-menu">
          <div className="dropdown-search">
            <Search size={15} />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={`搜索${label}`} />
          </div>
          <div className="multi-actions">
            <button type="button" onClick={() => onChange(visibleOptions.map((item) => item.name))}>选中结果</button>
            <button type="button" onClick={() => onChange([])}>
              <X size={14} />
              清空
            </button>
          </div>
          <div className="multi-options">
            {visibleOptions.map((item) => (
              <button
                className={selected.has(item.name) ? "multi-option active" : "multi-option"}
                key={item.name}
                type="button"
                onClick={() => toggle(item.name)}
              >
                <span className="check-box">{selected.has(item.name) ? <Check size={13} /> : null}</span>
                <span>{item.name}</span>
                {item.value ? <small>{numberFmt.format(item.value)}</small> : null}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function ModelSelectField({ icon, label, models, value, onChange, disabledId, allowOverall = false }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const selected = models.find((model) => model.id === value);
  const visibleModels = useMemo(() => {
    const clean = query.trim().toLowerCase();
    const list = clean
      ? models.filter((model) => `${model.name} ${model.manufacturer} ${model.energy} ${model.level}`.toLowerCase().includes(clean))
      : models;
    return list.slice(0, 180);
  }, [models, query]);
  const labelText = selected ? `${selected.name} · ${selected.manufacturer}` : allowOverall ? "总体销量" : "不对比";
  return (
    <div className="field model-select-field">
      <span className="field-label">
        {icon}
        {label}
      </span>
      <button className="multi-button" type="button" onClick={() => setOpen((current) => !current)}>
        <span>{labelText}</span>
        <ChevronDown size={16} />
      </button>
      {open ? (
        <div className="multi-menu model-menu">
          <div className="dropdown-search">
            <Search size={15} />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索车型 / 厂商 / 能源" />
          </div>
          <div className="model-options">
            <button
              className={!value ? "model-option active" : "model-option"}
              type="button"
              onClick={() => {
                onChange("");
                setOpen(false);
              }}
            >
              {allowOverall ? "总体销量" : "不对比"}
            </button>
            {visibleModels.map((model) => (
              <button
                className={model.id === value ? "model-option active" : "model-option"}
                key={model.id}
                type="button"
                disabled={model.id === disabledId}
                onClick={() => {
                  onChange(model.id);
                  setOpen(false);
                }}
              >
                <span>{model.name}</span>
                <small>{model.manufacturer} · {model.energy} · {model.level}</small>
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function SalesMap({ rows, selectedProvince, onProvinceChange, maxValue, totalValue }) {
  const ref = useRef(null);

  useEffect(() => {
    if (!ref.current) return undefined;
    const chart = echarts.init(ref.current);
    const mapRows = rows.map((row) => ({ ...row, dataName: row.name, name: toMapProvinceName(row.name) }));
    const positiveMax = maxValue ?? Math.max(...rows.map((row) => row.value), 1);
    const denominator = totalValue ?? rows.reduce((sum, row) => sum + row.value, 0);

    chart.setOption({
      backgroundColor: "transparent",
      tooltip: {
        trigger: "item",
        formatter: (params) => {
          const value = Number(params.value || 0);
          const share = denominator ? `${((value / denominator) * 100).toFixed(1)}%` : "-";
          return `${toDataProvinceName(params.name)}<br/>销量：${numberFmt.format(value)}<br/>占比：${share}`;
        },
        borderWidth: 0,
        backgroundColor: "rgba(4, 18, 31, 0.94)",
        textStyle: { color: "#eaf7ff" },
      },
      visualMap: {
        min: 0,
        max: positiveMax,
        left: 20,
        bottom: 24,
        text: ["高", "低"],
        calculable: true,
        itemWidth: 12,
        itemHeight: 110,
        inRange: { color: ["#0d1b2a", "#184e77", "#1fb6a6", "#f9d423", "#ff4d4d"] },
        textStyle: { color: "#9bc3d9" },
      },
      series: [
        {
          name: "销量",
          type: "map",
          map: "china",
          roam: true,
          layoutCenter: ["52%", "52%"],
          layoutSize: "78%",
          selectedMode: "single",
          data: mapRows,
          emphasis: {
            label: { show: false },
            itemStyle: { areaColor: "#ff7a45", shadowBlur: 20, shadowColor: "rgba(255, 122, 69, 0.62)" },
          },
          select: {
            label: { show: false },
            itemStyle: { areaColor: "#ff4d4d", shadowBlur: 22, shadowColor: "rgba(255, 77, 77, 0.68)" },
          },
          label: { show: false },
          itemStyle: {
            borderColor: "rgba(151, 227, 255, 0.65)",
            borderWidth: 0.9,
            areaColor: "#071624",
            shadowBlur: 10,
            shadowColor: "rgba(0, 240, 255, 0.18)",
          },
        },
      ],
    });
    if (selectedProvince) chart.dispatchAction({ type: "select", name: toMapProvinceName(selectedProvince) });
    chart.on("click", (params) => {
      const name = toDataProvinceName(params.name);
      onProvinceChange(name === selectedProvince ? "" : name);
    });
    const resize = () => chart.resize();
    window.addEventListener("resize", resize);
    return () => {
      window.removeEventListener("resize", resize);
      chart.dispose();
    };
  }, [rows, selectedProvince, onProvinceChange, maxValue, totalValue]);

  return <div className="map" ref={ref} />;
}

function CompareMaps({ primaryRows, compareRows, selectedProvince, onProvinceChange, primaryName, compareName, primaryTotal, compareTotal }) {
  const sharedMax = Math.max(...primaryRows.map((row) => row.value), ...compareRows.map((row) => row.value), 1);
  return (
    <div className="compare-maps">
      <section className="compare-map-card">
        <div className="compare-map-title">
          <span>车型 A</span>
          <strong>{primaryName}</strong>
        </div>
        <SalesMap rows={primaryRows} selectedProvince={selectedProvince} onProvinceChange={onProvinceChange} maxValue={sharedMax} totalValue={primaryTotal} />
      </section>
      <section className="compare-map-card">
        <div className="compare-map-title">
          <span>车型 B</span>
          <strong>{compareName}</strong>
        </div>
        <SalesMap rows={compareRows} selectedProvince={selectedProvince} onProvinceChange={onProvinceChange} maxValue={sharedMax} totalValue={compareTotal} />
      </section>
    </div>
  );
}

function DrillRanking({ provinceRows, cityRows, selectedProvince, onProvinceChange, compareMode, primaryName, compareName }) {
  const rows = selectedProvince ? cityRows : provinceRows;
  const title = selectedProvince ? `${selectedProvince} 城市排行` : compareMode ? "省份对比排行" : "省份排行";
  const selectedProvinceIndex = selectedProvince ? provinceRows.findIndex((row) => row.name === selectedProvince) : -1;
  const selectedProvinceRow = selectedProvinceIndex >= 0 ? provinceRows[selectedProvinceIndex] : null;
  const provinceTotal = provinceRows.reduce((sum, row) => sum + (compareMode ? (row.aValue ?? 0) + (row.bValue ?? 0) : row.value), 0);
  const selectedProvinceValue = selectedProvinceRow
    ? compareMode
      ? (selectedProvinceRow.aValue ?? 0) + (selectedProvinceRow.bValue ?? 0)
      : selectedProvinceRow.value
    : 0;
  const selectedProvinceShare = provinceTotal ? `${((selectedProvinceValue / provinceTotal) * 100).toFixed(1)}%` : "-";

  const valueLabel = (row) => {
    if (!compareMode) return numberFmt.format(row.value);
    return `${numberFmt.format(row.aValue ?? 0)} / ${numberFmt.format(row.bValue ?? 0)}`;
  };

  const secondary = (row) => {
    if (!compareMode) return selectedProvince ? row.province : "点击下探城市";
    if (row.value > 0) return `${primaryName} 多 ${numberFmt.format(Math.abs(row.value))}`;
    if (row.value < 0) return `${compareName} 多 ${numberFmt.format(Math.abs(row.value))}`;
    return "持平";
  };

  return (
    <div className="ranking drill-ranking">
      <div className="panel-title split-title">
        <span className="title-left">
          {selectedProvince ? <BarChart3 size={18} /> : <MapPinned size={18} />}
          <h2>{title}</h2>
        </span>
        {selectedProvince ? (
          <button className="ghost-button" type="button" onClick={() => onProvinceChange("")}>
            <ArrowLeft size={15} />
            返回省份
          </button>
        ) : null}
      </div>
      {selectedProvinceRow ? (
        <div className="drill-context">
          <div>
            <span>当前省份</span>
            <strong>{selectedProvince}</strong>
          </div>
          <div>
            <span>省份销量</span>
            <strong>{numberFmt.format(selectedProvinceValue)}</strong>
          </div>
          <div>
            <span>省份排名</span>
            <strong>#{selectedProvinceIndex + 1}</strong>
          </div>
          <div>
            <span>销量占比</span>
            <strong>{selectedProvinceShare}</strong>
          </div>
        </div>
      ) : null}
      <div className="rank-list tall">
        {rows.slice(0, 18).map((row, index) => (
          <button
            key={`${row.province ?? ""}-${row.name}-${index}`}
            className={row.name === selectedProvince ? "rank-row active" : "rank-row"}
            onClick={() => {
              if (!selectedProvince) onProvinceChange(row.name === selectedProvince ? "" : row.name);
            }}
            type="button"
          >
            <span className="rank-index">{index + 1}</span>
            <span className="rank-main">
              <span>{row.name}</span>
              <small>{secondary(row)}</small>
            </span>
            <strong>{valueLabel(row)}</strong>
          </button>
        ))}
      </div>
    </div>
  );
}

function ModelRanking({ rows, scopeLabel }) {
  return (
    <div className="model-ranking-pane">
      <div className="ranking-scope">
        <span>当前范围</span>
        <strong>{scopeLabel}</strong>
      </div>
      <div className="rank-list tall">
      {rows.slice(0, 18).map((row, index) => (
        <div className="rank-row static-row" key={`${row.id}-${index}`}>
          <span className="rank-index">{index + 1}</span>
          <span className="rank-main">
            <span>{row.name}</span>
            {row.manufacturer ? <small>{row.manufacturer}</small> : null}
          </span>
          <strong>{numberFmt.format(row.value)}</strong>
        </div>
      ))}
      </div>
    </div>
  );
}

function RankingTabs({ modelRows, modelScopeLabel, showModelRanking, children }) {
  const [tab, setTab] = useState("region");
  useEffect(() => {
    if (!showModelRanking && tab === "models") setTab("region");
  }, [showModelRanking, tab]);

  return (
    <section className="panel ranking combined-ranking">
      <div className="rank-tabs">
        <button className={tab === "region" ? "active" : ""} type="button" onClick={() => setTab("region")}>
          <MapPinned size={16} />
          地域排行
        </button>
        {showModelRanking ? (
          <button className={tab === "models" ? "active" : ""} type="button" onClick={() => setTab("models")}>
            <Car size={16} />
            车型排行
          </button>
        ) : null}
      </div>
      {tab === "region" ? children : <ModelRanking rows={modelRows} scopeLabel={modelScopeLabel} />}
    </section>
  );
}

function ModelInsights({ insights }) {
  if (!insights) return null;

  return (
    <section className="insights-panel">
      <div className="insights-heading">
        <div>
          <p>结论型洞察</p>
          <h2>{insights.title}</h2>
        </div>
        <span>{insights.period}</span>
      </div>
      <div className="insight-summary-card">
        <span>核心判断</span>
        <p>{insights.summary}</p>
        <div className="insight-chips">
          {insights.chips.map((chip) => (
            <em key={chip}>{chip}</em>
          ))}
        </div>
      </div>
      <div className="insight-report-grid">
        {insights.conclusions.map((item) => (
          <article className="insight-report-card" key={item.title}>
            <span>{item.title}</span>
            <p>{item.body}</p>
          </article>
        ))}
      </div>
      <div className="insight-actions">
        <span>机会与风险</span>
        <ul>
          {insights.opportunities.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </div>
    </section>
  );
}

const agentExamples = [
  "最近三个月整体市场增长由哪些省份驱动？",
  "当前筛选范围里，哪些区域还有机会补量？",
  "车型 A 和车型 B 的核心城市差异是什么？",
  "2026-03 新能源 SUV 的省份集中度如何？",
];

const formatEvidenceValue = (value) => {
  if (typeof value === "number") {
    if (Math.abs(value) > 1 && Number.isInteger(value)) return numberFmt.format(value);
    return value.toFixed(Math.abs(value) < 1 ? 4 : 1);
  }
  return String(value ?? "-");
};

const formatEvidenceDimensions = (dimensions = {}) =>
  Object.entries(dimensions)
    .filter(([, value]) => value !== null && value !== undefined && value !== "")
    .map(([key, value]) => `${key}: ${Array.isArray(value) ? value.join(", ") : value}`)
    .join(" · ");

function AgentWorkbench({ enabled, accessSession, context, onApplyViewState }) {
  const [question, setQuestion] = useState("");
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const disabledReason = !isMarketAgentConfigured
    ? "Agent endpoint 未配置。请配置 Supabase 和 VITE_MARKET_AGENT_URL，或使用默认 Supabase Edge Function 地址。"
    : !accessSession?.session_token
      ? "Agent 仅对有效邀请会话开放。"
      : "";

  const submit = async (event) => {
    event?.preventDefault();
    const cleanQuestion = question.trim();
    if (!cleanQuestion || loading || !enabled) return;

    setLoading(true);
    setError("");
    try {
      const result = await askMarketAgent({
        question: cleanQuestion,
        sessionToken: accessSession.session_token,
        context,
      });
      setReport(result);
    } catch (err) {
      setError(err.message || "Agent 分析失败");
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="panel agent-workbench">
      <div className="panel-title split-title">
        <span className="title-left">
          <Bot size={18} />
          <h2>汽车市场分析 Agent</h2>
        </span>
        <span className={enabled ? "agent-status ready" : "agent-status"}>{enabled ? "已连接" : "不可用"}</span>
      </div>

      <form className="agent-form" onSubmit={submit}>
        <textarea
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          placeholder="输入业务问题，例如：最近三个月哪些省份拉动新能源 SUV 增长？"
          rows={4}
          disabled={!enabled || loading}
        />
        <button type="submit" disabled={!enabled || loading || !question.trim()}>
          {loading ? <Sparkles size={16} /> : <Send size={16} />}
          {loading ? "分析中" : "开始分析"}
        </button>
      </form>

      {disabledReason ? <div className="agent-empty">{disabledReason}</div> : null}
      {error ? <div className="agent-error">{error}</div> : null}

      <div className="agent-examples">
        {agentExamples.map((item) => (
          <button
            key={item}
            type="button"
            onClick={() => setQuestion(item)}
            disabled={!enabled || loading}
          >
            {item}
          </button>
        ))}
      </div>

      {report ? (
        <div className="agent-report">
          <div className="agent-summary">
            <span>结论</span>
            <h3>{report.title}</h3>
            <p>{report.summary}</p>
            {report.suggestedViewState ? (
              <button type="button" onClick={() => onApplyViewState(report.suggestedViewState)}>
                <MapPinned size={15} />
                应用到地图
              </button>
            ) : null}
          </div>

          <div className="agent-section">
            <span className="agent-section-title">
              <Sparkles size={15} />
              关键发现
            </span>
            <div className="agent-findings">
              {(report.findings ?? []).map((finding, index) => (
                <article key={`${finding.claim}-${index}`}>
                  <p>{finding.claim}</p>
                  <div>
                    {(finding.evidenceIds ?? []).map((id) => (
                      <em key={id}>{id}</em>
                    ))}
                  </div>
                </article>
              ))}
            </div>
          </div>

          <div className="agent-section">
            <span className="agent-section-title">
              <Route size={15} />
              分析路径
            </span>
            <div className="agent-path">
              {(report.analysisPath ?? []).map((step, index) => (
                <article key={`${step.tool}-${index}`}>
                  <strong>{index + 1}</strong>
                  <div>
                    <span>{step.step}</span>
                    <small>{step.outputSummary}</small>
                  </div>
                </article>
              ))}
            </div>
          </div>

          <div className="agent-section">
            <span className="agent-section-title">
              <Database size={15} />
              证据链
            </span>
            <div className="agent-evidence">
              {(report.evidence ?? []).map((item) => (
                <article key={item.id}>
                  <strong>{item.id}</strong>
                  <div>
                    <span>{item.metric}: {formatEvidenceValue(item.value)}</span>
                    <small>{item.source}</small>
                    {item.dimensions ? <small>{formatEvidenceDimensions(item.dimensions)}</small> : null}
                  </div>
                </article>
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function InviteGate({ onAccessGranted }) {
  const [code, setCode] = useState("");
  const [visitorName, setVisitorName] = useState("");
  const [visitorCompany, setVisitorCompany] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  const submit = async (event) => {
    event.preventDefault();
    if (!code.trim()) {
      setMessage("请输入邀请码");
      return;
    }

    setLoading(true);
    setMessage("");

    try {
      const session = await claimInvite({ code, visitorName, visitorCompany });
      saveInviteSession(session);
      onAccessGranted(session);
    } catch (error) {
      setMessage(error.message || "邀请码校验失败");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="access-page">
      <section className="access-card">
        <div className="access-badge">
          <ShieldCheck size={18} />
          邀请访问
        </div>
        <h1>全国汽车销量地图</h1>
        <p>请输入邀请码进入看板。访问会被记录，用于了解评审反馈和使用情况。</p>
        <form className="access-form" onSubmit={submit}>
          <label>
            <span>邀请码</span>
            <div className="access-input">
              <KeyRound size={16} />
              <input value={code} onChange={(event) => setCode(event.target.value)} placeholder="例如 DEMO2026" autoFocus />
            </div>
          </label>
          <label>
            <span>姓名</span>
            <input value={visitorName} onChange={(event) => setVisitorName(event.target.value)} placeholder="可选，方便你识别访问者" />
          </label>
          <label>
            <span>公司</span>
            <input value={visitorCompany} onChange={(event) => setVisitorCompany(event.target.value)} placeholder="可选" />
          </label>
          {message ? <div className="access-error">{message}</div> : null}
          <button type="submit" disabled={loading}>
            {loading ? "正在校验..." : "进入看板"}
          </button>
        </form>
      </section>
    </main>
  );
}

function AdminInvitePage() {
  const [adminSecret, setAdminSecret] = useState("");
  const [ownerName, setOwnerName] = useState("");
  const [company, setCompany] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [customCode, setCustomCode] = useState("");
  const [notes, setNotes] = useState("");
  const [created, setCreated] = useState(null);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async (event) => {
    event.preventDefault();
    if (!adminSecret.trim() || !ownerName.trim()) {
      setMessage("请输入管理口令和邀请人姓名");
      return;
    }

    setLoading(true);
    setMessage("");
    setCreated(null);

    try {
      const invite = await createInviteCode({
        adminSecret,
        ownerName,
        company,
        expiresAt,
        customCode,
        notes,
      });
      setCreated(invite);
      setCustomCode("");
      setOwnerName("");
      setCompany("");
      setNotes("");
    } catch (error) {
      setMessage(error.message || "邀请码生成失败");
    } finally {
      setLoading(false);
    }
  };

  const copyCode = async () => {
    if (!created?.code) return;
    await navigator.clipboard.writeText(created.code);
    setMessage("邀请码已复制");
  };

  if (!isAccessGateConfigured) {
    return (
      <main className="access-page">
        <section className="access-card">
          <div className="access-badge">
            <UserPlus size={18} />
            管理员入口
          </div>
          <h1>邀请码生成</h1>
          <p>当前页面还没有配置 Supabase，无法创建邀请码。</p>
        </section>
      </main>
    );
  }

  return (
    <main className="access-page">
      <section className="access-card admin-card">
        <div className="access-badge">
          <UserPlus size={18} />
          管理员入口
        </div>
        <h1>生成专属邀请码</h1>
        <p>每个邀请码默认只能使用一次，用户首次通过后会绑定当前浏览器会话。</p>
        <form className="access-form" onSubmit={submit}>
          <label>
            <span>管理口令</span>
            <input type="password" value={adminSecret} onChange={(event) => setAdminSecret(event.target.value)} placeholder="只给管理员使用" />
          </label>
          <label>
            <span>邀请人姓名</span>
            <input value={ownerName} onChange={(event) => setOwnerName(event.target.value)} placeholder="例如 张三" />
          </label>
          <label>
            <span>公司</span>
            <input value={company} onChange={(event) => setCompany(event.target.value)} placeholder="可选" />
          </label>
          <label>
            <span>过期时间</span>
            <input type="datetime-local" value={expiresAt} onChange={(event) => setExpiresAt(event.target.value)} />
          </label>
          <label>
            <span>自定义邀请码</span>
            <input value={customCode} onChange={(event) => setCustomCode(event.target.value)} placeholder="可选，不填则自动生成" />
          </label>
          <label>
            <span>备注</span>
            <input value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="可选" />
          </label>
          {created ? (
            <div className="created-invite">
              <span>已生成邀请码</span>
              <strong>{created.code}</strong>
              <button type="button" onClick={copyCode}>
                <Copy size={15} />
                复制
              </button>
            </div>
          ) : null}
          {message ? <div className="access-error neutral">{message}</div> : null}
          <button type="submit" disabled={loading}>
            {loading ? "正在生成..." : "生成一次性邀请码"}
          </button>
        </form>
      </section>
    </main>
  );
}

function App({ accessSession, onLogout }) {
  const { data, error } = useSalesData();
  const [months, setMonths] = useState([]);
  const [modelId, setModelId] = useState("");
  const [compareModelId, setCompareModelId] = useState("");
  const [manufacturers, setManufacturers] = useState([]);
  const [energies, setEnergies] = useState([]);
  const [levels, setLevels] = useState([]);
  const [selectedProvince, setSelectedProvince] = useState("");
  const [sideTab, setSideTab] = useState("agent");

  const validMonths = useMemo(() => new Set(data?.months ?? []), [data]);
  const defaultMonths = useMemo(() => {
    const latestMonth = data?.months?.at(-1);
    return latestMonth ? [latestMonth] : [];
  }, [data]);
  const monthOptions = useMemo(
    () => [...(data?.months ?? [])].sort().reverse().map((name) => ({ name, value: 0 })),
    [data],
  );
  const selectedMonths = useMemo(() => {
    if (!data?.months?.length) return [];
    const explicitMonths = months.filter((month) => validMonths.has(month)).sort();
    return explicitMonths.length ? explicitMonths : defaultMonths;
  }, [months, defaultMonths, validMonths, data]);
  const previousMonths = useMemo(() => derivePreviousPeriod(selectedMonths).filter((month) => validMonths.has(month)), [selectedMonths, validMonths]);
  const lastYearMonths = useMemo(() => deriveLastYearPeriod(selectedMonths).filter((month) => validMonths.has(month)), [selectedMonths, validMonths]);
  const allNeededMonths = useMemo(
    () => [...new Set([...selectedMonths, ...previousMonths, ...lastYearMonths])],
    [selectedMonths, previousMonths, lastYearMonths],
  );
  const monthSlice = useMonthsData(allNeededMonths);

  const filteredModels = useMemo(() => {
    if (!data) return [];
    const manufacturerSet = new Set(manufacturers);
    const energySet = new Set(energies);
    const levelSet = new Set(levels);
    return data.models.filter((model) => {
      if (manufacturerSet.size && !manufacturerSet.has(model.manufacturer)) return false;
      if (energySet.size && !energySet.has(model.energy)) return false;
      if (levelSet.size && !levelSet.has(model.level)) return false;
      return true;
    });
  }, [data, manufacturers, energies, levels]);

  useEffect(() => {
    if (modelId && !filteredModels.some((model) => model.id === modelId)) setModelId("");
    if (compareModelId && !filteredModels.some((model) => model.id === compareModelId)) setCompareModelId("");
    setSelectedProvince("");
  }, [filteredModels, modelId, compareModelId]);

  useEffect(() => {
    if (compareModelId && compareModelId === modelId) setCompareModelId("");
  }, [modelId, compareModelId]);

  const selectedModel = data?.models.find((model) => model.id === modelId);
  const compareModel = data?.models.find((model) => model.id === compareModelId);
  const compareMode = Boolean(modelId && compareModelId && selectedModel && compareModel);
  const hasFacetFilters = manufacturers.length > 0 || energies.length > 0 || levels.length > 0;

  const currentMonthData = useMemo(() => selectedMonths.map((month) => monthSlice.data[month]).filter(Boolean), [selectedMonths, monthSlice.data]);
  const previousMonthData = useMemo(() => previousMonths.map((month) => monthSlice.data[month]).filter(Boolean), [previousMonths, monthSlice.data]);
  const lastYearMonthData = useMemo(() => lastYearMonths.map((month) => monthSlice.data[month]).filter(Boolean), [lastYearMonths, monthSlice.data]);
  const selectedDetail = modelId && currentMonthData.length ? aggregateModelDetails(currentMonthData, [selectedModel].filter(Boolean)) : null;
  const compareDetail = compareModelId && currentMonthData.length ? aggregateModelDetails(currentMonthData, [compareModel].filter(Boolean)) : null;

  const current = useMemo(() => {
    if (!data || !currentMonthData.length) return null;
    if (compareMode) {
      if (!selectedDetail || !compareDetail) return null;
      return {
        total: (selectedDetail.total ?? 0) + (compareDetail.total ?? 0),
        province: compareRows(selectedDetail.province, compareDetail.province, (row) => row.name),
        city: compareRows(selectedDetail.city, compareDetail.city, (row) => `${row.province}\u001f${row.name}`),
      };
    }
    if (modelId) return selectedDetail ?? { total: 0, province: [], city: [], modelRanking: [] };
    return aggregateModelDetails(currentMonthData, filteredModels);
  }, [data, currentMonthData, compareMode, selectedDetail, compareDetail, modelId, filteredModels]);

  const previousCurrent = useMemo(() => {
    if (!previousMonthData.length) return null;
    if (modelId && selectedModel) return aggregateModelDetails(previousMonthData, [selectedModel]);
    return aggregateModelDetails(previousMonthData, filteredModels);
  }, [previousMonthData, modelId, selectedModel, filteredModels]);

  const lastYearCurrent = useMemo(() => {
    if (!lastYearMonthData.length) return null;
    if (modelId && selectedModel) return aggregateModelDetails(lastYearMonthData, [selectedModel]);
    return aggregateModelDetails(lastYearMonthData, filteredModels);
  }, [lastYearMonthData, modelId, selectedModel, filteredModels]);

  const provinceRows = current?.province ?? [];
  const cityRows = useMemo(() => {
    const rows = current?.city ?? [];
    const scoped = selectedProvince ? rows.filter((row) => row.province === selectedProvince) : rows;
    return compareMode ? [...scoped].sort((a, b) => (b.aValue + b.bValue) - (a.aValue + a.bValue)) : [...scoped].sort(sortDesc);
  }, [current, selectedProvince, compareMode]);
  const modelRows = !modelId && current?.modelRanking ? current.modelRanking : [];
  const scopedModelRows = !modelId && selectedProvince && current?.provinceModelRanking?.[selectedProvince]
    ? current.provinceModelRanking[selectedProvince]
    : modelRows;
  const modelScopeLabel = selectedProvince ? `${selectedProvince} 省份内` : "全国";
  const loading = monthSlice.loading;
  const selectedModelLabel = selectedModel ? `${selectedModel.name} · ${selectedModel.manufacturer}` : "";
  const compareModelLabel = compareModel ? `${compareModel.name} · ${compareModel.manufacturer}` : "";
  const viewName = compareMode ? `${selectedModel.name} vs ${compareModel.name}` : selectedModel ? selectedModel.name : hasFacetFilters ? "筛选汇总" : "总体";
  const modelInsights = useMemo(
    () =>
      !compareMode && selectedModel
        ? buildModelInsights({ current, previousCurrent, lastYearCurrent, selectedModel, selectedMonths })
        : null,
    [compareMode, selectedModel, current, previousCurrent, lastYearCurrent, selectedMonths],
  );
  const agentContext = useMemo(
    () => ({
      months: selectedMonths,
      modelId: modelId || null,
      compareModelId: compareModelId || null,
      manufacturers,
      energies,
      levels,
      selectedProvince: selectedProvince || null,
    }),
    [selectedMonths, modelId, compareModelId, manufacturers, energies, levels, selectedProvince],
  );
  const applyAgentViewState = (state = {}) => {
    if (Array.isArray(state.months)) {
      const nextMonths = state.months.filter((month) => validMonths.has(month));
      if (nextMonths.length) setMonths(nextMonths);
    }
    if ("manufacturers" in state && Array.isArray(state.manufacturers)) setManufacturers(state.manufacturers);
    if ("energies" in state && Array.isArray(state.energies)) setEnergies(state.energies);
    if ("levels" in state && Array.isArray(state.levels)) setLevels(state.levels);
    if ("modelId" in state) setModelId(state.modelId || "");
    if ("compareModelId" in state) setCompareModelId(state.compareModelId || "");
    if ("selectedProvince" in state) setSelectedProvince(state.selectedProvince || "");
  };

  useEffect(() => {
    if (!accessSession?.session_token || !current) return undefined;
    const timer = window.setTimeout(() => {
      trackVisitEvent(accessSession.session_token, "view_changed", {
        months: selectedMonths,
        manufacturers,
        energies,
        levels,
        model_a: selectedModelLabel || "总体",
        model_b: compareModelLabel || null,
        province: selectedProvince || null,
        total: current.total ?? 0,
      });
    }, 900);

    return () => window.clearTimeout(timer);
  }, [
    accessSession?.session_token,
    selectedMonths,
    manufacturers,
    energies,
    levels,
    selectedModelLabel,
    compareModelLabel,
    selectedProvince,
    current,
  ]);

  if (error || monthSlice.error) {
    return <main className="state-page">{error || monthSlice.error}</main>;
  }

  if (!data || !current) {
    return <main className="state-page">正在加载销量地图...</main>;
  }

  return (
    <main className="app">
      <header className="topbar">
        <div>
          <p>全国汽车上牌量</p>
          <h1>销量地图 MVP</h1>
        </div>
        <div className="meta">
          {accessSession ? (
            <button type="button" className="session-chip" onClick={onLogout}>
              <LogOut size={15} />
              退出邀请码
            </button>
          ) : null}
          <span>{formatMonthLabel(selectedMonths)}</span>
          <span>{numberFmt.format(data.totalVolume)} 辆</span>
        </div>
      </header>

      <section className="toolbar">
        <MultiSelectField icon={<MapPinned size={16} />} label="月份" options={monthOptions} values={selectedMonths} onChange={(value) => {
          setMonths(value.length ? value : defaultMonths);
          setSelectedProvince("");
        }} />
        <MultiSelectField icon={<Factory size={16} />} label="厂商" options={data.filters.manufacturers} values={manufacturers} onChange={setManufacturers} />
        <MultiSelectField icon={<BarChart3 size={16} />} label="能源" options={data.filters.energies} values={energies} onChange={setEnergies} />
        <MultiSelectField icon={<Car size={16} />} label="级别" options={data.filters.levels} values={levels} onChange={setLevels} />
        <ModelSelectField
          icon={<Car size={16} />}
          label="车型 A"
          models={filteredModels}
          value={modelId}
          onChange={(value) => {
            setModelId(value);
            if (!value) setCompareModelId("");
            setSelectedProvince("");
          }}
          disabledId={compareModelId}
          allowOverall
        />
        <ModelSelectField
          icon={<GitCompare size={16} />}
          label="对比车型 B"
          models={filteredModels}
          value={compareModelId}
          onChange={(value) => {
            setCompareModelId(value);
            setSelectedProvince("");
          }}
          disabledId={modelId}
        />
      </section>

      <section className="summary-strip">
        <div>
          <span>{compareMode ? "车型 A 总销量" : modelId ? "当前车型销量" : hasFacetFilters ? "筛选后销量" : "总销量"}</span>
          <strong>{compareMode ? numberFmt.format(selectedDetail?.total ?? 0) : numberFmt.format(current.total ?? 0)}</strong>
        </div>
        <div>
          <span>{compareMode ? "车型 B 总销量" : "匹配车型"}</span>
          <strong>{compareMode ? numberFmt.format(compareDetail?.total ?? 0) : modelId ? 1 : filteredModels.length}</strong>
        </div>
        <div>
          <span>{selectedProvince ? `${selectedProvince} 城市数` : "城市覆盖"}</span>
          <strong>{cityRows.length}</strong>
        </div>
        <div>
          <span>环比</span>
          <strong className={previousCurrent?.total && current.total - previousCurrent.total >= 0 ? "positive" : "negative"}>
            {percentText(current.total ?? 0, previousCurrent?.total ?? 0)}
          </strong>
        </div>
        <div>
          <span>同比</span>
          <strong className={lastYearCurrent?.total && current.total - lastYearCurrent.total >= 0 ? "positive" : "negative"}>
            {percentText(current.total ?? 0, lastYearCurrent?.total ?? 0)}
          </strong>
        </div>
        <div>
          <span>当前视图</span>
          <strong>{viewName}</strong>
        </div>
      </section>

      <section className="workspace">
        <div className="map-shell">
          <div className="map-heading">
            <div>
              <h2>{compareMode ? "双车型销量分布对比" : selectedModel ? `${selectedModelLabel} 全国分布` : hasFacetFilters ? "筛选后销量分布" : "全国销量分布"}</h2>
              <p>
                {loading
                  ? "正在加载明细数据..."
                  : compareMode
                    ? "两张地图使用同一色阶；点击任一省份同步下探城市排行"
                    : selectedProvince
                      ? `已下探 ${selectedProvince} 城市排行`
                      : "月份可多选；环比按上一段同长度时间，同比按去年同期计算"}
              </p>
            </div>
            <button type="button" onClick={() => setSelectedProvince("")}>重置省份</button>
          </div>
          {compareMode ? (
            <CompareMaps
              primaryRows={selectedDetail?.province ?? []}
              compareRows={compareDetail?.province ?? []}
              selectedProvince={selectedProvince}
              onProvinceChange={setSelectedProvince}
              primaryName={selectedModelLabel}
              compareName={compareModelLabel}
              primaryTotal={selectedDetail?.total ?? 0}
              compareTotal={compareDetail?.total ?? 0}
            />
          ) : (
            <SalesMap rows={provinceRows} selectedProvince={selectedProvince} onProvinceChange={setSelectedProvince} totalValue={current.total} />
          )}
        </div>
        <aside className="side">
          <div className="side-tabbar">
            <button className={sideTab === "agent" ? "active" : ""} type="button" onClick={() => setSideTab("agent")}>
              <Bot size={16} />
              Agent
            </button>
            <button className={sideTab === "ranking" ? "active" : ""} type="button" onClick={() => setSideTab("ranking")}>
              <ListOrdered size={16} />
              排行
            </button>
          </div>
          {sideTab === "agent" ? (
            <AgentWorkbench
              enabled={Boolean(isMarketAgentConfigured && accessSession?.session_token)}
              accessSession={accessSession}
              context={agentContext}
              onApplyViewState={applyAgentViewState}
            />
          ) : (
            <RankingTabs modelRows={scopedModelRows} modelScopeLabel={modelScopeLabel} showModelRanking={!compareMode && scopedModelRows.length > 0}>
              <DrillRanking
                provinceRows={provinceRows}
                cityRows={cityRows}
                selectedProvince={selectedProvince}
                onProvinceChange={setSelectedProvince}
                compareMode={compareMode}
                primaryName={selectedModelLabel}
                compareName={compareModelLabel}
              />
            </RankingTabs>
          )}
        </aside>
      </section>
      <ModelInsights insights={modelInsights} />
    </main>
  );
}

function Root() {
  const [accessSession, setAccessSession] = useState(() => getSavedInviteSession());
  const isAdminRoute = new URLSearchParams(window.location.search).get("admin") === "1";

  useEffect(() => {
    if (!accessSession?.session_token) return;
    trackVisitEvent(accessSession.session_token, "app_open", {
      referrer: document.referrer || null,
    });
  }, [accessSession?.session_token]);

  const logout = () => {
    clearInviteSession();
    setAccessSession(null);
  };

  if (isAdminRoute) {
    return <AdminInvitePage />;
  }

  if (isAccessGateConfigured && !accessSession?.session_token) {
    return <InviteGate onAccessGranted={setAccessSession} />;
  }

  return <App accessSession={isAccessGateConfigured ? accessSession : null} onLogout={logout} />;
}

createRoot(document.getElementById("root")).render(<Root />);
