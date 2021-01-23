import * as vscode from 'vscode';
import { LanguageClient, LanguageClientOptions, Executable } from "vscode-languageclient";
import * as path from "path";
import * as fs from "fs";
import * as csv from "csv-parser";
import { SemanticHighlightingFeature, GlobalSemanticHighlightingVars } from './semanticHighlighting/semanticHighlighting';
import { MocaResults } from './results/mocaResults';
import { ResultViewPanel } from './results/ResultViewPanel';
import { MocaCommand, MocaTrigger } from './mocaCommandLookup/mocaCommandLookup';
import { performance } from 'perf_hooks';


// Language server constants.
const MOCA_LANGUAGE_SERVER_VERSION = "1.8.19";
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
export const CONFIGURATION_CLIENT_OPTIONS_NAME = "clientOptions";
export const CONFIGURATION_LANGUAGE_SERVER_OPTIONS_NAME = "languageServerOptions";
export const CONFIGURATION_DEFAULT_GROOVY_CLASSPATH_NAME = "defaultGroovyclasspath";
export const CONFIGURATION_TRACE_OUTLINER_NAME = "traceOutliner";


// Client commands.
export namespace LanguageClientCommands {
	export const CONNECT = "moca.connect";
	export const LOAD_CACHE = "moca.loadCache";
	export const EXECUTE = "moca.execute";
	export const EXECUTE_SELECTION = "moca.executeSelection";
	export const EXECUTE_TO_CSV = "moca.executeToCSV";
	export const EXECUTE_SELECTION_TO_CSV = "moca.executeSelectionToCSV";
	export const EXECUTE_WITH_CSV = "moca.executeWithCSV";
	export const EXECUTE_WITH_CSV_TO_CSV = "moca.executeWithCSVToCSV";
	export const TRACE = "moca.trace";
	export const COMMAND_LOOKUP = "moca.commandLookup";
	export const AUTO_EXECUTE = "moca.autoExecute";
	export const OPEN_TRACE_OUTLINE = "moca.openTraceOutline";
}

// Language server commands.
export namespace LanguageServerCommands {
	export const ACTIVATE = "mocalanguageserver.activate";
	export const CONNECT = "mocalanguageserver.connect";
	export const LOAD_CACHE = "mocalanguageserver.loadCache";
	export const EXECUTE = "mocalanguageserver.execute";
	export const EXECUTE_TO_CSV = "mocalanguageserver.executeToCSV";
	export const TRACE = "mocalanguageserver.trace";
	export const COMMAND_LOOKUP = "mocalanguageserver.commandLookup";
	export const SET_LANGUAGE_SERVER_OPTIONS = "mocalanguageserver.setLanguageServerOptions";
	export const OPEN_TRACE_OUTLINE = "mocalanguageserver.openTraceOutline";
}

// Status bar items.
// Arbitrary number to offset status bar priorities in order to try to keep items together better.
const STATUS_BAR_PRIORITY_OFFSET = 562;
var connectionStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, Number.MAX_VALUE + STATUS_BAR_PRIORITY_OFFSET);
var executeStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, Number.MAX_VALUE - 1 + STATUS_BAR_PRIORITY_OFFSET);
var executeSelectionStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, Number.MAX_VALUE - 2 + STATUS_BAR_PRIORITY_OFFSET);
var executeToCSVStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, Number.MAX_VALUE - 3 + STATUS_BAR_PRIORITY_OFFSET);
var executeSelectionToCSVStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, Number.MAX_VALUE - 4 + STATUS_BAR_PRIORITY_OFFSET);
var commandLookupStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, Number.MAX_VALUE - 5 + STATUS_BAR_PRIORITY_OFFSET);
var traceStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, Number.MAX_VALUE - 6 + STATUS_BAR_PRIORITY_OFFSET);
var openTraceOutlineStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, Number.MAX_VALUE - 7 + STATUS_BAR_PRIORITY_OFFSET);

// Status bar constants.
const STATUS_BAR_NOT_CONNECTED_STR = "MOCA: $(circle-slash)";
const STATUS_BAR_CONNECTED_PREFIX_STR = "MOCA: $(pass) ";
const STATUS_BAR_START_TRACE_STR = "$(debug-alt) Start Trace";
const STATUS_BAR_STOP_TRACE_STR = "$(debug-disconnect) Stop Trace";

// Constants for unsafe script executions configuration.
const UNSAFE_CODE_APPROVAL_PROMPT = "You are attempting to run unsafe code. Do you want to continue?";
const UNSAFE_CODE_APPROVAL_OPTION_YES = "Yes";
const UNSAFE_CODE_APPROVAL_OPTION_NO = "No";

// Constants for opening trace outline immediately after trace stop.
const OPEN_TRACE_OUTLINE_PROMPT = "Would you like to open trace outline?";
const OPEN_TRACE_OUTLINE_OPTION_YES = "Yes";
const OPEN_TRACE_OUTLINE_OPTION_NO = "No";

// Need to keep track of trace status.
let traceStarted: boolean = false;

// Need to save off user ID for default trace file naming.
let curConnectionUserId: string = "";

// Tells us if trace status bar item is hidden via showAllIconsInStatusBar client options config.
let hidingTraceStatusBarItem: boolean = false;


export async function activate(context: vscode.ExtensionContext) {


	// Set some vars.
	globalExtensionContext = context;

	// Make sure global storage path exists.
	vscode.workspace.fs.createDirectory(vscode.Uri.file(context.globalStoragePath));

	// Make sure other paths exist.
	vscode.workspace.fs.createDirectory(vscode.Uri.file(context.globalStoragePath + "\\command-lookup"));
	vscode.workspace.fs.createDirectory(vscode.Uri.file(context.globalStoragePath + "\\trace"));
	vscode.workspace.fs.createDirectory(vscode.Uri.file(context.globalStoragePath + "\\references"));

	// Directories are there -- let's purge existing files.
	var commandLookupDirRes = await vscode.workspace.fs.readDirectory(vscode.Uri.file(context.globalStoragePath + "\\command-lookup"));
	for (var i = 0; i < commandLookupDirRes.length; i++) {

		// Only delete if last modified date is not same as today.
		if (fs.statSync(context.globalStoragePath + "\\command-lookup\\" + commandLookupDirRes[i][0]).mtime.getDate() != new Date().getDate()) {
			vscode.workspace.fs.delete(vscode.Uri.file(context.globalStoragePath + "\\command-lookup\\" + commandLookupDirRes[i][0]));
		}

	}
	var traceDirRes = await vscode.workspace.fs.readDirectory(vscode.Uri.file(context.globalStoragePath + "\\trace"));
	for (var i = 0; i < traceDirRes.length; i++) {

		// Only delete if last modified date is not same as today.
		if (fs.statSync(context.globalStoragePath + "\\trace\\" + traceDirRes[i][0]).mtime.getDate() != new Date().getDate()) {
			vscode.workspace.fs.delete(vscode.Uri.file(context.globalStoragePath + "\\trace\\" + traceDirRes[i][0]));
		}
	}
	var referencesDirRes = await vscode.workspace.fs.readDirectory(vscode.Uri.file(context.globalStoragePath + "\\references"));
	for (var i = 0; i < referencesDirRes.length; i++) {

		// Only delete if last modified date is not same as today.
		if (fs.statSync(context.globalStoragePath + "\\references\\" + referencesDirRes[i][0]).mtime.getDate() != new Date().getDate()) {
			vscode.workspace.fs.delete(vscode.Uri.file(context.globalStoragePath + "\\references\\" + referencesDirRes[i][0]));
		}

	}




	// Start language server on extension activate.
	await startMocaLanguageServer();

	var activateResponse = await vscode.commands.executeCommand(LanguageServerCommands.ACTIVATE, context.globalStoragePath, vscode.workspace.getConfiguration(CONFIGURATION_NAME).get(CONFIGURATION_LANGUAGE_SERVER_OPTIONS_NAME), vscode.workspace.getConfiguration(CONFIGURATION_NAME).get(CONFIGURATION_DEFAULT_GROOVY_CLASSPATH_NAME));
	var activateResponseJsonObj = JSON.parse(JSON.stringify(activateResponse));
	if (activateResponseJsonObj["exception"]) {
		vscode.window.showErrorMessage("Error occuring during MOCA Language Server activation: " + activateResponseJsonObj["exception"]["message"]);
	}


	// Command registration.
	context.subscriptions.push(vscode.commands.registerCommand(LanguageClientCommands.CONNECT, async () => {

		var connectionNames = new Array();
		var connections = new Map<String, any>();

		// Read in config.
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

		// Let user pick connection.
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

		// This should be a safe place to set this.
		curConnectionUserId = selectedConnectionObj.user;

		// If no entries in groovy classpath for selected connection, set to default groovy classpath.
		if (!selectedConnectionObj.groovyclasspath || selectedConnectionObj.groovyclasspath.length === 0) {
			selectedConnectionObj.groovyclasspath = vscode.workspace.getConfiguration(CONFIGURATION_NAME).get(CONFIGURATION_DEFAULT_GROOVY_CLASSPATH_NAME);
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
					connectionStatusBarItem.text = STATUS_BAR_CONNECTED_PREFIX_STR + selectedConnectionObj.name;
				} else {
					var exceptionJsonObj = JSON.parse(JSON.stringify(connResponseJsonObj["exception"]));
					vscode.window.showErrorMessage(selectedConnectionObj.name + ": " + exceptionJsonObj["message"]);
					connectionStatusBarItem.text = STATUS_BAR_NOT_CONNECTED_STR;
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

			await executeMocaScriptWithProgress(context, curFileNameShortened, script, "Executing ");
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

				await executeMocaScriptWithProgress(context, curFileNameShortened, selectedScript, "Executing Selection ");
			}
		}
	}));

	context.subscriptions.push(vscode.commands.registerCommand(LanguageClientCommands.EXECUTE_TO_CSV, async () => {

		let editor = vscode.window.activeTextEditor;

		if (editor) {

			var curFileName = editor.document.fileName;
			var curFileNameShortened = curFileName.substring(curFileName.lastIndexOf('\\') + 1, curFileName.length);
			let script = editor.document.getText();

			await executeMocaScriptToCSVWithProgress(context, curFileNameShortened, curFileName, script, "Executing To CSV ");
		}
	}));

	context.subscriptions.push(vscode.commands.registerCommand(LanguageClientCommands.EXECUTE_SELECTION_TO_CSV, async () => {

		let editor = vscode.window.activeTextEditor;

		if (editor) {

			var curFileName = editor.document.fileName;
			var curFileNameShortened = curFileName.substring(curFileName.lastIndexOf('\\') + 1, curFileName.length);

			var selection = editor.selection;
			if (selection) {
				var selectedScript = editor.document.getText(selection);

				await executeMocaScriptToCSVWithProgress(context, curFileNameShortened, curFileName, selectedScript, "Executing Selection To CSV ");
			}
		}
	}));

	context.subscriptions.push(vscode.commands.registerCommand(LanguageClientCommands.EXECUTE_WITH_CSV, async () => {

		// Give user list of local files to pick from.
		var csvFileNameRes = await vscode.window.showOpenDialog({
			canSelectMany: false, canSelectFiles: true, canSelectFolders: false, title: "Execute With CSV", filters: {
				"CSV": ["csv"]
			}
		});

		if (csvFileNameRes) {

			var csvRes: any[] = [];

			// vscode is a bit goofy with it's URIs, so we need to do this ugly transform.
			var csvFileUri = vscode.Uri.parse(csvFileNameRes[0].toString());
			var csvFileName = csvFileUri.toString(true).replace("file:///", "");

			await fs.createReadStream(csvFileName)
				.pipe(csv())
				.on('data', (data) => {
					csvRes.push(data)
				})
				.on('end', async () => {

					var csvPublishMocaScript = buildCSVPublishMocaScript(csvRes);

					// CSV publish script is built. Now let's get editor script, combine accordingly, and execute.
					let editor = vscode.window.activeTextEditor;

					if (editor) {

						var curFileName = editor.document.fileName;
						var curFileNameShortened = curFileName.substring(curFileName.lastIndexOf('\\') + 1, curFileName.length);
						let script = editor.document.getText();

						if (csvPublishMocaScript.length > 0 && script.length > 0) {
							csvPublishMocaScript += " | ";
						}

						await executeMocaScriptWithProgress(context, curFileNameShortened, csvPublishMocaScript + script, "Executing With CSV ");
					}
				});
		}


	}));

	context.subscriptions.push(vscode.commands.registerCommand(LanguageClientCommands.EXECUTE_WITH_CSV_TO_CSV, async () => {

		// Give user list of local files to pick from.
		var csvFileNameRes = await vscode.window.showOpenDialog({
			canSelectMany: false, canSelectFiles: true, canSelectFolders: false, title: "Execute With CSV To CSV", filters: {
				"CSV": ["csv"]
			}
		});

		if (csvFileNameRes) {

			var csvRes: any[] = [];

			// vscode is a bit goofy with it's URIs, so we need to do this ugly transform.
			var csvFileUri = vscode.Uri.parse(csvFileNameRes[0].toString());
			var csvFileName = csvFileUri.toString(true).replace("file:///", "");

			await fs.createReadStream(csvFileName)
				.pipe(csv())
				.on('data', (data) => {
					csvRes.push(data)
				})
				.on('end', async () => {

					var csvPublishMocaScript = buildCSVPublishMocaScript(csvRes);

					// CSV publish script is built. Now let's get editor script, combine accordingly, and execute.
					let editor = vscode.window.activeTextEditor;

					if (editor) {

						var curFileName = editor.document.fileName;
						var curFileNameShortened = curFileName.substring(curFileName.lastIndexOf('\\') + 1, curFileName.length);
						let script = editor.document.getText();

						if (csvPublishMocaScript.length > 0 && script.length > 0) {
							csvPublishMocaScript += " | ";
						}

						await executeMocaScriptToCSVWithProgress(context, curFileNameShortened, curFileName, csvPublishMocaScript + script, "Executing With CSV To CSV ");
					}
				});
		}


	}));

	context.subscriptions.push(vscode.commands.registerCommand(LanguageClientCommands.TRACE, async () => {

		// Read in configuration.
		const config = vscode.workspace.getConfiguration(CONFIGURATION_NAME);
		var traceConfigObj = config.get(CONFIGURATION_TRACE_NAME);

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
			}, async (progress) => {

				progress.report({ increment: Infinity });

				// Start/stop trace.
				traceStarted = !traceStarted;
				if (traceStarted) {

					traceStatusBarItem.text = STATUS_BAR_STOP_TRACE_STR;

					// Regardless of showAllIconsInStatusBar client options config, we want to show the stop trace icon so that the user knows that a trace is running.
					if (hidingTraceStatusBarItem) {
						traceStatusBarItem.show();
					}


				} else {
					traceStatusBarItem.text = STATUS_BAR_START_TRACE_STR;

					// If hiding trace status bar icon via showAllIconsInStatusBar client options config, make sure we hide now.
					if (hidingTraceStatusBarItem) {
						traceStatusBarItem.hide();
					}
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
						traceStatusBarItem.text = STATUS_BAR_START_TRACE_STR;

						// If hiding trace status bar icon via showAllIconsInStatusBar client options config, make sure we hide now.
						if (hidingTraceStatusBarItem) {
							traceStatusBarItem.hide();
						}
					}
				} else {

					// Allow user to open trace.
					if (!traceStarted) {
						var openTraceOutlineOptionRes = await vscode.window.showInformationMessage(OPEN_TRACE_OUTLINE_PROMPT, OPEN_TRACE_OUTLINE_OPTION_YES, OPEN_TRACE_OUTLINE_OPTION_NO);
						if (openTraceOutlineOptionRes === OPEN_TRACE_OUTLINE_OPTION_YES) {

							vscode.window.withProgress({
								location: vscode.ProgressLocation.Notification,
								title: "MOCA"
							}, async (progress, token) => {
								progress.report({
									increment: Infinity,
									message: "Loading Trace Outline for " + fileName
								});

								// Read in configuration.
								const config = vscode.workspace.getConfiguration(CONFIGURATION_NAME);
								var traceOutlinerConfigObj = config.get(CONFIGURATION_TRACE_OUTLINER_NAME);

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
								var uri = vscode.Uri.file(context.globalStoragePath + "\\trace\\" + fileName.replace('.log', '') + ".moca.traceoutline");

								// Now that we have a remote trace file name, we can request outline from lang server.
								// NOTE: get rid of uri string encoding to match lang server format.
								var traceResponseRemoteRes = await vscode.commands.executeCommand(LanguageServerCommands.OPEN_TRACE_OUTLINE, fileName + ".log", uri.toString(true), true, useLogicalIndentStrategy, minimumExecutionTime);
								if (traceResponseRemoteRes) {
									var traceResponseRemoteObj = JSON.parse(JSON.stringify(traceResponseRemoteRes));

									// Make sure to check for exception.
									if (traceResponseRemoteObj.exception) {
										vscode.window.showErrorMessage("Trace Outline error: " + traceResponseRemoteObj.exception["message"]);
									} else {
										// No exceptions -- now load outline.
										await vscode.workspace.fs.writeFile(uri, Buffer.from(traceResponseRemoteObj.traceOutlineStr));
										var doc = await vscode.workspace.openTextDocument(uri);
										await vscode.window.showTextDocument(doc, { preview: false });
									}
								}
							});
						}
					}
				}
			});
		}
	}));

	context.subscriptions.push(vscode.commands.registerCommand(LanguageClientCommands.COMMAND_LOOKUP, async () => {

		// We will call COMMAND_LOOKUP lang server command with no args. The lang server will take this as us wanting a list of all commands.
		// We will pick a command via a quick pick, and call COMMAND_LOOKUP lang server command once more but with a command name arg. This will
		// let the lang server know which command/triggers to send us. We will then prompt the user to pick what they want to see via another
		// quick pick. After they have selected what they want to see, we will write to a file, open and display it.

		var commandLookupRes = await vscode.commands.executeCommand(LanguageServerCommands.COMMAND_LOOKUP);
		// We should have a string array of distinct moca command names.
		var commandLookupObj = JSON.parse(JSON.stringify(commandLookupRes));
		if (commandLookupObj.distinctMocaCommands) {
			var distinctCommands = commandLookupObj.distinctMocaCommands as string[];
			// Now sit tight while the user picks one.
			var distinctCommandSelected = await vscode.window.showQuickPick(distinctCommands, { ignoreFocusOut: true });
			if (!distinctCommandSelected) {
				return;
			}
			// Now that we have a command, we can request command data from server.
			var commandDataRes = await vscode.commands.executeCommand(LanguageServerCommands.COMMAND_LOOKUP, distinctCommandSelected);
			if (commandDataRes) {
				// Now we need to let the user pick a command at a certain level or pick a trigger to look at.
				var commandDataObj = JSON.parse(JSON.stringify(commandDataRes));
				var commandData = new Array();
				if (commandDataObj.commandsAtLevels) {
					var commandsAtLevels = commandDataObj.commandsAtLevels as MocaCommand[];
					for (var i = 0; i < commandsAtLevels.length; i++) {
						commandData.push(commandsAtLevels[i].cmplvl + ": " + commandsAtLevels[i].command + " (" + commandsAtLevels[i].type + ")");
					}
				}
				if (commandDataObj.triggers) {
					var triggers = commandDataObj.triggers as MocaTrigger[];
					for (var i = 0; i < triggers.length; i++) {
						commandData.push("Trigger: " + triggers[i].trgseq + " - " + triggers[i].name);
					}
				}

				var commandDataSelectedRes = await vscode.window.showQuickPick(commandData, { ignoreFocusOut: true, canPickMany: true });
				if (!commandDataSelectedRes) {
					return;
				}

				// Now that the user has selected something specific from the command looked up, we can load the file(s).
				var commandDataSelectedArr = commandDataSelectedRes as string[];

				// Put commands & triggers in arrays here if we have them.
				var commandsAtLevels: MocaCommand[] = [];
				if (commandDataObj.commandsAtLevels) {
					var commandsAtLevels = commandDataObj.commandsAtLevels as MocaCommand[];
				}
				var triggers: MocaTrigger[] = [];
				if (commandDataObj.triggers) {
					triggers = commandDataObj.triggers as MocaTrigger[];
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

		// Basically this just executes the same script over and over until a stop condition is met.

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

	context.subscriptions.push(vscode.commands.registerCommand(LanguageClientCommands.OPEN_TRACE_OUTLINE, async () => {

		// Let user decide between Remote and Local.
		var traceTypeRes = await vscode.window.showQuickPick(["Remote", "Local"], { ignoreFocusOut: true });
		if (!traceTypeRes) {
			return;
		}

		// Read in configuration.
		const config = vscode.workspace.getConfiguration(CONFIGURATION_NAME);
		var traceOutlinerConfigObj = config.get(CONFIGURATION_TRACE_OUTLINER_NAME);

		// Prepare values.
		var traceOutlinerConfigJsonObj = JSON.parse(JSON.stringify(traceOutlinerConfigObj));

		var useLogicalIndentStrategy = traceOutlinerConfigJsonObj.useLogicalIndentStrategy;
		var minimumExecutionTime = traceOutlinerConfigJsonObj.minimumExecutionTime;

		if (traceTypeRes === "Remote") {

			// Sending empty args so that lang server knows to send us back a list of remote trace files.
			var traceResponseRemoteRes = await vscode.commands.executeCommand(LanguageServerCommands.OPEN_TRACE_OUTLINE);

			// We should have a string array of trace file names now.
			var traceResponseRemoteObj = JSON.parse(JSON.stringify(traceResponseRemoteRes));

			if (traceResponseRemoteObj.traceFileNames) {
				// Convert to string array and give user the list.
				var traceFileNamesRemote = traceResponseRemoteObj.traceFileNames as string[];
				// Now sit tight while the user picks one.
				var traceFileNameSelectedRemote = await vscode.window.showQuickPick(traceFileNamesRemote, { ignoreFocusOut: true });
				if (!traceFileNameSelectedRemote) {
					return;
				}

				vscode.window.withProgress({
					location: vscode.ProgressLocation.Notification,
					title: "MOCA"
				}, async (progress, token) => {
					progress.report({
						increment: Infinity,
						message: "Loading Trace Outline for " + traceFileNameSelectedRemote
					});

					// Create uri now so we can give it to lang server.
					var uri = vscode.Uri.file(context.globalStoragePath + "\\trace\\" + traceFileNameSelectedRemote.replace('.log', '') + ".moca.traceoutline");

					// Now that we have a remote trace file name, we can request outline from lang server.
					// NOTE: get rid of uri string encoding to match lang server format.
					traceResponseRemoteRes = await vscode.commands.executeCommand(LanguageServerCommands.OPEN_TRACE_OUTLINE, traceFileNameSelectedRemote, uri.toString(true), true, useLogicalIndentStrategy, minimumExecutionTime);
					if (traceResponseRemoteRes) {
						traceResponseRemoteObj = JSON.parse(JSON.stringify(traceResponseRemoteRes));

						// Make sure to check for exception.
						if (traceResponseRemoteObj.exception) {
							vscode.window.showErrorMessage("Trace Outline error: " + traceResponseRemoteObj.exception["message"]);
						} else {
							// No exceptions -- now load outline.
							await vscode.workspace.fs.writeFile(uri, Buffer.from(traceResponseRemoteObj.traceOutlineStr));
							var doc = await vscode.workspace.openTextDocument(uri);
							await vscode.window.showTextDocument(doc, { preview: false });
						}
					}
				});
			} else if (traceResponseRemoteObj.exception) {
				vscode.window.showErrorMessage("Trace Outline error: " + traceResponseRemoteObj.exception["message"]);
			}
		} else if (traceTypeRes === "Local") {

			// Give user list of local files to pick from.
			var traceFileNameSelectedLocalRes = await vscode.window.showOpenDialog({
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
				}, async (progress, token) => {
					progress.report({
						increment: Infinity,
						message: "Loading Trace Outline for " + traceFileNameSelectedShortenedLocalStr
					});


					// Create uri now so we can give it to lang server.
					var uri = vscode.Uri.file(context.globalStoragePath + "\\trace\\" + traceFileNameSelectedShortenedLocalStr.replace('.log', '') + ".moca.traceoutline");

					// Now that we have a local trace file name, we can request outline from lang server.
					// NOTE: get rid of uri string encoding to match lang server format.
					var traceResponseLocalRes = await vscode.commands.executeCommand(LanguageServerCommands.OPEN_TRACE_OUTLINE, traceFileNameSelectedLocalStr, uri.toString(true), false, useLogicalIndentStrategy, minimumExecutionTime);

					if (traceResponseLocalRes) {
						var traceResponseLocalObj = JSON.parse(JSON.stringify(traceResponseLocalRes));

						// Make sure to check for exception.
						if (traceResponseLocalObj.exception) {
							vscode.window.showErrorMessage("Trace Outline error: " + traceResponseLocalObj.exception["message"]);
						} else {
							// No exceptions -- now load outline.
							await vscode.workspace.fs.writeFile(uri, Buffer.from(traceResponseLocalObj.traceOutlineStr));
							var doc = await vscode.workspace.openTextDocument(uri);
							await vscode.window.showTextDocument(doc, { preview: false });
						}
					}
				});
			}
		}
	}));


	// Events registration.

	// Configuration listener.
	context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(e => {

		// Client options.
		if (e.affectsConfiguration((CONFIGURATION_NAME + "." + CONFIGURATION_CLIENT_OPTIONS_NAME))) {
			GlobalSemanticHighlightingVars.semanticHighlightingFeature.loadCurrentTheme();

			// Show status bar items based on client options config.
			{
				const config = vscode.workspace.getConfiguration(CONFIGURATION_NAME);
				const clientOptionsConfig = config.get(CONFIGURATION_CLIENT_OPTIONS_NAME);
				const clientOptionsConfigObj = JSON.parse(JSON.stringify(clientOptionsConfig));

				if (clientOptionsConfigObj["showAllIconsInStatusBar"] === true) {
					executeStatusBarItem.show();
					executeSelectionStatusBarItem.show();
					executeToCSVStatusBarItem.show();
					executeSelectionToCSVStatusBarItem.show();
					commandLookupStatusBarItem.show();
					traceStatusBarItem.show();
					openTraceOutlineStatusBarItem.show();

					hidingTraceStatusBarItem = false;
				} else {
					executeStatusBarItem.hide();
					executeSelectionStatusBarItem.hide();
					executeToCSVStatusBarItem.hide();
					executeSelectionToCSVStatusBarItem.hide();
					commandLookupStatusBarItem.hide();
					traceStatusBarItem.hide();
					openTraceOutlineStatusBarItem.hide();

					hidingTraceStatusBarItem = true;
				}
			}
		}

		// Language server options.
		if (e.affectsConfiguration((CONFIGURATION_NAME + "." + CONFIGURATION_LANGUAGE_SERVER_OPTIONS_NAME))) {
			vscode.commands.executeCommand(LanguageServerCommands.SET_LANGUAGE_SERVER_OPTIONS, vscode.workspace.getConfiguration(CONFIGURATION_NAME).get(CONFIGURATION_LANGUAGE_SERVER_OPTIONS_NAME));
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
		const config = vscode.workspace.getConfiguration(CONFIGURATION_NAME);
		const clientOptionsConfig = config.get(CONFIGURATION_CLIENT_OPTIONS_NAME);
		const clientOptionsConfigObj = JSON.parse(JSON.stringify(clientOptionsConfig));

		if (clientOptionsConfigObj["showAllIconsInStatusBar"] === true) {
			executeStatusBarItem.show();
			executeSelectionStatusBarItem.show();
			executeToCSVStatusBarItem.show();
			executeSelectionToCSVStatusBarItem.show();
			commandLookupStatusBarItem.show();
			traceStatusBarItem.show();
			openTraceOutlineStatusBarItem.show();

			hidingTraceStatusBarItem = false;
		} else {
			executeStatusBarItem.hide();
			executeSelectionStatusBarItem.hide();
			executeToCSVStatusBarItem.hide();
			executeSelectionToCSVStatusBarItem.hide();
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
	context.subscriptions.push(commandLookupStatusBarItem);
	context.subscriptions.push(traceStatusBarItem);
	context.subscriptions.push(openTraceOutlineStatusBarItem);

}

export function deactivate() { }


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

				//let args = ["-jar", path.resolve(globalExtensionContext.extensionPath, "bin", MOCA_LANGUAGE_SERVER)];
				let args = ["-jar", path.resolve("C:\\dev\\moca-language-server\\build\\libs", MOCA_LANGUAGE_SERVER)];

				let executable: Executable = {
					command: javaPath,
					args: args
				};

				mocaLanguageClient = new LanguageClient("moca", "MOCA Language Server", executable, clientOptions);

				mocaLanguageClient.onReady().then(resolve, reason => {

					resolve(undefined);
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

async function executeMocaScriptWithProgress(context: vscode.ExtensionContext, curFileNameShortened: string, script: string, progressMessagePrefix: string) {
	vscode.window.withProgress({
		location: vscode.ProgressLocation.Notification,
		title: "MOCA",
		cancellable: true
	}, async (progress, token) => {
		progress.report({
			increment: Infinity,
			message: progressMessagePrefix + curFileNameShortened
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

async function executeMocaScriptToCSVWithProgress(context: vscode.ExtensionContext, curFileNameShortened: string, curFileName: string, script: string, progressMessagePrefix: string) {
	vscode.window.withProgress({
		location: vscode.ProgressLocation.Notification,
		title: "MOCA",
		cancellable: true
	}, async (progress, token) => {
		progress.report({
			increment: Infinity,
			message: progressMessagePrefix + curFileNameShortened
		});

		// Purpose of this is to indicate that cancellation was requested down below.
		var cancellationRequested = false;

		token.onCancellationRequested(() => {
			cancellationRequested = true;
		});


		var res = await vscode.commands.executeCommand(LanguageServerCommands.EXECUTE_TO_CSV, script, curFileNameShortened, curFileName, false);
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
						var approvedRes = await vscode.commands.executeCommand(LanguageServerCommands.EXECUTE_TO_CSV, script, curFileNameShortened, curFileName, true);
						var approvedMocaResults = new MocaResults(approvedRes);

						// Lang server is taking care of loading results.

						if (approvedMocaResults.msg && approvedMocaResults.msg.length > 0) {
							vscode.window.showErrorMessage(curFileNameShortened + ": " + approvedMocaResults.msg);
						}


					}
				}
			} else {

				// Lang server is taking care of loading results.

				if (mocaResults.msg && mocaResults.msg.length > 0) {
					vscode.window.showErrorMessage(curFileNameShortened + ": " + mocaResults.msg);
				}
			}
		}
	});
}

function buildCSVPublishMocaScript(csvRes: any[]) {

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
