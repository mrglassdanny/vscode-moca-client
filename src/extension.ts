import * as vscode from 'vscode';
import { LanguageClient, LanguageClientOptions, Executable } from "vscode-languageclient";
import * as path from "path";
import * as fs from "fs";
import { SemanticHighlightingFeature, GlobalSemanticHighlightingVars } from './semanticHighlighting';
import { MocaResults } from './mocaResults';
import { ResultViewPanel } from './results/ResultViewPanel';
import { MocaCommand, MocaTrigger } from './mocaCommandLookup';
import { performance } from 'perf_hooks';

// Language server constants.
const MOCA_LANGUAGE_SERVER_VERSION = "0.0.1";
const MOCA_LANGUAGE_SERVER = "moca-language-server-" + MOCA_LANGUAGE_SERVER_VERSION + "-all.jar";
const MOCA_LANGUAGE_SERVER_INITIALIZING_MESSAGE = "MOCA: Initializing language server";
const MOCA_LANGUAGE_SERVER_ERR_STARTUP = "The MOCA extension failed to start.";

// Client vars.
let globalExtensionContext: vscode.ExtensionContext;
let mocaLanguageClient: LanguageClient;
let javaPath: string;

// Client constants.
export const CONFIGURATION_NAME = "mocaclient";
export const CONFIGURATION_CONNECTIONS_NAME = "connections";
export const CONFIGURATION_TRACE_NAME = "trace";
export const CONFIGURATION_AUTO_EXECUTION_NAME = "autoExecution";
export const CONFIGURATION_SQL_RANGE_COLOR_NAME = "sqlRangeColor";
export const CONFIGURATION_GROOVY_RANGE_COLOR_NAME = "groovyRangeColor";
export const CONFIGURATION_FORMATTING_TRAINING_DATA = "formatterTrainingData";

// Client commands.
export namespace LanguageClientCommands {
	export const CONNECT = "mocaclient.connect";
	export const LOAD_CACHE = "mocaclient.loadCache";
	export const EXECUTE = "mocaclient.execute";
	export const EXECUTE_SELECTION = "mocaclient.executeSelection";
	export const TRACE = "mocaclient.trace";
	export const COMMAND_LOOKUP = "mocaclient.commandLookup";
	export const TRAIN_FORMATTERS = "mocaclient.trainFormatters";
	export const AUTO_EXECUTE = "mocaclient.autoExecute";
}

// Language server commands.
export namespace LanguageServerCommands {
	export const ACTIVATE = "mocalanguageserver.activate";
	export const CONNECT = "mocalanguageserver.connect";
	export const LOAD_CACHE = "mocalanguageserver.loadCache";
	export const EXECUTE = "mocalanguageserver.execute";
	export const TRACE = "mocalanguageserver.trace";
	export const COMMAND_LOOKUP = "mocalanguageserver.commandLookup";
	export const TRAIN_FORMATTERS = "mocalanguageserver.trainFormatters";
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

// Save the last successful connection. Reason being, is that if the user tries to re-connect to the same connection, we do not necessarily
// want to reload the cache.
let lastAttemptedConnectionName: string = "";

// Need to keep track of trace status.
let traceStarted: boolean = false;


export function activate(context: vscode.ExtensionContext) {

	// Set some vars.
	globalExtensionContext = context;

	// Make sure global storage path exists.
	vscode.workspace.fs.createDirectory(vscode.Uri.file(context.globalStoragePath));
	// Make sure other paths exist.
	vscode.workspace.fs.createDirectory(vscode.Uri.file(context.globalStoragePath + "\\command_lookup"));
	vscode.workspace.fs.createDirectory(vscode.Uri.file(context.globalStoragePath + "\\formatting\\training\\moca"));
	vscode.workspace.fs.createDirectory(vscode.Uri.file(context.globalStoragePath + "\\formatting\\training\\mocasql"));

	// Start language server on extension activate.
	startMocaLanguageServer().then(() => {
		const config = vscode.workspace.getConfiguration(CONFIGURATION_NAME);
		var formatterTrainingDataConfigObj = JSON.parse(JSON.stringify(config.get(CONFIGURATION_FORMATTING_TRAINING_DATA)));

		var formatterTrainingDataMocaDirName = formatterTrainingDataConfigObj['moca-dir-name'];
		var formatterTrainingDataMocaSqlDirName = formatterTrainingDataConfigObj['mocasql-dir-name'];
		vscode.commands.executeCommand(LanguageServerCommands.ACTIVATE, context.globalStoragePath, formatterTrainingDataMocaDirName, formatterTrainingDataMocaSqlDirName).then((activateResponse) => {
			var activateResponseJsonObj = JSON.parse(JSON.stringify(activateResponse));
			if (activateResponseJsonObj["exception"]) {
				vscode.window.showErrorMessage("Error occuring during MOCA Language Server activation: " + activateResponseJsonObj["exception"]["message"]);
			}
		})
	});



	// Command registration.
	context.subscriptions.push(vscode.commands.registerCommand(LanguageClientCommands.CONNECT, async () => {

		var connections = new Map<String, any>();
		var names = new Array();

		const config = vscode.workspace.getConfiguration(CONFIGURATION_NAME);
		var connObj = config.get(CONFIGURATION_CONNECTIONS_NAME);
		if (connObj) {
			var connObjArr = connObj as Object[];
			for (var i = 0; i < connObjArr.length; i++) {
				var connElem = JSON.parse(JSON.stringify(connObjArr[i]));


				var values = Object.keys(connElem).map(function (key) { return connElem[key]; });
				names.push(values[0]);
				connections.set(values[0], values);

			}
		}

		let quickPickRes = await vscode.window.showQuickPick(names);
		var selectedConnection = connections.get(quickPickRes);
		if (!selectedConnection) {
			return null;
		}

		var selectedConnectionJsonStr = JSON.stringify(selectedConnection);
		var selectedConnectionJsonObj = JSON.parse(selectedConnectionJsonStr);

		// Analyze selected connection to determine if we will need to reload moca repo.
		var useExistingMocaRepo = false;
		if (lastAttemptedConnectionName.localeCompare(selectedConnectionJsonObj[0]) === 0) {
			useExistingMocaRepo = true;
		} else {
			lastAttemptedConnectionName = selectedConnectionJsonObj[0];
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
				message: ("Connecting To " + selectedConnectionJsonObj[0])
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
				vscode.commands.executeCommand(LanguageServerCommands.CONNECT, selectedConnection, useExistingMocaRepo).then((connResponse) => {

					// If cancellation requested, skip this part.
					if (!cancellationRequested) {
						var connResponseJsonObj = JSON.parse(JSON.stringify(connResponse));
						var eOk = connResponseJsonObj["eOk"];

						if (eOk === true) {
							connectionSuccess = true;
							connectionStatusBarItem.text = CONNECTED_PREFIX_STR + selectedConnectionJsonObj[0];
						} else {
							var exceptionJsonObj = JSON.parse(JSON.stringify(connResponseJsonObj["exception"]));
							vscode.window.showErrorMessage(selectedConnectionJsonObj[0] + ": " + exceptionJsonObj["message"]);
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
	}));

	context.subscriptions.push(vscode.commands.registerCommand(LanguageClientCommands.LOAD_CACHE, async () => {

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

					vscode.commands.executeCommand(LanguageServerCommands.EXECUTE, script, curFileNameShortened).then((res) => {

						// If cancellation requested, skip this part.
						if (!cancellationRequested) {
							var mocaResults = new MocaResults(res);
							ResultViewPanel.createOrShow(context.extensionPath, curFileNameShortened, mocaResults);
							if (mocaResults.msg && mocaResults.msg.length > 0) {
								vscode.window.showErrorMessage(curFileNameShortened + ": " + mocaResults.msg);
							}
						}
					}).then(() => {
						// Resolve progress indicator.
						progress.report({ increment: Infinity });
						progressResolve();
					});
				});
				return p;
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

						vscode.commands.executeCommand(LanguageServerCommands.EXECUTE, selectedScript, curFileNameShortened).then((res) => {

							// If cancellation requested, skip this part.
							if (!cancellationRequested) {
								var mocaResults = new MocaResults(res);
								ResultViewPanel.createOrShow(context.extensionPath, curFileNameShortened, mocaResults);
								if (mocaResults.msg && mocaResults.msg.length > 0) {
									vscode.window.showErrorMessage(curFileNameShortened + ": " + mocaResults.msg);
								}
							}
						}).then(() => {
							// Resolve progress indicator.
							progress.report({ increment: Infinity });
							progressResolve();
						});
					});
					return p;
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

			if (fileName === undefined) {
				fileName = "";
			}
			if (mode === undefined || (mode !== "w" && mode !== "W" && mode !== "a" && mode !== "A")) {
				mode = "w";
			}

			// Start/stop trace.
			traceStarted = !traceStarted;
			if (traceStarted) {
				traceStatusBarItem.text = STOP_TRACE_STR;
			} else {
				traceStatusBarItem.text = START_TRACE_STR;
			}

			vscode.commands.executeCommand(LanguageServerCommands.TRACE, traceStarted, fileName, mode).then((traceRes) => {
			});
		}


	}));

	context.subscriptions.push(vscode.commands.registerCommand(LanguageClientCommands.COMMAND_LOOKUP, async () => {

		vscode.commands.executeCommand(LanguageServerCommands.COMMAND_LOOKUP).then(async (commandLookupRes) => {
			// We should have a string array of distinct moca command names.
			var commandLookupObj = JSON.parse(JSON.stringify(commandLookupRes));
			if (commandLookupObj.distinctMocaCommands) {
				var distinctCommands = commandLookupObj.distinctMocaCommands as string[];
				// Now sit tight while the user picks one.
				await vscode.window.showQuickPick(distinctCommands).then((distinctCommandSelected) => {
					// Now that we have a command, we can request command data from server.
					vscode.commands.executeCommand(LanguageServerCommands.COMMAND_LOOKUP, distinctCommandSelected).then(async (commandDataRes) => {
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

							await vscode.window.showQuickPick(commandData).then((commandDataSelectedRes) => {
								// Now that the user has selected something specific from the command looked up, we can load the file.
								var commandDataSelected = commandDataSelectedRes as string;
								if (commandDataJsonObj.commandsAtLevels) {
									var commandsAtLevels = commandDataJsonObj.commandsAtLevels as MocaCommand[];
									for (var i = 0; i < commandsAtLevels.length; i++) {
										if (commandDataSelected.localeCompare(commandsAtLevels[i].cmplvl + ": " + commandsAtLevels[i].command + " (" + commandsAtLevels[i].type + ")") === 0) {
											var uri = vscode.Uri.file(context.globalStoragePath + "\\command_lookup\\" + (commandsAtLevels[i].cmplvl + "-" + commandsAtLevels[i].command).replace(/ /g, "_") + ".msql.readonly");
											// Before we attempt to write, we need to make sure code is local syntax.
											if (commandsAtLevels[i].type.localeCompare("Local Syntax") !== 0) {
												vscode.window.showErrorMessage("Command Lookup: Cannot view non Local Syntax commands!");
											} else {
												vscode.workspace.fs.writeFile(uri, Buffer.from(commandsAtLevels[i].syntax)).then(() => {

													vscode.workspace.openTextDocument(uri).then(doc => {
														vscode.window.showTextDocument(doc);
													});
												});
											}
											return;
										}
									}
								}
								if (commandDataJsonObj.triggers) {
									var triggers = commandDataJsonObj.triggers as MocaTrigger[];
									for (var i = 0; i < triggers.length; i++) {
										commandData.push("Trigger: " + triggers[i].name);
										if (commandDataSelected.localeCompare("Trigger: " + triggers[i].trgseq + " - " + triggers[i].name) === 0) {
											var uri = vscode.Uri.file(context.globalStoragePath + "\\command_lookup\\" + (distinctCommandSelected + "-" + triggers[i].name).replace(/ /g, "_") + ".msql.readonly");
											// Triggers are always local syntax.
											vscode.workspace.fs.writeFile(uri, Buffer.from(triggers[i].syntax)).then(() => {
												vscode.workspace.openTextDocument(uri).then(doc => {
													vscode.window.showTextDocument(doc);
												});
											});
											return;
										}
									}
								}
							});
						}

					});
				});
			}

		});
	}));

	context.subscriptions.push(vscode.commands.registerCommand(LanguageClientCommands.TRAIN_FORMATTERS, async () => {

		vscode.window.withProgress({
			location: vscode.ProgressLocation.Notification,
			title: "MOCA",
			cancellable: false
		}, (progress, token) => {
			progress.report({
				increment: Infinity,
				message: "Training formatting models"
			});

			var p = new Promise(progressResolve => {
				const config = vscode.workspace.getConfiguration(CONFIGURATION_NAME);
				var formatterTrainingDataConfigObj = JSON.parse(JSON.stringify(config.get(CONFIGURATION_FORMATTING_TRAINING_DATA)));

				var mocaDirName = formatterTrainingDataConfigObj['moca-dir-name'];
				var mocaSqlDirName = formatterTrainingDataConfigObj['mocasql-dir-name'];
				vscode.commands.executeCommand(LanguageServerCommands.TRAIN_FORMATTERS, mocaDirName, mocaSqlDirName).then((trainFormattersRes) => {
					var trainFormattersResJsonObj = JSON.parse(JSON.stringify(trainFormattersRes));
					if (trainFormattersResJsonObj["exception"]) {
						vscode.window.showErrorMessage("Error occured during formatting model training: " + trainFormattersResJsonObj["exception"]["message"]);
					}
				}).then(() => {
					// Resolve progress indicator.
					progress.report({ increment: Infinity });
					progressResolve();
				});
			});
			return p;
		});


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

					var autoExecP = new Promise(autoExecProgressResolve => {

						// Purpose of this is to indicate that cancellation was requested down below.
						var autoExecCancellationRequested = false;

						autoExecToken.onCancellationRequested(() => {
							// Go ahead and resolve progress, send cancellation, then quit.
							autoExecCancellationRequested = true;
							autoExecProgressResolve();
							return autoExecP;
						});

						var innerAutoExecP = new Promise(async (innerAutoExecResolve) => {

							var executionCountIncrementAmount = (1 / stopIfExecutionCountExceeds) * 100;
							var elapsedTimeIncrementAmount = (1000 / stopIfTimeElapses) * 100;
							var incrementAmount = (executionCountIncrementAmount > elapsedTimeIncrementAmount ? executionCountIncrementAmount : elapsedTimeIncrementAmount);

							while (executionCount < stopIfExecutionCountExceeds && (curTime - startTime) < stopIfTimeElapses && !stopExecutionBecauseOfError) {

								// Sleep before execution.
								await sleepFunc(sleepDuration);

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

										vscode.commands.executeCommand(LanguageServerCommands.EXECUTE, script, curFileNameShortened).then((res) => {

											// If cancellation requested, skip this part.
											if (!execCancellationRequested && !autoExecCancellationRequested) {
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
										}).then(() => {
											// Resolve progress indicator.
											execProgress.report({ increment: Infinity });
											execProgressResolve();
										});
									});
									return execP;
								});

								executionCount++;
								curTime = performance.now();

								autoExecProgress.report({ increment: incrementAmount });

								// Quit if cancellation requested above.
								if (autoExecCancellationRequested) {
									break;
								}
							}

							// Resolve promise.
							innerAutoExecResolve();
						}).then(() => {
							// Resolve progress indicator.
							autoExecProgressResolve();
						});
					});
					return autoExecP;
				});
			}
		} else {
			vscode.window.showErrorMessage("Must Configure Auto Exection!");
		}
	}));





	// Events registration.
	context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(e => {

		// Checking if user changed sql or groovy range color config.
		// If so, we need to re-color things!
		if (e.affectsConfiguration((CONFIGURATION_NAME + "." + CONFIGURATION_SQL_RANGE_COLOR_NAME)) || e.affectsConfiguration((CONFIGURATION_NAME + "." + CONFIGURATION_GROOVY_RANGE_COLOR_NAME))) {
			GlobalSemanticHighlightingVars.semanticHighlightingFeature.loadCurrentTheme();
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

				// TODO: change back to regular path!
				//let args = ["-jar", path.resolve(globalExtensionContext.extensionPath, "bin", MOCA_LANGUAGE_SERVER)];
				let args = ["-jar", path.resolve("C:\\dev\\moca-language-server\\build\\", "libs", MOCA_LANGUAGE_SERVER)];

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

	if ("JAVA_HOME" in process.env) {
		let javaHome = process.env.JAVA_HOME as string;
		let javaPath = path.join(javaHome, "bin", executableFile);
		if (validate(javaPath)) {
			return javaPath;
		}
	}

	if ("JRE_HOME" in process.env) {
		let jreHome = process.env.JRE_HOME as string;
		let javaPath = path.join(jreHome, "bin", executableFile);
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



