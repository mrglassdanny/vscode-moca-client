# Visual Studio Code MOCA Client Extension

Provides MOCA client and language support via [MOCA Language Server].


## Quick Start
1. Install extension
2. Make sure [minimum Java version] installed and [set JAVA_HOME(for JDK) or JRE_HOME(for JRE) environment variable]
    * If Java standard library intellisense in Groovy context is desired, you will need a JDK. Otherwise, JRE will work just fine.
3. Extension is activated after you **either**:
    - open MOCA file (.moca **OR** .msql)
    - make MOCA connection


## Features

![Demo](resources/demo.gif)

- Syntax highlighting
- [Intellisense]
- [Command Execution]


## Commands
- `MOCA:Connect to MOCA Server`: Connect to 1 of the MOCA servers specified in `moca.connections` configuration.
- `MOCA:Load MOCA Cache`: Loads MOCA cache(commands/triggers/tables/views/etc).
- `MOCA:Execute MOCA Script` (`Ctrl+Enter`): Executes script in focused MOCA file and displays results in web view.
- `MOCA:Execute MOCA Selection` (`Ctrl+Shift+Enter`): Executes selection in focused MOCA file and displays results in web view.
- `MOCA:MOCA Trace`: Starts/stops trace.
- `MOCA:Lookup MOCA Command`: Dialog appears for searching commands/triggers.
- `MOCA:Auto Execute MOCA Script`: Auto MOCA script execution.

## Settings

*can hover over configuration items below in vscode settings.json for more information*

- `moca.connections`: Array object that stores MOCA connection information.
```json
"moca.connections": [
    {
        "name": "MOCA Connection Name",
        "url": "http://connectionstring/service",
        "user": "USER",
        "password": "PASSWORD",
        "groovyclasspath": [
            "path-to-jar",
            "path-to-jar",
            "path-to-jar"
        ]
    }
]
```

*can remove/leave empty `user` and/or `password` fields in order to be prompted for them upon MOCA connection attempt*

- `moca.trace`: Trace options.
```json
"moca.trace": {
        "fileName": "DGLASS",
        "mode": "w"
    }
```
- `moca.autoExecution`: Auto MOCA script execution configuration.
```json
"moca.autoExecution": {
        "initialDuration": 2,
        "sleepDuration": 3,
        "stopIfExecutionCountExceeds": 10,
        "stopIfTimeElapses": 600,
        "stopIfExecutionError": true
    }
```
- `moca.clientOptions`: vscode extension configuration options.
```json
"moca.clientOptions": {
        "sql-range-color-light": "rgba(0,150,225,0.15)",
        "sql-range-color-dark": "rgba(0,80,180,0.25)",
        "groovy-range-color-light": "rgba(225,100,0,0.15)",
        "groovy-range-color-dark": "rgba(175,45,0,0.25)",
        "dataTablePageSize": 100
    }
```
- `moca.languageServerOptions`: [MOCA Language Server] configuration options.
```json
"moca.languageServerOptions": {
        "moca-diagnostics-enabled": true,
        "moca-warning-diagnostics-enabled": true,
        "sql-diagnostics-enabled": true,
        "sql-warning-diagnostics-enabled": true,
        "groovy-diagnostics-enabled": true,
        "groovy-warning-diagnostics-enabled": true,
        "sql-formatting-enabled": true,
        "groovy-formatting-enabled": true,
        "groovy-static-type-checking-enabled": true
    }
```


## Contribute

If you think something is missing or could be improved, please open issues and pull requests.


## Contact

- mrglassdanny@gmail.com


[MOCA Language Server]: https://github.com/mrglassdanny/moca-language-server
[minimum Java version]: https://github.com/mrglassdanny/moca-language-server
[set JAVA_HOME(for JDK) or JRE_HOME(for JRE) environment variable]: https://confluence.atlassian.com/doc/setting-the-java_home-variable-in-windows-8895.html
[Intellisense]: https://github.com/mrglassdanny/moca-language-server
[Command Execution]: https://github.com/mrglassdanny/moca-language-server