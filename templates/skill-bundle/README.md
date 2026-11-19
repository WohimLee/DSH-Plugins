# {{slug}}

由 skill-bundle 模板生成的插件起点，尚未实现业务功能。请填写用途、验收、配置、失败行为与限制，并替换示例。

## 开发

```sh
pnpm install
pnpm check
pnpm pack --pack-destination <临时目录>
```

源码构建使用本包 devDependencies；tarball 安装不需要源码构建。测试安装须使用隔离 DSH_HOME；Web 通过 dsh plugin --profile web add 安装，Desktop 通过应用插件管理器安装。

DSH 基线 0.2.2-rc.5；Web/Desktop 支持状态以 plugin.meta.json 的验证证据为准，目前未验证。当前包 private=true，发布前确定许可证与包名归属。
