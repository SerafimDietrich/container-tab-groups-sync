module.exports = {
  sourceDir: "dist",
  verbose: true,
  build: {
    overwriteDest: true,
  },
  run: {
    firefox: "C:\\Program Files\\Firefox Developer Edition\\firefox.exe",
    watchFile: ["dist/*", "dist/**/*"],
    startUrl: [
      "about:debugging#/runtime/this-firefox",
      "about:addons",
      "https://addons.mozilla.org/firefox/downloads/file/4494279/multi_account_containers-8.3.0.xpi",
    ],
  },
};
