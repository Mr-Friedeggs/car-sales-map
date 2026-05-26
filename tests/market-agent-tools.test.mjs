import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import {
  createMarketDataClient,
  derivePreviousPeriod,
  executeMarketTool,
  runMarketAgent,
} from "../supabase/functions/_shared/market-agent-core.js";

const loadJson = async (path) => JSON.parse(await readFile(new URL(`../public/${path}`, import.meta.url), "utf8"));

const dataClient = createMarketDataClient({ loadJson });

const makeEvidence = () => {
  const rows = [];
  return {
    rows,
    add(entry) {
      const item = { id: `E${rows.length + 1}`, ...entry };
      rows.push(item);
      return item;
    },
    has(id) {
      return rows.some((row) => row.id === id);
    },
    selected(ids) {
      const set = new Set(ids);
      return rows.filter((row) => set.has(row.id));
    },
  };
};

test("sales index exposes expected month coverage", async () => {
  const index = await dataClient.getIndex();
  assert.equal(index.months.length, 46);
  assert.equal(index.months.at(-1), "2026-03");
  assert.equal(index.totalVolume, 74216703);
});

test("market overview unfiltered aggregation equals latest month total", async () => {
  const evidence = makeEvidence();
  const result = await executeMarketTool("market_overview", { months: ["2026-03"], limit: 3 }, {
    dataClient,
    context: {},
    evidence,
  });
  const month = await dataClient.getMonth("2026-03");
  assert.equal(result.total, month.total);
  assert.equal(result.total, 1237236);
  assert.equal(result.evidenceIds[0], "E1");
  assert.equal(evidence.rows[0].source, "data/months/2026-03.json");
});

test("previous period keeps the same window length", () => {
  assert.deepEqual(derivePreviousPeriod(["2026-02", "2026-03"]), ["2025-12", "2026-01"]);
  assert.deepEqual(derivePreviousPeriod(["2026-03"]), ["2026-02"]);
});

test("resolve_entities maps NIO family aliases to the NIO manufacturer filter", async () => {
  const evidence = makeEvidence();
  const result = await executeMarketTool("resolve_entities", { text: "蔚来为什么最近销量大幅提升" }, {
    dataClient,
    context: { months: ["2026-03"] },
    evidence,
  });

  assert.deepEqual(result.filters.manufacturers, ["蔚来"]);
});

test("growth_drivers exposes model-level NIO monthly lift with evidence", async () => {
  const evidence = makeEvidence();
  const result = await executeMarketTool("growth_drivers", {
    months: ["2026-03"],
    baseline: "previous",
    dimension: "model",
    filters: { manufacturers: ["蔚来"] },
    limit: 5,
  }, {
    dataClient,
    context: {},
    evidence,
  });

  assert.equal(result.total, 32985);
  assert.equal(result.baseTotal, 19395);
  assert.equal(result.totalDelta, 13590);
  assert.equal(result.gainers[0].name, "蔚来ES8");
  assert.equal(result.gainers[0].delta, 5328);
  assert.equal(result.gainers[2].name, "乐道L60");
  assert.equal(result.gainers[2].delta, 1717);
  assert.ok(evidence.rows.some((row) => row.metric === "增长项销量增量" && row.dimensions.name === "乐道L60"));
});

test("agent loop executes data tool then validates finalize_report evidence", async () => {
  let calls = 0;
  const callModel = async () => {
    calls += 1;
    if (calls === 1) {
      return {
        message: {
          role: "assistant",
          content: null,
          tool_calls: [
            {
              id: "call_overview",
              type: "function",
              function: {
                name: "market_overview",
                arguments: JSON.stringify({ months: ["2026-03"], limit: 3 }),
              },
            },
          ],
        },
        usage: { prompt_tokens: 10, completion_tokens: 5 },
      };
    }

    return {
      message: {
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: "call_final",
            type: "function",
            function: {
              name: "finalize_report",
              arguments: JSON.stringify({
                title: "2026-03 市场判断",
                summary: "2026-03 总销量为 1,237,236。",
                findings: [{ claim: "最新月份销量达到 1,237,236。", evidenceIds: ["E1"] }],
                analysisPath: [{ step: "汇总最新月", tool: "market_overview", outputSummary: "完成销量汇总。" }],
                suggestedViewState: { months: ["2026-03"], modelId: null, selectedProvince: null },
              }),
            },
          },
        ],
      },
      usage: { prompt_tokens: 6, completion_tokens: 8 },
    };
  };

  const result = await runMarketAgent({
    question: "2026-03 市场表现如何？",
    context: { months: ["2026-03"] },
    dataClient,
    callModel,
  });

  assert.equal(calls, 2);
  assert.equal(result.title, "2026-03 市场判断");
  assert.equal(result.evidence[0].id, "E1");
  assert.equal(result.usage.promptTokens, 16);
  assert.equal(result.usage.completionTokens, 13);
});

test("agent loop asks for repair when final report invents unsupported causal claims", async () => {
  let calls = 0;
  const callModel = async () => {
    calls += 1;
    if (calls === 1) {
      return {
        message: {
          role: "assistant",
          content: null,
          tool_calls: [
            {
              id: "call_growth",
              type: "function",
              function: {
                name: "growth_drivers",
                arguments: JSON.stringify({
                  months: ["2026-03"],
                  baseline: "previous",
                  dimension: "model",
                  filters: { manufacturers: ["蔚来"] },
                  limit: 5,
                }),
              },
            },
          ],
        },
      };
    }

    if (calls === 2) {
      return {
        message: {
          role: "assistant",
          content: null,
          tool_calls: [
            {
              id: "call_bad_final",
              type: "function",
              function: {
                name: "finalize_report",
                arguments: JSON.stringify({
                  title: "蔚来销量大幅提升分析",
                  summary: "蔚来增长得益于低价和无强力竞争对手。",
                  findings: [{ claim: "乐道L60以低价扩大用户覆盖。", evidenceIds: ["E1"] }],
                  analysisPath: [{ step: "查找车型增量", tool: "growth_drivers", outputSummary: "已返回车型增量。" }],
                  suggestedViewState: { months: ["2026-03"], manufacturers: ["蔚来"], modelId: null, selectedProvince: null },
                }),
              },
            },
          ],
        },
      };
    }

    return {
      message: {
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: "call_good_final",
            type: "function",
            function: {
              name: "finalize_report",
              arguments: JSON.stringify({
                title: "蔚来 2026-03 环比增量拆解",
                summary: "销量数据只能说明 2026-03 较 2026-02 的增量主要来自蔚来ES8、firefly萤火虫和乐道L60，不能证明真实商业原因。",
                findings: [{ claim: "蔚来ES8是最大车型增量项，环比增加 5,328 辆。", evidenceIds: ["E3"] }],
                analysisPath: [{ step: "查找车型增量", tool: "growth_drivers", outputSummary: "已返回车型增量。" }],
                suggestedViewState: { months: ["2026-03"], manufacturers: ["蔚来"], modelId: null, selectedProvince: null },
              }),
            },
          },
        ],
      },
    };
  };

  const result = await runMarketAgent({
    question: "蔚来为什么最近销量大幅提升",
    context: { months: ["2026-03"] },
    dataClient,
    callModel,
  });

  assert.equal(calls, 3);
  assert.equal(result.title, "蔚来 2026-03 环比增量拆解");
});
