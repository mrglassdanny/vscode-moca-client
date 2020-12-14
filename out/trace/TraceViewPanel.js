"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TraceViewPanel = void 0;
const path = require("path");
const vscode = require("vscode");
class TraceViewPanel {
    constructor(panel, extensionPath, fileName, traceHtml) {
        this._disposables = [];
        this._panel = panel;
        this._extensionPath = extensionPath;
        this.fileName = fileName;
        this.traceHtml = traceHtml;
        // Set the webview's initial html content
        this._update();
        //When we dispose this panel, dispose the disposable stuff in it
        //Event listener below:
        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
        // Update the content based on view changes
        this._panel.onDidChangeViewState(() => {
            if (this._panel.visible) {
                this._update();
            }
        }, null, this._disposables);
        //Handle messages from the webview
        this._panel.webview.onDidReceiveMessage(message => {
            //Idk what this class does
            switch (message.command) {
                case 'alert':
                    vscode.window.showErrorMessage(message.text);
                    return;
            }
        }, null, this._disposables);
    }
    static createOrShow(extensionPath, fileName, traceHtml) {
        const column = vscode.ViewColumn.Beside;
        if (TraceViewPanel.traceViewPanels.has(fileName)) {
            var traceViewPanel = this.traceViewPanels.get(fileName);
            traceViewPanel._panel.reveal(column);
            traceViewPanel.traceHtml = traceHtml;
        }
        else {
            // We don't have a panel, initialize one.
            const panel = vscode.window.createWebviewPanel(TraceViewPanel.viewType, 'Trace: ' + fileName, column, {
                //Enable javascript in the webview
                enableScripts: true,
                // And restrict the webview to only loading content from our extension's `media` directory.
                localResourceRoots: [vscode.Uri.file(path.join(extensionPath, 'media'))]
            });
            var traceViewPanel = new TraceViewPanel(panel, extensionPath, fileName, traceHtml);
            TraceViewPanel.traceViewPanels.set(fileName, traceViewPanel);
            traceViewPanel._panel.reveal(column);
        }
    }
    doRefactor() {
        // Send a message to the webview webview.
        // You can send any JSON serializable data.
        this._panel.webview.postMessage({ command: 'refactor' });
    }
    dispose() {
        // Remove from static map.
        TraceViewPanel.traceViewPanels.delete(this.fileName);
        //clean up our resources
        this._panel.dispose();
        while (this._disposables.length) {
            const x = this._disposables.pop();
            if (x) {
                x.dispose();
            }
        }
    }
    _update() {
        this._panel.webview.html = this.traceHtml;
    }
}
exports.TraceViewPanel = TraceViewPanel;
TraceViewPanel.traceViewPanels = new Map();
TraceViewPanel.viewType = 'traceView';
//# sourceMappingURL=TraceViewPanel.js.map