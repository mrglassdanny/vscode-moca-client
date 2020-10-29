import * as vscode from 'vscode';
import { LanguageClient, LanguageClientOptions, Executable } from "vscode-languageclient";
import * as path from "path";
import * as fs from "fs";
import { SemanticHighlightingFeature, GlobalSemanticHighlightingVars } from './semanticHighlighting/semanticHighlighting';
import { MocaResults } from './results/mocaResults';
import { ResultViewPanel } from './results/ResultViewPanel';
import { MocaCommand, MocaTrigger } from './mocaCommandLookup/mocaCommandLookup';
import { performance } from 'perf_hooks';

// Language server constants.
const MOCA_LANGUAGE_SERVER_VERSION = "1.6.10";
const MOCA_LANGUAGE_SERVER = "moca-language-server-" + MOCA_LANGUAGE_SERVER_VERSION + "-all.jar";
const MOCA_LANGUAGE_SERVER_INITIALIZING_MESSAGE = "MOCA: Initializing language server";
const MOCA_LANGUAGE_SERVER_ERR_STARTUP = "The MOCA extension failed to start";

// Client vars.
let globalExtensionContext: vscode.ExtensionContext;
let mocaLanguageClient: LanguageClient;
let javaPath: string;

// Client constants.
export const CONFIGURATION_NAME = "moca";
export const CONFIGURATION_CONNECTIONS_NAME = "connections";
export const CONFIGURATION_TRACE_NAME = "trace";
export const CONFIGURATION_AUTO_EXECUTION_NAME = "autoExecution";
export const CONFIGURATION_CLIENT_OPTIONS = "clientOptions";
export const CONFIGURATION_LANGUAGE_SERVER_OPTIONS = "languageServerOptions";
export const CONFIGURATION_DEFAULT_GROOVY_CLASSPATH = "defaultGroovyclasspath";


// Client commands.
export namespace LanguageClientCommands {
	export const CONNECT = "moca.connect";
	export const LOAD_CACHE = "moca.loadCache";
	export const EXECUTE = "moca.execute";
	export const EXECUTE_SELECTION = "moca.executeSelection";
	export const TRACE = "moca.trace";
	export const COMMAND_LOOKUP = "moca.commandLookup";
	export const AUTO_EXECUTE = "moca.autoExecute";
}

// Language server commands.
export namespace LanguageServerCommands {
	export const ACTIVATE = "mocalanguageserver.activate";
	export const CONNECT = "mocalanguageserver.connect";
	export const LOAD_CACHE = "mocalanguageserver.loadCache";
	export const EXECUTE = "mocalanguageserver.execute";
	export const TRACE = "mocalanguageserver.trace";
	export const COMMAND_LOOKUP = "mocalanguageserver.commandLookup";
	export const SET_LANGUAGE_SERVER_OPTIONS = "mocalanguageserver.setLanguageServerOptions";
}

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

// Need to keep track of trace status.
let traceStarted: boolean = false;


export async function activate(context: vscode.ExtensionContext) {

	// Set some vars.
	globalExtensionContext = context;

	// Make sure global storage path exists.
	vscode.workspace.fs.createDirectory(vscode.Uri.file(context.globalStoragePath));
	// Make sure other paths exist.
	vscode.workspace.fs.createDirectory(vscode.Uri.file(context.globalStoragePath + "\\command-lookup"));

	// Start language server on extension activate.
	await startMocaLanguageServer();

	var activateResponse = await vscode.commands.executeCommand(LanguageServerCommands.ACTIVATE, context.globalStoragePath, vscode.workspace.getConfiguration(CONFIGURATION_NAME).get(CONFIGURATION_LANGUAGE_SERVER_OPTIONS), vscode.workspace.getConfiguration(CONFIGURATION_NAME).get(CONFIGURATION_DEFAULT_GROOVY_CLASSPATH));
	var activateResponseJsonObj = JSON.parse(JSON.stringify(activateResponse));
	if (activateResponseJsonObj["exception"]) {
		vscode.window.showErrorMessage("Error occuring during MOCA Language Server activation: " + activateResponseJsonObj["exception"]["message"]);
	}


	// Command registration.
	context.subscriptions.push(vscode.commands.registerCommand(LanguageClientCommands.CONNECT, async () => {

		var connectionNames = new Array();
		var connections = new Map<String, any>();

		const config = vscode.workspace.getConfiguration(CONFIGURATION_NAME);
		const connectionConfig = config.get(CONFIGURATION_CONNECTIONS_NAME);

		if (connectionConfig) {
			const connectionConfigObjArr = connectionConfig as Object[];
			for (var i = 0; i < connectionConfigObjArr.length; i++) {
				const connectionObj = JSON.parse(JSON.stringify(connectionConfigObjArr[i]));
				connectionNames.push(connectionObj.name);
				connections.set(connectionObj.name, connectionObj);

			}
		}

		let connectionNameQuickPickRes = await vscode.window.showQuickPick(connectionNames, { ignoreFocusOut: true });
		const selectedConnectionObj = connections.get(connectionNameQuickPickRes);
		if (!selectedConnectionObj) {
			return null;
		}

		// Now let's see if selected connection possesses a user/password.
		// If not, we need to get from the user.
		if (!selectedConnectionObj.user) {
			let userInputRes = await vscode.window.showInputBox({ prompt: "User ID", ignoreFocusOut: true });
			if (!userInputRes) {
				return null;
			}
			selectedConnectionObj.user = userInputRes;


			let passwordInputRes = await vscode.window.showInputBox({ prompt: "Password", password: true, ignoreFocusOut: true });
			if (!passwordInputRes) {
				return null;
			}
			selectedConnectionObj.password = passwordInputRes;
		} else {
			if (!selectedConnectionObj.password) {
				let passwordInputRes = await vscode.window.showInputBox({ prompt: "Password", password: true, ignoreFocusOut: true });
				if (!passwordInputRes) {
					return null;
				}
				selectedConnectionObj.password = passwordInputRes;
			}
		}

		// If no entries in groovy classpath for selected connection, set to default groovy classpath.
		if (!selectedConnectionObj.groovyclasspath || selectedConnectionObj.groovyclasspath.length === 0) {
			selectedConnectionObj.groovyclasspath = vscode.workspace.getConfiguration(CONFIGURATION_NAME).get(CONFIGURATION_DEFAULT_GROOVY_CLASSPATH);
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
		}, async (progress, token) => {
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
			var connResponse = await vscode.commands.executeCommand(LanguageServerCommands.CONNECT, selectedConnectionObj);

			// If cancellation requested, skip this part.
			if (!cancellationRequested) {
				const connResponseJsonObj = JSON.parse(JSON.stringify(connResponse));
				const eOk = connResponseJsonObj["eOk"];

				if (eOk === true) {
					connectionSuccess = true;
					connectionStatusBarItem.text = CONNECTED_PREFIX_STR + selectedConnectionObj.name;
				} else {
					var exceptionJsonObj = JSON.parse(JSON.stringify(connResponseJsonObj["exception"]));
					vscode.window.showErrorMessage(selectedConnectionObj.name + ": " + exceptionJsonObj["message"]);
					connectionStatusBarItem.text = NOT_CONNECTED_STR;
				}
			}
		}).then(() => {
			// If successful connection and we are not just re-connecting to current connection, load repo.
			if (connectionSuccess) {
				vscode.commands.executeCommand(LanguageClientCommands.LOAD_CACHE);
			}
		});
	}));

	context.subscriptions.push(vscode.commands.registerCommand(LanguageClientCommands.LOAD_CACHE, async () => {

		vscode.window.withProgress({
			location: vscode.ProgressLocation.Window,
			title: "MOCA: Loading Cache",
			cancellable: false
		}, async (progress) => {
			progress.report({ increment: Infinity });
			await vscode.commands.executeCommand(LanguageServerCommands.LOAD_CACHE);
		});
	}));

	context.subscriptions.push(vscode.commands.registerCommand(LanguageClientCommands.EXECUTE, async () => {

		let editor = vscode.window.activeTextEditor;

		if (editor) {

			var curFileName = editor.document.fileName;
			var curFileNameShortened = curFileName.substring(curFileName.lastIndexOf('\\') + 1, curFileName.length);
			let script = editor.document.getText();

			vscode.window.withProgress({
				location: vscode.ProgressLocation.Notification,
				title: "MOCA",
				cancellable: true
			}, async (progress, token) => {
				progress.report({
					increment: Infinity,
					message: "Executing " + curFileNameShortened
				});

				// Purpose of this is to indicate that cancellation was requested down below.
				var cancellationRequested = false;

				token.onCancellationRequested(() => {
					cancellationRequested = true;
				});


				var res = await vscode.commands.executeCommand(LanguageServerCommands.EXECUTE, script, curFileNameShortened, false);
				// If cancellation requested, skip this part.
				if (!cancellationRequested) {
					var mocaResults = new MocaResults(res);

					// If lang server says we need approval before executing(due to unsafe code config on connection), we need to ask the user if they truly want to run script.
					// NOTE: if cancellation is requested before we get here, lang server does not run unsafe scripts in configured envs by default -- assuming that approval is required.
					if (mocaResults.needsApprovalToExecute) {
						var approvalOptionRes = await vscode.window.showWarningMessage(UNSAFE_CODE_APPROVAL_PROMPT, UNSAFE_CODE_APPROVAL_OPTION_YES, UNSAFE_CODE_APPROVAL_OPTION_NO);
						// Check again if cancellation is requested.
						// If so, just exit and do not worry about approval option result.
						if (!cancellationRequested) {
							if (approvalOptionRes === UNSAFE_CODE_APPROVAL_OPTION_YES) {
								// User says yes; run script!
								var approvedRes = await vscode.commands.executeCommand(LanguageServerCommands.EXECUTE, script, curFileNameShortened, true);
								// If cancellation requested, skip this part.
								if (!cancellationRequested) {
									var approvedMocaResults = new MocaResults(approvedRes);
									ResultViewPanel.createOrShow(context.extensionPath, curFileNameShortened, approvedMocaResults);
									if (approvedMocaResults.msg && approvedMocaResults.msg.length > 0) {
										vscode.window.showErrorMessage(curFileNameShortened + ": " + approvedMocaResults.msg);
									}
								}
							}
						}
					} else {
						ResultViewPanel.createOrShow(context.extensionPath, curFileNameShortened, mocaResults);
						if (mocaResults.msg && mocaResults.msg.length > 0) {
							vscode.window.showErrorMessage(curFileNameShortened + ": " + mocaResults.msg);
						}
					}
				}
			});
		}
	}));

	context.subscriptions.push(vscode.commands.registerCommand(LanguageClientCommands.EXECUTE_SELECTION, async () => {

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
				}, async (progress, token) => {
					progress.report({
						increment: Infinity,
						message: "Executing Selection " + curFileNameShortened
					});

					// Purpose of this is to indicate that cancellation was requested down below.
					var cancellationRequested = false;

					token.onCancellationRequested(() => {
						cancellationRequested = true;
					});

					var res = await vscode.commands.executeCommand(LanguageServerCommands.EXECUTE, selectedScript, curFileNameShortened, false);
					// If cancellation requested, skip this part.
					if (!cancellationRequested) {
						var mocaResults = new MocaResults(res);

						// If lang server says we need approval before executing(due to unsafe code config on connection), we need to ask the user if they truly want to run script.
						// NOTE: if cancellation is requested before we get here, lang server does not run unsafe scripts in configured envs by default -- assuming that approval is required.
						if (mocaResults.needsApprovalToExecute) {
							var approvalOptionRes = await vscode.window.showWarningMessage(UNSAFE_CODE_APPROVAL_PROMPT, UNSAFE_CODE_APPROVAL_OPTION_YES, UNSAFE_CODE_APPROVAL_OPTION_NO);
							// Check again if cancellation is requested.
							// If so, just exit and do not worry about approval option result.
							if (!cancellationRequested) {
								if (approvalOptionRes === UNSAFE_CODE_APPROVAL_OPTION_YES) {
									// User says yes; run script!
									var approvedRes = await vscode.commands.executeCommand(LanguageServerCommands.EXECUTE, selectedScript, curFileNameShortened, true);
									// If cancellation requested, skip this part.
									if (!cancellationRequested) {
										var approvedMocaResults = new MocaResults(approvedRes);
										ResultViewPanel.createOrShow(context.extensionPath, curFileNameShortened, approvedMocaResults);
										if (approvedMocaResults.msg && approvedMocaResults.msg.length > 0) {
											vscode.window.showErrorMessage(curFileNameShortened + ": " + approvedMocaResults.msg);
										}
									}
								}
							}
						} else {
							ResultViewPanel.createOrShow(context.extensionPath, curFileNameShortened, mocaResults);
							if (mocaResults.msg && mocaResults.msg.length > 0) {
								vscode.window.showErrorMessage(curFileNameShortened + ": " + mocaResults.msg);
							}
						}
					}
				});
			}
		}
	}));

	context.subscriptions.push(vscode.commands.registerCommand(LanguageClientCommands.TRACE, async () => {

		// Read in configuration and execute.
		const config = vscode.workspace.getConfiguration(CONFIGURATION_NAME);
		var traceConfigObj = config.get(CONFIGURATION_TRACE_NAME);
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
			}, async (progress) => {

				progress.report({ increment: Infinity });

				// Start/stop trace.
				traceStarted = !traceStarted;
				if (traceStarted) {
					traceStatusBarItem.text = STOP_TRACE_STR;
				} else {
					traceStatusBarItem.text = START_TRACE_STR;
				}

				var traceRes = await vscode.commands.executeCommand(LanguageServerCommands.TRACE, traceStarted, fileName, mode);
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
			});


		}


	}));

	context.subscriptions.push(vscode.commands.registerCommand(LanguageClientCommands.COMMAND_LOOKUP, async () => {

		var commandLookupRes = await vscode.commands.executeCommand(LanguageServerCommands.COMMAND_LOOKUP);
		// We should have a string array of distinct moca command names.
		var commandLookupObj = JSON.parse(JSON.stringify(commandLookupRes));
		if (commandLookupObj.distinctMocaCommands) {
			var distinctCommands = commandLookupObj.distinctMocaCommands as string[];
			// Now sit tight while the user picks one.
			var distinctCommandSelected = await vscode.window.showQuickPick(distinctCommands, { ignoreFocusOut: true });
			// Now that we have a command, we can request command data from server.
			var commandDataRes = await vscode.commands.executeCommand(LanguageServerCommands.COMMAND_LOOKUP, distinctCommandSelected);
			// Make sure we have a command to work with.
			if (distinctCommandSelected != null && distinctCommandSelected !== "") {
				// We have our object. Now we need to let the user pick a command at a certain level or pick a trigger to look at.
				var commandDataJsonObj = JSON.parse(JSON.stringify(commandDataRes));
				var commandData = new Array();
				if (commandDataJsonObj.commandsAtLevels) {
					var commandsAtLevels = commandDataJsonObj.commandsAtLevels as MocaCommand[];
					for (var i = 0; i < commandsAtLevels.length; i++) {
						commandData.push(commandsAtLevels[i].cmplvl + ": " + commandsAtLevels[i].command + " (" + commandsAtLevels[i].type + ")");
					}
				}
				if (commandDataJsonObj.triggers) {
					var triggers = commandDataJsonObj.triggers as MocaTrigger[];
					for (var i = 0; i < triggers.length; i++) {
						commandData.push("Trigger: " + triggers[i].trgseq + " - " + triggers[i].name);
					}
				}

				var commandDataSelectedRes = await vscode.window.showQuickPick(commandData, { ignoreFocusOut: true, canPickMany: true });
				// Now that the user has selected something specific from the command looked up, we can load the file(s).
				var commandDataSelectedArr = commandDataSelectedRes as string[];

				// Put commands & triggers in arrays here if we have them.
				var commandsAtLevels: MocaCommand[] = [];
				if (commandDataJsonObj.commandsAtLevels) {
					var commandsAtLevels = commandDataJsonObj.commandsAtLevels as MocaCommand[];
				}
				var triggers: MocaTrigger[] = [];
				if (commandDataJsonObj.triggers) {
					triggers = commandDataJsonObj.triggers as MocaTrigger[];
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
							} else {
								await vscode.workspace.fs.writeFile(uri, Buffer.from(commandsAtLevels[j].syntax));
								var doc = await vscode.workspace.openTextDocument(uri);
								await vscode.window.showTextDocument(doc, { preview: false });
							}
						}
					}

					// Checking triggers.
					for (var j = 0; j < triggers.length; j++) {
						if (commandDataSelected.localeCompare("Trigger: " + triggers[j].trgseq + " - " + triggers[j].name) === 0) {
							var uri = vscode.Uri.file(context.globalStoragePath + "\\command-lookup\\" + (distinctCommandSelected + "-" + triggers[j].name).replace(/ /g, "_") + ".moca.readonly");
							// Triggers are always local syntax.
							await vscode.workspace.fs.writeFile(uri, Buffer.from(triggers[j].syntax));
							var doc = await vscode.workspace.openTextDocument(uri);
							await vscode.window.showTextDocument(doc, { preview: false });
						}
					}
				}
			}
		}
	}));

	context.subscriptions.push(vscode.commands.registerCommand(LanguageClientCommands.AUTO_EXECUTE, async () => {

		// Read in configuration and execute.
		const config = vscode.workspace.getConfiguration(CONFIGURATION_NAME);
		var autoExecutionConfigObj = config.get(CONFIGURATION_AUTO_EXECUTION_NAME);
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
			var startTime = performance.now();
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
				}, async (autoExecProgress, autoExecToken) => {
					autoExecProgress.report({
						increment: Infinity,
						message: "Auto Executing " + curFileNameShortened
					});

					// Start with initial duration.
					await sleepFunc(initialDuration);

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
						await sleepFunc(sleepDuration);

						if (!autoExecCancellationRequested) {
							// Execute.
							vscode.window.withProgress({
								location: vscode.ProgressLocation.Notification,
								title: "MOCA",
								cancellable: true
							}, async (execProgress, execToken) => {
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
									var res = await vscode.commands.executeCommand(LanguageServerCommands.EXECUTE, script, curFileNameShortened, true);

									// If cancellation requested, skip this part.
									if (!execCancellationRequested) {
										var mocaResults = new MocaResults(res);
										ResultViewPanel.createOrShow(context.extensionPath, curFileNameShortened, mocaResults);
										if (mocaResults.msg && mocaResults.msg.length > 0) {
											vscode.window.showErrorMessage(curFileNameShortened + "(Auto Execution): " + mocaResults.msg);
											// This means we have an error. Check if we need to quit auto exec.
											if (stopIfExecutionError) {
												stopExecutionBecauseOfError = true;
											}
										}
									}
								}
							});

							executionCount++;
							curTime = performance.now();

							autoExecProgress.report({ increment: incrementAmount });
						}
					}
				});
			}
		} else {
			vscode.window.showErrorMessage("Must Configure Auto Execution!");
		}
	}));





	// Events registration.

	// Configuration listener.
	context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(e => {

		// Checking if user changed client options config (object has sql & groovy range color config).
		// If so, we potentially need to re-color things!
		if (e.affectsConfiguration((CONFIGURATION_NAME + "." + CONFIGURATION_CLIENT_OPTIONS))) {
			GlobalSemanticHighlightingVars.semanticHighlightingFeature.loadCurrentTheme();
		}

		// Checking if user changed lang server options. If so, we need to let the lang server know!
		if (e.affectsConfiguration((CONFIGURATION_NAME + "." + CONFIGURATION_LANGUAGE_SERVER_OPTIONS))) {
			vscode.commands.executeCommand(LanguageServerCommands.SET_LANGUAGE_SERVER_OPTIONS, vscode.workspace.getConfiguration(CONFIGURATION_NAME).get(CONFIGURATION_LANGUAGE_SERVER_OPTIONS));
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

export function deactivate() { }




// Language server functions.
function startMocaLanguageServer() {

	javaPath = findJava();

	return vscode.window.withProgress(
		{ location: vscode.ProgressLocation.Window },
		progress => {
			return new Promise((resolve, reject) => {
				progress.report({ message: MOCA_LANGUAGE_SERVER_INITIALIZING_MESSAGE });
				let clientOptions: LanguageClientOptions = {
					documentSelector: [{ scheme: "file", language: "moca" }],
					uriConverters: {
						code2Protocol: (value: vscode.Uri) => {
							if (/^win32/.test(process.platform)) {
								//drive letters on Windows are encoded with %3A instead of :
								//but Java doesn't treat them the same
								return value.toString().replace("%3A", ":");
							} else {
								return value.toString();
							}
						},
						//this is just the default behavior, but we need to define both
						protocol2Code: value => vscode.Uri.parse(value)
					}
				};

				let args = ["-jar", path.resolve(globalExtensionContext.extensionPath, "bin", MOCA_LANGUAGE_SERVER)];

				let executable: Executable = {
					command: javaPath,
					args: args
				};

				mocaLanguageClient = new LanguageClient("moca", "MOCA Language Server", executable, clientOptions);

				mocaLanguageClient.onReady().then(resolve, reason => {

					resolve();
					vscode.window.showErrorMessage(MOCA_LANGUAGE_SERVER_ERR_STARTUP);

				});

				const semanticHighlightingFeature =
					new SemanticHighlightingFeature(mocaLanguageClient,
						globalExtensionContext);
				globalExtensionContext.subscriptions.push(
					vscode.Disposable.from(semanticHighlightingFeature));
				mocaLanguageClient.registerFeature(semanticHighlightingFeature);

				let disposable = mocaLanguageClient.start();
				globalExtensionContext.subscriptions.push(disposable);
			});
		}
	);
}

export default function findJava(): string {
	var executableFile: string = "java";
	if (process["platform"] === "win32") {
		executableFile += ".exe";
	}

	if ("JRE_HOME" in process.env) {
		let jreHome = process.env.JRE_HOME as string;
		let javaPath = path.join(jreHome, "bin", executableFile);
		if (validate(javaPath)) {
			return javaPath;
		}
	}

	if ("JAVA_HOME" in process.env) {
		let javaHome = process.env.JAVA_HOME as string;
		let javaPath = path.join(javaHome, "bin", executableFile);
		if (validate(javaPath)) {
			return javaPath;
		}
	}

	if ("PATH" in process.env) {
		let PATH = process.env.PATH as string;
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

function validate(javaPath: string): boolean {
	return fs.existsSync(javaPath) && fs.statSync(javaPath).isFile();
}



