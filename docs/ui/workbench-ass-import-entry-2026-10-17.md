# 来源 ASS 与字体导入入口 · 2026-10-17

## 授权与范围

用户继续实现桌面/平板实际功能，沿用发布与主线集成授权。本单元重新读取R19§05/07/12、R24§07、初版根范围/路线/追踪矩阵，锚定B07/A01/B18/B20。此前工具栏“提取对象”只弹待接入提示，实际Windows内封ASS及字体导入能力隐藏在依赖区域。本轮优先接通ASS旗舰的来源操作；不把导入等同通用提取、字幕保留、自动字体匹配或跨端内封导入。

## 实现

工具栏明确命名“导入 ASS 与字体”，展开菜单提供外置ASS、外置字体、内封ASS与字体三种路径。外置路径调用原网页file input或原Native系统选择器；内封路径展开原依赖区域并聚焦唯一的原字幕轨selector，用户再点击原导入按钮才会提取。未复制控件或重挂载来源状态，不自动挑轨、导入或覆盖素材，不更改保留选项。

菜单由独立presentation模块管理。非硬字幕任务、运行或导入进行中拒绝操作；内封路径需Windows Native方法、当前source/media以及原面板的有效ASS选项。新来源尚未探测、无ASS或不支持端显示真实能力原因。Escape关闭菜单并归还触发器焦点。原Native文件/字体大小限制、来源绑定及导入结果处理仍归main/client/Bridge所有。

## 验证

新增basic入口断言先以缺失明确入口失败，实施后完整basic专项通过。新增check-source-import-entry.cjs纳入完整浏览器套件，使用真实main与Windows client、模拟Bridge HTTP：原外置ASS/字体选择器回填，内封字幕序号1请求与源名/大小，原导入失败后重试，素材状态更新，打开菜单不自动提取，保留选项未被导入改写。更换来源期间probe pending、无ASS、运行锁及非硬字幕禁用通过。另以Web真实filechooser选择外置ASS验证用户激活链；1440/1194/834/768无溢出。

Node439项：427通过/12跳过/0失败；构建成功，既有bundle提示保留。独立审查发现外置文件选择后焦点落到已隐藏菜单；新增断言先复现失败，再修复为调用原选择器前聚焦可见工具栏入口。Native取消选择保持原ASS和焦点、Web filechooser完成后焦点均通过；完整check-media-ui（包含新增真实来源导入专项）、check-expected-workbench的11宽度×3工作流、basic及最终Node/构建均通过；独立复查已关闭焦点Minor，无必要问题。中文平板菜单截图复看可读。Bridge响应和字体样本为模拟，未重新执行真实提取/字体解析/libass渲染，不关闭A01或真实设备验收。既有Windows hosted证据仍仅绑定其原SHA和合成素材，见wu02-windows-embedded-ass-source-import-2026-10-14.md。

PR122的frontend38930278715、UIGS38930278785及Branch hygiene38930315328均已核实success。

UIGS Intake 查询picker focus，关联既有QHE functional UI Case中的隐形file input焦点与取消语义观察，本轮将补充菜单关闭/Native按钮临时禁用的窄Test证据，不提升Canonical。

## 主线与Intake结果

[PR123](https://github.com/11576865/Quick-Automatic-Hardsub-Encoder/pull/123) 已从 `c0957e7b195f71fd5eae628d152615f1f6e035cc` 合入 `main@e85b8a28ae09d36b66641e67922c7d4fd4507d25`，发布前树与本地验证树一致。

唯一一次即时读取：Frontend38932013113 in_progress，UIGS38932013175 completed/success。托管验证与部署保持Pending External Validation，不同步等待或宣称上线。

Foundry Test `inbox/tests/2026-10-17-qhe-import-menu-file-picker-focus.md` 已写入提交 `d64c8404eeac9acbf162906f66c8d905760a9888`，记录焦点反例及Native取消/Web选择的有界证据，不修改Canonical。
