# Container Tab Groups Synchronisation

This Firefox extension automatically synchronizes tab groups with contextual identities (Firefox Multi-Account Containers). It is designed for Firefox 139+ and leverages the latest browser APIs for tab group and container management.

https://github.com/user-attachments/assets/7bc323e7-e437-4dc8-9b18-8a8951ca8110

## Features

- **Automatic Container Management:**
  - Creates a new contextual identity (container) for each tab group, using the group’s name and color.
  - Moves tabs into their corresponding containers when a tab group is created or updated.
  - Cleans up containers when tab groups are removed, including moving tabs back to the default container.
- **Automatic Deletion of Containers:**
  - When a tab group is deleted, the extension will also delete the associated container (contextual identity).
  - **Warning:** If you manually assign a container to a tab group, the extension may delete that container if the group is removed. Only containers created by the extension are tracked, but if you assign an existing container to a group, it may be deleted when the group is deleted.
- **Tab State Handling:**
  - Handles discarded and incomplete tabs robustly, activating or reloading them as needed before moving.
  - Ensures tabs are not lost or duplicated during moves between containers.
- **Concurrency and Race Condition Prevention:**
  - Uses locking mechanisms to prevent race conditions when moving tabs or creating/deleting containers.
  - All tab and group operations are protected by locks and timeouts to ensure consistency and avoid deadlocks.
- **Persistent Mapping:**
  - Maintains a persistent mapping between tab group IDs and container IDs in extension storage.
  - Cleans up mappings if containers or groups are removed externally.
- **Logging:**
  - Logs all major operations and errors to the console for easier debugging and transparency.
- **Localization:**
  - Uses extension-localized strings for default container names (e.g., "Unnamed Group").

## Important Behavior and Limitations

- **Container Deletion:**
  - The extension will delete containers it created for tab groups when those groups are removed. If you assign an existing container to a group, it may be deleted if the group is deleted.
- **No ES Modules:**
  - The background script must not use ES module imports/exports. Use only top-level code and CommonJS style.
- **Firefox-Only:**
  - This extension is designed for Firefox 139+ and will not work in browsers without tab group and contextual identity support.
- **TypeScript API Gaps:**
  - Some Firefox APIs (e.g., `tabGroups`) may not be present in TypeScript definitions. The code uses `@ts-ignore` where necessary.

## Installation

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

## Development Process

### Prerequisites

- Node.js and npm
- Firefox Developer Edition (recommended for testing)

### Build & Run

1. **Install dependencies:**

   ```bash
   npm install
   ```

2. **Build the extension:**

   ```bash
   npm run build
   ```

   This compiles TypeScript and copies non-TypeScript files to `dist/`.

3. **Run in Firefox:**

   ```bash
   npm run serve
   ```

   This launches the extension in Firefox using `web-ext` from the `dist/` directory.

### Packaging

To build a distributable artifact:

```bash
npm run build-artifact
```

### Notes

- The extension uses the latest Firefox APIs. If you see TypeScript errors for `tabGroups`, use `@ts-ignore` comments as the types may not be up-to-date.
- All user-facing strings should use extension localization (i18n) where possible.
- This project uses semantic versioning in the format: **x.y.z**
  - **Major version number (x):**
    Increased for major changes.
    Reset feature (y) and hotfix number (z) to zero when incremented.
  - **Feature number number (y):**
    Increased for new features (with or without bug fixes).
    Reset hotfix number (z) to zero when incremented.
  - **Hotfix number number (z):**
    Increased for bug fixes only.

## Contributing

Pull requests and suggestions are welcome!
