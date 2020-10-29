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
exports.deactivate = exports.activate = exports.LanguageServerCommands = exports.LanguageClientCommands = exports.CONFIGURATION_DEFAULT_GROOVY_CLASSPATH = exports.CONFIGURATION_LANGUAGE_SERVER_OPTIONS = exports.CONFIGURATION_CLIENT_OPTIONS = exports.CONFIGURATION_AUTO_EXECUTION_NAME = exports.CONFIGURATION_TRACE_NAME = exports.CONFIGURATION_CONNECTIONS_NAME = exports.CONFIGURATION_NAME = void 0;
const vscode = require("vscode");
const vscode_languageclient_1 = require("vscode-languageclient");
const path = require("path");
const fs = require("fs");
const semanticHighlighting_1 = require("./semanticHighlighting/semanticHighlighting");
const mocaResults_1 = require("./results/mocaResults");
const ResultViewPanel_1 = require("./results/ResultViewPanel");
const perf_hooks_1 = require("perf_hooks");
// Language server constants.
const MOCA_LANGUAGE_SERVER_VERSION = "1.6.10";
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
exports.CONFIGURATION_CLIENT_OPTIONS = "clientOptions";
exports.CONFIGURATION_LANGUAGE_SERVER_OPTIONS = "languageServerOptions";
exports.CONFIGURATION_DEFAULT_GROOVY_CLASSPATH = "defaultGroovyclasspath";
// Client commands.
var LanguageClientCommands;
(function (LanguageClientCommands) {
    LanguageClientCommands.CONNECT = "moca.connect";
    LanguageClientCommands.LOAD_CACHE = "moca.loadCache";
    LanguageClientCommands.EXECUTE = "moca.execute";
    LanguageClientCommands.EXECUTE_SELECTION = "moca.executeSelection";
    LanguageClientCommands.TRACE = "moca.trace";
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
    LanguageServerCommands.TRACE = "mocalanguageserver.trace";
    LanguageServerCommands.COMMAND_LOOKUP = "mocalanguageserver.commandLookup";
    LanguageServerCommands.SET_LANGUAGE_SERVER_OPTIONS = "mocalanguageserver.setLanguageServerOptions";
})(LanguageServerCommands = exports.LanguageServerCommands || (exports.LanguageServerCommands = {}));
// Status bar items.
// Arbitrary number to offset status bar priorities in order to try to keep items together better.
const STATUS_BAR_PRIORITY_OFFSET = 562;
var connectionStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, Number.MAX_VALUE + STATUS_BAR_PRIORITY_OFFSET);
var executeStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, Number.MAX_VALUE - 1 + STATUS_BAR_PRIORITY_OFFSET);
var executeSelectionStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, Number.MAX_VALUE - 2 + STATUS_BAR_PRIORITY_OFFSET);
var commandLookupStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, Number.MAX_VALUE - 3 + STATUS_BAR_PRIORITY_OFFSET);
var traceStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, Number.MAX_VALUE - 4 + STATUS_BAR_PRIORITY_OFFSET);
// Status bar constants.
const NOT_CONNECTED_STR = "MOCA: $(database) Not Connected";
const CONNECTED_PREFIX_STR = "MOCA: $(database) ";
const START_TRACE_STR = "$(debug-start) Start Trace";
const STOP_TRACE_STR = "$(debug-stop) Stop Trace";
// Constants for unsafe script executions configuration.
const UNSAFE_CODE_APPROVAL_PROMPT = "You are attempting to run unsafe code. Do you want to continue?";
const UNSAFE_CODE_APPROVAL_OPTION_YES = "Yes";
const UNSAFE_CODE_APPROVAL_OPTION_NO = "No";
// Save the last successful connection. Reason being, is that if the user tries to re-connect to the same connection, we do not necessarily
// want to reload the cache.
let lastAttemptedConnectionName = "";
// Need to keep track of trace status.
let traceStarted = false;
function activate(context) {
    // Set some vars.
    globalExtensionContext = context;
    // Make sure global storage path exists.
    vscode.workspace.fs.createDirectory(vscode.Uri.file(context.globalStoragePath));
    // Make sure other paths exist.
    vscode.workspace.fs.createDirectory(vscode.Uri.file(context.globalStoragePath + "\\command-lookup"));
    // Start language server on extension activate.
    startMocaLanguageServer().then(() => {
        vscode.commands.executeCommand(LanguageServerCommands.ACTIVATE, context.globalStoragePath, vscode.workspace.getConfiguration(exports.CONFIGURATION_NAME).get(exports.CONFIGURATION_LANGUAGE_SERVER_OPTIONS), vscode.workspace.getConfiguration(exports.CONFIGURATION_NAME).get(exports.CONFIGURATION_DEFAULT_GROOVY_CLASSPATH)).then((activateResponse) => {
            var activateResponseJsonObj = JSON.parse(JSON.stringify(activateResponse));
            if (activateResponseJsonObj["exception"]) {
                vscode.window.showErrorMessage("Error occuring during MOCA Language Server activation: " + activateResponseJsonObj["exception"]["message"]);
            }
        });
    });
    // Command registration.
    context.subscriptions.push(vscode.commands.registerCommand(LanguageClientCommands.CONNECT, () => __awaiter(this, void 0, void 0, function* () {
        var connectionNames = new Array();
        var connections = new Map();
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
        // Analyze selected connection to determine if we will need to reload moca repo.
        var useExistingMocaRepo = false;
        if (lastAttemptedConnectionName.localeCompare(selectedConnectionObj.name) === 0) {
            useExistingMocaRepo = true;
        }
        else {
            lastAttemptedConnectionName = selectedConnectionObj.name;
        }
        // If no entries in groovy classpath for selected connection, set to default groovy classpath.
        if (!selectedConnectionObj.groovyclasspath || selectedConnectionObj.groovyclasspath.length === 0) {
            selectedConnectionObj.groovyclasspath = vscode.workspace.getConfiguration(exports.CONFIGURATION_NAME).get(exports.CONFIGURATION_DEFAULT_GROOVY_CLASSPATH);
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
        }, (progress, token) => {
            progress.report({
                increment: Infinity,
                message: ("Connecting To " + selectedConnectionObj.name)
            });
            var p = new Promise(progressResolve => {
                // Purpose of this is to indicate that cancellation was requested down below.
                var cancellationRequested = false;
                token.onCancellationRequested(() => {
                    // Go ahead and resolve progress, then quit.
                    // Also make sure we do not send any notifications regarding
                    // connection success status.
                    cancellationRequested = true;
                    progressResolve();
                    return p;
                });
                // Language server will be started at this point.
                vscode.commands.executeCommand(LanguageServerCommands.CONNECT, selectedConnectionObj).then((connResponse) => {
                    // If cancellation requested, skip this part.
                    if (!cancellationRequested) {
                        const connResponseJsonObj = JSON.parse(JSON.stringify(connResponse));
                        const eOk = connResponseJsonObj["eOk"];
                        if (eOk === true) {
                            connectionSuccess = true;
                            connectionStatusBarItem.text = CONNECTED_PREFIX_STR + selectedConnectionObj.name;
                        }
                        else {
                            var exceptionJsonObj = JSON.parse(JSON.stringify(connResponseJsonObj["exception"]));
                            vscode.window.showErrorMessage(selectedConnectionObj.name + ": " + exceptionJsonObj["message"]);
                            connectionStatusBarItem.text = NOT_CONNECTED_STR;
                        }
                    }
                }).then(() => {
                    // Resolve progress indicator.
                    progress.report({ increment: Infinity });
                    progressResolve();
                });
            });
            return p;
        }).then(() => {
            // If successful connection and we are not just re-connecting to current connection, load repo.
            if (connectionSuccess && !useExistingMocaRepo) {
                vscode.commands.executeCommand(LanguageClientCommands.LOAD_CACHE);
            }
        });
    })));
    context.subscriptions.push(vscode.commands.registerCommand(LanguageClientCommands.LOAD_CACHE, () => __awaiter(this, void 0, void 0, function* () {
        vscode.window.withProgress({
            location: vscode.ProgressLocation.Window,
            title: "MOCA: Loading Cache",
            cancellable: false
        }, (progress) => {
            progress.report({ increment: Infinity });
            var p = new Promise(progressResolve => {
                vscode.commands.executeCommand(LanguageServerCommands.LOAD_CACHE).then(() => {
                    // Resolve progress indicator.
                    progress.report({ increment: Infinity });
                    progressResolve();
                });
            });
            return p;
        });
    })));
    context.subscriptions.push(vscode.commands.registerCommand(LanguageClientCommands.EXECUTE, () => __awaiter(this, void 0, void 0, function* () {
        let editor = vscode.window.activeTextEditor;
        if (editor) {
            var curFileName = editor.document.fileName;
            var curFileNameShortened = curFileName.substring(curFileName.lastIndexOf('\\') + 1, curFileName.length);
            let script = editor.document.getText();
            vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: "MOCA",
                cancellable: true
            }, (progress, token) => {
                progress.report({
                    increment: Infinity,
                    message: "Executing " + curFileNameShortened
                });
                var p = new Promise(progressResolve => {
                    // Purpose of this is to indicate that cancellation was requested down below.
                    var cancellationRequested = false;
                    token.onCancellationRequested(() => {
                        // Go ahead and resolve progress, send cancellation, then quit.
                        cancellationRequested = true;
                        progressResolve();
                        return p;
                    });
                    vscode.commands.executeCommand(LanguageServerCommands.EXECUTE, script, curFileNameShortened, false).then((res) => __awaiter(this, void 0, void 0, function* () {
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
                                        vscode.commands.executeCommand(LanguageServerCommands.EXECUTE, script, curFileNameShortened, true).then((approvedRes) => __awaiter(this, void 0, void 0, function* () {
                                            // If cancellation requested, skip this part.
                                            if (!cancellationRequested) {
                                                var approvedMocaResults = new mocaResults_1.MocaResults(approvedRes);
                                                ResultViewPanel_1.ResultViewPanel.createOrShow(context.extensionPath, curFileNameShortened, approvedMocaResults);
                                                if (approvedMocaResults.msg && approvedMocaResults.msg.length > 0) {
                                                    vscode.window.showErrorMessage(curFileNameShortened + ": " + approvedMocaResults.msg);
                                                }
                                            }
                                        }));
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
                    })).then(() => {
                        // Resolve progress indicator.
                        progress.report({ increment: Infinity });
                        progressResolve();
                    });
                });
                return p;
            });
        }
    })));
    context.subscriptions.push(vscode.commands.registerCommand(LanguageClientCommands.EXECUTE_SELECTION, () => __awaiter(this, void 0, void 0, function* () {
        let editor = vscode.window.activeTextEditor;
        if (editor) {
            var curFileName = editor.document.fileName;
            var curFileNameShortened = curFileName.substring(curFileName.lastIndexOf('\\') + 1, curFileName.length);
            var selection = editor.selection;
            if (selection) {
                var selectedScript = editor.document.getText(selection);
                vscode.window.withProgress({
                    location: vscode.ProgressLocation.Notification,
                    title: "MOCA",
                    cancellable: true
                }, (progress, token) => {
                    progress.report({
                        increment: Infinity,
                        message: "Executing Selection " + curFileNameShortened
                    });
                    var p = new Promise(progressResolve => {
                        // Purpose of this is to indicate that cancellation was requested down below.
                        var cancellationRequested = false;
                        token.onCancellationRequested(() => {
                            // Go ahead and resolve progress, send cancellation, then quit.
                            cancellationRequested = true;
                            progressResolve();
                            return p;
                        });
                        vscode.commands.executeCommand(LanguageServerCommands.EXECUTE, selectedScript, curFileNameShortened, false).then((res) => __awaiter(this, void 0, void 0, function* () {
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
                                            vscode.commands.executeCommand(LanguageServerCommands.EXECUTE, selectedScript, curFileNameShortened, true).then((approvedRes) => __awaiter(this, void 0, void 0, function* () {
                                                // If cancellation requested, skip this part.
                                                if (!cancellationRequested) {
                                                    var approvedMocaResults = new mocaResults_1.MocaResults(approvedRes);
                                                    ResultViewPanel_1.ResultViewPanel.createOrShow(context.extensionPath, curFileNameShortened, approvedMocaResults);
                                                    if (approvedMocaResults.msg && approvedMocaResults.msg.length > 0) {
                                                        vscode.window.showErrorMessage(curFileNameShortened + ": " + approvedMocaResults.msg);
                                                    }
                                                }
                                            }));
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
                        })).then(() => {
                            // Resolve progress indicator.
                            progress.report({ increment: Infinity });
                            progressResolve();
                        });
                    });
                    return p;
                });
            }
        }
    })));
    context.subscriptions.push(vscode.commands.registerCommand(LanguageClientCommands.TRACE, () => __awaiter(this, void 0, void 0, function* () {
        // Read in configuration and execute.
        const config = vscode.workspace.getConfiguration(exports.CONFIGURATION_NAME);
        var traceConfigObj = config.get(exports.CONFIGURATION_TRACE_NAME);
        if (traceConfigObj) {
            // Prepare values.
            var traceConfigJsonObj = JSON.parse(JSON.stringify(traceConfigObj));
            var fileName = traceConfigJsonObj.fileName;
            var mode = traceConfigJsonObj.mode;
            if (!fileName) {
                fileName = "";
            }
            if (!mode || (mode !== "w" && mode !== "a")) {
                mode = "w";
            }
            vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: (traceStarted ? "MOCA: Stopping trace" : "MOCA: Starting trace"),
                cancellable: false
            }, (progress) => {
                progress.report({ increment: Infinity });
                // Start/stop trace.
                traceStarted = !traceStarted;
                if (traceStarted) {
                    traceStatusBarItem.text = STOP_TRACE_STR;
                }
                else {
                    traceStatusBarItem.text = START_TRACE_STR;
                }
                var p = new Promise(progressResolve => {
                    console.log(traceStarted);
                    vscode.commands.executeCommand(LanguageServerCommands.TRACE, traceStarted, fileName, mode).then((traceRes) => {
                        const traceResponseJsonObj = JSON.parse(JSON.stringify(traceRes));
                        // If exception of any kind, we need to return the message/status and indicate that the trace is not running. This includes if we are not even connected to a MOCA env at all.
                        if (traceResponseJsonObj["mocaResultsResponse"]["exception"]) {
                            var exceptionJsonObj = JSON.parse(JSON.stringify(traceResponseJsonObj["mocaResultsResponse"]["exception"]));
                            vscode.window.showErrorMessage("Trace error: " + exceptionJsonObj["message"]);
                            // Reset trace status if currently running.
                            if (traceStarted) {
                                traceStarted = false;
                                traceStatusBarItem.text = START_TRACE_STR;
                            }
                        }
                        // Resolve progress indicator.
                        progress.report({ increment: Infinity });
                        progressResolve();
                    });
                });
                return p;
            });
        }
    })));
    context.subscriptions.push(vscode.commands.registerCommand(LanguageClientCommands.COMMAND_LOOKUP, () => __awaiter(this, void 0, void 0, function* () {
        var commandLookupRes = yield vscode.commands.executeCommand(LanguageServerCommands.COMMAND_LOOKUP);
        // We should have a string array of distinct moca command names.
        var commandLookupObj = JSON.parse(JSON.stringify(commandLookupRes));
        if (commandLookupObj.distinctMocaCommands) {
            var distinctCommands = commandLookupObj.distinctMocaCommands;
            // Now sit tight while the user picks one.
            var distinctCommandSelected = yield vscode.window.showQuickPick(distinctCommands, { ignoreFocusOut: true });
            // Now that we have a command, we can request command data from server.
            var commandDataRes = yield vscode.commands.executeCommand(LanguageServerCommands.COMMAND_LOOKUP, distinctCommandSelected);
            // Make sure we have a command to work with.
            if (distinctCommandSelected != null && distinctCommandSelected !== "") {
                // We have our object. Now we need to let the user pick a command at a certain level or pick a trigger to look at.
                var commandDataJsonObj = JSON.parse(JSON.stringify(commandDataRes));
                var commandData = new Array();
                if (commandDataJsonObj.commandsAtLevels) {
                    var commandsAtLevels = commandDataJsonObj.commandsAtLevels;
                    for (var i = 0; i < commandsAtLevels.length; i++) {
                        commandData.push(commandsAtLevels[i].cmplvl + ": " + commandsAtLevels[i].command + " (" + commandsAtLevels[i].type + ")");
                    }
                }
                if (commandDataJsonObj.triggers) {
                    var triggers = commandDataJsonObj.triggers;
                    for (var i = 0; i < triggers.length; i++) {
                        commandData.push("Trigger: " + triggers[i].trgseq + " - " + triggers[i].name);
                    }
                }
                var commandDataSelectedRes = yield vscode.window.showQuickPick(commandData, { ignoreFocusOut: true, canPickMany: true });
                // Now that the user has selected something specific from the command looked up, we can load the file(s).
                var commandDataSelectedArr = commandDataSelectedRes;
                // Put commands & triggers in arrays here if we have them.
                var commandsAtLevels = [];
                if (commandDataJsonObj.commandsAtLevels) {
                    var commandsAtLevels = commandDataJsonObj.commandsAtLevels;
                }
                var triggers = [];
                if (commandDataJsonObj.triggers) {
                    triggers = commandDataJsonObj.triggers;
                }
                for (var i = 0; i < commandDataSelectedArr.length; i++) {
                    var commandDataSelected = commandDataSelectedArr[i];
                    // Checking commands.
                    for (var j = 0; j < commandsAtLevels.length; j++) {
                        if (commandDataSelected.localeCompare(commandsAtLevels[j].cmplvl + ": " + commandsAtLevels[j].command + " (" + commandsAtLevels[j].type + ")") === 0) {
                            var uri = vscode.Uri.file(context.globalStoragePath + "\\command-lookup\\" + (commandsAtLevels[j].cmplvl + "-" + commandsAtLevels[j].command).replace(/ /g, "_") + ".moca.readonly");
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
                            var uri = vscode.Uri.file(context.globalStoragePath + "\\command-lookup\\" + (distinctCommandSelected + "-" + triggers[j].name).replace(/ /g, "_") + ".moca.readonly");
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
                var curFileNameShortened = curFileName.substring(curFileName.lastIndexOf('\\') + 1, curFileName.length);
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
                    var autoExecP = new Promise(autoExecProgressResolve => {
                        // Purpose of this is to indicate that cancellation was requested down below.
                        var autoExecCancellationRequested = false;
                        autoExecToken.onCancellationRequested(() => {
                            // Go ahead and resolve progress, send cancellation, then quit.
                            autoExecCancellationRequested = true;
                            autoExecProgressResolve();
                            return autoExecP;
                        });
                        var innerAutoExecP = new Promise((innerAutoExecResolve) => __awaiter(this, void 0, void 0, function* () {
                            var executionCountIncrementAmount = (1 / stopIfExecutionCountExceeds) * 100;
                            var elapsedTimeIncrementAmount = (1000 / stopIfTimeElapses) * 100;
                            var incrementAmount = (executionCountIncrementAmount > elapsedTimeIncrementAmount ? executionCountIncrementAmount : elapsedTimeIncrementAmount);
                            while (executionCount < stopIfExecutionCountExceeds && (curTime - startTime) < stopIfTimeElapses && !stopExecutionBecauseOfError) {
                                // Sleep before execution.
                                yield sleepFunc(sleepDuration);
                                // Execute.
                                vscode.window.withProgress({
                                    location: vscode.ProgressLocation.Notification,
                                    title: "MOCA",
                                    cancellable: true
                                }, (execProgress, execToken) => {
                                    execProgress.report({
                                        increment: Infinity,
                                        message: "Auto Executing " + curFileNameShortened + " (" + (executionCount + 1) + ")"
                                    });
                                    var execP = new Promise(execProgressResolve => {
                                        // Purpose of this is to indicate that cancellation was requested down below.
                                        var execCancellationRequested = false;
                                        execToken.onCancellationRequested(() => {
                                            // Go ahead and resolve progress, send cancellation, then quit.
                                            execCancellationRequested = true;
                                            execProgressResolve();
                                            return execP;
                                        });
                                        // NOTE: just assume user does not care about unsafe code config here.
                                        vscode.commands.executeCommand(LanguageServerCommands.EXECUTE, script, curFileNameShortened, true).then((res) => {
                                            // If cancellation requested, skip this part.
                                            if (!execCancellationRequested && !autoExecCancellationRequested) {
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
                                        }).then(() => {
                                            // Resolve progress indicator.
                                            execProgress.report({ increment: Infinity });
                                            execProgressResolve();
                                        });
                                    });
                                    return execP;
                                });
                                executionCount++;
                                curTime = perf_hooks_1.performance.now();
                                autoExecProgress.report({ increment: incrementAmount });
                                // Quit if cancellation requested above.
                                if (autoExecCancellationRequested) {
                                    break;
                                }
                            }
                            // Resolve promise.
                            innerAutoExecResolve();
                        })).then(() => {
                            // Resolve progress indicator.
                            autoExecProgressResolve();
                        });
                    });
                    return autoExecP;
                }));
            }
        }
        else {
            vscode.window.showErrorMessage("Must Configure Auto Exection!");
        }
    })));
    // Events registration.
    // Configuration listener.
    context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(e => {
        // Checking if user changed client options config (object has sql & groovy range color config).
        // If so, we potentially need to re-color things!
        if (e.affectsConfiguration((exports.CONFIGURATION_NAME + "." + exports.CONFIGURATION_CLIENT_OPTIONS))) {
            semanticHighlighting_1.GlobalSemanticHighlightingVars.semanticHighlightingFeature.loadCurrentTheme();
        }
        // Checking if user changed lang server options. If so, we need to let the lang server know!
        if (e.affectsConfiguration((exports.CONFIGURATION_NAME + "." + exports.CONFIGURATION_LANGUAGE_SERVER_OPTIONS))) {
            vscode.commands.executeCommand(LanguageServerCommands.SET_LANGUAGE_SERVER_OPTIONS, vscode.workspace.getConfiguration(exports.CONFIGURATION_NAME).get(exports.CONFIGURATION_LANGUAGE_SERVER_OPTIONS));
        }
    }));
    // Get status bar items up and running now.
    connectionStatusBarItem.text = NOT_CONNECTED_STR;
    connectionStatusBarItem.command = LanguageClientCommands.CONNECT;
    connectionStatusBarItem.tooltip = "Connect To MOCA Server";
    connectionStatusBarItem.show();
    executeStatusBarItem.text = "$(play)";
    executeStatusBarItem.command = LanguageClientCommands.EXECUTE;
    executeStatusBarItem.tooltip = "Execute (Ctrl+Enter)";
    executeStatusBarItem.show();
    executeSelectionStatusBarItem.text = "$(selection)";
    executeSelectionStatusBarItem.command = LanguageClientCommands.EXECUTE_SELECTION;
    executeSelectionStatusBarItem.tooltip = "Execute Selection (Ctrl+Shift+Enter)";
    executeSelectionStatusBarItem.show();
    commandLookupStatusBarItem.text = "$(file-code)";
    commandLookupStatusBarItem.command = LanguageClientCommands.COMMAND_LOOKUP;
    commandLookupStatusBarItem.tooltip = "Command Lookup";
    commandLookupStatusBarItem.show();
    traceStatusBarItem.text = START_TRACE_STR;
    traceStatusBarItem.command = LanguageClientCommands.TRACE;
    traceStatusBarItem.show();
    context.subscriptions.push(connectionStatusBarItem);
    context.subscriptions.push(executeStatusBarItem);
    context.subscriptions.push(executeSelectionStatusBarItem);
    context.subscriptions.push(commandLookupStatusBarItem);
    context.subscriptions.push(traceStatusBarItem);
}
exports.activate = activate;
function deactivate() { }
exports.deactivate = deactivate;
// Language server functions.
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
                resolve();
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
//# sourceMappingURL=extension.js.map