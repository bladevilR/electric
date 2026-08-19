## ADDED Requirements

### Requirement: Accepted visible rows accumulate durably
系统 SHALL 仅把通过现有敏感字段和业务字段校验的快照写入持久历史，并 SHALL 按交易日与点位幂等累计非空业务字段。

#### Scenario: New trading day is collected
- **WHEN** 一个包含新交易日有效业务行的快照被接受
- **THEN** 系统保留已有日期并增加新日期的业务行

#### Scenario: Same trading day is recollected
- **WHEN** 同一交易日和点位再次出现且带有新的非空业务字段
- **THEN** 系统补齐或更新该键而不产生重复行

#### Scenario: Snapshot contains sensitive fields
- **WHEN** 快照包含 Cookie、Token、密码、证书或 UKey PIN 类字段
- **THEN** 系统拒绝该快照且不得改变持久历史

### Requirement: Windows history survives package upgrades
Windows 启动器 SHALL 将持久历史路径设置在当前用户的 LocalAppData 下，而不是压缩包解压目录内。

#### Scenario: New package starts after an upgrade
- **WHEN** 用户从任意新解压目录启动系统
- **THEN** 服务读取 `%LOCALAPPDATA%\ElectricTradingAI\data\ukey-visible-history.json` 中已有历史

### Requirement: Existing snapshot is migrated once
系统 SHALL 在持久历史尚不存在时读取当前包内已有的接受快照并将其纳入历史。

#### Scenario: Legacy snapshot exists and history is absent
- **WHEN** 首次启动发现旧快照已接受且持久历史文件不存在
- **THEN** 旧快照行被写入持久历史并参与日期累计

