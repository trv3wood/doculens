const { app, BrowserWindow, protocol, session } = require("electron");
const path = require("node:path");

app.setName("DocuLens");

protocol.registerSchemesAsPrivileged([
  { scheme: "app", privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

app.whenReady().then(() => {
  protocol.registerSource("app", {
    routes: [
      {
        match: { host: "doculens" },
        source: { type: "directory", root: path.join(__dirname, "../dist/desktop") },
      },
    ],
  });

  session.defaultSession.on("will-download", (_event, item) => {
    item.setSaveDialogOptions({
      title: "保存扫描件",
      defaultPath: path.join(app.getPath("documents"), item.getFilename()),
    });
  });

  const window = new BrowserWindow({
    width: 1100,
    height: 850,
    autoHideMenuBar: true,
  });
  void window.loadURL("app://doculens/");
});

app.on("window-all-closed", () => app.quit());
