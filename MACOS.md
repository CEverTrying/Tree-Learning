# TreeLearning 树学 · macOS Apple Silicon

## 使用方法

版本：0.1.9。适用于 Apple Silicon（M 系列芯片），最低 macOS 12，不适用于 Intel Mac。

1. 下载并完整解压 `TreeLearning-0.1.9-macOS-arm64.zip`。
2. 打开 `TreeLearning.app`，也可先将它拖入“应用程序”文件夹。
3. 在“模型设置”中填写模型接口、名称和密钥；无需另装 Node.js。

本包在 Linux 上交叉构建，已核对 arm64 可执行文件、应用信息、框架符号链接和包内源码，未在 Mac 实机启动验证。应用尚无 Apple 开发者签名和公证，首次运行可能被 macOS 阻止。确认下载来源可信后，可在“系统设置 → 隐私与安全性”中使用“仍要打开”。

如果系统报告应用已损坏或签名无效，确认 ZIP 完整且来源可信后，可将应用移到“应用程序”，仅针对这个应用执行：

```bash
xattr -dr com.apple.quarantine /Applications/TreeLearning.app
codesign --force --deep --sign - /Applications/TreeLearning.app
```

以上是本机临时签名，不等同于 Apple 开发者签名或公证，不需要关闭系统整体安全保护。如仍无法运行，请记录完整错误信息以便排查。

## 数据与迁移

数据默认保存在 `~/Library/Application Support/treelearning/`，可通过软件菜单“文件 → 打开数据文件夹”查看。跨 Windows 与 Mac 迁移时，在原设备导出完整 ZIP 备份，再在新设备恢复；密钥需重新填写。程序 ZIP 与学习数据 ZIP 用途不同。

## 从源码打包

在 Mac 上安装 Node.js 22.19 或更新版本后，在源码目录运行：

```bash
npm ci
npm run dist:mac
```

该命令生成 arm64 ZIP，不生成 DMG，不上传发布。正式分发前应在 macOS 上完成签名、公证和实机验证。
