# Contribute

This document provides information for developers who wish to contribute to the **vscode MOCA Client** project.

## Building

#### Node.js
vscode extensions are built with node.js -- any version >= 10 should be okay.

#### Dependencies
npm is used for dependency management. Dependency information can be found in `package.json`.

#### Clone and run
Once repository is cloned, you will need to install dependencies. This can be done by running
```powershell
npm install
```
command in project root directory via terminal.

After dependencies are installed, pressing `F5` will run default configuration.


## Testing

If **not** testing new MOCA Language Server build, you can just run and debug normally.

If testing new MOCA Language Server build, place fat jar in `/bin` directory and make sure that `MOCA_LANGUAGE_SERVER_VERSION` in `src/extension.ts` matches fat jar version in `/bin` before running/debugging.

## Debugging

No special instructions -- breakpoints can be placed where desired and stepped through normally upon running via `F5`.

