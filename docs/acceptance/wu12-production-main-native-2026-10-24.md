# WU12：完整生产首页 → Windows Native 正式成品验收（2026-10-24）

**依据**：R19/R24 初版范围，路线文档 D1/D2，B02/B04/B05/B06/B07/B20/B24，A01–A03。承接主干 `2bdb2730db4172a4e0104837c5c4eb47d4daa763`（WU11 PR #131 全部 11 条 CI PASS 后合并）。

## 与 WU11 的本质区别

WU11 成功验收了同一个 Chromium 操作→真实 Windows Native Bridge→FFmpeg 同作业成品，但页面是专门构造的最小 HTML，并在挂载 `mountMediaWorkspace` 时自带测试 hooks。它不能证明真正的 `src/main.js` 曾恢复用户当前文件、通过生产输入依赖/UI 元数据、导入 ASS+字体或经过真实的字幕分析/预览。

WU12 直接访问实际发布的 `index.html`（经 Vite 运行 `src/main.js`），拒绝任何重写 `document.body.innerHTML` 或替换生产 `hooks.run`。它要求首次 bootstrap 通过 Native Bridge 恢复已经由同一 Windows Native 桥 `-InitialVideo` 选定的 rich MKV；实际 V3 导入入口回传来源绑定的内封 ASS 与字体；执行现有 `#analyze` owner 的 ASS 分析及 V3 可见“生成实际预览”以取得真实 Native libass 图像；再从生产 Manual 的可见 V3 逐轨 UI 明确选择 FLAC Copy + 必须 Copy 锁与另一轨 AAC 96kbps、完整时间和 1MB best-effort 预算。

正式执行必须由生产 `main.js` 自己的 `run` hook 经过现有 `NativeHardsub.startNativeEncode/getNativeJobStatus` 完成。测试只对原客户端的 import、budget、startEncode、poll 方法做**原样转发观察**，记录 Task v4/ASS/作业号，不伪造完成结果。随后 Windows PowerShell 根据该浏览器具体 `jobId` 找到自身 `output.mkv`，复用 WU11 独立 FFprobe/FFmpeg 验证器逐包检查 FLAC Copy、AAC 重新编码、ASS/字体与烧录像素变化，并检查真实预算测量及码率。

## 不能宣称的事情

完成这条 hosted Windows CI 才能说“生产首页调用完整且受控验收通过”。即便通过，来源仍为 CLI 预先授权的约五秒合成 rich MKV；不是用户手动在 Windows 系统选择器选择其他路径、不是保存文件夹的实际导出许可、不是长片/目标设备/播放器矩阵、不是严格输出体积上限。预检的原始 `#analyze` handler 通过脚本 DOM 调用，并非人手操作可见预检入口；V3 导入、生成预览、逐轨动作、运行按钮使用真正的浏览器可见 UI。

**当前状态：代码和 Windows CI 集成已提交，尚无此 WU12 exact-head 托管执行结果。禁止以 WU11 的已通过代替 WU12；PR 保持开放至所有精确 SHA 检查通过。**