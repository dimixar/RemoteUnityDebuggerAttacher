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

async function getDebugPortFromLocalProcessesMacOs(game, rinfo, isEditor = false) {
	const child_process = require('child_process');

	let returnPort = -1;

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
		let foundReturnPort = false;
		if (isEditor) {
			// use the debugIp to find the first port that is not the game port or the rinfo port
			lines.forEach(line => {
				const match = line.match(/TCP (\d+\.\d+\.\d+\.\d+):(\d+)/);
				if (match) {
					const port = parseInt(match[2], 10);
					if (port !== rinfo.port && port !== parseInt(game.Port)) {
						// This is the port you're interested in
						if (returnPort === -1) {
							returnPort = port;
						}
					}
				}
			});
		} else {
			lines.forEach(line => {
				const match = line.match(/TCP \*:(\d+)/);
				if (match) {
					const port = parseInt(match[1], 10);
					if (port !== rinfo.port && port !== parseInt(game.Port)) {
						// This is the port you're interested in
						if (returnPort === -1) {
							returnPort = port;
						}
					}
				}
			});
		}

		return returnPort;
	} catch (error) {
		vscode.window.showErrorMessage(`Error: ${error.message}`);
		return -1;
	}
}

async function getDebugPortFromRemoteProcessesMacOs(game, rinfo) {
	let returnPort = -1;

	// Use netstat to list all listening ports
	const { exec } = require('child_process');
	const netstat = await new Promise((resolve, reject) => {
		exec('netstat -an | grep LISTEN', (error, stdout, stderr) => {
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

	// Parse the netstat output to find the open ports
	const openPorts = netstat.match(new RegExp(game.IP + '\\.(\d+) \*\\.LISTEN', 'g'));
	if (openPorts) {
		// Filter out the game port and rinfo port
		const filteredPorts = openPorts.filter(port => {
			const portNumber = parseInt(port.split('.')[1], 10);
			return portNumber !== parseInt(game.Port) && portNumber !== rinfo.port;
		});

		// Assuming the game is using the first open port
		if (filteredPorts.length > 0) {
			if (returnPort === -1) {
				returnPort = parseInt(filteredPorts[0].split('.')[1], 10);
			}
		}
	}

	return returnPort;
}

async function getDebugPortFromLocalProcessesWindows(game, rinfo) {
	const child_process = require('child_process');

	let returnPort = -1;
	let sanitizedProjectName = game.ProjectName.replace(/\x00/g, '');

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
		let promises = lines.map(async line => {
			const parts = line.split(/\s+/);
			const match = parts[2] && parts[2].match(/:(\d+)/);
			const port = match ? parseInt(match[1]) : null;
			const pid = parts[5] ? parts[5] : null;

			if (port === null || pid === null) {
				return;
			}

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

			if (processNameOutput.includes(sanitizedProjectName) && port !== rinfo.port && port !== parseInt(game.Port)) {
				// This is the port you're interested in
				if (returnPort === -1) {
					returnPort = port;
				}
			}
		});

		await Promise.all(promises);

		return returnPort;
	} catch (error) {
		vscode.window.showErrorMessage(`Error: ${error.message}`);
		return -1;
	}
}

async function getDebugPortFromRemoteProcessesWindows(game, rinfo) {
	let returnPort = -1;

	// Use netstat to list all listening ports
	const { exec } = require('child_process');
	const netstat = await new Promise((resolve, reject) => {
		exec('netstat -ano | findstr LISTENING', (error, stdout, stderr) => {
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

	// Parse the netstat output to find the open ports
	const openPorts = netstat.match(new RegExp('TCP    ' + game.IP + ':([0-9]*)', 'g'));
	if (openPorts) {
		// Filter out the game port and rinfo port
		const filteredPorts = openPorts.filter(port => {
			const portNumber = parseInt(port.split(':')[1], 10);
			return portNumber !== parseInt(game.Port) && portNumber !== rinfo.port;
		});

		// Assuming the game is using the first open port
		if (filteredPorts.length > 0) {
			if (returnPort === -1) {
				returnPort = parseInt(filteredPorts[0].split(':')[1], 10);
			}
		}
	}

	return returnPort;
}

async function getDebugPortFromLocalProcessesLinux(game, rinfo) {
	const child_process = require('child_process');

	let returnPort = -1;
	let sanitizedProjectName = game.ProjectName.replace(/\x00/g, '');

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
		let promises = lines.map(async line => {
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

			if (processNameOutput.includes(sanitizedProjectName) && port !== rinfo.port && port !== parseInt(game.Port)) {
				// This is the port you're interested in
				if (returnPort === -1) {
					returnPort = port;
				}
			}
		});

		await Promise.all(promises);

		return returnPort;
	} catch (error) {
		vscode.window.showErrorMessage(`Error: ${error.message}`);
		return -1;
	}
}

async function getDebugPortFromRemoteProcessesLinux(game, rinfo) {
	let returnPort = -1;

	// Use netstat to list all listening ports
	const { exec } = require('child_process');
	const netstat = await new Promise((resolve, reject) => {
		exec('netstat -tuln | grep LISTEN', (error, stdout, stderr) => {
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

	// Parse the netstat output to find the open ports
	const openPorts = netstat.match(new RegExp(game.IP + ':([0-9]*)', 'g'));
	if (openPorts) {
		// Filter out the game port and rinfo port
		const filteredPorts = openPorts.filter(port => {
			const portNumber = parseInt(port.split(':')[1], 10);
			return portNumber !== parseInt(game.Port) && portNumber !== rinfo.port;
		});

		// Assuming the game is using the first open port
		if (filteredPorts.length > 0) {
			if (returnPort === -1) {
				returnPort = parseInt(filteredPorts[0].split(':')[1], 10);
			}
		}
	}

	return returnPort;
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
				let appExt = process.platform === 'win32' ? '.exe' : process.platform === 'darwin' ? '.app' : '';
				let containsUnity = stdout.match(new RegExp(`Unity${appExt}`, 'g'));
				resolve(containsUnity !== null);
			}
		});
	});
}

async function processGame(games, game, rinfo, isEditor = false) {
	const os = require('os');

	let ipAndPort = extractIpAndPort(game.Id);
	//NOTE: This is a workaround for the case where the IP and port are not included in the game.Id
	if (ipAndPort.success === false) {
		let debugPort;
		let isLocalHost = false;
		if (isEditor) {
			isLocalHost = true;
		} else {
			const networkInterfaces = os.networkInterfaces();
			for (const name of Object.keys(networkInterfaces)) {
				for (const net of networkInterfaces[name]) {
					if (net.family === 'IPv4' && !net.internal) {
						if (net.address === game.IP) {
							isLocalHost = true;
							break;
						}
					}
				}
				if (isLocalHost) {
					break;
				}
			}
		}

		let currentPlatform = os.platform();
		if (isLocalHost) {
			if (currentPlatform === 'darwin') {
				debugPort = await getDebugPortFromLocalProcessesMacOs(game, rinfo, isEditor);
			} else if (currentPlatform === 'win32') {
				debugPort = await getDebugPortFromLocalProcessesWindows(game, rinfo);
			} else if (currentPlatform === 'linux') {
				debugPort = await getDebugPortFromLocalProcessesLinux(game, rinfo);
			} else {
				vscode.window.showErrorMessage(`Unsupported platform: ${currentPlatform}`);
				return;
			}
		}
		else {
			if (currentPlatform === 'darwin') {
				debugPort = await getDebugPortFromRemoteProcessesMacOs(game, rinfo);
			} else if (currentPlatform === 'win32') {
				debugPort = await getDebugPortFromRemoteProcessesWindows(game, rinfo);
			} else if (currentPlatform === 'linux') {
				debugPort = await getDebugPortFromRemoteProcessesLinux(game, rinfo);
			} else {
				vscode.window.showErrorMessage(`Unsupported platform: ${currentPlatform}`);
				return;
			}
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
							description: `${g.ProjectName} ${g.debugIp}:${g.debugPort} (${g.PackageName})`
						}
					});
				});
			});

			let unityRunning = isUnityRunning();
			unityRunning.then((value) => {
				if (value === true) {
					let game = {
						Id: 'Unity Editor',
						IP: '127.0.0.1',
						ProjectName: 'Unity',
						PackageName: '-',
						debugIp: '127.0.0.1',
						isEditor: true
					};

					processGame(games, game, { port: 56000 }, true).then(() => {
						quickPick.items = games.map(g => {
							return {
								label: g.Id,
								description: `${g.ProjectName} ${g.debugIp}:${g.debugPort} (${g.PackageName})`
							}
						});
					});
				}
			});

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
						endPoint: `${selectedGameInfo.debugIp}:${selectedGameInfo.debugPort}`
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
