# 汽车市场分析 Agent

## 架构

Agent 由前端右侧工作台和 Supabase Edge Function `market-agent` 组成。浏览器只提交业务问题、邀请码会话和当前筛选上下文；MiniMax API Key 只放在 Edge Function 环境变量中。

Edge Function 的分析流程：

1. 校验 `sessionToken` 是否存在于 `invite_sessions`。
2. 按 `AGENT_MAX_REQUESTS_PER_HOUR` 对同一会话限流。
3. 按需读取 `MARKET_DATA_BASE_URL/data/sales-index.json` 和 `data/months/*.json`。
4. 调用 MiniMax M2.7 的 OpenAI-compatible tool calling 接口。
5. 执行受控数据工具并生成 evidence id。
6. 强制模型调用 `finalize_report`，返回结构化结论、分析路径和证据链。
7. 通过现有 `log_visit_event` 记录 `agent_analysis_completed` 或 `agent_analysis_failed`。

## 前端环境变量

```env
VITE_SUPABASE_URL=https://your-project-ref.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
VITE_MARKET_AGENT_URL=https://your-project-ref.supabase.co/functions/v1/market-agent
```

如果不配置 `VITE_MARKET_AGENT_URL`，前端会默认使用 `${VITE_SUPABASE_URL}/functions/v1/market-agent`。Agent 仅在 Supabase 邀请访问已配置且用户有有效 session 时可用。

## Edge Function Secrets

在 Supabase 项目中设置：

```bash
supabase secrets set MINIMAX_API_KEY=your-minimax-key
supabase secrets set MINIMAX_BASE_URL=https://api.minimaxi.com/v1
supabase secrets set MINIMAX_MODEL=MiniMax-M2.7
supabase secrets set MARKET_DATA_BASE_URL=https://your-site.example.com
supabase secrets set AGENT_MAX_REQUESTS_PER_HOUR=20
```

Supabase 默认会提供 `SUPABASE_URL`、`SUPABASE_ANON_KEY` 和 `SUPABASE_SERVICE_ROLE_KEY`。服务端会优先使用 service role 校验邀请会话；不要把 service role 或 MiniMax key 放进前端环境变量。

`MARKET_DATA_BASE_URL` 应指向能访问静态 `public/data` 的站点根地址，例如 GitHub Pages 或生产站点根 URL，不要以 `/data` 结尾。

## 部署

```bash
supabase functions deploy market-agent --no-verify-jwt --use-api
```

Agent 函数使用 `--no-verify-jwt` 部署，避免新版 publishable key 被 Edge Function 网关当作无效 JWT 拦截。业务访问控制仍以函数内部的邀请码 `sessionToken` 校验为准。

## 数据工具

当前工具集：

- `resolve_entities`：解析问题中的月份、车型、厂商、能源和级别候选。
- `market_overview`：汇总销量、Top 省份、Top 城市、Top 车型。
- `trend_series`：输出逐月趋势和环比。
- `growth_drivers`：对比上期或去年同期，识别增长/下滑驱动。
- `compare_segments`：对比车型或细分市场。
- `regional_opportunities`：识别强势、弱势和集中度。
- `finalize_report`：强制最终结构化输出，必须引用 evidence id。

第一版不做流式输出，不接外部网页搜索；结论只基于仓库静态销量 JSON。
