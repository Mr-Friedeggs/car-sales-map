import fs from "node:fs";
import path from "node:path";
import { parse } from "csv-parse";

const root = process.cwd();
const csvFile = fs
  .readdirSync(root)
  .find((file) => file.toLowerCase().endsWith(".csv"));

if (!csvFile) {
  throw new Error("未找到 CSV 文件，请把销量 CSV 放在项目根目录。");
}

const csvPath = path.join(root, csvFile);
const outputDir = path.join(root, "public", "data");
const monthsDir = path.join(outputDir, "months");
const modelsDir = path.join(outputDir, "models");
fs.mkdirSync(outputDir, { recursive: true });
fs.mkdirSync(monthsDir, { recursive: true });
fs.mkdirSync(modelsDir, { recursive: true });

const fixText = (value = "") => {
  if (!value) return "";
  if (!/[鐪佷笂涓婃捣娣卞湷骞夸笢钄氬]/.test(value)) return value;
  try {
    return Buffer.from(value, "latin1").toString("utf8");
  } catch {
    return value;
  }
};

const toNumber = (value) => {
  const parsed = Number.parseInt(String(value ?? "0").trim(), 10);
  return Number.isFinite(parsed) ? parsed : 0;
};

const addToMap = (map, key, volume) => {
  map.set(key, (map.get(key) ?? 0) + volume);
};

const splitKey = (key) => key.split("\u001f");

const rowsByProvince = new Map();
const rowsByCity = new Map();
const modelProvince = new Map();
const modelCity = new Map();
const provinceModelTotals = new Map();
const modelTotals = new Map();
const manufacturerTotals = new Map();
const energyTotals = new Map();
const levelTotals = new Map();
const monthTotals = new Map();
const modelMeta = new Map();

let rowCount = 0;
let totalVolume = 0;
let provinceHeader = null;

await new Promise((resolve, reject) => {
  fs.createReadStream(csvPath)
    .pipe(
      parse({
        columns: (headers) => {
          provinceHeader = headers.find((h) => h === "省份") ?? headers[8];
          return headers;
        },
        bom: true,
        skip_empty_lines: true,
        relax_quotes: true,
        trim: true,
      }),
    )
    .on("data", (row) => {
      const month = row.month;
      const modelId = row.model_id;
      const modelName = fixText(row.model_name);
      const city = fixText(row.city);
      const province = fixText(row[provinceHeader]);
      const manufacturer = fixText(row.manufacturer);
      const energy = fixText(row.energy);
      const level = fixText(row.level);
      const price = fixText(row.price);
      const volume = toNumber(row.volume);

      if (!month || !modelId || !province || !city || !volume) return;

      rowCount += 1;
      totalVolume += volume;

      addToMap(rowsByProvince, `${month}\u001f${province}`, volume);
      addToMap(rowsByCity, `${month}\u001f${province}\u001f${city}`, volume);
      addToMap(modelProvince, `${month}\u001f${modelId}\u001f${province}`, volume);
      addToMap(modelCity, `${month}\u001f${modelId}\u001f${province}\u001f${city}`, volume);
      addToMap(provinceModelTotals, `${month}\u001f${province}\u001f${modelId}`, volume);
      addToMap(modelTotals, `${month}\u001f${modelId}`, volume);
      addToMap(manufacturerTotals, manufacturer, volume);
      addToMap(energyTotals, energy, volume);
      addToMap(levelTotals, level, volume);
      addToMap(monthTotals, month, volume);

      if (!modelMeta.has(modelId)) {
        modelMeta.set(modelId, { id: modelId, name: modelName, manufacturer, energy, level, price });
      }
    })
    .on("error", reject)
    .on("end", resolve);
});

const sortDesc = (a, b) => b.value - a.value || a.name.localeCompare(b.name, "zh-CN");
const topItems = (items, limit = 20) => items.sort(sortDesc).slice(0, limit);

const months = [...monthTotals.keys()].sort();
const models = [...modelMeta.values()]
  .map((model) => {
    const total = [...modelTotals.entries()]
      .filter(([key]) => splitKey(key)[1] === model.id)
      .reduce((sum, [, value]) => sum + value, 0);
    return { ...model, total };
  })
  .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name, "zh-CN"));

const filters = {
  manufacturers: topItems([...manufacturerTotals.entries()].map(([name, value]) => ({ name, value })), 300),
  energies: topItems([...energyTotals.entries()].map(([name, value]) => ({ name, value })), 30),
  levels: topItems([...levelTotals.entries()].map(([name, value]) => ({ name, value })), 50),
};

const monthData = {};
for (const month of months) {
  const province = [];
  const city = [];
  const modelRanking = [];
  const provinceModelRanking = {};

  for (const [key, value] of rowsByProvince.entries()) {
    const [itemMonth, name] = splitKey(key);
    if (itemMonth === month) province.push({ name, value });
  }

  for (const [key, value] of rowsByCity.entries()) {
    const [itemMonth, provinceName, cityName] = splitKey(key);
    if (itemMonth === month) city.push({ province: provinceName, name: cityName, value });
  }

  for (const [key, value] of modelTotals.entries()) {
    const [itemMonth, modelId] = splitKey(key);
    if (itemMonth === month) {
      const meta = modelMeta.get(modelId);
      modelRanking.push({ id: modelId, name: meta?.name ?? modelId, value });
    }
  }

  for (const [key, value] of provinceModelTotals.entries()) {
    const [itemMonth, provinceName, modelId] = splitKey(key);
    if (itemMonth === month) {
      const meta = modelMeta.get(modelId);
      provinceModelRanking[provinceName] ??= [];
      provinceModelRanking[provinceName].push({
        id: modelId,
        name: meta?.name ?? modelId,
        manufacturer: meta?.manufacturer ?? "",
        value,
      });
    }
  }

  for (const rows of Object.values(provinceModelRanking)) {
    rows.sort(sortDesc);
  }

  monthData[month] = {
    total: monthTotals.get(month),
    province: province.sort(sortDesc),
    city: city.sort(sortDesc),
    modelRanking: modelRanking.sort(sortDesc).slice(0, 100),
    provinceModelRanking,
  };
}

const modelData = {};
for (const model of models) {
  modelData[model.id] = {};
}

for (const [key, value] of modelProvince.entries()) {
  const [month, modelId, province] = splitKey(key);
  modelData[modelId] ??= {};
  modelData[modelId][month] ??= { total: 0, province: [], city: [] };
  modelData[modelId][month].total += value;
  modelData[modelId][month].province.push({ name: province, value });
}

for (const [key, value] of modelCity.entries()) {
  const [month, modelId, province, city] = splitKey(key);
  modelData[modelId] ??= {};
  modelData[modelId][month] ??= { total: 0, province: [], city: [] };
  modelData[modelId][month].city.push({ province, name: city, value });
}

for (const monthsForModel of Object.values(modelData)) {
  for (const item of Object.values(monthsForModel)) {
    item.province.sort(sortDesc);
    item.city.sort(sortDesc);
  }
}

for (const month of months) {
  monthData[month].models = {};
}

for (const [modelId, monthsForModel] of Object.entries(modelData)) {
  for (const [month, item] of Object.entries(monthsForModel)) {
    monthData[month].models[modelId] = item;
  }
}

const payload = {
  generatedAt: new Date().toISOString(),
  sourceFile: csvFile,
  rowCount,
  totalVolume,
  months,
  models,
  filters,
};

fs.writeFileSync(path.join(outputDir, "sales-index.json"), JSON.stringify(payload));
for (const [month, item] of Object.entries(monthData)) {
  fs.writeFileSync(path.join(monthsDir, `${month}.json`), JSON.stringify(item));
}
for (const [modelId, item] of Object.entries(modelData)) {
  fs.writeFileSync(path.join(modelsDir, `${modelId}.json`), JSON.stringify(item));
}

const oldCombined = path.join(outputDir, "sales-data.json");
if (fs.existsSync(oldCombined)) fs.rmSync(oldCombined);

console.log(`已生成 public/data/sales-index.json、months/*.json、models/*.json`);
console.log(`月份 ${months.length} 个，车型 ${models.length} 个，销量 ${totalVolume.toLocaleString("zh-CN")}。`);
