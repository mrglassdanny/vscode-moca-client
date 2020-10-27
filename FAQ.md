# FAQ


**Q: How do I enable realtime formatting?**

A: In your `settings.json` file (global vscode settings), you can set the following:
```json
"editor.formatOnType" = true
```

**Q: Can I have MOCA formatting turned on, but not SQL/Groovy?**

A: Yes! In your `settings.json` file (global vscode settings), you can set the following:
```json
"moca.languageServerOptions": {
    ...
    "sql-formatting-enabled": false,
    "groovy-formatting-enabled": false,
    ...
}
```

**Q: I do not like the 'tables not existing' warnings, can I turn them off?**

A: Yes! In your `settings.json` file (global vscode settings), you can set the following:
```json
"moca.languageServerOptions": {
    ...
    "sql-warning-diagnostics-enabled": false,
    ...
},
```

There are other useful settings as well in the `moca.languageServerOptions` configuration.

**Q: What is recommended for editting .MCMD/.MTRG files?**

A: You can associate .MCMD/.MTRG files with the XML language automatically by setting the following in `settings.json` (global vscode settings):
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