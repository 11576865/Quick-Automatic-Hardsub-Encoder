# B16 — FLAC 已编码音轨缓存进入最终混合封装的逐包复用证明

日期：2026-10-14
状态：实验性可执行工程证明与 Draft Windows CI 已提交到 PR #105 工作分支；生产任务复用与严格预算准入尚未完成。

## 为什么这是上一阶段之后的必要一步

此前 Windows B16 已真实通过：多轨 FLAC 全段/裁切预编码、隔离复制流、Native HTTP 生命周期、182 秒异步成品音视频逐流 FFprobe、成品字节与 FILETIME/Job 身份和篡改失效。此前尝试的“预编码音轨包字节对比最终混合封装”只证明**两个相互独立编码输出**的包字节差异/相同，不能保证将来某一批 FLAC 音频字节数预先固定。

本批改换执行方式：将 FLAC **实际编码一次**到 Matroska 音频缓存，再在正式视频+软字幕混合输出中将缓存的 FLAC 通过 `-map` / `-c:a copy` 原样带入。用 FFprobe 对比双方每一个有序编码包的 `size` 与 `data_hash=SHA256`，而不只看包字节合计。如此证明本次最终输出确实保留了缓存的编码音频负载，是后续精确固定音频成本的可执行基础。

## 新增代码

- `src/flac-cache-reuse-contract.js`：接收当前源 SHA-256、完整源流 measurementId、缓存及成品制品 SHA-256、Windows FILETIME 字符串、正式作业 ID、编码方案、视频与软字幕确实存在、逐音轨 source/cache/outputOrdinal 和 full/trim、声道/采样率；强制 Matroska + `audioCodec=copy`。每条音轨的包数、包字节数、有序包数据哈希一致才通过。所有不相容情形 **fail closed**。
- `src/flac-cache-reuse-contract.test.mjs`：六组隔离行为测试包括错源、错制品、源文件身份、混淆编码/复制策略、流重排/漏流、时间范围漂移、不同编码包哈希/长度和溢出；还有一组真实 FFmpeg 跨平台运行测试（当 `QHE_B16_REAL_PACKET_FIXTURE=1`）：生成 3 秒 FFV1+双 PCM+软字幕 → 一条完整与一条 0.4–2.4 秒 FLAC 缓存 → 将缓存复制进 x264+软字幕最终 MKV → 独立对每条缓存/成品音轨读取 FFprobe `-show_data_hash sha256`，计算有序序列 SHA-256 并验证。还要求最终容器有一条视频、两条 FLAC 和一条软字幕，并注入错误包哈希证明拒收。
- `.github/workflows/windows-b16-runtime.yml`：Draft 精准 CI 的 FFmpeg 安装步骤后新增真实 FLAC 缓存复用测试；前端 Draft-fast 和完整 Node 均执行六组纯测试。

## 真实本地对照

Linux FFmpeg 曾在同样的 3 秒小型合成视频/双 PCM/SRT、缓存 FLAC 后复制至最终混合 MKV 的命令链下通过：完整音轨 32 个包、39,300 字节，裁切音轨 21 个包、27,599 字节，缓存/最终两轨每包有序 `(size, SHA256)` 序列一致。这是**Linux 本地具体样本**，不代表所有容器、时间轴、FFmpeg 版本或 Windows Native 正式任务已验收。

另外六组实际 GitHub JS 模块 V8 隔离行为测试 PASS。托管 exact-head Node/Windows 和真实正式任务复用尚 Pending。

## 证据权限：永不从观察直接跃迁为严格大小预测

本批收据即使 `ok:true`，仍明确 `canAuthorizeStrictBudget:false`、`canPredictNextJobSize:false`、`canRebaseWholeSourceLedger:false`。它只证明**本次已经完成**的混合成品复用了对应缓存包。不能把本次混合成品的头部、音轨 extradata、索引、章节、PTS / 时基、附件、或其他封装开销外推给下一批任务；甚至同一源再次渲染时也需要执行新的独立一致性验证。

真正进入 B16 形式化预算采纳仍必须：让生产正式任务在开始前**持有并安全验证那个可复用 FLAC 缓存**，把正式音频轨映射从 `flac encode` 切换到 `-c copy` 已编码制品；证明所有音轨流参数、时间裁切范围、PTS/DTS、缓存不可变内容哈希与 FFmpeg 参数；保留视频成本/最终 mux 上界余量与严格输出验收。当前 `src/media-planning.js::sizeBudget` 中 FLAC 成本未知的拒绝规则继续有效。

B16 的生产复用、跨端、真实长片和完整理论初版 B01–B25/A01–A10 的验收不因本批实验性证明被降格或提前签收。
