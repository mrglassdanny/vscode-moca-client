"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.deactivate = exports.activate = exports.LanguageServerCommands = exports.LanguageClientCommands = exports.CONFIGURATION_TRACE_OUTLINER_NAME = exports.CONFIGURATION_DEFAULT_GROOVY_CLASSPATH_NAME = exports.CONFIGURATION_LANGUAGE_SERVER_OPTIONS_NAME = exports.CONFIGURATION_CLIENT_OPTIONS_NAME = exports.CONFIGURATION_AUTO_EXECUTION_NAME = exports.CONFIGURATION_TRACE_NAME = exports.CONFIGURATION_CONNECTIONS_NAME = exports.CONFIGURATION_NAME = void 0;
const vscode = require("vscode");
const vscode_languageclient_1 = require("vscode-languageclient");
const path = require("path");
const fs = require("fs");
const csv = require("csv-parser");
const semanticHighlighting_1 = require("./semanticHighlighting/semanticHighlighting");
const mocaResults_1 = require("./results/mocaResults");
const ResultViewPanel_1 = require("./results/ResultViewPanel");
const perf_hooks_1 = require("perf_hooks");
// Language server constants.
const MOCA_LANGUAGE_SERVER_VERSION = "1.11.25";
const MOCA_LANGUAGE_SERVER = "moca-language-server-" + MOCA_LANGUAGE_SERVER_VERSION + "-all.jar";
const MOCA_LANGUAGE_SERVER_INITIALIZING_MESSAGE = "MOCA: Initializing language server";
const MOCA_LANGUAGE_SERVER_ERR_STARTUP = "The MOCA extension failed to start";
// Client vars.
let globalExtensionContext;
let mocaLanguageClient;
let javaPath;
// Client constants.
exports.CONFIGURATION_NAME = "moca";
exports.CONFIGURATION_CONNECTIONS_NAME = "connections";
exports.CONFIGURATION_TRACE_NAME = "trace";
exports.CONFIGURATION_AUTO_EXECUTION_NAME = "autoExecution";
exports.CONFIGURATION_CLIENT_OPTIONS_NAME = "clientOptions";
exports.CONFIGURATION_LANGUAGE_SERVER_OPTIONS_NAME = "languageServerOptions";
exports.CONFIGURATION_DEFAULT_GROOVY_CLASSPATH_NAME = "defaultGroovyclasspath";
exports.CONFIGURATION_TRACE_OUTLINER_NAME = "traceOutliner";
// Client commands.
var LanguageClientCommands;
(function (LanguageClientCommands) {
    LanguageClientCommands.CONNECT = "moca.connect";
    LanguageClientCommands.LOAD_CACHE = "moca.loadCache";
    LanguageClientCommands.EXECUTE = "moca.execute";
    LanguageClientCommands.EXECUTE_SELECTION = "moca.executeSelection";
    LanguageClientCommands.EXECUTE_TO_CSV = "moca.executeToCSV";
    LanguageClientCommands.EXECUTE_SELECTION_TO_CSV = "moca.executeSelectionToCSV";
    LanguageClientCommands.EXECUTE_WITH_CSV = "moca.executeWithCSV";
    LanguageClientCommands.EXECUTE_WITH_CSV_TO_CSV = "moca.executeWithCSVToCSV";
    LanguageClientCommands.EXECUTION_HISTORY = "moca.executionHistory";
    LanguageClientCommands.TRACE = "moca.trace";
    LanguageClientCommands.OPEN_TRACE_OUTLINE = "moca.openTraceOutline";
    LanguageClientCommands.COMMAND_LOOKUP = "moca.commandLookup";
    LanguageClientCommands.AUTO_EXECUTE = "moca.autoExecute";
})(LanguageClientCommands = exports.LanguageClientCommands || (exports.LanguageClientCommands = {}));
// Language server commands.
var LanguageServerCommands;
(function (LanguageServerCommands) {
    LanguageServerCommands.ACTIVATE = "mocalanguageserver.activate";
    LanguageServerCommands.CONNECT = "mocalanguageserver.connect";
    LanguageServerCommands.LOAD_CACHE = "mocalanguageserver.loadCache";
    LanguageServerCommands.EXECUTE = "mocalanguageserver.execute";
    LanguageServerCommands.EXECUTE_TO_CSV = "mocalanguageserver.executeToCSV";
    LanguageServerCommands.TRACE = "mocalanguageserver.trace";
    LanguageServerCommands.OPEN_TRACE_OUTLINE = "mocalanguageserver.openTraceOutline";
    LanguageServerCommands.COMMAND_LOOKUP = "mocalanguageserver.commandLookup";
    LanguageServerCommands.SET_LANGUAGE_SERVER_OPTIONS = "mocalanguageserver.setLanguageServerOptions";
})(LanguageServerCommands = exports.LanguageServerCommands || (exports.LanguageServerCommands = {}));
// Status bar items.
// Arbitrary number to offset status bar priorities in order to try to keep items together better.
const STATUS_BAR_PRIORITY_OFFSET = 562;
var connectionStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, Number.MAX_VALUE + STATUS_BAR_PRIORITY_OFFSET);
var executeStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, Number.MAX_VALUE - 1 + STATUS_BAR_PRIORITY_OFFSET);
var executeSelectionStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, Number.MAX_VALUE - 2 + STATUS_BAR_PRIORITY_OFFSET);
var executeToCSVStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, Number.MAX_VALUE - 3 + STATUS_BAR_PRIORITY_OFFSET);
var executeSelectionToCSVStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, Number.MAX_VALUE - 4 + STATUS_BAR_PRIORITY_OFFSET);
var executionHistoryStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, Number.MAX_VALUE - 5 + STATUS_BAR_PRIORITY_OFFSET);
var commandLookupStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, Number.MAX_VALUE - 6 + STATUS_BAR_PRIORITY_OFFSET);
var traceStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, Number.MAX_VALUE - 7 + STATUS_BAR_PRIORITY_OFFSET);
var openTraceOutlineStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, Number.MAX_VALUE - 8 + STATUS_BAR_PRIORITY_OFFSET);
// Status bar constants.
const STATUS_BAR_NOT_CONNECTED_STR = "MOCA: $(circle-slash)";
const STATUS_BAR_CONNECTED_PREFIX_STR = "MOCA: $(pass) ";
const STATUS_BAR_START_TRACE_STR = "$(debug-alt) Start Trace";
const STATUS_BAR_STOP_TRACE_STR = "$(debug-disconnect) Stop Trace";
// Constants for unsafe script executions configuration.
const UNSAFE_CODE_APPROVAL_PROMPT = "You are attempting to run unsafe code. Do you want to continue?";
const UNSAFE_CODE_APPROVAL_OPTION_YES = "Yes";
const UNSAFE_CODE_APPROVAL_OPTION_NO = "No";
const UNSAFE_CODE_NOT_SUPER_USER_MESSAGE = "Only super users are allowed to run unsafe code.";
// Constants for opening trace outline immediately after trace stop.
const OPEN_TRACE_OUTLINE_PROMPT = "Would you like to open trace outline?";
const OPEN_TRACE_OUTLINE_OPTION_YES = "Yes";
const OPEN_TRACE_OUTLINE_OPTION_NO = "No";
// Need to keep track of trace status.
let traceStarted = false;
// Need to save off user ID for default trace file naming.
let curConnectionUserId = "";
// Tells us if trace status bar item is hidden via showAllIconsInStatusBar client options config.
let hidingTraceStatusBarItem = false;
// History of executed scripts for current window.
// NOTE: Does not include auto executions.
let executionHistory = [];
function activate(context) {
    return __awaiter(this, void 0, void 0, function* () {
        // Set some vars.
        globalExtensionContext = context;
        // Make sure global storage path exists.
        vscode.workspace.fs.createDirectory(vscode.Uri.file(context.globalStoragePath));
        // NOTE: uri will be structured differently for windows vs other platforms.
        var commandLookupDir = null;
        var traceDir = null;
        var referencesDir = null;
        var dirDelim = null;
        if (process["platform"] === "win32") {
            commandLookupDir = context.globalStoragePath + "\\command-lookup";
            traceDir = context.globalStoragePath + "\\trace";
            referencesDir = context.globalStoragePath + "\\references";
            dirDelim = "\\";
        }
        else {
            commandLookupDir = context.globalStoragePath + "/command-lookup";
            traceDir = context.globalStoragePath + "/trace";
            referencesDir = context.globalStoragePath + "/references";
            dirDelim = "/";
        }
        // Make sure other paths exist.
        vscode.workspace.fs.createDirectory(vscode.Uri.file(commandLookupDir));
        vscode.workspace.fs.createDirectory(vscode.Uri.file(traceDir));
        vscode.workspace.fs.createDirectory(vscode.Uri.file(referencesDir));
        // Directories are there -- let's purge existing files.
        var commandLookupDirRes = yield vscode.workspace.fs.readDirectory(vscode.Uri.file(commandLookupDir));
        for (var i = 0; i < commandLookupDirRes.length; i++) {
            // Only delete if last modified date is not same as today.
            if (fs.statSync(commandLookupDir + dirDelim + commandLookupDirRes[i][0]).mtime.getDate() != new Date().getDate()) {
                vscode.workspace.fs.delete(vscode.Uri.file(commandLookupDir + dirDelim + commandLookupDirRes[i][0]));
            }
        }
        var traceDirRes = yield vscode.workspace.fs.readDirectory(vscode.Uri.file(traceDir));
        for (var i = 0; i < traceDirRes.length; i++) {
            // Only delete if last modified date is not same as today.
            if (fs.statSync(traceDir + dirDelim + traceDirRes[i][0]).mtime.getDate() != new Date().getDate()) {
                vscode.workspace.fs.delete(vscode.Uri.file(traceDir + dirDelim + traceDirRes[i][0]));
            }
        }
        var referencesDirRes = yield vscode.workspace.fs.readDirectory(vscode.Uri.file(referencesDir));
        for (var i = 0; i < referencesDirRes.length; i++) {
            // Only delete if last modified date is not same as today.
            if (fs.statSync(referencesDir + dirDelim + referencesDirRes[i][0]).mtime.getDate() != new Date().getDate()) {
                vscode.workspace.fs.delete(vscode.Uri.file(referencesDir + dirDelim + referencesDirRes[i][0]));
            }
        }
        // Start language server on extension activate.
        yield startMocaLanguageServer();
        var activateResponse = yield vscode.commands.executeCommand(LanguageServerCommands.ACTIVATE, context.globalStoragePath, vscode.workspace.getConfiguration(exports.CONFIGURATION_NAME).get(exports.CONFIGURATION_LANGUAGE_SERVER_OPTIONS_NAME), vscode.workspace.getConfiguration(exports.CONFIGURATION_NAME).get(exports.CONFIGURATION_DEFAULT_GROOVY_CLASSPATH_NAME));
        var activateResponseJsonObj = JSON.parse(JSON.stringify(activateResponse));
        if (activateResponseJsonObj["exception"]) {
            vscode.window.showErrorMessage("Error occuring during MOCA Language Server activation: " + activateResponseJsonObj["exception"]["message"]);
        }
        // Command registration.
        context.subscriptions.push(vscode.commands.registerCommand(LanguageClientCommands.CONNECT, () => __awaiter(this, void 0, void 0, function* () {
            var connectionNames = new Array();
            var connections = new Map();
            // Read in config.
            const config = vscode.workspace.getConfiguration(exports.CONFIGURATION_NAME);
            const connectionConfig = config.get(exports.CONFIGURATION_CONNECTIONS_NAME);
            if (connectionConfig) {
                const connectionConfigObjArr = connectionConfig;
                for (var i = 0; i < connectionConfigObjArr.length; i++) {
                    const connectionObj = JSON.parse(JSON.stringify(connectionConfigObjArr[i]));
                    connectionNames.push(connectionObj.name);
                    connections.set(connectionObj.name, connectionObj);
                }
            }
            // Let user pick connection.
            let connectionNameQuickPickRes = yield vscode.window.showQuickPick(connectionNames, { ignoreFocusOut: true });
            const selectedConnectionObj = connections.get(connectionNameQuickPickRes);
            if (!selectedConnectionObj) {
                return null;
            }
            // Now let's see if selected connection possesses a user/password.
            // If not, we need to get from the user.
            if (!selectedConnectionObj.user) {
                let userInputRes = yield vscode.window.showInputBox({ prompt: "User ID", ignoreFocusOut: true });
                if (!userInputRes) {
                    return null;
                }
                selectedConnectionObj.user = userInputRes;
                let passwordInputRes = yield vscode.window.showInputBox({ prompt: "Password", password: true, ignoreFocusOut: true });
                if (!passwordInputRes) {
                    return null;
                }
                selectedConnectionObj.password = passwordInputRes;
            }
            else {
                if (!selectedConnectionObj.password) {
                    let passwordInputRes = yield vscode.window.showInputBox({ prompt: "Password", password: true, ignoreFocusOut: true });
                    if (!passwordInputRes) {
                        return null;
                    }
                    selectedConnectionObj.password = passwordInputRes;
                }
            }
            // This should be a safe place to set this.
            curConnectionUserId = selectedConnectionObj.user;
            // If no entries in groovy classpath for selected connection, set to default groovy classpath.
            if (!selectedConnectionObj.groovyclasspath || selectedConnectionObj.groovyclasspath.length === 0) {
                selectedConnectionObj.groovyclasspath = vscode.workspace.getConfiguration(exports.CONFIGURATION_NAME).get(exports.CONFIGURATION_DEFAULT_GROOVY_CLASSPATH_NAME);
            }
            // If no entry for unsafe approval config, just default to false.
            if (!selectedConnectionObj.approveUnsafeScripts) {
                selectedConnectionObj.approveUnsafeScripts = false;
            }
            // Refering to moca server, not moca language server.
            var connectionSuccess = false;
            vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: "MOCA",
                cancellable: true
            }, (progress, token) => __awaiter(this, void 0, void 0, function* () {
                progress.report({
                    increment: Infinity,
                    message: ("Connecting To " + selectedConnectionObj.name)
                });
                // Purpose of this is to indicate that cancellation was requested down below.
                var cancellationRequested = false;
                token.onCancellationRequested(() => {
                    cancellationRequested = true;
                });
                // Language server will be started at this point.
                var connResponse = yield vscode.commands.executeCommand(LanguageServerCommands.CONNECT, selectedConnectionObj);
                // If cancellation requested, skip this part.
                if (!cancellationRequested) {
                    const connResponseJsonObj = JSON.parse(JSON.stringify(connResponse));
                    const eOk = connResponseJsonObj["eOk"];
                    if (eOk === true) {
                        connectionSuccess = true;
                        connectionStatusBarItem.text = STATUS_BAR_CONNECTED_PREFIX_STR + selectedConnectionObj.name;
                    }
                    else {
                        var exceptionJsonObj = JSON.parse(JSON.stringify(connResponseJsonObj["exception"]));
                        vscode.window.showErrorMessage(selectedConnectionObj.name + ": " + exceptionJsonObj["message"]);
                        connectionStatusBarItem.text = STATUS_BAR_NOT_CONNECTED_STR;
                    }
                }
            })).then(() => {
                // If successful connection and we are not just re-connecting to current connection, load repo.
                if (connectionSuccess) {
                    vscode.commands.executeCommand(LanguageClientCommands.LOAD_CACHE);
                }
            });
        })));
        context.subscriptions.push(vscode.commands.registerCommand(LanguageClientCommands.LOAD_CACHE, () => __awaiter(this, void 0, void 0, function* () {
            vscode.window.withProgress({
                location: vscode.ProgressLocation.Window,
                title: "MOCA: Loading Cache",
                cancellable: false
            }, (progress) => __awaiter(this, void 0, void 0, function* () {
                progress.report({ increment: Infinity });
                yield vscode.commands.executeCommand(LanguageServerCommands.LOAD_CACHE);
            }));
        })));
        context.subscriptions.push(vscode.commands.registerCommand(LanguageClientCommands.EXECUTE, () => __awaiter(this, void 0, void 0, function* () {
            let editor = vscode.window.activeTextEditor;
            if (editor) {
                var curFileName = editor.document.fileName;
                var curFileNameShortened = getShortenedFileName(curFileName);
                let script = editor.document.getText();
                yield executeMocaScriptWithProgress(context, curFileNameShortened, script, "Executing ");
            }
        })));
        context.subscriptions.push(vscode.commands.registerCommand(LanguageClientCommands.EXECUTE_SELECTION, () => __awaiter(this, void 0, void 0, function* () {
            let editor = vscode.window.activeTextEditor;
            if (editor) {
                var curFileName = editor.document.fileName;
                var curFileNameShortened = getShortenedFileName(curFileName);
                var selection = editor.selection;
                if (selection) {
                    var selectedScript = editor.document.getText(selection);
                    yield executeMocaScriptWithProgress(context, curFileNameShortened, selectedScript, "Executing Selection ");
                }
            }
        })));
        context.subscriptions.push(vscode.commands.registerCommand(LanguageClientCommands.EXECUTE_TO_CSV, () => __awaiter(this, void 0, void 0, function* () {
            let editor = vscode.window.activeTextEditor;
            if (editor) {
                var curFileName = editor.document.fileName;
                var curFileNameShortened = getShortenedFileName(curFileName);
                let script = editor.document.getText();
                yield executeMocaScriptToCSVWithProgress(context, curFileNameShortened, curFileName, script, "Executing To CSV ");
            }
        })));
        context.subscriptions.push(vscode.commands.registerCommand(LanguageClientCommands.EXECUTE_SELECTION_TO_CSV, () => __awaiter(this, void 0, void 0, function* () {
            let editor = vscode.window.activeTextEditor;
            if (editor) {
                var curFileName = editor.document.fileName;
                var curFileNameShortened = getShortenedFileName(curFileName);
                var selection = editor.selection;
                if (selection) {
                    var selectedScript = editor.document.getText(selection);
                    yield executeMocaScriptToCSVWithProgress(context, curFileNameShortened, curFileName, selectedScript, "Executing Selection To CSV ");
                }
            }
        })));
        context.subscriptions.push(vscode.commands.registerCommand(LanguageClientCommands.EXECUTE_WITH_CSV, () => __awaiter(this, void 0, void 0, function* () {
            // Give user list of local files to pick from.
            var csvFileNameRes = yield vscode.window.showOpenDialog({
                canSelectMany: false, canSelectFiles: true, canSelectFolders: false, title: "Execute With CSV", filters: {
                    "CSV": ["csv"]
                }
            });
            if (csvFileNameRes) {
                var csvRes = [];
                // vscode is a bit goofy with it's URIs, so we need to do this ugly transform.
                var csvFileUri = vscode.Uri.parse(csvFileNameRes[0].toString());
                var csvFileName = csvFileUri.toString(true).replace("file:///", "");
                fs.createReadStream(csvFileName)
                    .pipe(csv())
                    .on('data', (data) => {
                    csvRes.push(data);
                })
                    .on('end', () => __awaiter(this, void 0, void 0, function* () {
                    var csvPublishMocaScript = buildCSVPublishMocaScript(csvRes);
                    // CSV publish script is built. Now let's get editor script, combine accordingly, and execute.
                    let editor = vscode.window.activeTextEditor;
                    if (editor) {
                        var curFileName = editor.document.fileName;
                        var curFileNameShortened = getShortenedFileName(curFileName);
                        let script = editor.document.getText();
                        if (csvPublishMocaScript.length > 0 && script.length > 0) {
                            csvPublishMocaScript += " | ";
                        }
                        yield executeMocaScriptWithProgress(context, curFileNameShortened, csvPublishMocaScript + script, "Executing With CSV ");
                    }
                }));
            }
        })));
        context.subscriptions.push(vscode.commands.registerCommand(LanguageClientCommands.EXECUTE_WITH_CSV_TO_CSV, () => __awaiter(this, void 0, void 0, function* () {
            // Give user list of local files to pick from.
            var csvFileNameRes = yield vscode.window.showOpenDialog({
                canSelectMany: false, canSelectFiles: true, canSelectFolders: false, title: "Execute With CSV To CSV", filters: {
                    "CSV": ["csv"]
                }
            });
            if (csvFileNameRes) {
                var csvRes = [];
                // vscode is a bit goofy with it's URIs, so we need to do this ugly transform.
                var csvFileUri = vscode.Uri.parse(csvFileNameRes[0].toString());
                var csvFileName = csvFileUri.toString(true).replace("file:///", "");
                fs.createReadStream(csvFileName)
                    .pipe(csv())
                    .on('data', (data) => {
                    csvRes.push(data);
                })
                    .on('end', () => __awaiter(this, void 0, void 0, function* () {
                    var csvPublishMocaScript = buildCSVPublishMocaScript(csvRes);
                    // CSV publish script is built. Now let's get editor script, combine accordingly, and execute.
                    let editor = vscode.window.activeTextEditor;
                    if (editor) {
                        var curFileName = editor.document.fileName;
                        var curFileNameShortened = getShortenedFileName(curFileName);
                        let script = editor.document.getText();
                        if (csvPublishMocaScript.length > 0 && script.length > 0) {
                            csvPublishMocaScript += " | ";
                        }
                        yield executeMocaScriptToCSVWithProgress(context, curFileNameShortened, curFileName, csvPublishMocaScript + script, "Executing With CSV To CSV ");
                    }
                }));
            }
        })));
        context.subscriptions.push(vscode.commands.registerCommand(LanguageClientCommands.EXECUTION_HISTORY, () => __awaiter(this, void 0, void 0, function* () {
            // Show quick pick for user to pick particular execution.
            // NOTE: reversing the array since we want the most recent executions on top.
            let reversedExecutionHistory = [...executionHistory].reverse();
            let executionHistoryQuickPickRes = yield vscode.window.showQuickPick(reversedExecutionHistory, { ignoreFocusOut: true });
            if (executionHistoryQuickPickRes) {
                let editor = vscode.window.activeTextEditor;
                if (editor) {
                    editor.edit(editBuilder => {
                        editBuilder.replace(new vscode.Range(new vscode.Position(0, 0), editor.document.positionAt(editor.document.getText().length)), executionHistoryQuickPickRes);
                    });
                }
                else {
                    vscode.window.showErrorMessage("Error occured when inserting script: no editor tab has focus");
                }
            }
        })));
        context.subscriptions.push(vscode.commands.registerCommand(LanguageClientCommands.TRACE, () => __awaiter(this, void 0, void 0, function* () {
            // Read in configuration.
            const config = vscode.workspace.getConfiguration(exports.CONFIGURATION_NAME);
            var traceConfigObj = config.get(exports.CONFIGURATION_TRACE_NAME);
            if (traceConfigObj) {
                var traceConfigJsonObj = JSON.parse(JSON.stringify(traceConfigObj));
                var fileName = traceConfigJsonObj.fileName;
                var mode = traceConfigJsonObj.mode;
                if (!fileName) {
                    fileName = curConnectionUserId;
                }
                if (!mode || (mode !== "w" && mode !== "a")) {
                    mode = "w";
                }
                vscode.window.withProgress({
                    location: vscode.ProgressLocation.Notification,
                    title: (traceStarted ? "MOCA: Stopping trace" : "MOCA: Starting trace"),
                    cancellable: false
                }, (progress) => __awaiter(this, void 0, void 0, function* () {
                    progress.report({ increment: Infinity });
                    // Start/stop trace.
                    traceStarted = !traceStarted;
                    if (traceStarted) {
                        traceStatusBarItem.text = STATUS_BAR_STOP_TRACE_STR;
                        // Regardless of showAllIconsInStatusBar client options config, we want to show the stop trace icon so that the user knows that a trace is running.
                        if (hidingTraceStatusBarItem) {
                            traceStatusBarItem.show();
                        }
                    }
                    else {
                        traceStatusBarItem.text = STATUS_BAR_START_TRACE_STR;
                        // If hiding trace status bar icon via showAllIconsInStatusBar client options config, make sure we hide now.
                        if (hidingTraceStatusBarItem) {
                            traceStatusBarItem.hide();
                        }
                    }
                    var traceRes = yield vscode.commands.executeCommand(LanguageServerCommands.TRACE, traceStarted, fileName, mode);
                    const traceResponseJsonObj = JSON.parse(JSON.stringify(traceRes));
                    // If exception of any kind, we need to return the message/status and indicate that the trace is not running. This includes if we are not even connected to a MOCA env at all.
                    if (traceResponseJsonObj["mocaResultsResponse"]["exception"]) {
                        var exceptionJsonObj = JSON.parse(JSON.stringify(traceResponseJsonObj["mocaResultsResponse"]["exception"]));
                        vscode.window.showErrorMessage("Trace error: " + exceptionJsonObj["message"]);
                        // Reset trace status if currently running.
                        if (traceStarted) {
                            traceStarted = false;
                            traceStatusBarItem.text = STATUS_BAR_START_TRACE_STR;
                            // If hiding trace status bar icon via showAllIconsInStatusBar client options config, make sure we hide now.
                            if (hidingTraceStatusBarItem) {
                                traceStatusBarItem.hide();
                            }
                        }
                    }
                    else {
                        // Allow user to open trace.
                        if (!traceStarted) {
                            var openTraceOutlineOptionRes = yield vscode.window.showInformationMessage(OPEN_TRACE_OUTLINE_PROMPT, OPEN_TRACE_OUTLINE_OPTION_YES, OPEN_TRACE_OUTLINE_OPTION_NO);
                            if (openTraceOutlineOptionRes === OPEN_TRACE_OUTLINE_OPTION_YES) {
                                vscode.window.withProgress({
                                    location: vscode.ProgressLocation.Notification,
                                    title: "MOCA"
                                }, (progress, token) => __awaiter(this, void 0, void 0, function* () {
                                    progress.report({
                                        increment: Infinity,
                                        message: "Loading Trace Outline for " + fileName
                                    });
                                    // Read in configuration.
                                    const config = vscode.workspace.getConfiguration(exports.CONFIGURATION_NAME);
                                    var traceOutlinerConfigObj = config.get(exports.CONFIGURATION_TRACE_OUTLINER_NAME);
                                    // Prepare values.
                                    var traceOutlinerConfigJsonObj = JSON.parse(JSON.stringify(traceOutlinerConfigObj));
                                    var useLogicalIndentStrategy = traceOutlinerConfigJsonObj.useLogicalIndentStrategy;
                                    if (useLogicalIndentStrategy === undefined) {
                                        useLogicalIndentStrategy = true;
                                    }
                                    var minimumExecutionTime = traceOutlinerConfigJsonObj.minimumExecutionTime;
                                    if (!minimumExecutionTime) {
                                        minimumExecutionTime = 1.0;
                                    }
                                    // Create uri now so we can give it to lang server.
                                    var uri = vscode.Uri.file(traceDir + dirDelim + fileName.replace('.log', '') + ".moca.traceoutline");
                                    // Now that we have a remote trace file name, we can request outline from lang server.
                                    // NOTE: get rid of uri string encoding to match lang server format if windows. Do not skip encoding if other than windows.
                                    var traceResponseRemoteRes = null;
                                    if (process["platform"] === "win32") {
                                        traceResponseRemoteRes = yield vscode.commands.executeCommand(LanguageServerCommands.OPEN_TRACE_OUTLINE, fileName + ".log", uri.toString(true), true, useLogicalIndentStrategy, minimumExecutionTime);
                                    }
                                    else {
                                        traceResponseRemoteRes = yield vscode.commands.executeCommand(LanguageServerCommands.OPEN_TRACE_OUTLINE, fileName + ".log", uri.toString(false), true, useLogicalIndentStrategy, minimumExecutionTime);
                                    }
                                    if (traceResponseRemoteRes) {
                                        var traceResponseRemoteObj = JSON.parse(JSON.stringify(traceResponseRemoteRes));
                                        // Make sure to check for exception.
                                        if (traceResponseRemoteObj.exception) {
                                            vscode.window.showErrorMessage("Trace Outline error: " + traceResponseRemoteObj.exception["message"]);
                                        }
                                        else {
                                            // No exceptions -- now load outline.
                                            yield vscode.workspace.fs.writeFile(uri, Buffer.from(traceResponseRemoteObj.traceOutlineStr));
                                            var doc = yield vscode.workspace.openTextDocument(uri);
                                            yield vscode.window.showTextDocument(doc, { preview: false });
                                        }
                                    }
                                }));
                            }
                        }
                    }
                }));
            }
        })));
        context.subscriptions.push(vscode.commands.registerCommand(LanguageClientCommands.OPEN_TRACE_OUTLINE, () => __awaiter(this, void 0, void 0, function* () {
            // Let user decide between Remote and Local.
            var traceTypeRes = yield vscode.window.showQuickPick(["Remote", "Local"], { ignoreFocusOut: true });
            if (!traceTypeRes) {
                return;
            }
            // Read in configuration.
            const config = vscode.workspace.getConfiguration(exports.CONFIGURATION_NAME);
            var traceOutlinerConfigObj = config.get(exports.CONFIGURATION_TRACE_OUTLINER_NAME);
            // Prepare values.
            var traceOutlinerConfigJsonObj = JSON.parse(JSON.stringify(traceOutlinerConfigObj));
            var useLogicalIndentStrategy = traceOutlinerConfigJsonObj.useLogicalIndentStrategy;
            var minimumExecutionTime = traceOutlinerConfigJsonObj.minimumExecutionTime;
            if (traceTypeRes === "Remote") {
                // Sending empty args so that lang server knows to send us back a list of remote trace files.
                var traceResponseRemoteRes = yield vscode.commands.executeCommand(LanguageServerCommands.OPEN_TRACE_OUTLINE);
                // We should have a string array of trace file names now.
                var traceResponseRemoteObj = JSON.parse(JSON.stringify(traceResponseRemoteRes));
                if (traceResponseRemoteObj.traceFileNames) {
                    // Convert to string array and give user the list.
                    var traceFileNamesRemote = traceResponseRemoteObj.traceFileNames;
                    // Now sit tight while the user picks one.
                    var traceFileNameSelectedRemote = yield vscode.window.showQuickPick(traceFileNamesRemote, { ignoreFocusOut: true });
                    if (!traceFileNameSelectedRemote) {
                        return;
                    }
                    vscode.window.withProgress({
                        location: vscode.ProgressLocation.Notification,
                        title: "MOCA"
                    }, (progress, token) => __awaiter(this, void 0, void 0, function* () {
                        progress.report({
                            increment: Infinity,
                            message: "Loading Trace Outline for " + traceFileNameSelectedRemote
                        });
                        // Create uri now so we can give it to lang server.
                        var uri = vscode.Uri.file(traceDir + dirDelim + traceFileNameSelectedRemote.replace('.log', '') + ".moca.traceoutline");
                        // Now that we have a remote trace file name, we can request outline from lang server.
                        // NOTE: get rid of uri string encoding to match lang server format if windows. Do not skip encoding if other than windows.
                        if (process["platform"] === "win32") {
                            traceResponseRemoteRes = yield vscode.commands.executeCommand(LanguageServerCommands.OPEN_TRACE_OUTLINE, traceFileNameSelectedRemote, uri.toString(true), true, useLogicalIndentStrategy, minimumExecutionTime);
                        }
                        else {
                            traceResponseRemoteRes = yield vscode.commands.executeCommand(LanguageServerCommands.OPEN_TRACE_OUTLINE, traceFileNameSelectedRemote, uri.toString(false), true, useLogicalIndentStrategy, minimumExecutionTime);
                        }
                        if (traceResponseRemoteRes) {
                            traceResponseRemoteObj = JSON.parse(JSON.stringify(traceResponseRemoteRes));
                            // Make sure to check for exception.
                            if (traceResponseRemoteObj.exception) {
                                vscode.window.showErrorMessage("Trace Outline error: " + traceResponseRemoteObj.exception["message"]);
                            }
                            else {
                                // No exceptions -- now load outline.
                                yield vscode.workspace.fs.writeFile(uri, Buffer.from(traceResponseRemoteObj.traceOutlineStr));
                                var doc = yield vscode.workspace.openTextDocument(uri);
                                yield vscode.window.showTextDocument(doc, { preview: false });
                            }
                        }
                    }));
                }
                else if (traceResponseRemoteObj.exception) {
                    vscode.window.showErrorMessage("Trace Outline error: " + traceResponseRemoteObj.exception["message"]);
                }
            }
            else if (traceTypeRes === "Local") {
                // Give user list of local files to pick from.
                var traceFileNameSelectedLocalRes = yield vscode.window.showOpenDialog({
                    canSelectMany: false, canSelectFiles: true, canSelectFolders: false, title: "Open Trace Outline", filters: {
                        "Log": ["log"]
                    }
                });
                if (traceFileNameSelectedLocalRes) {
                    // traceFileNameSelectedLocalRes should be array object with just 1 element. Let's create a couple vars to simplify our interactions with it.
                    var traceFileNameSelectedLocalStr = traceFileNameSelectedLocalRes[0].toString();
                    var traceFileNameSelectedShortenedLocalStr = traceFileNameSelectedLocalStr.substring(traceFileNameSelectedLocalStr.lastIndexOf('/') + 1, traceFileNameSelectedLocalStr.length);
                    vscode.window.withProgress({
                        location: vscode.ProgressLocation.Notification,
                        title: "MOCA"
                    }, (progress, token) => __awaiter(this, void 0, void 0, function* () {
                        progress.report({
                            increment: Infinity,
                            message: "Loading Trace Outline for " + traceFileNameSelectedShortenedLocalStr
                        });
                        // Create uri now so we can give it to lang server.
                        var uri = vscode.Uri.file(traceDir + dirDelim + traceFileNameSelectedShortenedLocalStr.replace('.log', '') + ".moca.traceoutline");
                        // Now that we have a local trace file name, we can request outline from lang server.
                        // NOTE: get rid of uri string encoding to match lang server format if windows. Do not skip encoding if other than windows.
                        var traceResponseLocalRes = null;
                        if (process["platform"] === "win32") {
                            traceResponseLocalRes = yield vscode.commands.executeCommand(LanguageServerCommands.OPEN_TRACE_OUTLINE, traceFileNameSelectedLocalStr, uri.toString(true), false, useLogicalIndentStrategy, minimumExecutionTime);
                        }
                        else {
                            traceResponseLocalRes = yield vscode.commands.executeCommand(LanguageServerCommands.OPEN_TRACE_OUTLINE, traceFileNameSelectedLocalStr, uri.toString(false), false, useLogicalIndentStrategy, minimumExecutionTime);
                        }
                        if (traceResponseLocalRes) {
                            var traceResponseLocalObj = JSON.parse(JSON.stringify(traceResponseLocalRes));
                            // Make sure to check for exception.
                            if (traceResponseLocalObj.exception) {
                                vscode.window.showErrorMessage("Trace Outline error: " + traceResponseLocalObj.exception["message"]);
                            }
                            else {
                                // No exceptions -- now load outline.
                                yield vscode.workspace.fs.writeFile(uri, Buffer.from(traceResponseLocalObj.traceOutlineStr));
                                var doc = yield vscode.workspace.openTextDocument(uri);
                                yield vscode.window.showTextDocument(doc, { preview: false });
                            }
                        }
                    }));
                }
            }
        })));
        context.subscriptions.push(vscode.commands.registerCommand(LanguageClientCommands.COMMAND_LOOKUP, () => __awaiter(this, void 0, void 0, function* () {
            // We will call COMMAND_LOOKUP lang server command with no args. The lang server will take this as us wanting a list of all commands.
            // We will pick a command via a quick pick, and call COMMAND_LOOKUP lang server command once more but with a command name arg. This will
            // let the lang server know which command/triggers to send us. We will then prompt the user to pick what they want to see via another
            // quick pick. After they have selected what they want to see, we will write to a file, open and display it.
            var commandLookupRes = yield vscode.commands.executeCommand(LanguageServerCommands.COMMAND_LOOKUP);
            // We should have a string array of distinct moca command names.
            var commandLookupObj = JSON.parse(JSON.stringify(commandLookupRes));
            if (commandLookupObj.distinctMocaCommands) {
                var distinctCommands = commandLookupObj.distinctMocaCommands;
                // Now sit tight while the user picks one.
                var distinctCommandSelected = yield vscode.window.showQuickPick(distinctCommands, { ignoreFocusOut: true });
                if (!distinctCommandSelected) {
                    return;
                }
                // Now that we have a command, we can request command data from server.
                var commandDataRes = yield vscode.commands.executeCommand(LanguageServerCommands.COMMAND_LOOKUP, distinctCommandSelected);
                if (commandDataRes) {
                    // Now we need to let the user pick a command at a certain level or pick a trigger to look at.
                    var commandDataObj = JSON.parse(JSON.stringify(commandDataRes));
                    var commandData = new Array();
                    if (commandDataObj.commandsAtLevels) {
                        var commandsAtLevels = commandDataObj.commandsAtLevels;
                        for (var i = 0; i < commandsAtLevels.length; i++) {
                            commandData.push(commandsAtLevels[i].cmplvl + ": " + commandsAtLevels[i].command + " (" + commandsAtLevels[i].type + ")");
                        }
                    }
                    if (commandDataObj.triggers) {
                        var triggers = commandDataObj.triggers;
                        for (var i = 0; i < triggers.length; i++) {
                            commandData.push("Trigger: " + triggers[i].trgseq + " - " + triggers[i].name);
                        }
                    }
                    var commandDataSelectedRes = yield vscode.window.showQuickPick(commandData, { ignoreFocusOut: true, canPickMany: true });
                    if (!commandDataSelectedRes) {
                        return;
                    }
                    // Now that the user has selected something specific from the command looked up, we can load the file(s).
                    var commandDataSelectedArr = commandDataSelectedRes;
                    // Put commands & triggers in arrays here if we have them.
                    var commandsAtLevels = [];
                    if (commandDataObj.commandsAtLevels) {
                        var commandsAtLevels = commandDataObj.commandsAtLevels;
                    }
                    var triggers = [];
                    if (commandDataObj.triggers) {
                        triggers = commandDataObj.triggers;
                    }
                    for (var i = 0; i < commandDataSelectedArr.length; i++) {
                        var commandDataSelected = commandDataSelectedArr[i];
                        // Checking commands.
                        for (var j = 0; j < commandsAtLevels.length; j++) {
                            if (commandDataSelected.localeCompare(commandsAtLevels[j].cmplvl + ": " + commandsAtLevels[j].command + " (" + commandsAtLevels[j].type + ")") === 0) {
                                var uri = vscode.Uri.file(commandLookupDir + dirDelim + (commandsAtLevels[j].cmplvl + "-" + commandsAtLevels[j].command).replace(/ /g, "_") + ".moca.readonly");
                                // Before we attempt to write, we need to make sure code is local syntax.
                                if (commandsAtLevels[j].type.localeCompare("Local Syntax") !== 0) {
                                    vscode.window.showErrorMessage("Command Lookup: Cannot view non Local Syntax commands!");
                                }
                                else {
                                    yield vscode.workspace.fs.writeFile(uri, Buffer.from(commandsAtLevels[j].syntax));
                                    var doc = yield vscode.workspace.openTextDocument(uri);
                                    yield vscode.window.showTextDocument(doc, { preview: false });
                                }
                            }
                        }
                        // Checking triggers.
                        for (var j = 0; j < triggers.length; j++) {
                            if (commandDataSelected.localeCompare("Trigger: " + triggers[j].trgseq + " - " + triggers[j].name) === 0) {
                                var uri = vscode.Uri.file(commandLookupDir + dirDelim + (distinctCommandSelected + "-" + triggers[j].name).replace(/ /g, "_") + ".moca.readonly");
                                // Triggers are always local syntax.
                                yield vscode.workspace.fs.writeFile(uri, Buffer.from(triggers[j].syntax));
                                var doc = yield vscode.workspace.openTextDocument(uri);
                                yield vscode.window.showTextDocument(doc, { preview: false });
                            }
                        }
                    }
                }
            }
        })));
        context.subscriptions.push(vscode.commands.registerCommand(LanguageClientCommands.AUTO_EXECUTE, () => __awaiter(this, void 0, void 0, function* () {
            // Basically this just executes the same script over and over until a stop condition is met.
            // Read in configuration and execute.
            const config = vscode.workspace.getConfiguration(exports.CONFIGURATION_NAME);
            var autoExecutionConfigObj = config.get(exports.CONFIGURATION_AUTO_EXECUTION_NAME);
            if (autoExecutionConfigObj) {
                // Prepare values.
                var autoExecutionConfigJsonObj = JSON.parse(JSON.stringify(autoExecutionConfigObj));
                var initialDuration = autoExecutionConfigJsonObj.initialDuration;
                var sleepDuration = autoExecutionConfigJsonObj.sleepDuration;
                var stopIfExecutionCountExceeds = autoExecutionConfigJsonObj.stopIfExecutionCountExceeds;
                var stopIfTimeElapses = autoExecutionConfigJsonObj.stopIfTimeElapses;
                var stopIfExecutionError = autoExecutionConfigJsonObj.stopIfExecutionError;
                if (initialDuration === undefined) {
                    initialDuration = 5;
                }
                if (sleepDuration === undefined) {
                    sleepDuration = 5;
                }
                if (stopIfExecutionCountExceeds === undefined) {
                    stopIfExecutionCountExceeds = 75;
                }
                if (stopIfTimeElapses === undefined) {
                    stopIfTimeElapses = 600;
                }
                if (stopIfExecutionError === undefined) {
                    stopIfExecutionError = true;
                }
                // Sleep function for later.
                function sleepFunc(ms = 0) {
                    return new Promise(r => setTimeout(r, ms));
                }
                // Convert seconds to milliseconds.
                initialDuration *= 1000;
                sleepDuration *= 1000;
                stopIfTimeElapses *= 1000;
                // Loop break vars.
                var executionCount = 0;
                var startTime = perf_hooks_1.performance.now();
                var curTime = startTime;
                var stopExecutionBecauseOfError = false;
                // Start auto execution.
                let editor = vscode.window.activeTextEditor;
                if (editor) {
                    var curFileName = editor.document.fileName;
                    var curFileNameShortened = getShortenedFileName(curFileName);
                    let script = editor.document.getText();
                    vscode.window.withProgress({
                        location: vscode.ProgressLocation.Notification,
                        title: "MOCA",
                        cancellable: true
                    }, (autoExecProgress, autoExecToken) => __awaiter(this, void 0, void 0, function* () {
                        autoExecProgress.report({
                            increment: Infinity,
                            message: "Auto Executing " + curFileNameShortened
                        });
                        // Start with initial duration.
                        yield sleepFunc(initialDuration);
                        // Purpose of this is to indicate that cancellation was requested down below.
                        var autoExecCancellationRequested = false;
                        autoExecToken.onCancellationRequested(() => {
                            autoExecCancellationRequested = true;
                        });
                        var executionCountIncrementAmount = (1 / stopIfExecutionCountExceeds) * 100;
                        var elapsedTimeIncrementAmount = (1000 / stopIfTimeElapses) * 100;
                        var incrementAmount = (executionCountIncrementAmount > elapsedTimeIncrementAmount ? executionCountIncrementAmount : elapsedTimeIncrementAmount);
                        while (executionCount < stopIfExecutionCountExceeds && (curTime - startTime) < stopIfTimeElapses && !stopExecutionBecauseOfError && !autoExecCancellationRequested) {
                            // Sleep before execution.
                            yield sleepFunc(sleepDuration);
                            if (!autoExecCancellationRequested) {
                                // Execute.
                                vscode.window.withProgress({
                                    location: vscode.ProgressLocation.Notification,
                                    title: "MOCA",
                                    cancellable: true
                                }, (execProgress, execToken) => __awaiter(this, void 0, void 0, function* () {
                                    execProgress.report({
                                        increment: Infinity,
                                        message: "Auto Executing " + curFileNameShortened + " (" + (executionCount + 1) + ")"
                                    });
                                    // Purpose of this is to indicate that cancellation was requested down below.
                                    var execCancellationRequested = false;
                                    execToken.onCancellationRequested(() => {
                                        execCancellationRequested = true;
                                    });
                                    if (!autoExecCancellationRequested && !execCancellationRequested) {
                                        // NOTE: just assume user does not care about unsafe code config here.
                                        var res = yield vscode.commands.executeCommand(LanguageServerCommands.EXECUTE, script, curFileNameShortened, true);
                                        // If cancellation requested, skip this part.
                                        if (!execCancellationRequested) {
                                            var mocaResults = new mocaResults_1.MocaResults(res);
                                            ResultViewPanel_1.ResultViewPanel.createOrShow(context.extensionPath, curFileNameShortened, mocaResults);
                                            if (mocaResults.msg && mocaResults.msg.length > 0) {
                                                vscode.window.showErrorMessage(curFileNameShortened + "(Auto Execution): " + mocaResults.msg);
                                                // This means we have an error. Check if we need to quit auto exec.
                                                if (stopIfExecutionError) {
                                                    stopExecutionBecauseOfError = true;
                                                }
                                            }
                                        }
                                    }
                                }));
                                executionCount++;
                                curTime = perf_hooks_1.performance.now();
                                autoExecProgress.report({ increment: incrementAmount });
                            }
                        }
                    }));
                }
            }
            else {
                vscode.window.showErrorMessage("Must Configure Auto Execution!");
            }
        })));
        // Events registration.
        // Configuration listener.
        context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(e => {
            // Client options.
            if (e.affectsConfiguration((exports.CONFIGURATION_NAME + "." + exports.CONFIGURATION_CLIENT_OPTIONS_NAME))) {
                semanticHighlighting_1.GlobalSemanticHighlightingVars.semanticHighlightingFeature.loadCurrentTheme();
                // Show status bar items based on client options config.
                {
                    const config = vscode.workspace.getConfiguration(exports.CONFIGURATION_NAME);
                    const clientOptionsConfig = config.get(exports.CONFIGURATION_CLIENT_OPTIONS_NAME);
                    const clientOptionsConfigObj = JSON.parse(JSON.stringify(clientOptionsConfig));
                    if (clientOptionsConfigObj["showAllIconsInStatusBar"] === true) {
                        executeStatusBarItem.show();
                        executeSelectionStatusBarItem.show();
                        executeToCSVStatusBarItem.show();
                        executeSelectionToCSVStatusBarItem.show();
                        executionHistoryStatusBarItem.show();
                        commandLookupStatusBarItem.show();
                        traceStatusBarItem.show();
                        openTraceOutlineStatusBarItem.show();
                        hidingTraceStatusBarItem = false;
                    }
                    else {
                        executeStatusBarItem.hide();
                        executeSelectionStatusBarItem.hide();
                        executeToCSVStatusBarItem.hide();
                        executeSelectionToCSVStatusBarItem.hide();
                        executionHistoryStatusBarItem.hide();
                        commandLookupStatusBarItem.hide();
                        traceStatusBarItem.hide();
                        openTraceOutlineStatusBarItem.hide();
                        hidingTraceStatusBarItem = true;
                    }
                }
            }
            // Language server options.
            if (e.affectsConfiguration((exports.CONFIGURATION_NAME + "." + exports.CONFIGURATION_LANGUAGE_SERVER_OPTIONS_NAME))) {
                vscode.commands.executeCommand(LanguageServerCommands.SET_LANGUAGE_SERVER_OPTIONS, vscode.workspace.getConfiguration(exports.CONFIGURATION_NAME).get(exports.CONFIGURATION_LANGUAGE_SERVER_OPTIONS_NAME));
            }
        }));
        // Get status bar items up and running now.
        connectionStatusBarItem.text = STATUS_BAR_NOT_CONNECTED_STR;
        connectionStatusBarItem.command = LanguageClientCommands.CONNECT;
        connectionStatusBarItem.tooltip = "Connect To MOCA Server";
        executeStatusBarItem.text = "$(play)";
        executeStatusBarItem.command = LanguageClientCommands.EXECUTE;
        executeStatusBarItem.tooltip = "Execute (Ctrl+Enter)";
        executeSelectionStatusBarItem.text = "$(play)$(selection)";
        executeSelectionStatusBarItem.command = LanguageClientCommands.EXECUTE_SELECTION;
        executeSelectionStatusBarItem.tooltip = "Execute Selection (Ctrl+Shift+Enter)";
        executeToCSVStatusBarItem.text = "CSV";
        executeToCSVStatusBarItem.command = LanguageClientCommands.EXECUTE_TO_CSV;
        executeToCSVStatusBarItem.tooltip = "Execute To CSV (Ctrl+Alt+Enter)";
        executeSelectionToCSVStatusBarItem.text = "$(selection)CSV";
        executeSelectionToCSVStatusBarItem.command = LanguageClientCommands.EXECUTE_SELECTION_TO_CSV;
        executeSelectionToCSVStatusBarItem.tooltip = "Execute Selection To CSV (Ctrl+Shift+Alt+Enter)";
        executionHistoryStatusBarItem.text = "$(history)";
        executionHistoryStatusBarItem.command = LanguageClientCommands.EXECUTION_HISTORY;
        executionHistoryStatusBarItem.tooltip = "Execution History For Current Window";
        commandLookupStatusBarItem.text = "$(file-code)";
        commandLookupStatusBarItem.command = LanguageClientCommands.COMMAND_LOOKUP;
        commandLookupStatusBarItem.tooltip = "Command Lookup";
        traceStatusBarItem.text = STATUS_BAR_START_TRACE_STR;
        traceStatusBarItem.command = LanguageClientCommands.TRACE;
        openTraceOutlineStatusBarItem.text = "$(list-tree)";
        openTraceOutlineStatusBarItem.command = LanguageClientCommands.OPEN_TRACE_OUTLINE;
        openTraceOutlineStatusBarItem.tooltip = "Open Trace Outline";
        // Show status bar items based on client options config.
        // MOCA connection will always be shown.
        connectionStatusBarItem.show();
        {
            const config = vscode.workspace.getConfiguration(exports.CONFIGURATION_NAME);
            const clientOptionsConfig = config.get(exports.CONFIGURATION_CLIENT_OPTIONS_NAME);
            const clientOptionsConfigObj = JSON.parse(JSON.stringify(clientOptionsConfig));
            if (clientOptionsConfigObj["showAllIconsInStatusBar"] === true) {
                executeStatusBarItem.show();
                executeSelectionStatusBarItem.show();
                executeToCSVStatusBarItem.show();
                executeSelectionToCSVStatusBarItem.show();
                executionHistoryStatusBarItem.show();
                commandLookupStatusBarItem.show();
                traceStatusBarItem.show();
                openTraceOutlineStatusBarItem.show();
                hidingTraceStatusBarItem = false;
            }
            else {
                executeStatusBarItem.hide();
                executeSelectionStatusBarItem.hide();
                executeToCSVStatusBarItem.hide();
                executeSelectionToCSVStatusBarItem.hide();
                executionHistoryStatusBarItem.hide();
                commandLookupStatusBarItem.hide();
                traceStatusBarItem.hide();
                openTraceOutlineStatusBarItem.hide();
                hidingTraceStatusBarItem = true;
            }
        }
        context.subscriptions.push(connectionStatusBarItem);
        context.subscriptions.push(executeStatusBarItem);
        context.subscriptions.push(executeSelectionStatusBarItem);
        context.subscriptions.push(executeToCSVStatusBarItem);
        context.subscriptions.push(executeSelectionToCSVStatusBarItem);
        context.subscriptions.push(executionHistoryStatusBarItem);
        context.subscriptions.push(commandLookupStatusBarItem);
        context.subscriptions.push(traceStatusBarItem);
        context.subscriptions.push(openTraceOutlineStatusBarItem);
    });
}
exports.activate = activate;
function deactivate() { }
exports.deactivate = deactivate;
function startMocaLanguageServer() {
    javaPath = findJava();
    return vscode.window.withProgress({ location: vscode.ProgressLocation.Window }, progress => {
        return new Promise((resolve, reject) => {
            progress.report({ message: MOCA_LANGUAGE_SERVER_INITIALIZING_MESSAGE });
            let clientOptions = {
                documentSelector: [{ scheme: "file", language: "moca" }],
                uriConverters: {
                    code2Protocol: (value) => {
                        if (/^win32/.test(process.platform)) {
                            //drive letters on Windows are encoded with %3A instead of :
                            //but Java doesn't treat them the same
                            return value.toString().replace("%3A", ":");
                        }
                        else {
                            return value.toString();
                        }
                    },
                    //this is just the default behavior, but we need to define both
                    protocol2Code: value => vscode.Uri.parse(value)
                }
            };
            let args = ["-jar", path.resolve(globalExtensionContext.extensionPath, "bin", MOCA_LANGUAGE_SERVER)];
            let executable = {
                command: javaPath,
                args: args
            };
            mocaLanguageClient = new vscode_languageclient_1.LanguageClient("moca", "MOCA Language Server", executable, clientOptions);
            mocaLanguageClient.onReady().then(resolve, reason => {
                resolve(undefined);
                vscode.window.showErrorMessage(MOCA_LANGUAGE_SERVER_ERR_STARTUP);
            });
            const semanticHighlightingFeature = new semanticHighlighting_1.SemanticHighlightingFeature(mocaLanguageClient, globalExtensionContext);
            globalExtensionContext.subscriptions.push(vscode.Disposable.from(semanticHighlightingFeature));
            mocaLanguageClient.registerFeature(semanticHighlightingFeature);
            let disposable = mocaLanguageClient.start();
            globalExtensionContext.subscriptions.push(disposable);
        });
    });
}
function findJava() {
    var executableFile = "java";
    if (process["platform"] === "win32") {
        executableFile += ".exe";
    }
    if ("JRE_HOME" in process.env) {
        let jreHome = process.env.JRE_HOME;
        let javaPath = path.join(jreHome, "bin", executableFile);
        if (validate(javaPath)) {
            return javaPath;
        }
    }
    if ("JAVA_HOME" in process.env) {
        let javaHome = process.env.JAVA_HOME;
        let javaPath = path.join(javaHome, "bin", executableFile);
        if (validate(javaPath)) {
            return javaPath;
        }
    }
    if ("PATH" in process.env) {
        let PATH = process.env.PATH;
        let paths = PATH.split(path.delimiter);
        let pathCount = paths.length;
        for (let i = 0; i < pathCount; i++) {
            let javaPath = path.join(paths[i], executableFile);
            if (validate(javaPath)) {
                return javaPath;
            }
        }
    }
    return "";
}
exports.default = findJava;
function validate(javaPath) {
    return fs.existsSync(javaPath) && fs.statSync(javaPath).isFile();
}
function getShortenedFileName(fileName) {
    // Behavior will be different for windows vs other platforms.
    if (process["platform"] === "win32") {
        return fileName.substring(fileName.lastIndexOf('\\') + 1, fileName.length);
    }
    else {
        return fileName.substring(fileName.lastIndexOf('/') + 1, fileName.length);
    }
}
function executeMocaScriptWithProgress(context, curFileNameShortened, script, progressMessagePrefix) {
    return __awaiter(this, void 0, void 0, function* () {
        vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: "MOCA",
            cancellable: true
        }, (progress, token) => __awaiter(this, void 0, void 0, function* () {
            progress.report({
                increment: Infinity,
                message: progressMessagePrefix + curFileNameShortened
            });
            // Purpose of this is to indicate that cancellation was requested down below.
            var cancellationRequested = false;
            token.onCancellationRequested(() => {
                cancellationRequested = true;
            });
            var res = yield vscode.commands.executeCommand(LanguageServerCommands.EXECUTE, script, curFileNameShortened, false);
            // Add to execution history.
            executionHistory.push(script);
            // If cancellation requested, skip this part.
            if (!cancellationRequested) {
                var mocaResults = new mocaResults_1.MocaResults(res);
                // If lang server says we need approval before executing (due to unsafe code config on connection), we need to ask the user if they truly want to run script.
                // NOTE: if cancellation is requested before we get here, lang server does not run unsafe scripts in configured envs by default -- assuming that approval is required.
                if (mocaResults.needsApprovalToExecute) {
                    if (!mocaResults.superUser) {
                        vscode.window.showErrorMessage(UNSAFE_CODE_NOT_SUPER_USER_MESSAGE);
                    }
                    else {
                        var approvalOptionRes = yield vscode.window.showWarningMessage(UNSAFE_CODE_APPROVAL_PROMPT, UNSAFE_CODE_APPROVAL_OPTION_YES, UNSAFE_CODE_APPROVAL_OPTION_NO);
                        // Check again if cancellation is requested.
                        // If so, just exit and do not worry about approval option result.
                        if (!cancellationRequested) {
                            if (approvalOptionRes === UNSAFE_CODE_APPROVAL_OPTION_YES) {
                                // User says yes -- run script!
                                var approvedRes = yield vscode.commands.executeCommand(LanguageServerCommands.EXECUTE, script, curFileNameShortened, true);
                                // If cancellation requested, skip this part.
                                if (!cancellationRequested) {
                                    var approvedMocaResults = new mocaResults_1.MocaResults(approvedRes);
                                    ResultViewPanel_1.ResultViewPanel.createOrShow(context.extensionPath, curFileNameShortened, approvedMocaResults);
                                    if (approvedMocaResults.msg && approvedMocaResults.msg.length > 0) {
                                        vscode.window.showErrorMessage(curFileNameShortened + ": " + approvedMocaResults.msg);
                                    }
                                }
                            }
                        }
                    }
                }
                else {
                    ResultViewPanel_1.ResultViewPanel.createOrShow(context.extensionPath, curFileNameShortened, mocaResults);
                    if (mocaResults.msg && mocaResults.msg.length > 0) {
                        vscode.window.showErrorMessage(curFileNameShortened + ": " + mocaResults.msg);
                    }
                }
            }
        }));
    });
}
function executeMocaScriptToCSVWithProgress(context, curFileNameShortened, curFileName, script, progressMessagePrefix) {
    return __awaiter(this, void 0, void 0, function* () {
        vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: "MOCA",
            cancellable: true
        }, (progress, token) => __awaiter(this, void 0, void 0, function* () {
            progress.report({
                increment: Infinity,
                message: progressMessagePrefix + curFileNameShortened
            });
            // Purpose of this is to indicate that cancellation was requested down below.
            var cancellationRequested = false;
            token.onCancellationRequested(() => {
                cancellationRequested = true;
            });
            var res = yield vscode.commands.executeCommand(LanguageServerCommands.EXECUTE_TO_CSV, script, curFileNameShortened, curFileName, false);
            // Add to execution history.
            executionHistory.push(script);
            // If cancellation requested, skip this part.
            if (!cancellationRequested) {
                var mocaResults = new mocaResults_1.MocaResults(res);
                // If lang server says we need approval before executing(due to unsafe code config on connection), we need to ask the user if they truly want to run script.
                // NOTE: if cancellation is requested before we get here, lang server does not run unsafe scripts in configured envs by default -- assuming that approval is required.
                if (mocaResults.needsApprovalToExecute) {
                    var approvalOptionRes = yield vscode.window.showWarningMessage(UNSAFE_CODE_APPROVAL_PROMPT, UNSAFE_CODE_APPROVAL_OPTION_YES, UNSAFE_CODE_APPROVAL_OPTION_NO);
                    // Check again if cancellation is requested.
                    // If so, just exit and do not worry about approval option result.
                    if (!cancellationRequested) {
                        if (approvalOptionRes === UNSAFE_CODE_APPROVAL_OPTION_YES) {
                            // User says yes; run script!
                            var approvedRes = yield vscode.commands.executeCommand(LanguageServerCommands.EXECUTE_TO_CSV, script, curFileNameShortened, curFileName, true);
                            var approvedMocaResults = new mocaResults_1.MocaResults(approvedRes);
                            // Lang server is taking care of loading results.
                            if (approvedMocaResults.msg && approvedMocaResults.msg.length > 0) {
                                vscode.window.showErrorMessage(curFileNameShortened + ": " + approvedMocaResults.msg);
                            }
                        }
                    }
                }
                else {
                    // Lang server is taking care of loading results.
                    if (mocaResults.msg && mocaResults.msg.length > 0) {
                        vscode.window.showErrorMessage(curFileNameShortened + ": " + mocaResults.msg);
                    }
                }
            }
        }));
    });
}
function buildCSVPublishMocaScript(csvRes) {
    var csvPublishMocaScript = "";
    for (var i in csvRes) {
        var obj = JSON.parse(JSON.stringify(csvRes[i]));
        csvPublishMocaScript += "publish data where ";
        for (var attributename in obj) {
            csvPublishMocaScript += (attributename + " = \"" + obj[attributename] + "\" and ");
        }
        // Get rid of last " and " and add " & ".
        csvPublishMocaScript = csvPublishMocaScript.slice(0, csvPublishMocaScript.length - " and ".length);
        csvPublishMocaScript += " & ";
    }
    // Get rid of last " & ".
    if (csvPublishMocaScript.length > 0) {
        csvPublishMocaScript = csvPublishMocaScript.slice(0, csvPublishMocaScript.length - " & ".length);
    }
    return csvPublishMocaScript;
}
//# sourceMappingURL=extension.js.map