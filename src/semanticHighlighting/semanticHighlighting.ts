import * as fs from 'fs';
import * as jsonc from "jsonc-parser";
import * as path from 'path';
import * as vscode from 'vscode';
import * as vscodelc from 'vscode-languageclient';
import * as vscodelct from 'vscode-languageserver-types';
import { CONFIGURATION_NAME, CONFIGURATION_CLIENT_OPTIONS_NAME } from '../extension';




// Global access variables.
export namespace GlobalSemanticHighlightingVars {
    // Global access Highlighter object so that we re-load certian things from other contexts.
    export let semanticHighlightingFeature: SemanticHighlightingFeature;
}



// Parameters for the semantic highlighting (server-side) push notification.
// Mirrors the structure in the semantic highlighting proposal for LSP.
interface SemanticHighlightingParams {
    // The text document that has to be decorated with the semantic highlighting
    // information.
    textDocument: vscodelct.VersionedTextDocumentIdentifier;
    // An array of semantic highlighting information.
    lines: SemanticHighlightingInformation[];
}
// Contains the highlighting information for a specified line. Mirrors the
// structure in the semantic highlighting proposal for LSP.
interface SemanticHighlightingInformation {
    // The zero-based line position in the text document.
    line: number;
    // A base64 encoded string representing every single highlighted characters
    // with its start position, length and the "lookup table" index of of the
    // semantic highlighting Text Mate scopes.
    tokens?: string;
}

// A SemanticHighlightingToken decoded from the base64 data sent by mocals.
interface SemanticHighlightingToken {
    // Start column for this token.
    character: number;
    // Length of the token.
    length: number;
    // The TextMate scope index to the mocals scope lookup table.
    scopeIndex: number;
}
// A line of decoded highlightings from the data mocals sent.
export interface SemanticHighlightingLine {
    // The zero-based line position in the text document.
    line: number;
    // All SemanticHighlightingTokens on the line.
    tokens: SemanticHighlightingToken[];
}

// Language server push notification providing the semantic highlighting
// information for a text document.
const NotificationType =
    new vscodelc.NotificationType<SemanticHighlightingParams, void>(
        'textDocument/semanticHighlighting');

// The feature that should be registered in the vscode lsp for enabling
// experimental semantic highlighting.
export class SemanticHighlightingFeature implements vscodelc.StaticFeature {
    // The TextMate scope lookup table. A token with scope index i has the scopes
    // on index i in the lookup table.
    scopeLookupTable!: string[][];
    // The object that applies the highlightings mocals sends.
    highlighter!: Highlighter;
    // Any disposables that should be cleaned up when mocals crashes.
    private subscriptions: vscode.Disposable[] = [];
    constructor(client: vscodelc.BaseLanguageClient,
        context: vscode.ExtensionContext) {
        context.subscriptions.push(client.onDidChangeState(({ newState }) => {
            if (newState == vscodelc.State.Running) {
                // Register handler for semantic highlighting notification.
                client.onNotification(NotificationType,
                    this.handleNotification.bind(this));
            } else if (newState == vscodelc.State.Stopped) {
                // Dispose resources when mocals crashes.
                this.dispose();
            }
        }));


        // Set global var.
        GlobalSemanticHighlightingVars.semanticHighlightingFeature = this;
    }
    fillClientCapabilities(capabilities: vscodelc.ClientCapabilities) {
        // Extend the ClientCapabilities type and add semantic highlighting
        // capability to the object.
        const textDocumentCapabilities: vscodelc.TextDocumentClientCapabilities &
        { semanticHighlightingCapabilities?: { semanticHighlighting: boolean } } =
            capabilities.textDocument;
        textDocumentCapabilities.semanticHighlightingCapabilities = {
            semanticHighlighting: true,
        };
    }

    async loadCurrentTheme() {
        const themeRuleMatcher = new ThemeRuleMatcher(
            await loadTheme(vscode.workspace.getConfiguration('workbench')
                .get<string>('colorTheme')));
        this.highlighter.initialize(themeRuleMatcher);
    }

    initialize(capabilities: vscodelc.ServerCapabilities,
        documentSelector: vscodelc.DocumentSelector | undefined) {
        // The semantic highlighting capability information is in the capabilities
        // object but to access the data we must first extend the ServerCapabilities
        // type.
        const serverCapabilities: vscodelc.ServerCapabilities &
        { semanticHighlighting?: { scopes: string[][] } } = capabilities;
        if (!serverCapabilities.semanticHighlighting) {
            return;
        }
        this.scopeLookupTable = serverCapabilities.semanticHighlighting.scopes;
        // Important that highlighter is created before the theme is loading as
        // otherwise it could try to update the themeRuleMatcher without the
        // highlighter being created.
        this.highlighter = new Highlighter(this.scopeLookupTable);
        this.subscriptions.push(vscode.Disposable.from(this.highlighter));
        // Adds a listener to reload the theme when it changes.
        this.subscriptions.push(
            vscode.workspace.onDidChangeConfiguration((conf) => {
                if (!conf.affectsConfiguration('workbench.colorTheme'))
                    return;
                this.loadCurrentTheme();
            }));
        this.loadCurrentTheme();
        // Event handling for handling with TextDocuments/Editors lifetimes.
        this.subscriptions.push(vscode.window.onDidChangeVisibleTextEditors(
            (editors: vscode.TextEditor[]) => editors.forEach(
                (e) => this.highlighter.applyHighlights(e.document.uri))));
        this.subscriptions.push(vscode.workspace.onDidCloseTextDocument(
            (doc) => this.highlighter.removeFileHighlightings(doc.uri)));
    }

    handleNotification(params: SemanticHighlightingParams) {

        const lines: SemanticHighlightingLine[] = params.lines.map(
            (line) => ({ line: line.line, tokens: decodeTokens(line.tokens) }));
        this.highlighter.highlight(vscode.Uri.parse(params.textDocument.uri),
            lines);
    }
    // Disposes of all disposable resources used by this object.
    public dispose() {
        this.subscriptions.forEach((d) => d.dispose());
        this.subscriptions = [];
    }
}

// Converts a string of base64 encoded tokens into the corresponding array of
// HighlightingTokens.
export function decodeTokens(tokens: string): SemanticHighlightingToken[] {
    const scopeMask = 0xFFFF;
    const lenShift = 0x10;
    const uint32Size = 4;
    const buf = Buffer.from(tokens, 'base64');
    const retTokens = [];
    for (let i = 0, end = buf.length / uint32Size; i < end; i += 2) {
        const start = buf.readUInt32BE(i * uint32Size);
        const lenKind = buf.readUInt32BE((i + 1) * uint32Size);
        const scopeIndex = lenKind & scopeMask;
        const len = lenKind >>> lenShift;
        retTokens.push({ character: start, scopeIndex: scopeIndex, length: len });
    }

    return retTokens;
}

// The main class responsible for processing of highlightings that mocals
// sends.
export class Highlighter {

    // Custom moca decorations.
    private sqlRangeDecoration: vscode.TextEditorDecorationType;
    private groovyRangeDecoration: vscode.TextEditorDecorationType;
    private sqlRangeLastLineDecoration: vscode.TextEditorDecorationType;
    private groovyRangeLastLineDecoration: vscode.TextEditorDecorationType;
    private mocaCommandStreamEndDecoration: vscode.TextEditorDecorationType;
    // Custom moca trace outline decorations.
    private traceOutlineOutlineIdDecoration: vscode.TextEditorDecorationType;
    private traceOutlineServerGotDecoration: vscode.TextEditorDecorationType;
    private traceOutlineCommandInitiatedDecoration: vscode.TextEditorDecorationType;
    private traceOutlineFiringTriggersDecoration: vscode.TextEditorDecorationType;
    private traceOutlineTriggerDecoration: vscode.TextEditorDecorationType;
    private traceOutlineErrorDecoration: vscode.TextEditorDecorationType;
    private traceOutlineErrorCaughtDecoration: vscode.TextEditorDecorationType;
    private traceOutlineConditionalTestPassDecoration: vscode.TextEditorDecorationType;
    private traceOutlineConditionalTestFailDecoration: vscode.TextEditorDecorationType;
    private traceOutlinePreparedStatementDecoration: vscode.TextEditorDecorationType;
    private traceOutlineExceedsExecutionTimeDecoration: vscode.TextEditorDecorationType;
    private traceOutlineCFunctionDecoration: vscode.TextEditorDecorationType;
    private traceOutlineJavaMethodDecoration: vscode.TextEditorDecorationType;
    private traceOutlineInstructionPrefixDecoration: vscode.TextEditorDecorationType;
    private traceOutlineInstructionSuffixDecoration: vscode.TextEditorDecorationType;


    // Maps uris with currently open TextDocuments to the current highlightings.
    private files: Map<string, Map<number, SemanticHighlightingLine>> = new Map();
    // DecorationTypes for the current theme that are used when highlighting. A
    // SemanticHighlightingToken with scopeIndex i should have the decoration at
    // index i in this list.
    private decorationTypes: vscode.TextEditorDecorationType[] = [];
    // The mocals TextMate scope lookup table.
    private scopeLookupTable: string[][];
    constructor(scopeLookupTable: string[][]) {
        this.scopeLookupTable = scopeLookupTable;
    }
    public dispose() {
        this.files.clear();
        this.decorationTypes.forEach((t) => t.dispose());
        // Dispose must not be not called multiple times if initialize is
        // called again.
        this.decorationTypes = [];
    }
    // This function must be called at least once or no highlightings will be
    // done. Sets the theme that is used when highlighting. Also triggers a
    // recolorization for all current highlighters. Should be called whenever the
    // theme changes and has been loaded. Should also be called when the first
    // theme is loaded.
    public initialize(themeRuleMatcher: ThemeRuleMatcher) {
        this.decorationTypes.forEach((t) => t.dispose());

        // Create decoration types.
        const config = vscode.workspace.getConfiguration(CONFIGURATION_NAME);
        const clientOptsConfigObj = JSON.parse(JSON.stringify(config.get(CONFIGURATION_CLIENT_OPTIONS_NAME)));

        const sqlRangeColorLightObj = clientOptsConfigObj['sqlRangeColorLight'];
        const sqlRangeColorDarkObj = clientOptsConfigObj['sqlRangeColorDark'];
        const groovyRangeColorLightObj = clientOptsConfigObj['groovyRangeColorLight'];
        const groovyRangeColorDarkObj = clientOptsConfigObj['groovyRangeColorDark'];

        this.sqlRangeDecoration = vscode.window.createTextEditorDecorationType(
            {
                overviewRulerLane: vscode.OverviewRulerLane.Right,
                isWholeLine: true,

                light: {
                    overviewRulerColor: sqlRangeColorLightObj,
                    backgroundColor: sqlRangeColorLightObj
                },
                dark: {
                    overviewRulerColor: sqlRangeColorDarkObj,
                    backgroundColor: sqlRangeColorDarkObj
                }
            }
        );

        this.sqlRangeLastLineDecoration = vscode.window.createTextEditorDecorationType(
            {
                overviewRulerLane: vscode.OverviewRulerLane.Right,
                isWholeLine: false,

                light: {
                    overviewRulerColor: sqlRangeColorLightObj,
                    backgroundColor: sqlRangeColorLightObj
                },
                dark: {
                    overviewRulerColor: sqlRangeColorDarkObj,
                    backgroundColor: sqlRangeColorDarkObj
                }
            }
        );

        this.groovyRangeDecoration = vscode.window.createTextEditorDecorationType(
            {
                overviewRulerLane: vscode.OverviewRulerLane.Right,
                isWholeLine: true,
                light: {
                    overviewRulerColor: groovyRangeColorLightObj,
                    backgroundColor: groovyRangeColorLightObj
                },
                dark: {
                    overviewRulerColor: groovyRangeColorDarkObj,
                    backgroundColor: groovyRangeColorDarkObj
                }
            }
        );

        this.groovyRangeLastLineDecoration = vscode.window.createTextEditorDecorationType(
            {
                overviewRulerLane: vscode.OverviewRulerLane.Right,
                isWholeLine: false,
                light: {
                    overviewRulerColor: groovyRangeColorLightObj,
                    backgroundColor: groovyRangeColorLightObj
                },
                dark: {
                    overviewRulerColor: groovyRangeColorDarkObj,
                    backgroundColor: groovyRangeColorDarkObj
                }
            }
        );

        this.mocaCommandStreamEndDecoration = vscode.window.createTextEditorDecorationType(
            {
                isWholeLine: true,
                light: {
                    borderWidth: "0px 0px .6px 0px",
                    borderColor: "rgba(25,25,25,.75)",
                    borderStyle: "solid"
                },
                dark: {
                    borderWidth: "0px 0px .6px 0px",
                    borderColor: "rgba(175,175,175,.75)",
                    borderStyle: "solid"
                }
            }
        );

        this.traceOutlineOutlineIdDecoration = vscode.window.createTextEditorDecorationType(
            {
                isWholeLine: true,
                fontWeight: '900',
                light: {
                    borderWidth: "1px 1px 1px 1px",
                    borderColor: "rgba(25,25,25,.75)",
                    borderStyle: "solid",
                    color: "rgba(66, 66, 66, 1)",
                    backgroundColor: "rgba(222, 222, 222, .35)",
                },
                dark: {
                    borderWidth: "1px 1px 1px 1px",
                    borderColor: "rgba(175,175,175,.75)",
                    borderStyle: "solid",
                    color: "rgba(242, 242, 242, 1)",
                    backgroundColor: "rgba(140, 140, 140, 0.3)",
                }

            }
        );

        this.traceOutlineServerGotDecoration = vscode.window.createTextEditorDecorationType(
            {
                isWholeLine: true,

                light: {
                    borderWidth: ".6px 0px 0px 0px",
                    borderColor: "rgba(25,25,25,.75)",
                    borderStyle: "dashed"
                },
                dark: {
                    borderWidth: ".6px 0px 0px 0px",
                    borderColor: "rgba(175,175,175,.75)",
                    borderStyle: "dashed"
                }
            }
        );

        this.traceOutlineCommandInitiatedDecoration = vscode.window.createTextEditorDecorationType(
            {
                isWholeLine: false,

                light: {
                    after: {
                        contentText: 'Initiated from compiled code',
                        color: "rgba(66, 66, 66, 1)",
                        backgroundColor: "rgba(222, 222, 222, .35)",
                        margin: "0px 25px 0px",
                        fontStyle: 'italic'

                    }
                },
                dark: {
                    after: {
                        contentText: 'Initiated from compiled code',
                        color: "rgba(242, 242, 242, 1)",
                        backgroundColor: "rgba(140, 140, 140, 0.3)",
                        margin: "0px 25px 0px",
                        fontStyle: 'italic'
                    }
                }

            }
        );

        this.traceOutlineFiringTriggersDecoration = vscode.window.createTextEditorDecorationType(
            {
                isWholeLine: false,

                light: {
                    color: "rgba(83, 2, 141, 1)",
                    backgroundColor: "rgba(213, 188, 240, 0.5)",
                },
                dark: {
                    color: "rgba(226, 185, 254, 1)",
                    backgroundColor: "rgba(156, 114, 197, 0.5)",
                }
            }
        );

        this.traceOutlineTriggerDecoration = vscode.window.createTextEditorDecorationType(
            {
                isWholeLine: false,

                light: {
                    after: {
                        contentText: 'Trigger',
                        color: "rgba(83, 2, 141, 1)",
                        backgroundColor: "rgba(213, 188, 240, 0.5)",
                        margin: "0px 5px 0px 0px"
                    }
                },
                dark: {
                    after: {
                        contentText: 'Trigger',
                        color: "rgba(226, 185, 254, 1)",
                        backgroundColor: "rgba(156, 114, 197, 0.5)",
                        margin: "0px 5px 0px 0px",
                    }
                }

            }
        );

        this.traceOutlineErrorDecoration = vscode.window.createTextEditorDecorationType(
            {
                isWholeLine: false,

                light: {
                    backgroundColor: "rgba(240, 0, 0, 0.2)"
                },
                dark: {
                    backgroundColor: "rgba(255, 36, 36, 0.2)"
                }

            }
        );

        this.traceOutlineErrorCaughtDecoration = vscode.window.createTextEditorDecorationType(
            {
                isWholeLine: false,

                light: {
                    backgroundColor: "rgba(255, 217, 46, 0.35)"
                },
                dark: {
                    backgroundColor: "rgba(255, 226, 41, 0.15)"
                }
            }
        );

        this.traceOutlineConditionalTestPassDecoration = vscode.window.createTextEditorDecorationType(
            {
                isWholeLine: false,

                light: {
                    after: {
                        contentText: 'Passed',
                        color: "rgba(0, 117, 43, 1)",
                        backgroundColor: "rgba(87, 255, 148, 0.30)",
                        margin: "0px 15px 0px"
                    }
                },
                dark: {
                    after: {
                        contentText: 'Passed',
                        color: "rgba(174, 244, 200, 1)",
                        backgroundColor: "rgba(61, 255, 132, 0.25)",
                        margin: "0px 15px 0px",
                    }
                }

            }
        );

        this.traceOutlineConditionalTestFailDecoration = vscode.window.createTextEditorDecorationType(
            {
                isWholeLine: false,

                light: {
                    after: {
                        contentText: 'Failed',
                        color: "rgba(153, 0, 5, 1)",
                        backgroundColor: "rgba(240, 0, 0, 0.2)",
                        margin: "0px 15px 0px"
                    }
                },
                dark: {
                    after: {
                        contentText: 'Failed',
                        color: "rgba(255, 204, 206, 1)",
                        backgroundColor: "rgba(255, 77, 77, 0.2)",
                        margin: "0px 15px 0px"
                    }
                }
            }
        );

        this.traceOutlinePreparedStatementDecoration = vscode.window.createTextEditorDecorationType(
            {
                isWholeLine: false,
                opacity: ".50"
            }
        );

        this.traceOutlineExceedsExecutionTimeDecoration = vscode.window.createTextEditorDecorationType(
            {
                isWholeLine: false,
                fontWeight: '900',
                light: {
                    borderWidth: "2.5px 2.5px 2.5px 2.5px",
                    borderColor: "rgba(240, 148, 0, .75)",
                    borderStyle: "solid"
                },
                dark: {
                    borderWidth: "2.5px 2.5px 2.5px 2.5px",
                    borderColor: "rgba(198, 126, 12, .75)",
                    borderStyle: "solid"
                }

            }
        );

        this.traceOutlineCFunctionDecoration = vscode.window.createTextEditorDecorationType(
            {
                isWholeLine: false,
                light: {
                    after: {
                        contentText: 'C Function',
                        color: "rgba(66, 66, 66, 1)",
                        backgroundColor: "rgba(222, 222, 222, .35)",
                        margin: "0px 25px 0px",
                        fontStyle: 'italic'
                    }
                },
                dark: {
                    after: {
                        contentText: 'C Function',
                        color: "rgba(242, 242, 242, 1)",
                        backgroundColor: "rgba(140, 140, 140, 0.3)",
                        margin: "0px 25px 0px",
                        fontStyle: 'italic'
                    }
                }
            }
        );

        this.traceOutlineJavaMethodDecoration = vscode.window.createTextEditorDecorationType(
            {
                isWholeLine: false,
                light: {
                    after: {
                        contentText: 'Java Method',
                        color: "rgba(66, 66, 66, 1)",
                        backgroundColor: "rgba(222, 222, 222, .35)",
                        margin: "0px 25px 0px",
                        fontStyle: 'italic'

                    }
                },
                dark: {
                    after: {
                        contentText: 'Java Method',
                        color: "rgba(242, 242, 242, 1)",
                        backgroundColor: "rgba(140, 140, 140, 0.3)",
                        margin: "0px 25px 0px",
                        fontStyle: 'italic'
                    }
                }
            }
        );

        this.traceOutlineInstructionPrefixDecoration = vscode.window.createTextEditorDecorationType(
            {
                isWholeLine: false,
                opacity: '.5',
                light: {
                    color: "rgba(66, 66, 66, 1)",
                    fontStyle: 'italic'
                },
                dark: {
                    color: "rgba(242, 242, 242, 1)",
                    fontStyle: 'italic'
                }
            }
        );

        this.traceOutlineInstructionSuffixDecoration = vscode.window.createTextEditorDecorationType(
            {
                isWholeLine: false,
                opacity: '.5',
                light: {
                    color: "rgba(66, 66, 66, 1)",
                    fontStyle: 'italic'
                },
                dark: {
                    color: "rgba(242, 242, 242, 1)",
                    fontStyle: 'italic'
                }
            }
        );


        this.decorationTypes = this.scopeLookupTable.map((scopes) => {

            switch (scopes[0]) {
                case "moca.commandstream.end":
                    return this.mocaCommandStreamEndDecoration;
                case "moca.sql":
                    return this.sqlRangeDecoration;
                case "moca.sql.lastline":
                    return this.sqlRangeLastLineDecoration;
                case "moca.groovy":
                    return this.groovyRangeDecoration;
                case "moca.groovy.lastline":
                    return this.groovyRangeLastLineDecoration;
                case "moca.traceoutline.outlineid":
                    return this.traceOutlineOutlineIdDecoration;
                case "moca.traceoutline.servergot":
                    return this.traceOutlineServerGotDecoration;
                case "moca.traceoutline.commandinitiated":
                    return this.traceOutlineCommandInitiatedDecoration;
                case "moca.traceoutline.firingtriggers":
                    return this.traceOutlineFiringTriggersDecoration;
                case "moca.traceoutline.trigger":
                    return this.traceOutlineTriggerDecoration;
                case "moca.traceoutline.error":
                    return this.traceOutlineErrorDecoration;
                case "moca.traceoutline.error.caught":
                    return this.traceOutlineErrorCaughtDecoration;
                case "moca.traceoutline.conditionaltest.pass":
                    return this.traceOutlineConditionalTestPassDecoration;
                case "moca.traceoutline.conditionaltest.fail":
                    return this.traceOutlineConditionalTestFailDecoration;
                case "moca.traceoutline.preparedstatement":
                    return this.traceOutlinePreparedStatementDecoration;
                case "moca.traceoutline.exceedsexecutiontime":
                    return this.traceOutlineExceedsExecutionTimeDecoration;
                case "moca.traceoutline.cfunction":
                    return this.traceOutlineCFunctionDecoration;
                case "moca.traceoutline.javamethod":
                    return this.traceOutlineJavaMethodDecoration;
                case "moca.traceoutline.instructionprefix":
                    return this.traceOutlineInstructionPrefixDecoration;
                case "moca.traceoutline.instructionsuffix":
                    return this.traceOutlineInstructionSuffixDecoration;
                default: // Let theme matcher do it's thing.
                    const options: vscode.DecorationRenderOptions = {
                        // If there exists no rule for this scope the matcher returns an empty
                        // color. That's ok because vscode does not do anything when applying
                        // empty decorations.
                        color: themeRuleMatcher.getBestThemeRule(scopes[0]).foreground,
                        // If the rangeBehavior is set to Open in any direction the
                        // highlighting becomes weird in certain cases.
                        rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
                    };
                    return vscode.window.createTextEditorDecorationType(options);
            }

        });
        this.getVisibleTextEditorUris().forEach((fileUri) =>
            this.applyHighlights(fileUri));
    }

    // Adds incremental highlightings to the current highlightings for the file
    // with fileUri. Also applies the highlightings to any associated
    // TextEditor(s).
    public highlight(fileUri: vscode.Uri,
        highlightingLines: SemanticHighlightingLine[]) {
        const fileUriStr = fileUri.toString();
        if (!this.files.has(fileUriStr)) {
            this.files.set(fileUriStr, new Map());
        }
        const fileHighlightings = this.files.get(fileUriStr);
        // Clearing because we do not want any lines lingering that no longer exist.
        fileHighlightings.clear();
        highlightingLines.forEach((line) => fileHighlightings.set(line.line, line));
        this.applyHighlights(fileUri);
    }

    // Applies all the highlightings currently stored for a file with fileUri.
    public applyHighlights(fileUri: vscode.Uri) {
        const fileUriStr = fileUri.toString();
        if (!this.files.has(fileUriStr)) {
            // There are no highlightings for this file, must return early or will get
            // out of bounds when applying the decorations below.
            return;
        }
        if (!this.decorationTypes.length) {
            // Can't apply any decorations when there is no theme loaded.
            return;
        }
        // This must always do a full re-highlighting due to the fact that
        // TextEditorDecorationType are very expensive to create (which makes
        // incremental updates infeasible). For this reason one
        // TextEditorDecorationType is used per scope.
        const ranges = this.getDecorationRanges(fileUri);
        vscode.window.visibleTextEditors.forEach((e) => {
            if (e.document.uri.toString() !== fileUriStr) {
                return;
            }
            this.decorationTypes.forEach((d, i) => {
                e.setDecorations(d, ranges[i])
            });
        });
    }

    // Called when a text document is closed. Removes any highlighting entries for
    // the text document that was closed.
    public removeFileHighlightings(fileUri: vscode.Uri) {
        // If there exists no entry the call to delete just returns false.
        this.files.delete(fileUri.toString());
    }

    // Gets the uris as strings for the currently visible text editors.
    protected getVisibleTextEditorUris(): vscode.Uri[] {
        return vscode.window.visibleTextEditors.map((e) => e.document.uri);
    }

    // Returns the ranges that should be used when decorating. Index i in the
    // range array has the decoration type at index i of this.decorationTypes.
    protected getDecorationRanges(fileUri: vscode.Uri): vscode.Range[][] {
        const fileUriStr = fileUri.toString();
        if (!this.files.has(fileUriStr)) {
            // this.files should always have an entry for fileUri if we are here. But
            // if there isn't one we don't want to crash the extension. This is also
            // useful for tests.
            return [];
        }
        const lines: SemanticHighlightingLine[] =
            Array.from(this.files.get(fileUriStr).values());
        const decorations: vscode.Range[][] = this.decorationTypes.map(() => []);
        lines.forEach((line) => {
            line.tokens.forEach((token) => {
                decorations[token.scopeIndex].push(new vscode.Range(
                    new vscode.Position(line.line, token.character),
                    new vscode.Position(line.line, token.character + token.length)));
            });
        });
        return decorations;
    }
}

// A rule for how to color TextMate scopes.
interface TokenColorRule {
    // A TextMate scope that specifies the context of the token, e.g.
    // "entity.name.function.cpp".
    scope: string;
    // foreground is the color tokens of this scope should have.
    foreground: string;
}

export class ThemeRuleMatcher {
    // The rules for the theme.
    private themeRules: TokenColorRule[];
    // A cache for the getBestThemeRule function.
    private bestRuleCache: Map<string, TokenColorRule> = new Map();
    constructor(rules: TokenColorRule[]) { this.themeRules = rules; }
    // Returns the best rule for a scope.
    getBestThemeRule(scope: string): TokenColorRule {
        if (this.bestRuleCache.has(scope)) {
            return this.bestRuleCache.get(scope);
        }
        let bestRule: TokenColorRule = { scope: '', foreground: '' };
        this.themeRules.forEach((rule) => {
            // The best rule for a scope is the rule that is the longest prefix of the
            // scope (unless a perfect match exists in which case the perfect match is
            // the best). If a rule is not a prefix and we tried to match with longest
            // common prefix instead variables would be highlighted as `less`
            // variables when using Light+ (as variable.other would be matched against
            // variable.other.less in this case). Doing common prefix matching also
            // means we could match variable.cpp to variable.css if variable.css
            // occurs before variable in themeRules.
            // FIXME: This is not defined in the TextMate standard (it is explicitly
            // undefined, https://macromates.com/manual/en/scope_selectors). Might
            // want to rank some other way.
            if (scope !== undefined && scope.startsWith(rule.scope) &&
                rule.scope.length > bestRule.scope.length) {
                // This rule matches and is more specific than the old rule.
                bestRule = rule;
            }
        });
        this.bestRuleCache.set(scope, bestRule);
        return bestRule;
    }
}

// Get all token color rules provided by the theme.
function loadTheme(themeName: string): Promise<TokenColorRule[]> {
    const extension =
        vscode.extensions.all.find((extension: vscode.Extension<any>) => {
            const contribs = extension.packageJSON.contributes;
            if (!contribs || !contribs.themes) {
                return false;
            }
            return contribs.themes.some((theme: any) => theme.id === themeName ||
                theme.label === themeName);
        });

    if (!extension) {
        return Promise.reject('Could not find a theme with name: ' + themeName);
    }

    const themeInfo = extension.packageJSON.contributes.themes.find(
        (theme: any) => theme.id === themeName || theme.label === themeName);
    return parseThemeFile(path.join(extension.extensionPath, themeInfo.path));
}

/**
 * Parse the TextMate theme at fullPath. If there are multiple TextMate scopes
 * of the same name in the include chain only the earliest entry of the scope is
 * saved.
 * @param fullPath The absolute path to the theme.
 * @param seenScopes A set containing the name of the scopes that have already
 *     been set.
 */
export async function parseThemeFile(
    fullPath: string, seenScopes?: Set<string>): Promise<TokenColorRule[]> {
    if (!seenScopes) {
        seenScopes = new Set();
    }
    // FIXME: Add support for themes written as .tmTheme.
    if (path.extname(fullPath) === '.tmTheme') {
        return [];
    }
    try {
        const contents = await readFileText(fullPath);
        const parsed = jsonc.parse(contents);
        const rules: TokenColorRule[] = [];
        // To make sure it does not crash if tokenColors is undefined.
        if (!parsed.tokenColors) {
            parsed.tokenColors = [];
        }
        parsed.tokenColors.forEach((rule: any) => {
            if (!rule.scope || !rule.settings || !rule.settings.foreground) {
                return;
            }
            const textColor = rule.settings.foreground;
            // Scopes that were found further up the TextMate chain should not be
            // overwritten.
            const addColor = (scope: string) => {
                if (seenScopes.has(scope)) {
                    return;
                }
                rules.push({ scope, foreground: textColor });
                seenScopes.add(scope);

            };
            if (rule.scope instanceof Array) {
                return rule.scope.forEach((s: string) => addColor(s));
            }
            addColor(rule.scope);
        });

        if (parsed.include) {
            // Get all includes and merge into a flat list of parsed json.
            return [
                ...(await parseThemeFile(
                    path.join(path.dirname(fullPath), parsed.include), seenScopes)),
                ...rules
            ];
        }
        return rules;
    } catch (err) {
        // If there is an error opening a file, the TextMate files that were
        // correctly found and parsed further up the chain should be returned.
        // Otherwise there will be no highlightings at all.
        console.warn('Could not open file: ' + fullPath + ', error: ', err);
    }

    return [];
}

function readFileText(path: string): Promise<string> {
    return new Promise((resolve, reject) => {
        fs.readFile(path, 'utf8', (err, data) => {
            if (err) {
                return reject(err);
            }
            return resolve(data);
        });
    });
}