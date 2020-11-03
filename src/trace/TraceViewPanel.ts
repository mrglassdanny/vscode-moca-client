
import * as path from 'path';
import * as vscode from 'vscode';

export class TraceViewPanel {
    public static traceViewPanels: Map<string, TraceViewPanel> = new Map<string, TraceViewPanel>();
    public static readonly viewType = 'resultView';

    private readonly _panel: vscode.WebviewPanel;
    private readonly _extensionPath: string;
    private _disposables: vscode.Disposable[] = [];

    private fileName: string;
    private traceHtml: string;

    public static createOrShow(extensionPath: string, fileName: string, traceHtml: string) {

        const column = vscode.ViewColumn.Beside;

        if (TraceViewPanel.traceViewPanels.has(fileName)) {
            var traceViewPanel = this.traceViewPanels.get(fileName);
            traceViewPanel._panel.reveal(column);
            traceViewPanel.traceHtml = traceHtml;
        } else {
            // We don't have a panel, initialize one.
            const panel = vscode.window.createWebviewPanel(
                TraceViewPanel.viewType,
                'Trace: ' + fileName,
                column,
                {
                    //Enable javascript in the webview
                    enableScripts: true,

                    // And restrict the webview to only loading content from our extension's `media` directory.
                    localResourceRoots: [vscode.Uri.file(path.join(extensionPath, 'media'))]
                }
            );

            var traceViewPanel = new TraceViewPanel(panel, extensionPath, fileName, traceHtml);
            TraceViewPanel.traceViewPanels.set(fileName, traceViewPanel);
            traceViewPanel._panel.reveal(column);
        }
    }

    private constructor(panel: vscode.WebviewPanel, extensionPath: string, fileName: string, traceHtml: string) {

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
        this._panel.onDidChangeViewState(
            () => {
                if (this._panel.visible) {
                    this._update();
                }
            },
            null,
            this._disposables
        );

        //Handle messages from the webview
        this._panel.webview.onDidReceiveMessage(
            message => {
                //Idk what this class does
                switch (message.command) {
                    case 'alert':
                        vscode.window.showErrorMessage(message.text);
                        return;
                }
            },
            null,
            this._disposables
        );
    }

    public doRefactor() {
        // Send a message to the webview webview.
        // You can send any JSON serializable data.
        this._panel.webview.postMessage({ command: 'refactor' });
    }

    public dispose() {

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

    private _update() {
        this._panel.webview.html = this.traceHtml;
    }


}