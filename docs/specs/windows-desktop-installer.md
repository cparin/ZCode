# Windows Desktop Installer Spec

## Scope

Provide a supported Windows desktop installer artifact for ZCode, in addition to the existing macOS and Linux desktop artifacts.

## Product Requirements

- Build a Windows NSIS installer for `win32-x64`.
- Build a Windows NSIS installer for `win32-arm64` when the target environment provides the matching native assets.
- Keep installation directory selectable by the user.
- Use the Windows-specific application and installer icons already tracked by the desktop package.
- Preserve the existing Windows install manifest and uninstall cleanup behavior.
- Produce an artifact named `ZCode-<version>-win-<arch>.exe` (with the existing test suffix when applicable).
- Do not claim that an unsigned local build is code-signed or suitable for production distribution.

## Ownership and Build Path

`packages/desktop/scripts/bundle.mjs` owns target normalization, preparation, Electron build invocation, artifact discovery, and post-build verification. `packages/desktop/electron-builder.config.js` owns the NSIS target and Windows packaging hooks.

```text
bundle:desktop:win
  → target normalization (win/x64)
  → runtime/native asset preparation
  → desktop production build
  → electron-builder --win --x64
  → app.asar/native dependency verification
  → NSIS installer in packages/desktop/dist/
```

## Accepted Commands

- `pnpm bundle:desktop:win` — Windows x64 installer.
- `pnpm bundle:desktop:win-arm64` — Windows arm64 installer.
- `pnpm bundle:desktop -- --os win --arch <x64|arm64>` — equivalent generic command.

## Failure Semantics

- Unsupported target architecture fails before packaging.
- Missing Windows native assets fails during preparation or package verification; the command must not publish a partial installer.
- Packaging may be run on another OS only when Electron Builder and all target native assets support that cross-build; otherwise it must run on Windows.
- Verification failure after packaging is a failed build, even if an `.exe` file was produced.

## Acceptance Criteria

- The x64 command resolves to `win32-x64` and NSIS configuration.
- The arm64 command resolves to `win32-arm64` and NSIS configuration.
- The generated artifact uses the documented name and `.exe` extension.
- The installer configuration enables selectable installation directory and Windows icons.
- Existing macOS/Linux target commands remain unchanged.
