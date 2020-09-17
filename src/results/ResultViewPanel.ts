import * as path from 'path';
import * as vscode from 'vscode';
import { MocaResults } from './mocaResults';
import { CONFIGURATION_NAME, CONFIGURATION_CLIENT_OPTIONS } from '../extension';

export class ResultViewPanel {
    public static resultViewPanels: Map<string, ResultViewPanel> = new Map<string, ResultViewPanel>();
    public static readonly viewType = 'resultView';

    private readonly _panel: vscode.WebviewPanel;
    private readonly _extensionPath: string;
    private _disposables: vscode.Disposable[] = [];

    private fileName: string;
    private res: MocaResults;
    private curColWidths: number[] = [];

    public static createOrShow(extensionPath: string, fileName: string, res: MocaResults) {

        const column = vscode.ViewColumn.Beside;

        if (ResultViewPanel.resultViewPanels.has(fileName)) {
            var resultViewPanel = this.resultViewPanels.get(fileName);
            resultViewPanel._panel.reveal(column);
            resultViewPanel.res = res;
        } else {
            // We don't have a panel, initialize one.
            const panel = vscode.window.createWebviewPanel(
                ResultViewPanel.viewType,
                'Results: ' + fileName,
                column,
                {
                    //Enable javascript in the webview
                    enableScripts: true,

                    // And restrict the webview to only loading content from our extension's `media` directory.
                    localResourceRoots: [vscode.Uri.file(path.join(extensionPath, 'media'))]
                }
            );

            var resultViewPanel = new ResultViewPanel(panel, extensionPath, fileName, res);
            ResultViewPanel.resultViewPanels.set(fileName, resultViewPanel);
            resultViewPanel._panel.reveal(column);
        }
    }

    private constructor(panel: vscode.WebviewPanel, extensionPath: string, fileName: string, res: MocaResults) {

        this._panel = panel;
        this._extensionPath = extensionPath;
        this.fileName = fileName;
        this.res = res;

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
        ResultViewPanel.resultViewPanels.delete(this.fileName);

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
        const webview = this._panel.webview;

        //update shit here I guess.
        this._panel.webview.html = this._getHtmlForWebview(webview);
    }

    private _getHtmlForWebview(webview: vscode.Webview) {

        // Load scripts.
        const jexcelScriptPathOnDisk = vscode.Uri.file(
            path.join(this._extensionPath, 'media', 'jexcel.js')
        );
        const jexcelScriptUri = webview.asWebviewUri(jexcelScriptPathOnDisk);
        const jsuitesScriptPathOnDisk = vscode.Uri.file(
            path.join(this._extensionPath, 'media', 'jsuites.js')
        );
        const jsuitesScriptUri = webview.asWebviewUri(jsuitesScriptPathOnDisk);

        // Load css.
        const jexcelCssPathOnDisk = vscode.Uri.file(
            path.join(this._extensionPath, 'media', 'jexcel.css')
        );
        const jexcelCssUri = webview.asWebviewUri(jexcelCssPathOnDisk);
        const jsuitesCssPathOnDisk = vscode.Uri.file(
            path.join(this._extensionPath, 'media', 'jsuites.css')
        );
        const jsuitesCssUri = webview.asWebviewUri(jsuitesCssPathOnDisk);


        // Get data table page size from client options configuration.
        const config = vscode.workspace.getConfiguration(CONFIGURATION_NAME);
        var clientOptsConfigObj = JSON.parse(JSON.stringify(config.get(CONFIGURATION_CLIENT_OPTIONS)));
        var dataTablePageSize = clientOptsConfigObj['dataTablePageSize'];
        // If less than 1, set to default.
        if (dataTablePageSize < 1)
            dataTablePageSize = 100;


        var htmlStr = `<html lang="en">
        <script src="${jexcelScriptUri}"></script>
        <script src="${jsuitesScriptUri}"></script>
        <link rel="stylesheet" href="${jexcelCssUri}" type="text/css" />
        <link rel="stylesheet" href="${jsuitesCssUri}" type="text/css" />

        <div id="spreadsheet"></div>

            <script>
                var data = [
                    ` + this.getMocaResultsData() + `
                ];

                jexcel(document.getElementById('spreadsheet'), {
                    data:data,
                    columns: [
                        ` + this.getMocaResultsColumns() + `
                    ],
                    allowInsertRow:false,
                    allowManualInsertRow:false,
                    allowInsertColumn:false,
                    allowManualInsertColumn:false,
                    allowDeleteRow:false,
                    allowDeleteColumn:false,
                    allowExport:false,
                    allowRenameColumn:false,
                    about:false,
                    columnDrag:true,
                    parseFormulas:false,
                    search:true,
                    pagination:${dataTablePageSize},
                });
            </script>
        </html>`;

        return htmlStr;
    }

    public getMocaResultsColumns(): string {

        var colStr = "";
        var colIdx = 0;
        const colWidPixelMultiplier = 10;
        const maxAllowedColWid = 300;

        this.res.cols.forEach(col => {

            colStr += '{ type: '

            // Types info from com.redprairie.moca.MocaType
            switch (col[1]) {
                case "S": // String.
                    colStr += `'text', `;
                    break;
                case "I": // Number.
                    colStr += `'numeric',`
                    break;
                case "D": // Date.
                    colStr += `'text', `;
                    break;
                case "O": // ?
                default:
                    colStr += `'text',`
                    break;
            }

            let colWid: number;

            if (col[0].toString().length >= this.curColWidths[colIdx]) {
                colWid = col[0].toString().length * colWidPixelMultiplier;
            } else {
                colWid = this.curColWidths[colIdx] * colWidPixelMultiplier;
            }

            // Want to make sure col wid is not crazy!
            if (colWid > maxAllowedColWid) {
                colWid = maxAllowedColWid;
            }

            colStr += ` title: '` + col[0].toString() + `', width: ` + (colWid) + `, readOnly:true },`;

            colIdx++;
        });

        colStr = colStr.substring(0, colStr.length - 1);
        return colStr;
    }

    public getMocaResultsData(): string {

        this.curColWidths = [];

        let strArr: string[] = [];


        var colCount = this.res.cols.length;
        var colIdx = 0;
        var rowIdx = 0;
        this.res.rows.forEach(row => {
            row.forEach(e2 => {

                let value: string;
                if (e2 === null) {
                    value = '';
                } else {
                    value = e2.toString();
                }

                // '\' not showing up correctly. Go ahead and fix here.
                value = value.replace(/\\/g, "\\\\");

                var len = value.length;
                if (rowIdx === 0) {
                    this.curColWidths.push(len);
                } else {
                    if (this.curColWidths[colIdx] < len) {
                        this.curColWidths[colIdx] = len;
                    }
                }


                if (colIdx == 0 && colIdx == colCount - 1) {
                    strArr.push("[`" + value + "`]");
                } else if (colIdx == 0 && colIdx != colCount - 1) {
                    strArr.push("[`" + value + "`");
                } else if (colIdx != 0 && colIdx == colCount - 1) {
                    strArr.push("`" + value + "`]");
                } else {
                    strArr.push("`" + value + "`");
                }
                colIdx++;
            });

            colIdx = 0;
            rowIdx++;
        });
        return strArr.toString();
    }

}