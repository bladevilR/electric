# JSPEC Standard 96 Quality Report

Generated at: 2026-05-12T02:24:57.633Z
Rows: 192
Dates: 2026-05-12, 2026-05-13

## Sources

| Source | Captures | Standard rows | Files |
| --- | ---: | ---: | --- |
| user_bid_96 | 3 | 288 | 036-www-jspec-com-cn-px-spotgoods-province-mosenergybidinfouser-getmosenergybidinfouser.json<br>040-www-jspec-com-cn-px-spotgoods-province-mosenergybidinfouser-getmosenergybidinfouser.json<br>043-www-jspec-com-cn-px-spotgoods-province-mosenergybidinfouser-getmosenergybidinfouser.json |
| user_default_bid_96 | 3 | 288 | 052-www-jspec-com-cn-px-spotgoods-province-mosenergybidinfouser-getmosenergybidinfouserdefault.json<br>056-www-jspec-com-cn-px-spotgoods-province-mosenergybidinfouser-getmosenergybidinfouserdefault.json<br>058-www-jspec-com-cn-px-spotgoods-province-mosenergybidinfouser-getmosenergybidinfouserdefault.json |
| dayahead_user_clearing | 1 | 96 | 062-www-jspec-com-cn-px-spotgoods-province-dd2jyuserclearingresult-querydd2jyrqclearing.json |
| dayahead_public_clearing | 1 | 96 | 065-www-jspec-com-cn-px-spotgoods-province-dayclearingresult-querytablexrdonlyjiesuan.json |
| realtime_public_clearing | 1 | 96 | 067-www-jspec-com-cn-px-spotgoods-province-curclearingresult-querytablexrdonlyjiesuan.json |
| realtime_average_price | 1 | 96 | 069-www-jspec-com-cn-px-spotgoods-province-realtimeclearingrelease-queryrealtimemaravepricepublic.json |
| actual_load_96 | 0 | 0 | - |
| settle_day | 1 | 0 | 071-www-jspec-com-cn-px-js-outer-deferrableload-trandeclare-querydaysettleresult.json |

## Field Completeness

| Field | Non-empty rows |
| --- | ---: |
| date | 192 |
| pointIndex | 192 |
| timePoint | 192 |
| declarationPower | 0 |
| declarationPowerUpper | 0 |
| declarationPowerLower | 0 |
| declarationStartStopState | 0 |
| declarationPercent | 0 |
| defaultDeclarationPower | 96 |
| defaultDeclarationPowerUpper | 0 |
| defaultDeclarationPowerLower | 0 |
| defaultDeclarationStartStopState | 0 |
| defaultDeclarationPercent | 0 |
| dayAheadUserMediumLongPower | 0 |
| dayAheadUserStandardPower | 0 |
| dayAheadUserSumPower | 0 |
| dayAheadUserClearingPower | 0 |
| dayAheadUserPrice | 0 |
| dayAheadUserPriceFinal | 0 |
| dayAheadUserSouthPrice | 0 |
| dayAheadUserNorthPrice | 0 |
| dayAheadPublicClearingPower | 0 |
| dayAheadPublicPrice | 0 |
| dayAheadPublicSouthPrice | 0 |
| dayAheadPublicNorthPrice | 0 |
| dayAheadPublicSouthNodePrice | 0 |
| dayAheadPublicNorthNodePrice | 0 |
| realTimeSouthPrice | 0 |
| realTimeNorthPrice | 0 |
| realTimeSouthNodePrice | 0 |
| realTimeNorthNodePrice | 0 |
| realTimeSouthReleaseType | 0 |
| realTimeNorthReleaseType | 0 |
| realTimeClearingPower | 0 |
| realTimeAvgPrice | 57 |
| realTimePointPrice | 0 |
| realTimeAvgPriceCurrent | 0 |
| realTimePointPriceCurrent | 0 |
| realTimeAvgPriceFinal | 0 |
| realTimePointPriceFinal | 0 |
| actualKwh | 0 |
| settleAmount | 0 |

## Gaps

- [high] actual_load_96_missing: P0 source actual_load_96 was not captured.
- [medium] settle_day_empty: P0 source settle_day was captured but returned no standard rows.
- [medium] mixed_dates: Captured rows span 2 dates. This can be valid, but downstream strategy should not compare day-ahead and real-time rows as the same day without checking date.
