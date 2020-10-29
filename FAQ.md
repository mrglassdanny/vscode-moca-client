# FAQ


**Q: How do I enable realtime formatting?**

A: In your `settings.json` file (global vscode settings), you can set the following:
```json
"editor.formatOnType" = true
```

**Q: Can I have MOCA formatting turned on, but not SQL/Groovy?**

A: Yes! In your `settings.json` file, you can set the following:
```json
"moca.languageServerOptions": {
    "moca-diagnostics-enabled": true,
    "moca-warning-diagnostics-enabled": true,
    "sql-diagnostics-enabled": true,
    "sql-warning-diagnostics-enabled": true,
    "groovy-diagnostics-enabled": true,
    "groovy-warning-diagnostics-enabled": true,
    -----> "sql-formatting-enabled": false,
    -----> "groovy-formatting-enabled": false,
    "groovy-static-type-checking-enabled": true
}
```

**Q: I do not like the 'tables not existing' warnings, can I turn them off?**

A: Yes! In your `settings.json` file, you can set the following:
```json
"moca.languageServerOptions": {
    "moca-diagnostics-enabled": true,
    "moca-warning-diagnostics-enabled": true,
    "sql-diagnostics-enabled": true,
    -----> "sql-warning-diagnostics-enabled": false,
    "groovy-diagnostics-enabled": true,
    "groovy-warning-diagnostics-enabled": true,
    "sql-formatting-enabled": true,
    "groovy-formatting-enabled": true,
    "groovy-static-type-checking-enabled": true
}
```

**Q: Is there a way I can avoid accidentally executing 'unsafe' scripts in PRODUCTION environments?**

A: Yes! Each MOCA connection you configure in your `settings.json` file allows you to enable unsafe code execution approval. If you set this to TRUE, you will be prompted for approval upon attempting execution of unsafe script. Here is an example MOCA connection with this configured:
```json
{
    "name": "Example MOCA Connection",
    "url": "http://connectionstring/service",
    -----> "approveUnsafeScripts": true
}
```

**Q: What is recommended for editing .MCMD/.MTRG files?**

A: You can associate .MCMD/.MTRG files with the XML language automatically by setting the following in `settings.json`:
```json
"files.associations": {
    "*.mcmd": "xml",
    "*.mtrg": "xml"
}
```

You can also install the [XML] language server extension in vscode for extra XML language features.

**Q: Can I have multiple MOCA connections open per window?**

A: No. You need to open a new vscode window.

**Q: Can I create custom code snippets?**

A: Yes! Here is a [user-defined snippets] guide.



[XML]: https://marketplace.visualstudio.com/items?itemName=redhat.vscode-xml
[user-defined snippets]: https://code.visualstudio.com/docs/editor/userdefinedsnippets