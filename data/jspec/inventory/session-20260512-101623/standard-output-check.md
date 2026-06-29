# JSPEC Standard 96 Output Check

Rows: 192
Dates: 2026-05-12, 2026-05-13

## Row Count Explanation

192 standard row(s) = 2 date(s) x 96 quarter-hour points. Source row totals (960) count rows before merge/deduplication by date + timePoint.

## Date Distribution

| Date | Standard rows |
| --- | ---: |
| 2026-05-12 | 96 |
| 2026-05-13 | 96 |

## Source Row Counts

| Source | Rows before merge |
| --- | ---: |
| dayahead_public_clearing | 96 |
| dayahead_user_clearing | 96 |
| realtime_average_price | 96 |
| realtime_public_clearing | 96 |
| settle_day | 0 |
| user_bid_96 | 288 |
| user_default_bid_96 | 288 |

## Zero Non-Empty Fields

- actualKwh
- dayAheadPublicClearingPower
- dayAheadPublicNorthNodePrice
- dayAheadPublicNorthPrice
- dayAheadPublicPrice
- dayAheadPublicSouthNodePrice
- dayAheadPublicSouthPrice
- dayAheadUserClearingPower
- dayAheadUserMediumLongPower
- dayAheadUserNorthPrice
- dayAheadUserPrice
- dayAheadUserPriceFinal
- dayAheadUserSouthPrice
- dayAheadUserStandardPower
- dayAheadUserSumPower
- declarationPercent
- declarationPower
- declarationPowerLower
- declarationPowerUpper
- declarationStartStopState
- defaultDeclarationPercent
- defaultDeclarationPowerLower
- defaultDeclarationPowerUpper
- defaultDeclarationStartStopState
- realTimeAvgPriceCurrent
- realTimeAvgPriceFinal
- realTimeClearingPower
- realTimeNorthNodePrice
- realTimeNorthPrice
- realTimeNorthReleaseType
- realTimePointPrice
- realTimePointPriceCurrent
- realTimePointPriceFinal
- realTimeSouthNodePrice
- realTimeSouthPrice
- realTimeSouthReleaseType
- settleAmount

## Known Gaps

- [high] actual_load_96_missing: P0 source actual_load_96 was not captured.
- [medium] settle_day_empty: P0 source settle_day was captured but returned no standard rows.
- [medium] mixed_dates: Captured rows span 2 dates. This can be valid, but downstream strategy should not compare day-ahead and real-time rows as the same day without checking date.
