# Transaction Calculation XLS Ingest Summary

| Source file | Month | Usage date | Submission points | Usage rows | Hourly rows | Summary rows |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| 1、交易计算表1月.xls | 2026-01 | 2026-01-31 | 96 | 1248 | 744 | 144 |
| 1、交易计算表2月.xls | 2026-02 | 2026-02-28 | 96 | 1248 | 672 | 144 |
| 1、交易计算表3月.xls | 2026-03 | 2026-03-31 | 96 | 1248 | 744 | 144 |
| 1、交易计算表4月.xls | 2026-04 | 2026-04-30 | 96 | 1248 | 720 | 144 |
| 1、交易计算表5月.xls | 2026-05 | 2026-05-05 | 96 | 1248 | 120 | 144 |

Notes:
- Source files are local manual XLS files and are not committed.
- All output rows set contains_credentials=false.
- The hourly table header says 兆瓦时, but daily-row magnitudes look kWh-like; values are preserved as raw_value without automatic conversion.
- May file currently contains usage_date 2026-05-05 and only populated daily hourly rows are exported.
