# Container Tab Groups Synchronisation

This Firefox extension automatically synchronizes tab groups with contextual identities (Firefox Multi-Account Containers). It is designed for Firefox 139+ and leverages the latest browser APIs for tab group and container management.

https://github.com/user-attachments/assets/7bc323e7-e437-4dc8-9b18-8a8951ca8110

## Features

- **Automatic Container Management:**
  - Creates a contextual identity (container) for each tab group, using the group’s name and color.
  - Moves tabs into their corresponding containers when a tab group is created or updated.
  - Cleans up containers when tab groups are removed, including moving tabs back to the default container.
- **Automatic Deletion of Containers:**
  - When a tab group is deleted, the extension deletes the associated container (contextual identity).
- **Tab State Handling:**
  - Handles discarded and incomplete tabs robustly, activating or reloading them as needed before moving.
- **Concurrency and Race Condition Prevention:**
  - Uses locking mechanisms to prevent race conditions when moving tabs or creating/deleting containers.
- **Persistent Mapping:**
  - Maintains a persistent mapping between tab group IDs and container IDs in extension storage.
- **Logging:**
  - Logs all major operations and errors to the console for easier debugging.
- **Localization:**
  - Uses extension-localized strings for default container names.

## Installation

### Through the Firefox Add-on store

Visit [https://addons.mozilla.org/de/firefox/addon/container-tab-groups-sync/](https://addons.mozilla.org/de/firefox/addon/container-tab-groups-sync/) and click "Add to Firefox"!

### Manually

To install this extension, follow these steps:

1. **Download the Extension File:**

   - Download the extension file from the [releases page](https://github.com/SerafimDietrich/container-tab-groups-sync/releases).
2. **Open Firefox Add-ons Page:**

   - Open Firefox and type `about:addons` in the address bar, then press Enter.
3. **Install the Extension:**

   - In the Add-ons Manager tab, click on the gear icon in the top-right corner and select "Install Add-on From File."
   - Navigate to the location where you downloaded the file, select it, and click "Open."
4. **Enable Unsigned Extensions (if necessary):**

   - Since this extension is not signed by Mozilla, you may need to enable the installation of unsigned extensions. (May only be possible with Firefox Developer Edition or Firefox Beta) To do this:
     - Type `about:config` in the address bar and press Enter.
     - Search for `xpinstall.signatures.required`.
     - Double-click on the preference to set it to `false`.

You should now see the extension listed in your Add-ons Manager.

## Getting Started

These instructions will help you set up the project for development and testing.

### Prerequisites

- [Node.js](https://nodejs.org/) and npm
- Firefox Developer Edition (recommended for testing)

### Setup

1. **Clone the repository:**
   ```bash
   git clone https://github.com/SerafimDietrich/container-tab-groups-sync.git
   cd container-tab-groups-sync
   ```
2. **Install dependencies:**
   ```bash
   npm install
   ```

### Build & Run

1. **Build the extension:**

   ```bash
   npm run build
   ```

   This compiles TypeScript and copies non-TypeScript files to `dist/`.
2. **Run in Firefox:**

   ```bash
   npm run serve
   ```

   This launches the extension in Firefox using `web-ext` from the `dist/` directory.

### Packaging

To build a distributable artifact (build the extension beforehand):

```bash
npm run build-artifact
```

## Project Structure

- `src/` – Source code for the extension
  - `_locales/` – Localization files
  - `icons/` – Icons
  - `background.ts` – Main background script
  - `manifest.json` – Extension manifest
- `.prettierrc` – Prettier configuration
- `eslint.config.js` – ESLint configuration
- `package.json` – Project metadata and scripts
- `tsconfig.json` – TypeScript configuration
- `web-ext-config.cjs` – Configuration for web-ext

## Code Style

- This project uses [ESLint](https://eslint.org/) for linting and [Prettier](https://prettier.io/) for code formatting.
- TypeScript is used for type safety. Some Firefox APIs (e.g., `tabGroups`) may not be present in TypeScript definitions; use `@ts-ignore` where necessary.
- All user-facing strings should use extension localization (i18n) where possible.

## Important Behavior and Limitations

- **Container Deletion:** The extension deletes containers it created for tab groups when those groups are removed. If you assign an existing container to a group, it may be deleted if the group is deleted.
- **No ES Modules:** The background script must not use ES module imports/exports. Use only top-level code and CommonJS style.
- **Firefox-Only:** This extension is designed for Firefox 139+ and will not work in browsers without tab group and contextual identity support.
- **TypeScript API Gaps:** Some Firefox APIs (e.g., `tabGroups`) may not be present in TypeScript definitions. The code uses `@ts-ignore` where necessary.

## Versioning

This project uses semantic versioning in the format: **x.y.z**

- **Major (x):** Increased for major changes. Resets feature (y) and hotfix (z) to zero when incremented.
- **Feature (y):** Increased for new features (with or without bug fixes). Resets hotfix (z) to zero when incremented.
- **Hotfix (z):** Increased for bug fixes only.

## Contributing

Contributions are welcome! To contribute:

1. Fork the repository and create your branch from `master`.
2. Ensure your code is clean, well-documented, and passes linting/formatting checks.
3. Add or update tests if applicable.
4. Submit a pull request with a clear description of your changes.

For major changes, please open an issue first to discuss what you would like to change.

## License

This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for details.
