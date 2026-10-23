# QHE 中央源帧预览：来源实例与缓存失效边界（2026-10-23）

## 授权范围
依据 R19/R24 初版及 `docs/qhe-initial-version-route-reanchor-2026-10-14.md` 的 B03/B09/B20/A04。本切片不是新增编解码器、不是多来源批处理，也不重建第二套预览解码器。PR #124 的中央实际取帧已经在精确主干提交 `d804e5fc4a3e5907c01c620862351020c4d67c3d` 完成集成；这是其来源正确性修正。

## 真实用户场景与已定位问题
A、B 两个 `File` 可以具有完全相同的 `name`、`size`、`lastModified`，也可以在抽取指定时间画面时生成**完全相同的 PNG 字节**。旧 `main.js` 元数据键值不能区分 A/B，中央 `workbench-v3.js` 又把相同旧图像 URL 视为旧帧，因此可能误用旧时间轴，或把新来源已经解码成功的相同图像永远隐藏。图像 URL 的文本差异不是足够的媒体来源身份证明。

## 本轮实现
- `main.js` 向正式 `media-workspace.js` 单一解码所有者注入仅运行时有效的 `sourceAsset() => state.video`，不变更持久化 fingerprint / task schema。
- `quick-hardsub-media-info-changed` 到来时，仅在源对象真实更换才清除源帧缓存及在途 request generation、波形、关键帧、标尺、请求/实际 IN 边界帧，并展示需重新读取的状态；非来源变更不打断用户操作。
- 时间轴异步处理同样核对完整源对象身份，来源发生替换后拒绝旧结果，旧失败不覆盖新来源状态。
- `scripts/check-source-import-entry.cjs` 使用真实前端 + Windows Native Client + **模拟** HTTP，先生成源帧，再通过 Native 选择另一个元数据完全相同的文件，确保旧画面和时间轴被隐藏，重新发出 `/api/frame` 并允许相同 PNG data URL 的新画面出现在中央。

## 验证边界
代码已提交到独立分支。上述 Playwright 新断言属于 **Committed / Pending CI**，并非本会话在用户 Windows 机器上运行 FFmpeg 的真实验证。B03/B09/B20/A04 仍为局部相关，不关闭整项；复杂 VFR/B 帧、long-form、多音轨剪切/保留、实际播放器仍是 Field Pending。

## 后续判定
先看精确 head 的 GitHub CI；任一失败只做一次针对性修复，不为获得绿色结果松动同元数据/同 PNG 身份回归约束；未通过完整前端 CI 前不合并。
