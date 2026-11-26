# Data layer fixtures

**这些文件是 2026-11-17 真实抓取的响应原样**，仅用于解析回归测试（`node scripts/test-data.mjs`）。
它们不是实时数据，**不得**在任何运行时路径中被当作行情使用（`src/` 不含读取 fixtures 的代码）。

| 文件 | 来源 | 抓取时间（Asia/Shanghai） | 用途 |
|---|---|---|---|
| `eastmoney-quote-600519-20261117.json` | 东财 `push2.eastmoney.com/api/qt/stock/get?secid=1.600519` | 2026-11-17 20:19 | 行情解析 |
| `tencent-quote-600519-20261117.txt` | 腾讯 `qt.gtimg.cn/q=sh600519`（GBK） | 2026-11-17 20:19 | 行情解析 |
| `sina-quote-600519-20261117.txt` | 新浪 `hq.sinajs.cn/list=sh600519`（GBK，带 Referer） | 2026-11-17 20:19 | 行情解析 |
| `eastmoney-valuation-600519-20261117.json` | 东财 `push2` 估值字段（PE/PB/市值/行业） | 2026-11-17 21:00 | 估值解析 |
| `eastmoney-financials-600519-20261117.json` | 东财 `datacenter-web` F10 主要指标（5 期） | 2026-11-17 21:00 | 财报解析 + point-in-time |
| `eastmoney-kline-600519-20261103-20261117.json` | 东财日 K（fqt=1 前复权） | 2026-11-17 20:20 | 日 K 解析 |
| `tencent-kline-600519-20261110-20261117.json` | 腾讯日 K（qfq） | 2026-11-17 20:20 | 日 K 解析（缺成交额） |
| `eastmoney-announcements-600519-20261117.json` | 东财公告列表（5 条） | 2026-11-17 22:10 | 公告解析 + point-in-time |
| `eastmoney-news-search-600519-20261117.txt` | 东财新闻搜索（JSONP，5 条） | 2026-11-17 22:10 | 新闻解析 + point-in-time |
| `eastmoney-moneyflow-600519-20261117.json` | 东财日级资金流（10 日） | 2026-11-17 22:10 | 资金流解析 |
| `eastmoney-index-kline-20261117-trading.json` | 东财上证指数单日 K（交易日） | 2026-11-17 20:20 | 交易日校验 |
| `eastmoney-index-kline-20261115-nontrading.json` | 东财上证指数单日 K（周日） | 2026-11-17 20:20 | 交易日校验 |
| `tencent-index-kline-20261117-trading.json` | 腾讯上证指数单日 K（交易日） | 2026-11-17 20:21 | 交易日校验降级 |
| `tencent-index-kline-20261115-nontrading.json` | 腾讯上证指数单日 K（周日） | 2026-11-17 20:21 | 交易日校验降级 |

抓取命令（原样，可重放；重放会得到当日数据，不保证与 fixture 逐字相同）：

```sh
curl -s "https://push2.eastmoney.com/api/qt/stock/get?secid=1.600519&fields=f43,f44,f45,f46,f47,f48,f57,f58,f60,f86,f169,f170&ut=fa5fd1943c7b386f172d6893dbfba10b"
curl -s "https://qt.gtimg.cn/q=sh600519"
curl -s -e "https://finance.sina.com.cn" "https://hq.sinajs.cn/list=sh600519"
curl -s "https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=1.600519&klt=101&fqt=1&beg=20261103&end=20261117&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61&ut=fa5fd1943c7b386f172d6893dbfba10b"
curl -s "https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=sh600519,day,2026-11-10,2026-11-17,10,qfq"
# 基本面（估值 + 主要财务指标）
curl -s "https://push2.eastmoney.com/api/qt/stock/get?secid=1.600519&fields=f57,f58,f43,f116,f117,f162,f163,f164,f167,f127,f128&ut=fa5fd1943c7b386f172d6893dbfba10b"
curl -s "https://np-anotice-stock.eastmoney.com/api/security/ann?sr=-1&page_size=5&page_index=1&ann_type=A&client_source=web&stock_list=600519&f_node=0&s_node=0"
curl -s --get "https://search-api-web.eastmoney.com/search/jsonp" --data-urlencode 'cb=cb' --data-urlencode 'param={"uid":"","keyword":"600519","type":["cmsArticleWebOld"],"client":"web","clientType":"web","clientVersion":"curr","param":{"cmsArticleWebOld":{"searchScope":"default","sort":"default","pageIndex":1,"pageSize":5,"preTag":"","postTag":""}}}'
curl -s "https://push2his.eastmoney.com/api/qt/stock/fflow/daykline/get?lmt=10&klt=101&secid=1.600519&fields1=f1,f2,f3,f7&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61,f62,f63,f64,f65&ut=fa5fd1943c7b386f172d6893dbfba10b"
curl -s --get "https://datacenter-web.eastmoney.com/api/data/v1/get" --data-urlencode 'reportName=RPT_F10_FINANCE_MAINFINADATA' --data-urlencode 'columns=ALL' --data-urlencode 'filter=(SECUCODE="600519.SH")' --data-urlencode 'pageNumber=1' --data-urlencode 'pageSize=5' --data-urlencode 'sortColumns=REPORT_DATE' --data-urlencode 'sortTypes=-1' --data-urlencode 'source=HSF10' --data-urlencode 'client=PC'
```

> 新增 fixture 必须：① 来自真实源（不是手写）；② 在 `README` 记录来源与抓取时间；③ 对应测试断言来自字段实测，不来自猜测。
