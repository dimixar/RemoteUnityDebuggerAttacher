const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const dgram = require('dgram');

function extractIpAndPort(str) {
	const regex = /\((\d+),([\d.]+)\):(\d+)/;
	const match = str.match(regex);

	if (match) {
		return {
			success: true,
			ip: match[2],
			port: match[3]
		};
	} else {
		return {
			success: false,
			ip: '',
			port: ''
		};
	}
}

function parseUnityMessage(message) {
	// Split the message into parts
	let parts = message.split(' ');

	// Create an object to store the parsed information
	let parsedMessage = {};

	// Iterate over the parts and extract the information
	let key = '';
	for (let i = 0; i < parts.length; i++) {
		if (parts[i].startsWith('[')) {
			// The part is a key, remove the brackets and store it
			key = parts[i].substring(1, parts[i].length - 1);
		}
		else {
			if (key !== '') {
				parsedMessage[key] = parts[i];
				key = '';
			}
		}
	}

	// Return the parsed message
	parsedMessage.isEditor = false;
	return parsedMessage;
}

async function getDebugPortFromLocalProcessesMacOs(game, rinfo) {
	const child_process = require('child_process');

	let returnPort = 0;

	try {
		const output = await new Promise((resolve, reject) => {
			let sanitizedProjectName = game.ProjectName.replace(/\x00/g, '');
			child_process.exec(`lsof -iTCP -sTCP:LISTEN -n -P | grep ${sanitizedProjectName}`, (error, stdout, stderr) => {
				if (error) {
					reject(error);
					return;
				}

				if (stderr) {
					reject(new Error(stderr));
					return;
				}

				resolve(stdout);
			});
		});

		let lines = output.split('\n');
		lines.forEach(line => {
			const match = line.match(/TCP \*:(\d+)/);
			if (match) {
				const port = parseInt(match[1], 10);
				if (port !== rinfo.port && port !== game.Port) {
					// This is the port you're interested in
					returnPort = port;
				}
			}
		});

		return returnPort;
	} catch (error) {
		vscode.window.showErrorMessage(`Error: ${error.message}`);
		return 0;
	}
}

async function getDebugPortFromLocalProcessesWindows(game, rinfo) {
	const child_process = require('child_process');

	let returnPort = 0;

	try {
		const output = await new Promise((resolve, reject) => {
			child_process.exec(`netstat -ano | findstr LISTENING`, (error, stdout, stderr) => {
				if (error) {
					reject(error);
					return;
				}

				if (stderr) {
					reject(new Error(stderr));
					return;
				}

				resolve(stdout);
			});
		});

		let lines = output.split('\n');
		lines.forEach(async line => {
			const parts = line.split(/\s+/);
			const port = parseInt(parts[1].split(':')[1], 10);
			const pid = parts[4];

			const processNameOutput = await new Promise((resolve, reject) => {
				child_process.exec(`tasklist /FI "PID eq ${pid}"`, (error, stdout, stderr) => {
					if (error) {
						reject(error);
						return;
					}

					if (stderr) {
						reject(new Error(stderr));
						return;
					}

					resolve(stdout);
				});
			});

			if (processNameOutput.includes(game.ProjectName) && port !== rinfo.port && port !== game.Port) {
				// This is the port you're interested in
				returnPort = port;
			}
		});

		return returnPort;
	} catch (error) {
		vscode.window.showErrorMessage(`Error: ${error.message}`);
		return 0;
	}
}

async function getDebugPortFromLocalProcessesLinux(game, rinfo) {
	const child_process = require('child_process');

	let returnPort = 0;

	try {
		const output = await new Promise((resolve, reject) => {
			child_process.exec(`netstat -tuln | grep LISTEN`, (error, stdout, stderr) => {
				if (error) {
					reject(error);
					return;
				}

				if (stderr) {
					reject(new Error(stderr));
					return;
				}

				resolve(stdout);
			});
		});

		let lines = output.split('\n');
		lines.forEach(async line => {
			const parts = line.split(/\s+/);
			const port = parseInt(parts[3].split(':')[1], 10);
			const pid = parts[6].split('/')[0];

			const processNameOutput = await new Promise((resolve, reject) => {
				child_process.exec(`ps -p ${pid} -o comm=`, (error, stdout, stderr) => {
					if (error) {
						reject(error);
						return;
					}

					if (stderr) {
						reject(new Error(stderr));
						return;
					}

					resolve(stdout);
				});
			});

			if (processNameOutput.includes(game.ProjectName) && port !== rinfo.port && port !== game.Port) {
				// This is the port you're interested in
				returnPort = port;
			}
		});

		return returnPort;
	} catch (error) {
		vscode.window.showErrorMessage(`Error: ${error.message}`);
		return 0;
	}
}


function isUnityRunning() {
	const child_process = require('child_process');
	return new Promise((resolve, reject) => {
		// Use 'ps aux' on Unix or 'tasklist' on Windows
		const command = process.platform === 'win32' ? 'tasklist' : 'ps aux';

		child_process.exec(command, (err, stdout, stderr) => {
			if (err) {
				reject(err);
			} else {
				// Check if the output includes 'Unity'
				resolve(stdout.includes('Unity') && !stdout.includes('Unity Hub'));
			}
		});
	});
}

async function processGame(games, game, rinfo) {
	const os = require('os');

	let ipAndPort = extractIpAndPort(game.Id);
	//NOTE: I assume that the game is running on the same machine as the editor
	if (ipAndPort.success === false) {

		let debugPort;
		if (os.platform() === 'darwin') {
			debugPort = await getDebugPortFromLocalProcessesMacOs(game, rinfo);
		} else if (os.platform() === 'win32') {
			debugPort = await getDebugPortFromLocalProcessesWindows(game, rinfo);
		} else if (os.platform() === 'linux') {
			debugPort = await getDebugPortFromLocalProcessesLinux(game, rinfo);
		} else {
			vscode.window.showErrorMessage(`Unsupported platform: ${os.platform()}`);
			return;
		}

		ipAndPort.port = debugPort;
		ipAndPort.ip = game.IP;
	}

	game.debugIp = ipAndPort.ip;
	game.debugPort = ipAndPort.port;
	if (games.findIndex(g => g.Id === game.Id && g.debugPort === game.debugPort) === -1) {
		games.push(game);
	}
}

function activate(context) {
	let findMulticastingPlayers = vscode.commands.registerCommand('FindRemoteDebug.findAndAttach', function () {
		// Check if this is a Unity project
		if (vscode.workspace.workspaceFolders.some(folder => fs.existsSync(path.join(folder.uri.fsPath, 'Assets')))) {
			// Create a new UDP socket
			const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });

			// Bind the socket to a port
			socket.bind(54997, function () {
				socket.addMembership('225.0.0.222');
			});

			// Handle listening events
			socket.on('listening', () => {
				const address = socket.address();
				vscode.window.showInformationMessage(`Listening on ${address.address}:${address.port}`);
			});

			let games = [];
			let candidates = [];
			let quickPick = vscode.window.createQuickPick();

			// Handle message events
			socket.on('message', async (msg, rinfo) => {
				let game = parseUnityMessage(msg.toString());

				if (candidates.findIndex(g => g.Id === game.Id && g.IP === game.IP) !== -1) {
					return;
				}

				candidates.push(game);

				processGame(games, game, rinfo).then(() => {
					quickPick.items = games.map(g => {
						return {
							label: g.Id,
							description: `${g.ProjectName} (${g.PackageName})`
						}
					});
				});
			});

			if (isUnityRunning()) {
				let game = {
					Id: 'Unity',
					IP: 'localhost',
					ProjectName: 'Unity Editor',
					PackageName: '-',
					isEditor: true
				};

				games.push(game);
				quickPick.items = games.map(g => {
					return {
						label: g.Id,
						description: `${g.ProjectName} (${g.PackageName})`
					}
				});
			}

			// Handle error events
			socket.on('error', (err) => {
				vscode.window.showErrorMessage(`Error: ${err}`);
			});

			quickPick.onDidAccept(() => {
				let selectedGame = quickPick.selectedItems[0];
				let selectedGameInfo = games.find(g => g.Id === selectedGame.label);
				if (selectedGameInfo.isEditor) {
					vscode.debug.startDebugging(undefined, {
						name: `Attach to ${selectedGameInfo.Id}`,
						type: 'vstuc',
						request: 'attach',
						endPoint: 'localhost:56000'
					})
				} else {
					vscode.debug.startDebugging(undefined, {
						name: `Attach to ${selectedGameInfo.Id}`,
						type: 'vstuc',
						request: 'attach',
						endPoint: `${selectedGameInfo.debugIp}:${selectedGameInfo.debugPort}`
					})
				}
				quickPick.hide();
				socket.close();
			});

			quickPick.onDidHide(() => {
				socket.close();
				quickPick.dispose();
			});

			quickPick.title = 'Searching for running unity builds...';
			quickPick.busy = true;
			quickPick.show();
		} else {
			vscode.window.showInformationMessage('This is not a Unity project.');
		}
	});

	context.subscriptions.push(findMulticastingPlayers);
}

function deactivate() { }

module.exports = {
	activate,
	deactivate
}
